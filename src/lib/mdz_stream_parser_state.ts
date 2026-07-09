/**
 * Streaming parser state and low-level operations.
 *
 * Free functions take a `MdzStreamParserState` first parameter so handlers can
 * live in separate sibling modules — JS private (`#`) fields can't cross
 * module boundaries.
 *
 * @module
 */

import type {MdzNodeTypeContainer, MdzNodeId, MdzOpcode} from './mdz_opcodes.ts';
import type {MdzTableCellParser} from './mdz.ts';
import {NEWLINE, has_non_whitespace, mdz_heading_id_from_text} from './mdz_helpers.ts';
import {mdz_debug_work} from './mdz_debug_work.ts';

/**
 * Tri-state result for `try_*` parser handlers.
 * - `'consumed'`: input matched and the parser advanced
 * - `'need_more'`: input is potentially valid but more bytes are required to decide
 * - `'not_match'`: input definitely doesn't match — caller falls through to the next handler
 *
 * @nodocs
 */
export type TryResult = 'consumed' | 'need_more' | 'not_match';

/** @nodocs */
export interface StackEntry {
	id: MdzNodeId;
	node_type: MdzNodeTypeContainer;
	/**
	 * The opening delimiter text, used as `replacement_text` on revert.
	 * Empty for the block frames (`Paragraph`, `Heading`), which are never
	 * reverted — every inline open is optimistic (speculative, reverted if not
	 * closed), so the revert loops don't need a per-entry flag.
	 */
	delimiter: string;
	/** Tag name for Element/Component entries, `undefined` for all others. */
	tag_name: string | undefined;
	/** Whether any child content has been emitted inside this container. */
	has_children: boolean;
	/**
	 * Whether any non-whitespace text or non-text child has been emitted
	 * inside this container. Only tracked for `Paragraph` entries to detect
	 * whitespace-only paragraphs that should be dropped at close.
	 */
	has_non_whitespace_content: boolean;
	/** Global byte offset of the opening delimiter. */
	start: number;
}

/**
 * Memo entry for `buffer_index_of`, in **global** byte coordinates (see
 * `MdzStreamParserState.base_offset`). Global coordinates make the memo
 * immune to front-compaction: content at a global offset never changes once
 * fed, so a found result stays valid forever and a not-found result stays
 * valid for the byte range it scanned (`searched_to`).
 *
 * @nodocs
 */
export interface BufferSearchMemo {
	/** Global byte offset the memoized scan started from. */
	from: number;
	/** Global byte offset of the found occurrence, or `-1` when not found. */
	result: number;
	/** Global byte offset of the buffer end when the scan ran — the extent a `-1` result covers. */
	searched_to: number;
}

/** @nodocs */
export interface CodeblockState {
	id: MdzNodeId;
	backtick_count: number;
	text_id: MdzNodeId | null;
	/**
	 * The opener line's indent — 0 for top-level fences, the marker-relative
	 * line indent for in-item fences. Closers match at any indent <= this,
	 * and content lines strip `min(fence_indent, line_indent)`.
	 */
	fence_indent: number;
	/** Global byte offset of the opening fence. */
	start: number;
}

/**
 * An open list level — the column of its markers, mirroring the sync lexer's stack.
 *
 * @nodocs
 */
export interface MdzListLevel {
	indent: number;
	ordered: boolean;
}

/**
 * An open blockquote — the streaming analogue of the sync lexer's quote
 * sub-lex. A quote's content is a mini-document behind the per-line prefix,
 * so the quote owns a **nested parser state**: the outer parser strips one
 * prefix level per line and feeds the remainder (including each line's
 * terminating newline) to `inner`, whose opcodes pass through with positions
 * remapped to source offsets. Nesting recurses — `inner` opens its own quote
 * for deeper prefixes — so the outer parser tracks at most one quote
 * directly. The id counter is shared (`inner.next_id` seeds from the outer's
 * and syncs back at close), so pass-through opcodes need no id remapping.
 *
 * @nodocs
 */
export interface MdzBlockquoteState {
	/** The Blockquote frame's node id. */
	id: MdzNodeId;
	/** The nested parser state for the quote's content document. */
	inner: MdzStreamParserState;
	/**
	 * Affine segments mapping inner-document offsets to global source
	 * offsets — one per quote line; the line's content and terminating
	 * newline are contiguous in both coordinate spaces.
	 */
	segments: Array<{inner_start: number; source_start: number}>;
	/** Total bytes fed to the inner document so far. */
	inner_len: number;
	/**
	 * Inner-coordinate end of each live text node, tracked so forwarded
	 * `append_text` opcodes can carry explicit remapped `end`s — an implied
	 * extend-by-content-length is wrong across the prefix gap at line
	 * boundaries.
	 */
	text_inner_ends: Map<MdzNodeId, number>;
	/** The attach item's marker indent for in-item quotes; -1 at top level. */
	item_indent: number;
}

