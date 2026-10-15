/**
 * List handlers for the streaming mdz parser — column-0 list starts and the
 * line classifier that drives structure inside open lists.
 *
 * The streaming analogue of the sync lexer's `#tokenize_list`: the level
 * stack lives in `state.list_levels`, and List/ListItem frames sit on the
 * main stack (never reverted, like Paragraph). Every line inside an open
 * list classifies from bounded input — leading whitespace plus a few marker
 * chars for most lines, the whole line for empty markers and fence openers —
 * and blank-run containment consumes one blank line at a time, holding only
 * the structural close-vs-contain decision, never renderable content.
 *
 * @module
 */

import {
	BACKTICK,
	HYPHEN,
	MAX_LIST_NUMBER_DIGITS,
	MIN_CODEBLOCK_BACKTICKS,
	NEWLINE,
	NINE,
	PERIOD,
	PIPE,
	RIGHT_ANGLE,
	SPACE,
	ZERO,
	is_line_whitespace,
	mdz_match_blockquote_prefix,
	mdz_blockquote_line_has_content
} from './mdz_helpers.ts';
import { match_table_in_item_head, open_table_in_item } from './mdz_stream_parser_table.ts';
import {
	type MdzStreamParserState,
	type TryResult,
	accumulate_text,
	alloc_id,
	close_all_list_levels,
	close_list_item,
	close_list_level,
	close_list_run,
	close_paragraph,
	emit,
	extend_accumulated_end,
	flush_text,
	offset,
	push_stack_entry
} from './mdz_stream_parser_state.ts';

/**
 * A matched list marker: `- ` (unordered) or `N. ` (ordered, 1-9 digits).
 * `empty` markers have nothing but whitespace after the marker — valid only
 * as mid-list empty items, never starting a list. Positions are local buffer
 * indices.
 *
 * @nodocs
 */
export interface MdzStreamListMarker {
	ordered: boolean;
	/** Parsed integer for ordered markers (`007.` → 7); `0` for unordered. */
	number: number;
	/** Local buffer position of the marker character. */
	start: number;
	/** Index just past the marker chars (`-` or `N.`), before the space. */
	marker_end: number;
	/** Index just past the marker space — the inline run's content. */
	content_start: number;
	empty: boolean;
}

/**
 * Whether only line whitespace remains between `from` and the line's end —
 * `'pending'` when the buffer ends inside the run while streaming (the line
 * hasn't resolved); in forced mode EOF is a line end.
 */
const rest_is_blank = (
	state: MdzStreamParserState,
	from: number,
	forced: boolean
): boolean | 'pending' => {
	let i = from;
	while (i < state.buffer.length && is_line_whitespace(state.buffer.charCodeAt(i))) {
		i++;
	}
	if (i >= state.buffer.length) return forced ? true : 'pending';
	return state.buffer.charCodeAt(i) === NEWLINE;
};

/**
 * Match a list marker at `i` — the streaming analogue of the sync lexer's
 * `#match_list_marker`, with `'pending'` for a marker that can't resolve
 * until more input arrives (digits cut off at buffer end, a possible empty
 * marker whose line hasn't ended). Returns null for anything that's
 * definitely not a marker (`-x`, `--`, a tab after the marker, 10+ digits).
 *
 * @nodocs
 */
