/**
 * Streaming opcode parser for mdz.
 *
 * Fed chunks of text (e.g., from LLM output), emits opcodes as rendering
 * instructions. Makes optimistic assumptions about ambiguous syntax and
 * emits `revert` opcodes to correct when wrong. Never re-parses —
 * corrections are bounded, explicit opcodes (`revert`, `wrap`, `trim_text`).
 *
 * The design is derived from
 * {@link https://bsky.app/profile/pngwn.at/post/3mi527zntb22n @pngwn.at}'s
 * ideas: restrict the syntax so streaming is tractable, render
 * optimistically and correct when wrong, emit serializable opcodes to avoid
 * re-parsing, and keep the opcodes target-agnostic so any renderer can
 * consume them. mdz diverges in one respect: the Svelte consumer
 * (`MdzStreamState`) does build a reactive tree from opcodes — the platform
 * dictates this — but mutations are fine-grained via `$state`, not diffed.
 *
 * The parser is split across sibling modules: this file holds the public
 * `MdzStreamParser` class and the `process_loop` / `process_inline`
 * orchestrators. Per-category handlers (block / inline / link / url / text)
 * live in `mdz_stream_parser_*.ts` as free functions taking the shared
 * `MdzStreamParserState` as first argument.
 *
 * Usage:
 * ```ts
 * const parser = new MdzStreamParser();
 * parser.feed('hello **bold');
 * const ops1 = parser.take_opcodes(); // open Paragraph, text "hello ", open Bold, text "bold"
 * parser.feed('** world');
 * const ops2 = parser.take_opcodes(); // close Bold, text " world"
 * parser.finish();
 * const ops3 = parser.take_opcodes(); // close Paragraph
 * ```
 *
 * @module
 */

import type {MdzOpcode} from './mdz_opcodes.ts';
import {
	BACKTICK,
	ASTERISK,
	UNDERSCORE,
	TILDE,
	NEWLINE,
	HYPHEN,
	HASH,
	PIPE,
	LEFT_ANGLE,
	RIGHT_ANGLE,
	SLASH,
	LEFT_BRACKET,
	RIGHT_BRACKET,
	H_LOWER,
	H_UPPER,
	PERIOD,
	SPACE,
	ZERO,
	NINE,
	is_word_char,
	is_line_whitespace,
	mdz_match_blockquote_prefix,
	mdz_blockquote_line_has_content,
	mdz_blockquote_strip_width,
	mdz_remap_segments,
} from './mdz_helpers.ts';
import {
	type MdzStreamParserState,
	type TryResult,
	accumulate_text,
	alloc_id,
	close_all_list_levels,
	close_codeblock_at_eof,
	close_heading,
	close_paragraph,
	create_state,
	emit,
	find_open,
	flush_text,
	handle_paragraph_break,
	offset,
	pop_stack_entry,
	push_stack_entry,
	revert_failed_close,
} from './mdz_stream_parser_state.ts';
import {
	process_codeblock,
	process_codeblock_forced,
	process_codeblock_in_item,
	try_codeblock_open,
	try_heading,
	try_hr,
} from './mdz_stream_parser_block.ts';
import {process_list_line, try_list_start} from './mdz_stream_parser_list.ts';
import {close_table, process_table_line, try_table_start} from './mdz_stream_parser_table.ts';
import {
	check_close_word_boundary,
	close_delimiter,
	process_code_content,
	try_code,
	try_double_delimiter,
	try_italic,
} from './mdz_stream_parser_inline.ts';
import {
	try_close_tag,
	try_complete_link,
	try_link_open,
	try_tag_open,
} from './mdz_stream_parser_link.ts';
import {
	complete_pending_url,
	process_url_content,
	start_speculative_url,
	try_auto_path_absolute,
	try_auto_path_relative,
	try_auto_url_forced,
} from './mdz_stream_parser_url.ts';
import {consume_delimiter_as_text, consume_text_run} from './mdz_stream_parser_text.ts';