/**
 * Counts of open inline containers by type, letting `find_open` answer the
 * common "nothing open" case in O(1) instead of walking a stack that can grow
 * arbitrarily deep with unclosed optimistic tags (tag-dense single-paragraph
 * input leaks one `<Tag>` frame per line). Only the types `find_open` is
 * queried with are counted. The counts are run-scoped for free: every run
 * frame below the current one sealed by reverting its inlines (decrementing
 * their counts), so all counted entries sit above the innermost run boundary
 * (Paragraph, Heading, or ListItem).
 *
 * @nodocs
 */
export interface OpenInlineCounts {
	Bold: number;
	Italic: number;
	Strikethrough: number;
	Link: number;
}

/**
 * Pending auto-link URL/path state for text-first rendering.
 * When set, URL chars flow as visible text. On terminator, a `wrap` opcode
 * retroactively wraps the text node in a Link.
 *
 * For URLs, `confirmed` starts false during speculative prefix matching
 * (chars stream as text while we verify `https://` or `http://`).
 * For paths, `confirmed` starts true (prefix already validated by hold).
 *
 * @nodocs
 */
export interface PendingUrl {
	url_text: string;
	start: number;
	link_type: 'external' | 'internal';
	/** Whether the URL/path prefix has been fully confirmed. */
	confirmed: boolean;
	/** Prefix match tracking — only used when `!confirmed`. */
	viable_https: boolean;
	viable_http: boolean;
}

/**
 * Mutable state for the streaming parser. One instance per `MdzStreamParser`.
 * Handlers in sibling modules take this as their first parameter — the streaming
 * parser uses free functions, not class methods, so state crosses module
 * boundaries.
 *
 * @nodocs
 */