export const match_list_marker = (
	state: MdzStreamParserState,
	i: number,
	forced: boolean
): MdzStreamListMarker | 'pending' | null => {
	const { buffer } = state;
	const c = buffer.charCodeAt(i);
	if (c === HYPHEN) {
		const after = i + 1;
		const blank = rest_is_blank(state, after, forced);
		if (blank === 'pending') return 'pending';
		if (blank) {
			return {
				ordered: false,
				number: 0,
				start: i,
				marker_end: after,
				content_start: after,
				empty: true
			};
		}
		// in bounds: `blank === false` means the scan found a char at or past `after`
		if (buffer.charCodeAt(after) !== SPACE) return null;
		const content_start = after + 1;
		const empty = rest_is_blank(state, content_start, forced);
		if (empty === 'pending') return 'pending';
		return { ordered: false, number: 0, start: i, marker_end: after, content_start, empty };
	}
	if (c >= ZERO && c <= NINE) {
		let j = i + 1;
		while (j < buffer.length && buffer.charCodeAt(j) >= ZERO && buffer.charCodeAt(j) <= NINE) {
			j++;
		}
		if (j - i > MAX_LIST_NUMBER_DIGITS) return null;
		if (j >= buffer.length) return forced ? null : 'pending'; // digits could grow, `.` could follow
		if (buffer.charCodeAt(j) !== PERIOD) return null;
		const number = Number(buffer.slice(i, j));
		const after = j + 1;
		const blank = rest_is_blank(state, after, forced);
		if (blank === 'pending') return 'pending';
		if (blank) {
			return {
				ordered: true,
				number,
				start: i,
				marker_end: after,
				content_start: after,
				empty: true
			};
		}
		// in bounds: `blank === false` means the scan found a char at or past `after`
		if (buffer.charCodeAt(after) !== SPACE) return null;
		const content_start = after + 1;
		const empty = rest_is_blank(state, content_start, forced);
		if (empty === 'pending') return 'pending';
		return { ordered: true, number, start: i, marker_end: after, content_start, empty };
	}
	return null;
};

/**
 * A matched fence opener line (see `match_fence_opener`).
 *
 * @nodocs
 */
export interface MdzStreamFenceOpener {
	backtick_count: number;
	lang: string | null;
	/** Local position just past the opener's newline. */
	content_start: number;
}

/**
 * Match a complete fence opener line at `i`: >=3 backticks, an optional
 * language word, only whitespace to a terminating newline. `'pending'` while
 * the line could still become one; null when it definitely isn't — including
 * an opener cut off at EOF without its newline (forced), which stays text,
 * matching the sync parser's opener rule.
 *
 * @nodocs
 */
export const match_fence_opener = (
	state: MdzStreamParserState,
	i: number,
	forced: boolean
): MdzStreamFenceOpener | 'pending' | null => {
	const { buffer } = state;
	let j = i;
	let count = 0;
	while (j < buffer.length && buffer.charCodeAt(j) === BACKTICK) {
		count++;
		j++;
	}
	if (j >= buffer.length && !forced) return 'pending'; // run could still grow
	if (count < MIN_CODEBLOCK_BACKTICKS) return null;
	const lang_start = j;
	while (j < buffer.length) {
		const c = buffer.charCodeAt(j);
		if (c === NEWLINE || is_line_whitespace(c)) break;
		j++;
	}
	const lang = j > lang_start ? buffer.slice(lang_start, j) : null;
	while (j < buffer.length && is_line_whitespace(buffer.charCodeAt(j))) {
		j++;
	}
	if (j >= buffer.length) return forced ? null : 'pending'; // the opener needs its newline
	if (buffer.charCodeAt(j) !== NEWLINE) return null;
	return { backtick_count: count, lang, content_start: j + 1 };
};

/** Emit a `ListItem` open for `marker` and push its frame. */
const open_list_item = (state: MdzStreamParserState, marker: MdzStreamListMarker): void => {
	const id = alloc_id(state);
	const start = offset(state, marker.start);
	if (marker.ordered) {
		emit(state, { type: 'open', id, node_type: 'ListItem', start, number: marker.number });
	} else {
		emit(state, { type: 'open', id, node_type: 'ListItem', start });
	}
	push_stack_entry(state, id, 'ListItem', start);
	if (marker.empty) {
		// a childless close uses this as the item's end (sync's `open.end`)
		state.last_empty_item_end = offset(state, marker.marker_end);
	}
	state.active_text_id = null;
};