/**
 * Streaming opcode parser for mdz content.
 * Feed chunks via `feed()`, retrieve opcodes via `take_opcodes()`, call `finish()` at end.
 *
 * The opcode sequence is not deterministic across chunk boundaries — the same input
 * fed in different chunk sizes may produce different `text`/`append_text` splits and
 * different optimistic/revert sequences. The final tree (via `mdz_opcodes_to_nodes`)
 * matches the one-shot result: optimistic opens are corrected by `revert` opcodes
 * at the first failed closer, at run close (paragraph, heading, or list-item
 * run), or at EOF, and at EOF the delimiter-paired opens
 * (bold/italic/strikethrough) and inline-code candidates are gated on a closer
 * scan of the complete final buffer, so held tails parse like the one-shot
 * parse. The residual divergence classes are:
 *
 * - **Backtick-adjacent chunking** — an inline-code candidate held across
 *   chunks can make its text-vs-code decision bounded by a wrongly-optimistic
 *   italic (opened before its failed closer was visible), where the one-shot
 *   parse greedy-rejects that italic and scans unbounded — `` _`__` ``
 *   chunked at the italic stays flat text where one-shot parses the code span.
 *   Italic is the only wedge (the only delimiter whose one-shot form rejects
 *   on a failed first closer); see `try_code`'s hold and `code_search_limit`.
 * - **Optimistic inline code unclosed at EOF** — a `` ` `` that opened
 *   optimistically consumes its tail as raw code text, so formatting inside it
 *   never forms (`` h `x **b** z `` stays flat where one-shot parses the bold);
 *   the parser never re-parses, so the EOF revert can only flatten it to text.
 * - **Link/tag opens at EOF** — `finish()` doesn't open links or tags, so a held
 *   tail containing complete `[text](url)` / `<Tag>…</Tag>` syntax parses flat.
 * - **Block elements interrupt optimistic inlines** — at column 0 a
 *   heading/HR/fence/list/blockquote line interrupts the open paragraph even when an
 *   optimistic inline container spans it (`**a\n# h\nb**` parses the heading
 *   here; the one-shot parse, knowing the closer exists, swallows the line as
 *   bold text). Inherent: the swallow is only correct when a closer eventually
 *   arrives, which streaming can't know — interrupting matches the one-shot
 *   parse on the no-closer flip side (`**a\n# h`) and renders blocks promptly.
 *
 * Lifecycle: one parser instance per stream — `feed()` any number of times,
 * `finish()` exactly once, then a final `take_opcodes()`. There is no
 * `reset()`; calling `feed()` or `finish()` after `finish()` is undefined.
 * To restart, construct a new parser (and a new consumer — see
 * `MdzStreamState`).
 */
export class MdzStreamParser {
	#state: MdzStreamParserState = create_state();