export interface MdzStreamParserState {
	buffer: string;
	pos: number;
	opcodes: Array<MdzOpcode>;
	next_id: MdzNodeId;
	stack: Array<StackEntry>;
	column: number;
	prev_char: number;
	active_text_id: MdzNodeId | null;
	accumulated_text: string;
	accumulated_text_start: number;
	/**
	 * Global byte offset just past the accumulated text's source span. Equals
	 * `accumulated_text_start + accumulated_text.length` except when list
	 * continuation lines strip structural indent — content is then shorter
	 * than its source span, and flushes carry this so consumers keep
	 * source-accurate node `end`s.
	 */
	accumulated_text_end: number;
	codeblock: CodeblockState | null;
	/**
	 * Open list levels, deepest last — the streaming analogue of the sync
	 * lexer's level stack in `#tokenize_list`. Non-empty exactly while
	 * List/ListItem frames are on `stack`; newlines then route to the list
	 * line classifier instead of the top-level paragraph-break scan.
	 */
	list_levels: Array<MdzListLevel>;
	/**
	 * The open blockquote, or null. While set, all input routes through the
	 * quote (prefix stripping + nested-parser feeding) — see `MdzBlockquoteState`.
	 */
	blockquote: MdzBlockquoteState | null;
	/**
	 * The open table, or null. While set, each line is consumed as a body row
	 * (or ends the table) by `process_table_line`. Holds the `Table` frame's id
	 * so the table can be closed when a non-row line or EOF ends it. `item_indent`
	 * is `null` for a top-level table (column-0 rows) or the enclosing list item's
	 * marker indent for a table nested as a block child (rows skip the indent and
	 * a dedent to that indent ends the table, returning control to the list).
	 * `cell_parser` is the table's shared cell parser, rebound per row.
	 */
	table: {id: MdzNodeId; item_indent: number | null; cell_parser: MdzTableCellParser} | null;
	/**
	 * Whether the innermost open ListItem's first inline run is current.
	 * Content then flows directly into the ListItem frame — the sync AST
	 * keeps an item's first run as direct children — so `ensure_paragraph`
	 * is suppressed. Cleared when the run ends (blank line, dedent, block
	 * child); later runs in the item open `Paragraph` block children.
	 */
	in_list_item_run: boolean;
	/**
	 * Source end (just past the marker chars) of the most recently opened
	 * empty list item — the close opcode's `end` when an item closes
	 * childless, mirroring the sync parser's `open.end` fallback. One slot
	 * suffices: only empty items can close childless, and at most one can be
	 * open untouched (anything emitted after it opened becomes its child;
	 * a sibling closes it before the next empty item opens).
	 */
	last_empty_item_end: number;
	/** Global byte offset of the start of `buffer`. */
	base_offset: number;
	/**
	 * Per-needle search memo for `buffer_index_of`, keyed by needle.
	 * Created lazily — only `code_search_limit`'s cold path uses it, and the
	 * per-parser `Map` allocation is measurable on tiny inputs.
	 */
	search_memo: Map<string, BufferSearchMemo> | null;
	/** Open-container counts for `find_open`'s O(1) "nothing open" early exit. */
	open_counts: OpenInlineCounts;
	/**
	 * Count of open `Link`/`Element`/`Component` frames in the current run — the
	 * streaming analogue of the sync lexer's `#inline_depth`. Kept as an O(1)
	 * counter (not a stack walk, which would reintroduce the deep-stack
	 * quadratic `open_counts` exists to avoid) so `try_link_open`/`try_tag_open`
	 * can cap nesting at `MAX_INLINE_NESTING_DEPTH` — rendering a deeper `[`/`<`
	 * literal, matching the sync cap on pure/symmetric nesting. It counts
	 * **optimistic** opens, though, so it diverges from the sync `#inline_depth`
	 * (which the sync tag path only bumps after a closer precheck) on an
	 * asymmetric cap-saturating prefix — 100+ *unclosed* `<a>` before a valid
	 * `[x](/u)` saturates this counter and suppresses the trailing link that sync
	 * still forms. Adversarial-only, documented not fixed (streaming can't
	 * precheck closers): see the flip-at-cap case in `mdz_nesting_cap.test.ts`.
	 * Run-scoped for free like `open_counts`: a
	 * run close reverts every inline frame above it, decrementing back to zero.
	 */
	open_link_tag_depth: number;
	/**
	 * Per-name counts of open Element/Component frames, the tag analogue of
	 * `open_counts`: `try_close_tag` bails in O(1) when the closing name isn't
	 * open, instead of walking a stack that grows one frame per leaked unclosed
	 * `<Tag>`. Lazily created on the first tag open — tag-free inputs never
	 * allocate the map. Run-scoped like `open_counts`: run closes revert every
	 * inline frame above them, decrementing the counts back to zero.
	 */
	open_tag_counts: Map<string, number> | null;
	/** Whether we're inside a heading (newline ends it). */
	in_heading: boolean;
	/** Whether we're inside an optimistic inline Code container. */
	in_code: boolean;
	/** Cached flag: whether a Paragraph is open on the stack. */
	in_paragraph: boolean;
	pending_url: PendingUrl | null;
	/**
	 * Stack of text segments for heading ID computation.
	 * Each open container inside a heading pushes a new segment.
	 * On close: pop and append to parent (children's text is part of heading).
	 * On revert: pop, prepend replacement_text, append to parent
	 * (document order: delimiter text comes before children's text).
	 */
	heading_text_parts: Array<string>;
	/**
	 * When true, absorb the blank region (newlines and whitespace-only lines)
	 * at the current position before normal processing. Set after block-element
	 * closes (codeblock, heading, HR) and paragraph breaks; stays set across
	 * chunks until a content line arrives — needed for char-by-char streaming
	 * where post-block blanks arrive in later chunks. Consumed by
	 * `skip_blank_region` in `mdz_stream_parser.ts`.
	 */
	skip_blank_lines: boolean;
	/**
	 * Stack index of the innermost open `Paragraph`, or `-1` when none.
	 * Lets `mark_paragraph_non_whitespace` skip the stack walk that runs on
	 * every non-whitespace emit. Updated only on Paragraph push/pop (block
	 * boundaries — only one of `Paragraph`/`Heading` can be on the stack
	 * at a time, so the cache is stable across inline pushes/pops).
	 */
	paragraph_stack_idx: number;
	/**
	 * Id of the most-recent `text`/`append_text` emission, used by
	 * `trim_trailing_newline` to target the right opcode after `take_opcodes()`
	 * has drained the queue. `null` after a structural emit (open/close/revert)
	 * sealed the prior text run.
	 */
	last_text_id: MdzNodeId | null;
	/** Whether the most recent text emission's content ended in `'\n'`. */
	last_text_ended_with_newline: boolean;
	/**
	 * Whether the most recent text emission was a `text` opcode (not
	 * `append_text`) with content exactly `'\n'` — trimming the trailing \n
	 * would leave the text node empty, so `active_text_id` must be cleared
	 * to keep subsequent content from merging into a deleted node.
	 */
	last_text_was_singleton_newline: boolean;
}

/** @nodocs */
export const create_state = (): MdzStreamParserState => ({
	buffer: '',
	pos: 0,
	opcodes: [],
	next_id: 0,
	stack: [],
	column: 0,
	prev_char: -1,
	active_text_id: null,
	accumulated_text: '',
	accumulated_text_start: 0,
	accumulated_text_end: 0,
	codeblock: null,
	list_levels: [],
	blockquote: null,
	table: null,
	in_list_item_run: false,
	last_empty_item_end: 0,
	base_offset: 0,
	search_memo: null,
	open_counts: {Bold: 0, Italic: 0, Strikethrough: 0, Link: 0},
	open_link_tag_depth: 0,
	open_tag_counts: null,
	in_heading: false,
	in_code: false,
	in_paragraph: false,
	pending_url: null,
	heading_text_parts: [],
	// matches mdz_parse: leading blank lines before any block are skipped, not
	// preserved as paragraph content
	skip_blank_lines: true,
	paragraph_stack_idx: -1,
	last_text_id: null,
	last_text_ended_with_newline: false,
	last_text_was_singleton_newline: false,
});

/** @nodocs */
export const alloc_id = (state: MdzStreamParserState): MdzNodeId => state.next_id++;