/** Open a new list level — its `List` frame and first item — at `indent`. */
const open_list_level = (
	state: MdzStreamParserState,
	indent: number,
	marker: MdzStreamListMarker
): void => {
	const id = alloc_id(state);
	const start = offset(state, marker.start);
	if (marker.ordered) {
		emit(state, {
			type: 'open',
			id,
			node_type: 'List',
			start,
			ordered: true,
			start_number: marker.number
		});
	} else {
		emit(state, { type: 'open', id, node_type: 'List', start, ordered: false });
	}
	push_stack_entry(state, id, 'List', start);
	open_list_item(state, marker);
	state.list_levels.push({ indent, ordered: marker.ordered });
};

/**
 * Begin a non-empty item's inline run at the marker line's content. Extra
 * whitespace after the marker space is content-leading slop, trimmed like
 * the sync lexer's `#list_run` — the marker guaranteed a non-whitespace char
 * before the line end, so the scan can't hit the buffer end.
 */
const begin_item_run = (
	state: MdzStreamParserState,
	marker: MdzStreamListMarker,
	line_start: number
): void => {
	let i = marker.content_start;
	while (i < state.buffer.length && is_line_whitespace(state.buffer.charCodeAt(i))) {
		i++;
	}
	state.in_list_item_run = true;
	state.pos = i;
	state.column = i - line_start;
	state.prev_char = SPACE;
};

/**
 * The level index of the deepest open item a line at `indent` can attach to —
 * the deepest level with marker indent strictly less than `indent` — or -1.
 * Levels above it get popped by the caller.
 */
const list_continuation_target = (state: MdzStreamParserState, indent: number): number => {
	for (let i = state.list_levels.length - 1; i >= 0; i--) {
		if (state.list_levels[i]!.indent < indent) return i;
	}
	return -1;
};

/**
 * Continue the current run across a soft break: the newline joins the run's
 * text, the continuation line's structural indent strips (its span folds
 * into the preceding text's source end, matching the sync lexer's
 * `#list_run_strip`), and inline processing resumes at the line's content.
 */
const continue_run = (
	state: MdzStreamParserState,
	nl_pos: number,
	content_pos: number
): boolean => {
	accumulate_text(state, '\n', offset(state, nl_pos));
	extend_accumulated_end(state, offset(state, content_pos));
	state.pos = content_pos;
	state.column = content_pos - (nl_pos + 1);
	state.prev_char = NEWLINE;
	return true;
};

/**
 * Try to start a list at a column-0 marker line — `try_hr` has already
 * rejected `---` when the char is `-`. Mirrors the sync lexer's
 * `#tokenize_list` entry conditions: empty markers never start a list, the
 * marker line must show content before the open confirms (a line-bounded
 * hold, the heading has-content pattern), and a non-`1.` ordered marker
 * never interrupts a current paragraph (the hard-wrap `2024.` guard).
 *
 * @nodocs
 */
export const try_list_start = (state: MdzStreamParserState, forced: boolean): TryResult => {
	const line_start = state.pos;
	const marker = match_list_marker(state, line_start, forced);
	if (marker === 'pending') return 'need_more';
	if (marker === null || marker.empty) return 'not_match';
	if (marker.ordered && marker.number !== 1 && state.in_paragraph) return 'not_match';

	flush_text(state);
	close_paragraph(state);
	open_list_level(state, 0, marker);
	begin_item_run(state, marker, line_start);
	return 'consumed';
};