	/**
	 * Feed a chunk of text to the parser.
	 * Opcodes are accumulated and retrieved via `take_opcodes()`.
	 */
	feed(chunk: string): void {
		feed_state(this.#state, chunk);
	}

	/**
	 * Signal end of input. Resolves all pending state: closes open blocks,
	 * reverts unclosed optimistic opens, trims trailing newlines.
	 *
	 * Trailing-newline trimming is handled in one place: `trim_trailing_newline()`
	 * called at the top of `close_paragraph()` and `close_codeblock_at_eof()`,
	 * before either function reverts its inner stack. The trim sees the
	 * just-flushed text node's `last_text_id` (or a still-accumulated `\n`) and
	 * emits a `trim_text` opcode. Revert opcodes only fire after.
	 *
	 * Optimistic-container revert is handled by `close_paragraph` and
	 * `close_heading` (each reverts everything above its own block frame via
	 * `revert_above`), so no separate revert pass is needed — optimistic
	 * containers can only exist inside an open Paragraph or Heading (parser
	 * invariant).
	 */
	finish(): void {
		finish_state(this.#state);
	}

	/**
	 * Drain and return all accumulated opcodes.
	 * Destructive — empties the internal queue. The returned array is owned by the caller.
	 */
	take_opcodes(): Array<MdzOpcode> {
		const ops = this.#state.opcodes;
		this.#state.opcodes = [];
		return ops;
	}
}

// -- Drive functions --
// The bodies of `feed`/`finish` as free functions over the state, so the
// blockquote machinery can drive its nested inner parser through the same
// code paths (nested parsing is recursive, which keeps these and
// `process_loop` in one module).

/** Feed a chunk to a parser state — the body of `MdzStreamParser#feed`. */
const feed_state = (state: MdzStreamParserState, chunk: string): void => {
	state.buffer += chunk;
	process_loop(state, false);
	// flush any accumulated text so the renderer shows it immediately
	flush_text(state);
	// drain processed bytes from the buffer
	if (state.pos > 0) {
		state.base_offset += state.pos;
		state.buffer = state.buffer.slice(state.pos);
		state.pos = 0;
	}
};

/** Resolve all pending state at end of input — the body of `MdzStreamParser#finish`. */
const finish_state = (state: MdzStreamParserState): void => {
	// process any remaining buffer — `forced=true` treats ambiguous trailing
	// bytes as concrete content rather than waiting for more input
	if (state.buffer.length > 0) {
		process_loop(state, true);
	}
	// close an open top-level table — forced processing ends it at the last
	// row, but an already-drained buffer (everything consumed) needs this net
	if (state.table) {
		close_table(state);
	}
	// close an open blockquote — finishes its nested inner document (an
	// unclosed fence inside ends at the quote's EOF, which is this) and
	// cascades recursively through deeper quotes
	if (state.blockquote) {
		finish_blockquote(state);
	}
	// finalize pending URL if any (text-first auto-links)
	if (state.pending_url !== null) {
		flush_text(state);
		complete_pending_url(state);
	}
	flush_text(state);
	// close heading if open — internally reverts its inner optimistic stack
	if (state.in_heading) {
		close_heading(state);
	}
	// close paragraph if open (a top-level paragraph or a list item's
	// Paragraph block child) — internally trims trailing \n, reverts its
	// inner optimistic stack, then pops
	close_paragraph(state);
	// close codeblock if open — raw mode is absolute, so an unclosed fence
	// consumed to EOF and gets a plain close (top-level trims trailing \n)
	if (state.codeblock) {
		close_codeblock_at_eof(state);
	}
	// EOF ends any open list: seal the item run, close items and lists
	close_all_list_levels(state);
};

// -- Blockquotes --
// A quote's content is a mini-document behind the per-line prefix, parsed by
// a nested parser state: the outer parser classifies each line's prefix
// (line-bounded holds), strips one level, and feeds the remainder — including
// each line's terminating newline — to the inner document, forwarding its
// opcodes with positions remapped to source offsets. Deeper prefixes nest by
// recursion (the inner parser opens its own quote), so the outer tracks at
// most one quote. The id counter is shared, so ids pass through unmapped.

/**
 * Open a blockquote at `state.pos` (the validated prefix's first `>`).
 * `item_indent` is -1 for top-level quotes or the attach item's marker
 * indent for in-item quotes (block children of a list item).
 */
const open_blockquote = (state: MdzStreamParserState, item_indent: number): void => {
	const id = alloc_id(state);
	const start = offset(state);
	emit(state, {type: 'open', id, node_type: 'Blockquote', start});
	push_stack_entry(state, id, 'Blockquote', start);
	const inner = create_state();
	inner.next_id = state.next_id;
	const strip = state.pos + mdz_blockquote_strip_width(state.buffer, state.pos);
	state.blockquote = {
		id,
		inner,
		segments: [{inner_start: 0, source_start: offset(state, strip)}],
		inner_len: 0,
		text_inner_ends: new Map(),
		item_indent,
	};
	state.pos = strip;
	state.prev_char = SPACE;
	state.active_text_id = null;
};

/** Feed a slice of quote content to the inner document and forward its opcodes. */
const feed_blockquote_inner = (state: MdzStreamParserState, chunk: string): void => {
	const blockquote = state.blockquote!;
	feed_state(blockquote.inner, chunk);
	blockquote.inner_len += chunk.length;
	forward_inner_opcodes(state);
};

/**
 * Drain the inner document's opcodes into the outer stream, remapping
 * positions from inner-document offsets to source offsets. Ids pass through
 * unmapped (the counter is shared). `append_text` always gains an explicit
 * remapped `end` — the implied extend-by-content-length is wrong across the
 * prefix gap at line boundaries — via per-node inner-end tracking.
 */
const forward_inner_opcodes = (state: MdzStreamParserState): void => {
	const blockquote = state.blockquote!;
	const ops = blockquote.inner.opcodes;
	if (ops.length === 0) return;
	blockquote.inner.opcodes = [];
	const {segments, text_inner_ends} = blockquote;
	for (const op of ops) {
		switch (op.type) {
			case 'open':
			case 'revert':
				op.start = mdz_remap_segments(segments, op.start);
				break;
			case 'close':
				op.end = mdz_remap_segments(segments, op.end);
				break;
			case 'text':
				text_inner_ends.set(op.id, op.end);
				op.start = mdz_remap_segments(segments, op.start);
				op.end = mdz_remap_segments(segments, op.end);
				break;
			case 'append_text': {
				const inner_end = op.end ?? text_inner_ends.get(op.id)! + op.content.length;
				text_inner_ends.set(op.id, inner_end);
				op.end = mdz_remap_segments(segments, inner_end);
				break;
			}
			case 'trim_text': {
				const inner_end = text_inner_ends.get(op.id);
				if (inner_end !== undefined) text_inner_ends.set(op.id, inner_end - op.count);
				break;
			}
			case 'void':
				op.start = mdz_remap_segments(segments, op.start);
				op.end = mdz_remap_segments(segments, op.end);
				break;
			case 'wrap':
				op.start = mdz_remap_segments(segments, op.start);
				op.end = mdz_remap_segments(segments, op.end);
				break;
		}
		emit(state, op);
	}
};

/**
 * Close the open blockquote: finish the inner document (its EOF — unclosed
 * fences and open structure inside resolve here, recursing through deeper
 * quotes), forward the final opcodes, sync the shared id counter back, and
 * close the Blockquote frame.
 */
const finish_blockquote = (state: MdzStreamParserState): void => {
	const blockquote = state.blockquote!;
	finish_state(blockquote.inner);
	forward_inner_opcodes(state);
	state.next_id = blockquote.inner.next_id;
	state.blockquote = null;
	const entry = pop_stack_entry(state);
	emit(state, {type: 'close', id: entry.id, end: offset(state)});
	state.active_text_id = null;
};

/**
 * Try to open a blockquote at a column-0 `>` — a valid prefix with
 * non-whitespace content after it on the same line (no empty start,
 * mirroring lists; the hold is line-bounded). Interrupts a current
 * paragraph, like every block construct.
 */
const try_blockquote_start = (state: MdzStreamParserState, forced: boolean): TryResult => {
	const prefix = mdz_match_blockquote_prefix(state.buffer, state.pos, forced);
	if (prefix === 'pending') return 'need_more';
	if (prefix === null) return 'not_match';
	const has_content = mdz_blockquote_line_has_content(state.buffer, prefix.content_start, forced);
	if (has_content === 'pending') return 'need_more';
	if (!has_content) return 'not_match';
	flush_text(state);
	close_paragraph(state);
	open_blockquote(state, -1);
	return 'consumed';
};

/**
 * Process input while a quote is open: pass content through to the inner
 * document mid-line, and classify each following line's prefix at its
 * newline — continue (feed the held newline, strip one level), or end the
 * quote (blank line, missing or mis-positioned prefix, EOF). Returns false
 * when the buffer ends in an unresolved line and more input is needed; all
 * holds are line-bounded.
 */
const process_blockquote = (state: MdzStreamParserState, forced: boolean): boolean => {
	const blockquote = state.blockquote!;
	const {buffer} = state;
	// mid-line: feed content through to the line's newline (or buffer end —
	// content streams as it arrives; `pos` is the fed watermark)
	if (state.pos < buffer.length && buffer.charCodeAt(state.pos) !== NEWLINE) {
		let i = state.pos;
		while (i < buffer.length && buffer.charCodeAt(i) !== NEWLINE) {
			i++;
		}
		feed_blockquote_inner(state, buffer.slice(state.pos, i));
		state.pos = i;
	}
	if (state.pos >= buffer.length) return true; // everything fed; more may arrive

	// at the line's newline: the next line decides continue-vs-end before the
	// held newline feeds (it joins the inner document either way — quote lines
	// are newline-terminated — but a continuation also needs its strip point)
	const nl_pos = state.pos;
	const line_start = nl_pos + 1;
	let first = line_start;
	if (blockquote.item_indent >= 0) {
		while (first < buffer.length && is_line_whitespace(buffer.charCodeAt(first))) {
			first++;
		}
	}
	if (first >= buffer.length && !forced) return false; // unresolved line — hold
	const indent = first - line_start;
	if (
		first < buffer.length &&
		buffer.charCodeAt(first) === RIGHT_ANGLE &&
		(blockquote.item_indent < 0 ? indent === 0 : indent > blockquote.item_indent)
	) {
		const prefix = mdz_match_blockquote_prefix(buffer, first, forced);
		if (prefix === 'pending') return false;
		if (prefix !== null) {
			// the quote continues: feed the held newline, then resume past the
			// stripped prefix level (a bare prefix line contributes only its
			// newline — the next iteration classifies again from there)
			feed_blockquote_inner(state, '\n');
			const strip = first + mdz_blockquote_strip_width(buffer, first);
			blockquote.segments.push({
				inner_start: blockquote.inner_len,
				source_start: offset(state, strip),
			});
			state.pos = strip;
			state.column = strip - line_start;
			state.prev_char = NEWLINE;
			return true;
		}
	}
	// the line doesn't continue the quote — it ends here. The last quote
	// line's newline joins the inner document; the ending line re-dispatches
	// outside: the list classifier owns it inside an open list (blank
	// containment, markers, list end), the main loop otherwise.
	feed_blockquote_inner(state, '\n');
	finish_blockquote(state);
	if (state.list_levels.length === 0) {
		state.pos = line_start;
		state.column = 0;
		state.prev_char = NEWLINE;
		state.skip_blank_lines = true;
	}
	return true;
};

// -- Processing loop --

/**
 * Absorb the blank region at the current position: newlines and
 * whitespace-only lines. Runs while `skip_blank_lines` is set — at document
 * start, after block-element closes, and after paragraph breaks. Clears the
 * flag when a content line is reached (its leading whitespace stays in the
 * text); leaves it set when the buffer is consumed entirely, carrying the
 * absorb across chunks.
 *
 * Returns `false` when the buffer ends in an unresolved partial line
 * (whitespace so far — could still gain content) and more input is needed;
 * `state.pos` stays at the partial line's start. In forced mode a trailing
 * whitespace run is a blank line at EOF and is consumed.
 */
const skip_blank_region = (state: MdzStreamParserState, forced: boolean): boolean => {
	while (state.pos < state.buffer.length) {
		const char_code = state.buffer.charCodeAt(state.pos);
		if (char_code === NEWLINE) {
			state.pos++;
			state.column = 0;
			state.prev_char = NEWLINE;
			continue;
		}
		if (!is_line_whitespace(char_code)) {
			state.skip_blank_lines = false;
			return true;
		}
		// whitespace at line start — blank only if the rest of the line is whitespace
		let i = state.pos;
		while (i < state.buffer.length && is_line_whitespace(state.buffer.charCodeAt(i))) {
			i++;
		}
		if (i >= state.buffer.length) {
			if (forced) {
				// trailing whitespace-only line at EOF
				state.pos = i;
				return true;
			}
			return false; // partial line — need more input to classify it
		}
		if (state.buffer.charCodeAt(i) !== NEWLINE) {
			// line has content — its leading whitespace is text
			state.skip_blank_lines = false;
			return true;
		}
		state.pos = i; // blank line — newline consumed next iteration
	}
	return true; // consumed everything; flag stays set for the next chunk
};

/**
 * Core processing loop. When `forced` is false (normal streaming), returns
 * when more input is needed. When `forced` is true (EOF), treats buffer end
 * as content end and never waits for more input.
 */
const process_loop = (state: MdzStreamParserState, forced: boolean): void => {
	while (state.pos < state.buffer.length) {
		// absorb the blank region at start of input or after a block boundary
		// (paragraph break, heading/HR/codeblock close in this or a prior chunk)
		if (state.skip_blank_lines) {
			if (!skip_blank_region(state, forced)) return; // need more input
			continue;
		}
		// open blockquote — all input routes through the quote (prefix
		// classification + nested-parser feeding) until a line breaks it
		if (state.blockquote) {
			if (!process_blockquote(state, forced)) return; // need more input
			continue;
		}
		// codeblock mode — in-item fences (`fence_indent > 0`) stream complete
		// lines with per-line indent stripping; top-level fences keep the raw
		// char-walk fast path
		if (state.codeblock) {
			if (state.codeblock.fence_indent > 0) {
				if (!process_codeblock_in_item(state, forced)) return; // need more input
				continue;
			}
			if (forced) {
				// consumes to the buffer end by construction — content runs to
				// EOF, or an EOF-terminated closer ends the block (see
				// `process_codeblock_forced`) — so nothing is left to process
				process_codeblock_forced(state);
				return;
			}
			if (!process_codeblock(state)) return; // need more input
			continue;
		}

		// optimistic inline code mode — raw scanning for close/revert
		if (state.in_code) {
			process_code_content(state);
			continue;
		}

		// text-first URL/path scanning mode
		if (state.pending_url !== null) {
			process_url_content(state, forced);
			continue;
		}

		// open table — each line is a body row or ends the table
		if (state.table) {
			if (!process_table_line(state, forced)) return; // need more input
			continue;
		}

		const char_code = state.buffer.charCodeAt(state.pos);

		// newline handling
		if (char_code === NEWLINE) {
			if (state.in_heading) {
				// newline ends heading; trailing blanks absorb at the loop top
				flush_text(state);
				close_heading(state);
				state.pos++;
				state.skip_blank_lines = true;
				state.column = 0;
				state.prev_char = NEWLINE;
				continue;
			}
			// inside an open list, every line classifies through the list line
			// classifier (continuation / marker / blank containment / list end);
			// a deeper quote-opener line signals back so the quote opens here
			if (state.list_levels.length > 0) {
				const r = process_list_line(state, forced);
				if (r === 'blockquote') {
					open_blockquote(state, state.list_levels[state.list_levels.length - 1]!.indent);
					continue;
				}
				if (!r) return; // need more input
				continue;
			}
			// scan past line whitespace: a following blank line is a paragraph break
			let after = state.pos + 1;
			while (after < state.buffer.length && is_line_whitespace(state.buffer.charCodeAt(after))) {
				after++;
			}
			if (after >= state.buffer.length && !forced) {
				// hold trailing `\n` + whitespace — could become a blank line
				return;
			}
			if (after < state.buffer.length && state.buffer.charCodeAt(after) === NEWLINE) {
				handle_paragraph_break(state);
				continue;
			}
			// single newline: accumulate as text (any scanned whitespace is the
			// next line's leading content and accumulates via the normal text path)
			accumulate_text(state, '\n', offset(state));
			state.pos++;
			state.column = 0;
			state.prev_char = NEWLINE;
			continue;
		}

		// block elements at column 0
		if (state.column === 0 && !state.in_heading) {
			if (char_code === HASH) {
				const r = try_heading(state);
				if (r === 'consumed') continue;
				if (!forced && r === 'need_more') return;
			} else if (char_code === HYPHEN) {
				const r = try_hr(state, forced);
				if (r === 'consumed') continue;
				if (!forced && r === 'need_more') return;
				// not an HR — could start an unordered list
				const lr = try_list_start(state, forced);
				if (lr === 'consumed') continue;
				if (!forced && lr === 'need_more') return;
			} else if (char_code === BACKTICK) {
				const r = try_codeblock_open(state);
				if (r === 'consumed') continue;
				if (!forced && r === 'need_more') return;
			} else if (char_code >= ZERO && char_code <= NINE) {
				const r = try_list_start(state, forced);
				if (r === 'consumed') continue;
				if (!forced && r === 'need_more') return;
			} else if (char_code === RIGHT_ANGLE) {
				const r = try_blockquote_start(state, forced);
				if (r === 'consumed') continue;
				if (!forced && r === 'need_more') return;
			} else if (char_code === PIPE) {
				const r = try_table_start(state, forced);
				if (r === 'consumed') continue;
				if (!forced && r === 'need_more') return;
			}
		}

		// inline processing
		if (!process_inline(state, forced)) return; // need more input
	}
};

// -- Inline processing --

/**
 * Process one inline element. Returns false if more input is needed.
 * When `forced` is true (EOF processing), open decisions run against the
 * complete final buffer instead of waiting for more input: bold, italic,
 * and strikethrough open only when their confirmed closer is already
 * present, and an inline-code candidate degrades to literal text when its
 * closer isn't (at EOF it never can be). Link and tag opens are skipped
 * entirely — held `[text](url)` / `<Tag>` tails parse flat (an accepted
 * divergence; see the `MdzStreamParser` class TSDoc). All closing
 * constructs and auto-links still run.
 * Never returns false in forced mode.
 */
const process_inline = (state: MdzStreamParserState, forced: boolean): boolean => {
	const char_code = state.buffer.charCodeAt(state.pos);

	// check for closing delimiters first (if matching open exists)
	if (char_code === ASTERISK || char_code === TILDE) {
		if (
			state.pos + 1 < state.buffer.length &&
			state.buffer.charCodeAt(state.pos + 1) === char_code
		) {
			const node_type = char_code === ASTERISK ? 'Bold' : 'Strikethrough';
			const open_idx = find_open(state, node_type);
			if (open_idx !== -1) {
				return close_delimiter(state, open_idx);
			}
			return try_double_delimiter(state, char_code === ASTERISK ? '**' : '~~', node_type, forced);
		}

		if (!forced) {
			// could be start of the doubled delimiter — need next char to decide
			if (state.pos + 1 >= state.buffer.length) return false; // hold for next chunk
			// single char is text (next char doesn't double it)
			consume_delimiter_as_text(state, char_code === ASTERISK ? '*' : '~');
			return true;
		}
		// forced with a lone delimiter char: falls through to the text handler
	}

	if (char_code === UNDERSCORE) {
		const open_idx = find_open(state, 'Italic');
		if (open_idx !== -1) {
			// hold: the char after a potential closer decides its boundary
			if (!forced && state.pos + 1 >= state.buffer.length) return false;
			if (check_close_word_boundary(state)) {
				return close_delimiter(state, open_idx);
			}
			// failed closer: the one-shot parse greedy-rejects the opener at
			// the first invalid closer, so the optimistic open is known wrong
			revert_failed_close(state, open_idx);
			// fall through: this same delimiter may be a fresh opener, matching
			// the one-shot parse, which continues after the rejected opener
		}
		return try_italic(state, forced);
	}

	if (char_code === BACKTICK) {
		return try_code(state, forced);
	}

	if (char_code === LEFT_BRACKET && !forced) {
		return try_link_open(state);
	}

	if (char_code === RIGHT_BRACKET && !forced) {
		const link_idx = find_open(state, 'Link');
		if (link_idx !== -1) {
			return try_complete_link(state, link_idx);
		}
		// no open link — treat as text
		consume_delimiter_as_text(state, ']');
		return true;
	}

	if (char_code === LEFT_ANGLE) {
		// closing tags are handled even in forced mode
		if (state.pos + 1 < state.buffer.length && state.buffer.charCodeAt(state.pos + 1) === SLASH) {
			const result = try_close_tag(state);
			if (result === 'consumed') return true;
			// in forced mode, need_more falls through to text
			if (!forced && result === 'need_more') return false;
			// not_match — fall through
		}
		if (!forced) {
			const tag_result = try_tag_open(state);
			if (tag_result === 'consumed') return true;
			if (tag_result === 'need_more') return false;
			// not_match — fall through
		}
		// not a valid tag — fall through to text
	}

	// auto-detected URLs (text-first speculative prefix matching).
	// Fires on `h` and `H` — scheme matching is case-insensitive (RFC 3986).
	if (char_code === H_LOWER || char_code === H_UPPER) {
		if (forced) {
			const result = try_auto_url_forced(state);
			if (result === 'consumed') return true;
			if (result === 'need_more') return false;
		} else if (state.prev_char === -1 || !is_word_char(state.prev_char)) {
			// word boundary — start speculative URL prefix matching
			start_speculative_url(state);
			return true;
		}
	}

	// auto-detected paths
	if (char_code === SLASH) {
		const result = try_auto_path_absolute(state, forced);
		if (result === 'consumed') return true;
		if (result === 'need_more') return false;
	}
	if (char_code === PERIOD) {
		const result = try_auto_path_relative(state, forced);
		if (result === 'consumed') return true;
		if (result === 'need_more') return false;
	}

	// plain text
	consume_text_run(state);
	return true;
};