/**
 * Push a new container frame onto the stack. Fills the boilerplate fields
 * (`has_children`, `has_non_whitespace_content`) so call sites only spell out
 * what varies per container type. Keeping the object literal in one place
 * also gives V8 a single monomorphic creation site for `StackEntry`.
 *
 * @nodocs
 */
export const push_stack_entry = (
	state: MdzStreamParserState,
	id: MdzNodeId,
	node_type: MdzNodeTypeContainer,
	start: number,
	delimiter: string = '',
	tag_name?: string,
): void => {
	state.stack.push({
		id,
		node_type,
		delimiter,
		tag_name,
		has_children: false,
		has_non_whitespace_content: false,
		start,
	});
	if (node_type === 'Paragraph') {
		state.paragraph_stack_idx = state.stack.length - 1;
	} else {
		bump_open_count(state, node_type, 1);
	}
	if (tag_name !== undefined) {
		const counts = (state.open_tag_counts ??= new Map());
		counts.set(tag_name, (counts.get(tag_name) ?? 0) + 1);
	}
	// Link/Element/Component contribute to the nesting-depth cap (tag_name is
	// set for Element/Component only, so `Link || tag_name` is exactly the three)
	if (node_type === 'Link' || tag_name !== undefined) state.open_link_tag_depth++;
};

/**
 * Adjust the `open_counts` entry for a counted container type; no-op for
 * uncounted types. Static-key accesses keep the property loads monomorphic —
 * a keyed `counts[type]` access measurably regresses hot push/pop paths.
 *
 * @mutates `state.open_counts`
 */
const bump_open_count = (
	state: MdzStreamParserState,
	node_type: MdzNodeTypeContainer,
	delta: number,
): void => {
	const counts = state.open_counts;
	if (node_type === 'Bold') counts.Bold += delta;
	else if (node_type === 'Italic') counts.Italic += delta;
	else if (node_type === 'Strikethrough') counts.Strikethrough += delta;
	else if (node_type === 'Link') counts.Link += delta;
};

/**
 * Pop the top stack entry, keeping `open_counts` in sync. All pops of inline
 * containers must go through this — the only direct stack removal elsewhere
 * is `revert_failed_close`'s mid-stack splice, which adjusts the count itself.
 *
 * @mutates `state`
 * @nodocs
 */
export const pop_stack_entry = (state: MdzStreamParserState): StackEntry => {
	const entry = state.stack.pop()!;
	bump_open_count(state, entry.node_type, -1);
	if (entry.tag_name !== undefined) {
		const counts = state.open_tag_counts!;
		// drop zero-count keys so a long stream of many distinct tag names can't
		// grow the map unboundedly — the `!counts.get(name)` bail in `try_close_tag`
		// treats a missing key and a 0 count identically, so this is behavior-neutral
		const remaining = counts.get(entry.tag_name)! - 1;
		if (remaining === 0) counts.delete(entry.tag_name);
		else counts.set(entry.tag_name, remaining);
	}
	if (entry.node_type === 'Link' || entry.tag_name !== undefined) state.open_link_tag_depth--;
	return entry;
};

/**
 * Mark the innermost open `Paragraph` as having non-whitespace content,
 * via the `paragraph_stack_idx` cache (O(1) instead of an O(stack) walk).
 *
 * No-op when no Paragraph is open — that includes the Heading case, since
 * block boundaries are mutually exclusive (a Heading on stack means
 * `paragraph_stack_idx === -1`).
 */
const mark_paragraph_non_whitespace = (state: MdzStreamParserState): void => {
	if (state.paragraph_stack_idx === -1) return;
	state.stack[state.paragraph_stack_idx]!.has_non_whitespace_content = true;
};

/**
 * Global byte offset for a local buffer position.
 *
 * @nodocs
 */
export const offset = (state: MdzStreamParserState, pos: number = state.pos): number =>
	state.base_offset + pos;

/**
 * Seal the prior text run so `trim_trailing_newline` can no longer target it.
 * Called when a structural opcode (open/close/revert) ends the run.
 *
 * @mutates `state`
 */
const seal_text_run = (state: MdzStreamParserState): void => {
	state.last_text_id = null;
	state.last_text_ended_with_newline = false;
	state.last_text_was_singleton_newline = false;
};

/**
 * Memoized `String#indexOf` over `state.buffer` against the given memo
 * record, taking and returning **local** buffer positions.
 *
 * The streaming analogue of the sync lexer's memoized `#index_of`: a failed
 * search would otherwise rescan the remaining buffer on every candidate,
 * making inputs dense in unclosed candidates quadratic. Unlike the sync case
 * the buffer mutates — `feed()` appends and the parser compacts consumed
 * bytes from the front — so the memo lives in global byte coordinates
 * (compaction shifts local positions but global content is immutable) and a
 * not-found result records how far it scanned (`searched_to`). After an
 * append, only the new tail is rescanned, backed up by `needle.length - 1`
 * bytes to catch needles straddling the old boundary.
 *
 * A memoized found result earlier than `from` falls through to a fresh scan,
 * same as the sync memo — the parser's scan positions are monotonic, so each
 * needle's missing-suffix region is still scanned at most once per append.
 *
 * @mutates `memo`
 */