/**
 * Classify the line after a newline inside an open list and apply its
 * structural effect — the streaming analogue of the sync lexer's
 * `#tokenize_list` line loop plus `#list_run_end`'s continuation rules.
 * Called with `pos` at the newline; returns `false` to hold until the line
 * classifies (never in forced mode). Dispatch, in order:
 *
 * - blank line: the current run closes; the close-vs-contain decision waits
 *   on the next non-blank line (one blank consumes per call, so long blank
 *   runs make incremental progress across chunks)
 * - marker lines: nest when deeper (subject to the ordered interrupt guard
 *   against a current run), else snap to the nearest surviving level as a
 *   sibling or a marker-type switch; empty markers at an exactly-matching
 *   level form empty items
 * - deeper fence opener lines: a code block child of the item they'd
 *   otherwise continue (`process_codeblock_in_item` streams it)
 * - deeper quote opener lines (a prefix with content after it): the levels
 *   pop to the attach target and `'blockquote'` returns with `pos` at the prefix —
 *   the main loop opens the blockquote child (the quote machinery lives
 *   there, beside the nested-parser driving)
 * - deeper non-marker lines: continuation of a current run (soft break,
 *   indent stripped), else a new `Paragraph` block child
 * - anything else: the whole list closes and the line re-dispatches at the
 *   top level
 *
 * @nodocs
 */
export const process_list_line = (
	state: MdzStreamParserState,
	forced: boolean
): boolean | 'blockquote' => {
	const { buffer } = state;
	const nl_pos = state.pos;
	const line_start = nl_pos + 1;
	let j = line_start;
	while (j < buffer.length && is_line_whitespace(buffer.charCodeAt(j))) {
		j++;
	}
	if (j >= buffer.length && !forced) return false; // unresolved line — hold

	if (j >= buffer.length || buffer.charCodeAt(j) === NEWLINE) {
		// blank line (or blank to EOF): the current run is over either way
		close_list_run(state);
		if (j >= buffer.length) {
			// forced: blank to EOF — the list closes
			close_all_list_levels(state);
		}
		state.pos = j; // at the next newline (re-enter here) or EOF
		state.column = 0;
		state.prev_char = NEWLINE;
		return true;
	}

	const indent = j - line_start;
	const run_current = state.in_list_item_run || state.in_paragraph;
	const deepest = state.list_levels[state.list_levels.length - 1]!;

	const marker = match_list_marker(state, j, forced);
	if (marker === 'pending') return false;

	if (marker !== null && !marker.empty) {
		if (indent > deepest.indent) {
			// deeper marker nests — except a non-`1.` ordered marker against a
			// current run, which is hard-wrapped continuation text (the `2024.`
			// guard, applied uniformly to item runs)
			if (run_current && marker.ordered && marker.number !== 1) {
				return continue_run(state, nl_pos, j);
			}
			close_list_run(state);
			open_list_level(state, indent, marker);
		} else {
			// dedent snaps to the nearest surviving level
			close_list_run(state);
			while (
				state.list_levels.length > 1 &&
				state.list_levels[state.list_levels.length - 1]!.indent > indent
			) {
				close_list_level(state);
			}
			if (state.list_levels[state.list_levels.length - 1]!.ordered === marker.ordered) {
				// sibling item
				close_list_item(state);
				open_list_item(state, marker);
			} else {
				// marker-type switch: close the list, open a new one at this indent
				close_list_level(state);
				open_list_level(state, indent, marker);
			}
		}
		begin_item_run(state, marker, line_start);
		return true;
	}

	if (marker !== null && marker.empty) {
		// empty item: only at an indent exactly matching an open level of the
		// same marker type — anything else degrades below (manual loop like
		// `list_continuation_target` — no per-line closure allocation)
		let level_idx = -1;
		for (let li = 0; li < state.list_levels.length; li++) {
			const l = state.list_levels[li]!;
			if (l.indent === indent && l.ordered === marker.ordered) {
				level_idx = li;
				break;
			}
		}
		if (level_idx !== -1) {
			close_list_run(state);
			while (state.list_levels.length - 1 > level_idx) {
				close_list_level(state);
			}
			close_list_item(state);
			open_list_item(state, marker);
			// consume the marker and trailing whitespace, leaving pos at the
			// line's newline (or EOF)
			let k = marker.marker_end;
			while (k < buffer.length && is_line_whitespace(buffer.charCodeAt(k))) {
				k++;
			}
			state.pos = k;
			state.column = k - line_start;
			state.prev_char = NEWLINE;
			return true;
		}
	}

	// a deeper fence opener line becomes a code block child of the item it
	// would otherwise continue
	if (indent > 0 && buffer.charCodeAt(j) === BACKTICK) {
		const target_idx = list_continuation_target(state, indent);
		if (target_idx !== -1) {
			const fence = match_fence_opener(state, j, forced);
			if (fence === 'pending') return false;
			if (fence !== null) {
				close_list_run(state);
				while (state.list_levels.length - 1 > target_idx) {
					close_list_level(state);
				}
				const id = alloc_id(state);
				const cb_start = offset(state, j);
				emit(state, {
					type: 'open',
					id,
					node_type: 'Codeblock',
					start: cb_start,
					lang: fence.lang
				});
				state.codeblock = {
					id,
					backtick_count: fence.backtick_count,
					text_id: null,
					fence_indent: indent,
					start: cb_start
				};
				state.active_text_id = null;
				state.pos = fence.content_start;
				state.column = 0;
				state.prev_char = NEWLINE;
				return true;
			}
		}
	}

	// a deeper quote opener line (prefix with content) becomes a blockquote
	// child of the item it would otherwise continue — the fence precedent
	if (indent > 0 && buffer.charCodeAt(j) === RIGHT_ANGLE) {
		const target_idx = list_continuation_target(state, indent);
		if (target_idx !== -1) {
			const prefix = mdz_match_blockquote_prefix(buffer, j, forced);
			if (prefix === 'pending') return false;
			if (prefix !== null) {
				const has_content = mdz_blockquote_line_has_content(buffer, prefix.content_start, forced);
				if (has_content === 'pending') return false;
				if (has_content) {
					close_list_run(state);
					while (state.list_levels.length - 1 > target_idx) {
						close_list_level(state);
					}
					state.pos = j;
					state.column = indent;
					state.prev_char = NEWLINE;
					return 'blockquote';
				}
			}
		}
	}

	// a deeper pipe-row line whose next line is a delimiter becomes a table
	// child of the item it would otherwise continue (the fence/quote precedent,
	// a two-line lookahead held until the delimiter line arrives)
	if (indent > 0 && buffer.charCodeAt(j) === PIPE) {
		const target_idx = list_continuation_target(state, indent);
		if (target_idx !== -1) {
			const marker_indent = state.list_levels[target_idx]!.indent;
			const head = match_table_in_item_head(state, j, marker_indent, forced);
			if (head === 'pending') return false;
			if (head !== null) {
				close_list_run(state);
				while (state.list_levels.length - 1 > target_idx) {
					close_list_level(state);
				}
				open_table_in_item(state, j, marker_indent, head);
				return true;
			}
		}
	}

	if (run_current && indent > deepest.indent) {
		// continuation line: soft break, structural indent stripped
		return continue_run(state, nl_pos, j);
	}

	// the run (if any) is over: a deeper line opens a new Paragraph block
	// child of the item it attaches to; anything else ends the list
	close_list_run(state);
	const target_idx = indent > 0 ? list_continuation_target(state, indent) : -1;
	if (target_idx !== -1) {
		while (state.list_levels.length - 1 > target_idx) {
			close_list_level(state);
		}
		// the Paragraph opens lazily at the first emit (`ensure_paragraph`)
		state.pos = j;
		state.column = indent;
		state.prev_char = NEWLINE;
		return true;
	}

	// nothing list-shaped — the list ends; the main loop re-dispatches this
	// line (paragraph, heading, HR, fence, or a fresh list)
	close_all_list_levels(state);
	state.pos = line_start;
	state.column = 0;
	state.prev_char = NEWLINE;
	return true;
};