const memo_index_of = (
	state: MdzStreamParserState,
	memo: BufferSearchMemo,
	needle: string,
	from: number,
): number => {
	const global_from = state.base_offset + from;
	const global_end = state.base_offset + state.buffer.length;
	if (memo.from <= global_from) {
		if (memo.result >= global_from) return memo.result - state.base_offset;
		if (memo.result === -1) {
			if (memo.searched_to >= global_end) return -1; // nothing appended since
			// rescan only the appended tail, overlapping the old boundary so a
			// straddling needle isn't missed
			const rescan_from = Math.max(global_from, memo.searched_to - (needle.length - 1));
			const local_from = rescan_from - state.base_offset;
			const result = state.buffer.indexOf(needle, local_from);
			if (mdz_debug_work.enabled) {
				mdz_debug_work.total += (result === -1 ? state.buffer.length : result) - local_from;
			}
			memo.from = global_from;
			memo.result = result === -1 ? -1 : state.base_offset + result;
			memo.searched_to = global_end;
			return result;
		}
		// found result already behind `from` — fall through to a fresh scan
	}
	const result = state.buffer.indexOf(needle, from);
	if (mdz_debug_work.enabled) {
		mdz_debug_work.total += (result === -1 ? state.buffer.length : result) - from;
	}
	memo.from = global_from;
	memo.result = result === -1 ? -1 : state.base_offset + result;
	memo.searched_to = global_end;
	return result;
};

/**
 * Memoized buffer search for an arbitrary needle, backed by the per-needle
 * `search_memo` map (created on first use). Used for cold-path scans with
 * dynamic needles — the stack-delimiter searches in `code_search_limit`,
 * where unclosed-tag delimiters absent from the rest of the input would
 * otherwise rescan to the buffer end on every backtick candidate.
 *
 * @mutates `state.search_memo`
 * @nodocs
 */
export const buffer_index_of = (
	state: MdzStreamParserState,
	needle: string,
	from: number,
): number => {
	const map = (state.search_memo ??= new Map());
	let memo = map.get(needle);
	if (memo === undefined) {
		// "scanned [0, 0), found nothing" — memo_index_of handles the full scan
		memo = {from: 0, result: -1, searched_to: 0};
		map.set(needle, memo);
	}
	return memo_index_of(state, memo, needle, from);
};

/**
 * Emit an opcode into the pending batch (drained by `take_opcodes`),
 * maintaining the `has_children`/non-whitespace bookkeeping on open frames.
 *
 * @nodocs
 */
export const emit = (state: MdzStreamParserState, op: MdzOpcode): void => {
	state.opcodes.push(op);
	// mark the innermost container as having children
	if (op.type === 'text' || op.type === 'append_text' || op.type === 'void') {
		const top = state.stack[state.stack.length - 1];
		if (top) {
			top.has_children = true;
			// propagate non-whitespace marker to the nearest Paragraph so
			// whitespace-only paragraphs can be discarded at close — the O(1)
			// no-paragraph check runs first so codeblock/table-cell emissions
			// (never inside a Paragraph) skip the content scan entirely
			if (
				op.type === 'void' ||
				(state.paragraph_stack_idx !== -1 && has_non_whitespace(op.content))
			) {
				mark_paragraph_non_whitespace(state);
			}
		}
	} else if (op.type === 'open') {
		// opening a child container counts as content for the parent
		const parent = state.stack[state.stack.length - 1];
		if (parent) {
			parent.has_children = true;
			mark_paragraph_non_whitespace(state);
		}
	} else if (op.type === 'wrap') {
		// retroactive Link wrap of a text node — the resulting Link is non-whitespace
		mark_paragraph_non_whitespace(state);
	}
	// track the most recent text run so `trim_trailing_newline` can target it
	// after `take_opcodes()` has drained the queue
	if (op.type === 'text') {
		state.last_text_id = op.id;
		state.last_text_ended_with_newline = op.content.endsWith('\n');
		state.last_text_was_singleton_newline = op.content === '\n';
	} else if (op.type === 'append_text') {
		state.last_text_id = op.id;
		state.last_text_ended_with_newline = op.content.endsWith('\n');
		// append_text builds on a prior text node; the underlying node can't be
		// singleton even if this appended chunk is just '\n'
		state.last_text_was_singleton_newline = false;
	} else if (op.type === 'open' || op.type === 'close' || op.type === 'revert') {
		seal_text_run(state);
	}
	// track text content for heading ID computation
	if (state.in_heading && state.heading_text_parts.length > 0) {
		if (op.type === 'text' || op.type === 'append_text') {
			state.heading_text_parts[state.heading_text_parts.length - 1] += op.content;
		} else if (op.type === 'open') {
			// child container: push a new segment for its text content
			state.heading_text_parts.push('');
		} else if (op.type === 'close') {
			// normal close: pop child's text and merge into parent
			if (state.heading_text_parts.length > 1) {
				const child_text = state.heading_text_parts.pop()!;
				state.heading_text_parts[state.heading_text_parts.length - 1] += child_text;
			}
		} else if (op.type === 'revert') {
			// revert: pop child's text, prepend replacement (document order), merge into parent
			if (state.heading_text_parts.length > 1) {
				const child_text = state.heading_text_parts.pop()!;
				state.heading_text_parts[state.heading_text_parts.length - 1] +=
					(op.replacement_text || '') + child_text;
			}
		}
	}
};

/**
 * Accumulate text, tracking the source span (start of the first character, end past the last).
 *
 * @nodocs
 */
export const accumulate_text = (
	state: MdzStreamParserState,
	text: string,
	start_offset: number,
): void => {
	if (state.accumulated_text.length === 0) {
		state.accumulated_text_start = start_offset;
	}
	state.accumulated_text += text;
	state.accumulated_text_end = start_offset + text.length;
};

/**
 * Extend the accumulated text's source span past content that was stripped
 * from it — a list continuation line's structural indent. The sync parser
 * attributes the stripped region to the preceding text token, so node `end`s
 * stay source-accurate across both pipelines.
 *
 * @mutates `state`
 * @nodocs
 */
export const extend_accumulated_end = (state: MdzStreamParserState, end: number): void => {
	state.accumulated_text_end = end;
};

/**
 * Flush accumulated text as a text or append_text opcode. Opcode `end`s come
 * from the tracked source span, which can outgrow the content length when
 * list continuation lines strip structural indent.
 *
 * @nodocs
 */
export const flush_text = (state: MdzStreamParserState): void => {
	if (state.accumulated_text.length === 0) return;
	if (state.active_text_id !== null) {
		emit(state, {
			type: 'append_text',
			id: state.active_text_id,
			content: state.accumulated_text,
			end: state.accumulated_text_end,
		});
	} else {
		ensure_paragraph(state);
		const id = alloc_id(state);
		const start = state.accumulated_text_start;
		emit(state, {
			type: 'text',
			id,
			content: state.accumulated_text,
			text_type: 'Text',
			start,
			end: state.accumulated_text_end,
		});
		state.active_text_id = id;
	}
	state.accumulated_text = '';
};

/**
 * Open a Paragraph frame unless a run frame is already current — an open
 * paragraph or heading, or a list item's first inline run (which flows
 * directly into the ListItem frame, matching the sync AST's direct-children
 * shape).
 *
 * @nodocs
 */
export const ensure_paragraph = (state: MdzStreamParserState): void => {
	if (state.in_heading || state.in_paragraph || state.in_list_item_run) return;
	const id = alloc_id(state);
	const start = offset(state);
	emit(state, {type: 'open', id, node_type: 'Paragraph', start});
	push_stack_entry(state, id, 'Paragraph', start);
	state.in_paragraph = true;
};

/**
 * Whether a stack frame bounds an inline run — inline pairs never cross a
 * Paragraph, Heading, or ListItem frame (an item's first run is a
 * paragraph-equivalent region; a List frame is never the innermost frame
 * under inline content, so checking it is unnecessary).
 *
 * @nodocs
 */
export const is_run_boundary = (node_type: MdzNodeTypeContainer): boolean =>
	node_type === 'Paragraph' || node_type === 'Heading' || node_type === 'ListItem';

/**
 * Find the innermost open container of a given type.
 * Returns stack index, or -1 if not found.
 * Does not cross run boundaries (Paragraph, Heading, ListItem).
 *
 * The "nothing open" case is O(1) via `open_counts` — without it, every
 * candidate char in a deep-stack paragraph (unclosed optimistic tags leak
 * one frame per line) walks to the block boundary, going quadratic.
 *
 * @nodocs
 */
export const find_open = (state: MdzStreamParserState, type: keyof OpenInlineCounts): number => {
	const counts = state.open_counts;
	const count =
		type === 'Bold'
			? counts.Bold
			: type === 'Italic'
				? counts.Italic
				: type === 'Strikethrough'
					? counts.Strikethrough
					: counts.Link;
	if (count === 0) return -1;
	for (let i = state.stack.length - 1; i >= 0; i--) {
		const entry = state.stack[i]!;
		if (entry.node_type === type) return i;
		if (is_run_boundary(entry.node_type)) return -1;
	}
	return -1;
};

/**
 * Revert all stack entries above the given index. Every inline open is
 * optimistic, so anything above a known frame is revertable by construction.
 *
 * @nodocs
 */
export const revert_above = (state: MdzStreamParserState, target_idx: number): void => {
	while (state.stack.length - 1 > target_idx) {
		const entry = pop_stack_entry(state);
		if (entry.node_type === 'Code') state.in_code = false;
		emit(state, {
			type: 'revert',
			id: entry.id,
			replacement_text: entry.delimiter,
			start: entry.start,
		});
	}
	state.active_text_id = null;
};

/**
 * Revert an open `Italic` whose first closer candidate failed its boundary
 * check (italic is the only inline with closer-boundary rules). One-shot
 * parsing greedy-rejects the opener at the first invalid closer, so once a
 * failed candidate is seen, the optimistic open is known wrong — reverting
 * immediately (instead of leaving the container open for a later closer)
 * keeps chunked output identical to the one-shot parse.
 *
 * Unlike `revert_above`, this reverts a possibly
 * **mid-stack** entry: containers opened above it (e.g. a Bold inside the
 * failed Italic) stay open — the one-shot parse opens them at top level, and
 * the consumers' revert handlers re-parent them identically (the reverted
 * node is still its parent's last child; see `mdz_opcodes_to_nodes` and
 * `MdzStreamState`).
 *
 * Bypasses `emit` for the opcode push: `emit`'s heading-segment handling
 * assumes the reverted container is the innermost open one, which doesn't
 * hold mid-stack — the segment merge here targets the reverted frame's own
 * segment, keeping the segments of still-open frames above it live.
 *
 * @mutates `state`
 * @nodocs
 */
export const revert_failed_close = (state: MdzStreamParserState, stack_idx: number): void => {
	flush_text(state);
	const entry = state.stack[stack_idx]!;
	const frames_above = state.stack.length - 1 - stack_idx;
	state.stack.splice(stack_idx, 1);
	bump_open_count(state, entry.node_type, -1);
	if (entry.tag_name !== undefined) {
		const counts = state.open_tag_counts!;
		// drop zero-count keys so a long stream of many distinct tag names can't
		// grow the map unboundedly — the `!counts.get(name)` bail in `try_close_tag`
		// treats a missing key and a 0 count identically, so this is behavior-neutral
		const remaining = counts.get(entry.tag_name)! - 1;
		if (remaining === 0) counts.delete(entry.tag_name);
		else counts.set(entry.tag_name, remaining);
	}
	// only ever reverts an Italic today, but keep the depth counter honest if a
	// Link/Element/Component is ever failed-closed mid-stack
	if (entry.node_type === 'Link' || entry.tag_name !== undefined) state.open_link_tag_depth--;
	state.opcodes.push({
		type: 'revert',
		id: entry.id,
		replacement_text: entry.delimiter,
		start: entry.start,
	});
	// structural opcode seals the prior text run (mirrors `emit`)
	seal_text_run(state);
	// heading slug bookkeeping: fold the reverted frame's segment into its
	// parent segment, delimiter text first (document order)
	if (state.in_heading && state.heading_text_parts.length > 1) {
		const seg_idx = state.heading_text_parts.length - 1 - frames_above;
		if (seg_idx >= 1) {
			const seg = state.heading_text_parts.splice(seg_idx, 1)[0]!;
			state.heading_text_parts[seg_idx - 1] += entry.delimiter + seg;
		}
	}
	state.active_text_id = null;
};

/**
 * Trim a trailing newline from paragraph content.
 * Checks unflushed accumulated text first; otherwise emits a `trim_text`
 * opcode targeting the most recent text/append_text via the tracking fields
 * on `state` (which survive `take_opcodes()` drains). The opcode stream
 * stays append-only — no retroactive opcode mutation.
 *
 * @nodocs
 */
export const trim_trailing_newline = (state: MdzStreamParserState): void => {
	if (state.accumulated_text.endsWith('\n')) {
		state.accumulated_text = state.accumulated_text.slice(0, -1);
		return;
	}
	if (state.last_text_id === null || !state.last_text_ended_with_newline) return;
	// emit trim opcode; consumer adjusts content and removes empty nodes
	emit(state, {type: 'trim_text', id: state.last_text_id, count: 1});
	// if this trim empties a singleton text node, clear active_text_id so
	// subsequent content doesn't merge into a deleted node via append_text
	if (state.last_text_was_singleton_newline) {
		state.active_text_id = null;
	}
	// after trim, the prior text no longer ends in \n — guard against re-trim
	state.last_text_ended_with_newline = false;
	state.last_text_was_singleton_newline = false;
};

/** @nodocs */
export const close_paragraph = (state: MdzStreamParserState): void => {
	// find and close the paragraph on the stack
	for (let i = state.stack.length - 1; i >= 0; i--) {
		if (state.stack[i]!.node_type === 'Paragraph') {
			// trim trailing newline from paragraph content
			trim_trailing_newline(state);
			revert_above(state, i);
			const entry = pop_stack_entry(state);
			// drop whitespace-only paragraphs to match `mdz_parse`'s output;
			// consumers (`mdz_opcodes_to_nodes`, `MdzStreamState`) honor `discard`
			// by removing the node and its descendants from the tree
			const discard = !entry.has_non_whitespace_content;
			emit(
				state,
				discard
					? {type: 'close', id: entry.id, end: offset(state), discard: true}
					: {type: 'close', id: entry.id, end: offset(state)},
			);
			state.active_text_id = null;
			state.in_paragraph = false;
			state.paragraph_stack_idx = -1;
			return;
		}
	}
};

/** @nodocs */
export const close_heading = (state: MdzStreamParserState): void => {
	// find the heading frame and revert the open inlines above it (before
	// clearing in_heading, so revert replacement text is captured in
	// heading_text_parts)
	let heading_idx = -1;
	for (let i = state.stack.length - 1; i >= 0; i--) {
		if (state.stack[i]!.node_type === 'Heading') {
			heading_idx = i;
			break;
		}
	}
	if (heading_idx !== -1) {
		revert_above(state, heading_idx);
	}
	// compute heading ID from accumulated text before clearing heading state
	const heading_text = state.heading_text_parts.join('');
	state.heading_text_parts = [];
	state.in_heading = false;
	if (heading_idx === -1) return;
	const heading_id = mdz_heading_id_from_text(heading_text);
	// the heading is now the top of the stack
	const entry = pop_stack_entry(state);
	emit(state, {type: 'close', id: entry.id, end: offset(state), heading_id});
	state.active_text_id = null;
};

/**
 * Close a codeblock left open at EOF. Raw mode is absolute — an unclosed
 * fence consumes to EOF as content — so this is a plain close after trimming
 * one trailing newline, matching closed fences' content shape (which
 * excludes the newline before the closer line) and the sync parser's
 * unclosed-fence trim.
 *
 * @nodocs
 */
export const close_codeblock_at_eof = (state: MdzStreamParserState): void => {
	if (!state.codeblock) return;
	// in-item content emits line-by-line with '\n' separators and never gains
	// a trailing newline, so only top-level bulk emission needs the trim
	if (state.codeblock.fence_indent === 0) {
		trim_trailing_newline(state);
	}
	emit(state, {type: 'close', id: state.codeblock.id, end: offset(state)});
	state.codeblock = null;
};

/**
 * Seal the innermost ListItem's first inline run: flush text and revert the
 * optimistic inlines above the ListItem frame. The item itself stays open —
 * block children (nested lists, paragraphs, code blocks) may follow.
 *
 * @nodocs
 */
export const seal_list_item_run = (state: MdzStreamParserState): void => {
	if (!state.in_list_item_run) return;
	flush_text(state);
	for (let i = state.stack.length - 1; i >= 0; i--) {
		if (state.stack[i]!.node_type === 'ListItem') {
			revert_above(state, i);
			break;
		}
	}
	state.in_list_item_run = false;
	state.active_text_id = null;
};

/**
 * Close the current inline run inside a list, whichever frame holds it: a
 * `Paragraph` block child closes, an item's first run seals. No-op when no
 * run is current (post-blank, post-block-child).
 *
 * @nodocs
 */
export const close_list_run = (state: MdzStreamParserState): void => {
	if (state.in_paragraph) {
		flush_text(state);
		close_paragraph(state);
	} else {
		seal_list_item_run(state);
	}
};

/**
 * Close the deepest open level's current item. The run must already be
 * sealed/closed, leaving the ListItem frame on top of the stack. A childless
 * close means an empty item — its `end` is the marker end recorded at open
 * (the sync parser's `open.end` fallback); otherwise consumers derive the
 * node's `end` from its children, so the offset here is cosmetic.
 *
 * @nodocs
 */
export const close_list_item = (state: MdzStreamParserState): void => {
	const entry = pop_stack_entry(state);
	emit(state, {
		type: 'close',
		id: entry.id,
		end: entry.has_children ? offset(state) : state.last_empty_item_end,
	});
	state.active_text_id = null;
};

/**
 * Close the deepest open level: its current item, then its list.
 *
 * @nodocs
 */
export const close_list_level = (state: MdzStreamParserState): void => {
	close_list_item(state);
	const entry = pop_stack_entry(state);
	emit(state, {type: 'close', id: entry.id, end: offset(state)});
	state.list_levels.pop();
};

/**
 * Close every open list level — the whole stack — sealing the item's first
 * run if current. A current `Paragraph` block child must be closed by the
 * caller first (`close_paragraph` in `finish()`, `close_list_run` in the
 * classifier).
 *
 * @nodocs
 */
export const close_all_list_levels = (state: MdzStreamParserState): void => {
	if (state.list_levels.length === 0) return;
	seal_list_item_run(state);
	while (state.list_levels.length > 0) {
		close_list_level(state);
	}
};

/** @nodocs */
export const handle_paragraph_break = (state: MdzStreamParserState): void => {
	flush_text(state);
	// `close_paragraph` reverts everything above the paragraph frame itself.
	// Its trailing-newline trim runs before those reverts, but the ordering is
	// unobservable here: content at a paragraph break never ends in `\n` (the
	// break's first newline is absorbed by `skip_blank_region`, and a lone held
	// `\n` at buffer end never accumulates), so there's never a trim to emit.
	close_paragraph(state);
	// the break's newlines and blank lines are absorbed by `skip_blank_region`
	// at the top of the process loop, which also carries the absorb across
	// chunks — otherwise a blank run split mid-stream would leak a leading
	// `\n` into the next paragraph's text
	state.skip_blank_lines = true;
	state.column = 0;
	state.prev_char = NEWLINE;
};
