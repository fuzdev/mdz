/**
 * Inline-formatting handlers (bold, italic, strikethrough, inline code)
 * for the streaming mdz parser.
 *
 * @module
 */

import {
	BACKTICK,
	NEWLINE,
	RIGHT_ANGLE,
	UNDERSCORE,
	is_line_whitespace,
	is_word_char,
	mdz_blockquote_line_has_content,
	mdz_match_blockquote_prefix,
} from './mdz_helpers.ts';
import {
	type MdzStreamParserState,
	accumulate_text,
	alloc_id,
	buffer_index_of,
	emit,
	ensure_paragraph,
	flush_text,
	is_run_boundary,
	offset,
	pop_stack_entry,
	push_stack_entry,
	revert_above,
} from './mdz_stream_parser_state.ts';
import {match_fence_opener, match_list_marker} from './mdz_stream_parser_list.ts';
import {consume_delimiter_as_text} from './mdz_stream_parser_text.ts';

/**
 * Whether `buffer` contains a paragraph break — a newline followed (across
 * optional line whitespace) by another newline — anywhere in `[from, to)`,
 * both newlines inside the window. The streaming analogue of the lexer's
 * `#has_paragraph_break_between`; callers bound `to` to a found delimiter,
 * keeping the probe amortized (see `scan_closer_boundary`). A break can't
 * straddle `to`: the delimiter there is never whitespace, so a whitespace
 * run starting inside the window ends inside it.
 */
const has_paragraph_break_between = (buffer: string, from: number, to: number): boolean => {
	for (let i = from; i < to - 1; i++) {
		if (buffer.charCodeAt(i) === NEWLINE) {
			let j = i + 1;
			while (j < to && is_line_whitespace(buffer.charCodeAt(j))) {
				j++;
			}
			if (j < to && buffer.charCodeAt(j) === NEWLINE) {
				return true;
			}
			i = j - 1; // skip the scanned whitespace run (loop increment lands on j)
		}
	}
	return false;
};

/**
 * Whether the current inline run ends anywhere in `[from, to)` — a paragraph
 * break, or (inside an open list) a line that classifies as list structure
 * rather than continuation: blank, at or above the deepest marker's indent,
 * a nesting marker (subject to the ordered interrupt guard, which makes a
 * deeper non-`1.` ordered marker continuation text), a fence opener line, or
 * a quote opener line.
 * The streaming counterpart of the sync lexer's `#max_search_index` run
 * bound: a closer candidate past a run boundary can never close.
 *
 * Same amortization as the paragraph-break probe — callers bound `to` to a
 * found delimiter, so consecutive scans cover disjoint windows, and the
 * per-line classification reads only bounded prefixes. A line that can't yet
 * classify (cut off at the buffer end) reports no boundary: while streaming
 * the optimistic open it permits is corrected by the run-close revert, and
 * in forced mode the buffer is complete so every line classifies.
 */
const has_run_boundary_between = (
	state: MdzStreamParserState,
	from: number,
	to: number,
	forced: boolean,
): boolean => {
	const {buffer} = state;
	if (state.list_levels.length === 0) {
		return has_paragraph_break_between(buffer, from, to);
	}
	const deepest_indent = state.list_levels[state.list_levels.length - 1]!.indent;
	let i = buffer.indexOf('\n', from);
	while (i !== -1 && i < to) {
		const line_start = i + 1;
		let j = line_start;
		while (j < buffer.length && is_line_whitespace(buffer.charCodeAt(j))) {
			j++;
		}
		if (j >= buffer.length) return false; // unresolved line (only reachable while streaming)
		if (buffer.charCodeAt(j) === NEWLINE) return true; // blank line ends the run
		if (j - line_start <= deepest_indent) return true; // sibling, dedent, or list end
		const marker = match_list_marker(state, j, forced);
		if (marker === 'pending') return false;
		if (marker !== null && !marker.empty && (!marker.ordered || marker.number === 1)) {
			return true; // a nested list opens
		}
		if (buffer.charCodeAt(j) === BACKTICK) {
			const fence = match_fence_opener(state, j, forced);
			if (fence === 'pending') return false;
			if (fence !== null) return true; // a fence opener interrupts the run
		}
		if (buffer.charCodeAt(j) === RIGHT_ANGLE) {
			const prefix = mdz_match_blockquote_prefix(buffer, j, forced);
			if (prefix === 'pending') return false;
			if (prefix !== null) {
				const has_content = mdz_blockquote_line_has_content(buffer, prefix.content_start, forced);
				if (has_content === 'pending') return false;
				if (has_content) return true; // a quote opener interrupts the run
			}
		}
		i = buffer.indexOf('\n', j); // continuation — classify the next line
	}
	return false;
};

// -- Bold / strikethrough (doubled-delimiter inlines) --

/**
 * Whether a closing doubled delimiter exists in the remaining buffer with no
 * run boundary before it — the one-shot parse's open condition (the lexer's
 * `#tokenize_double_delimiter` under its `#max_search_index` bound). Only
 * consulted in forced mode, where the buffer is complete so a missing closer
 * is definitive. The boundary probe is bounded to the found-closer window,
 * same as `scan_closer_boundary`.
 */
const has_double_closer = (state: MdzStreamParserState, delimiter: '**' | '~~'): boolean => {
	const search_start = state.pos + 2;
	const buffer = state.buffer;
	const close_index = buffer.indexOf(delimiter, search_start);
	if (close_index === -1) return false;
	return !has_run_boundary_between(state, search_start, close_index, true);
};

/**
 * Try to open a doubled-delimiter inline (`**` bold, `~~` strikethrough) —
 * the streaming analogue of the lexer's `#tokenize_double_delimiter`. No
 * word-boundary checks, matching the one-shot parse: doubled delimiters are
 * unambiguous enough to pair anywhere, and the first closer wins.
 *
 * @nodocs
 */
export const try_double_delimiter = (
	state: MdzStreamParserState,
	delimiter: '**' | '~~',
	node_type: 'Bold' | 'Strikethrough',
	forced = false,
): boolean => {
	// we know we're at the doubled delimiter (the caller checked both chars)
	// and there's no matching open container
	if (forced) {
		// at EOF the closer scan has full information: open only when the
		// one-shot parse would, otherwise the delimiter is literal text
		if (!has_double_closer(state, delimiter)) {
			consume_delimiter_as_text(state, delimiter);
			return true;
		}
	} else if (state.pos + 2 >= state.buffer.length) {
		// need at least one char after the delimiter to avoid an empty container
		return false;
	}

	flush_text(state);
	ensure_paragraph(state);

	const id = alloc_id(state);
	const start = offset(state);
	emit(state, {type: 'open', id, node_type, start});
	push_stack_entry(state, id, node_type, start, delimiter);
	state.active_text_id = null;
	state.pos += 2;
	state.column += 2;
	state.prev_char = delimiter.charCodeAt(1);
	return true;
};

// -- Italic (single-delimiter inline) --

/**
 * Try to open an italic span (`_`) — the streaming analogue of the lexer's
 * `#tokenize_italic`.
 *
 * @nodocs
 */
export const try_italic = (state: MdzStreamParserState, forced = false): boolean => {
	// opening boundary: reject after a word char, or after the delimiter
	// itself — `_` is self-opaque, so runs like `__init__` stay literal
	if (state.prev_char !== -1 && (is_word_char(state.prev_char) || state.prev_char === UNDERSCORE)) {
		consume_delimiter_as_text(state, '_');
		return true;
	}

	// need at least one char after the delimiter
	if (state.pos + 1 >= state.buffer.length) {
		if (forced) {
			// at EOF with only the delimiter left — treat as text
			consume_delimiter_as_text(state, '_');
			return true;
		}
		return false;
	}

	// greedy first-closer check: a visible closer with an invalid boundary
	// kills the open ('rejected', matching the one-shot parse). No closer in
	// the buffer ('pending') opens optimistically while streaming — the revert
	// machinery corrects at the first failed closer or run close — but
	// at EOF (forced) nothing can ever close it, so degrade to text.
	const closer = scan_closer_boundary(state, forced);
	if (closer === 'rejected' || (forced && closer === 'pending')) {
		consume_delimiter_as_text(state, '_');
		return true;
	}

	flush_text(state);
	ensure_paragraph(state);

	const id = alloc_id(state);
	const start = offset(state);
	emit(state, {type: 'open', id, node_type: 'Italic', start});
	push_stack_entry(state, id, 'Italic', start, '_');
	state.active_text_id = null;
	state.pos++;
	state.column++;
	state.prev_char = UNDERSCORE;
	return true;
};

// -- Delimiter close (bold/italic/strikethrough) --

/**
 * Whether the char after a closing italic candidate permits the close (only
 * `_` has close-boundary rules — `**`/`~~` close anywhere). Word chars and
 * `_` itself (self-opaque — `_x__` never closes on the first `_` of a run)
 * fail the boundary.
 *
 * At end of buffer the boundary is treated as valid — only reachable in
 * forced mode, where end-of-input is a true boundary; while streaming,
 * `process_inline` holds the closer decision until the next char arrives.
 *
 * @nodocs
 */
export const check_close_word_boundary = (state: MdzStreamParserState): boolean => {
	const next_pos = state.pos + 1;
	if (next_pos < state.buffer.length) {
		const next = state.buffer.charCodeAt(next_pos);
		return !(is_word_char(next) || next === UNDERSCORE);
	}
	return true;
};

/**
 * Close an open delimiter-paired container (`Bold`, `Italic`, `Strikethrough`)
 * at the given stack index, consuming the closing delimiter — read from the
 * entry, so `**`/`~~` advance two chars and `_` one. The caller in
 * `process_inline` already located the open via `find_open`, so we trust the
 * index rather than re-walking the stack.
 *
 * @nodocs
 */
export const close_delimiter = (state: MdzStreamParserState, stack_idx: number): boolean => {
	flush_text(state);
	// revert anything between the container and the top of the stack
	revert_above(state, stack_idx);
	const entry = pop_stack_entry(state);
	const {delimiter} = entry;
	// check for empty container — revert to literal text instead of closing
	if (!entry.has_children) {
		emit(state, {
			type: 'revert',
			id: entry.id,
			replacement_text: delimiter,
			start: entry.start,
		});
		accumulate_text(state, delimiter, offset(state));
	} else {
		emit(state, {type: 'close', id: entry.id, end: offset(state) + delimiter.length});
	}
	state.active_text_id = null;
	state.pos += delimiter.length;
	state.column += delimiter.length;
	state.prev_char = delimiter.charCodeAt(delimiter.length - 1);
	return true;
};

/**
 * Scan for the first potential closing `_` and check its word boundary (only
 * italic has closer-boundary rules). Returns a tri-state:
 * - `'confirmed'`: closer found in buffer with valid word boundary
 * - `'rejected'`: closer found but with invalid word boundary (greedy first-match fails)
 * - `'pending'`: no closer in buffer yet, or can't determine boundary
 *
 * The boundary check is self-opaque: a candidate followed by `_` itself is
 * `'rejected'`, so underscore runs (`__init__`) degrade to literal text.
 * While streaming, `'pending'` opens optimistically (the revert machinery
 * corrects later); in forced mode it degrades to text.
 *
 * The delimiter search uses raw `indexOf` and stays amortized-linear without
 * a memo: candidates are occurrences of the searched character itself, so a
 * scan ends either at the next candidate (consecutive scans cover disjoint
 * ranges) or at the end of the buffer with no candidates left to rescan it.
 * The run-boundary probe (paragraph breaks, and list structure inside open
 * lists) is bounded to the same window — only a boundary *before* the found
 * delimiter matters — inheriting that amortization; an unbounded probe would
 * rescan to EOF per candidate on single-paragraph input, going quadratic.
 *
 * @nodocs
 */
export const scan_closer_boundary = (
	state: MdzStreamParserState,
	forced = false,
): 'confirmed' | 'rejected' | 'pending' => {
	const search_start = state.pos + 1;
	const buffer = state.buffer;
	const delim_pos = buffer.indexOf('_', search_start);
	if (delim_pos === -1) return 'pending'; // no closer in buffer
	// check for a run boundary before the delimiter (delimiters are never \n,
	// so a relevant boundary lies entirely within [search_start, delim_pos))
	if (has_run_boundary_between(state, search_start, delim_pos, forced)) {
		return 'pending'; // the run ends first
	}
	// check word boundary after the closer (the delimiter itself is self-opaque)
	const after_pos = delim_pos + 1;
	if (after_pos < state.buffer.length) {
		const after = state.buffer.charCodeAt(after_pos);
		return is_word_char(after) || after === UNDERSCORE ? 'rejected' : 'confirmed';
	}
	// closer at end of buffer — treat as confirmed, consistent with
	// check_close_word_boundary which also assumes boundary at buffer end
	return 'confirmed';
};

// -- Inline code --

/** @nodocs */
export const try_code = (state: MdzStreamParserState, forced = false): boolean => {
	const start = state.pos;
	let i = start + 1; // past opening backtick

	// compute search boundary: don't scan past open formatting delimiters
	const search_limit = code_search_limit(state, start + 1);

	// scan for closing backtick (must be before newline and search boundary)
	while (i < state.buffer.length && i < search_limit) {
		const c = state.buffer.charCodeAt(i);
		if (c === BACKTICK) {
			// found close
			const content = state.buffer.slice(start + 1, i);
			if (content.length === 0) {
				// empty code — treat as text
				consume_delimiter_as_text(state, '``');
				return true;
			}
			flush_text(state);
			ensure_paragraph(state);
			const id = alloc_id(state);
			emit(state, {
				type: 'text',
				id,
				content,
				text_type: 'Code',
				start: offset(state, start),
				end: offset(state, i + 1),
			});
			state.active_text_id = null;
			state.pos = i + 1;
			state.column += i + 1 - start;
			state.prev_char = BACKTICK;
			return true;
		}
		if (c === NEWLINE) {
			// inline code can't span lines — treat opening backtick as text
			consume_delimiter_as_text(state, '`');
			return true;
		}
		i++;
	}

	// hit search limit (open formatting delimiter boundary) — treat backtick as
	// text. This is the documented backtick-adjacent divergence point: when the
	// bounding frame is a wrongly-optimistic italic (its failed closer not yet
	// processed), the one-shot parse rejects that italic and scans unbounded —
	// see the `MdzStreamParser` TSDoc and the parity suite's expected-divergence
	// battery
	if (i < state.buffer.length && i >= search_limit) {
		consume_delimiter_as_text(state, '`');
		return true;
	}

	// buffer ended without close or newline.
	// At EOF the buffer is complete, so no closer can ever arrive — the
	// backtick is literal text, matching the one-shot parse's unclosed
	// fallback (an optimistic open here would strand an unclosable Code).
	if (forced) {
		consume_delimiter_as_text(state, '`');
		return true;
	}
	// If formatting is on the stack, hold — the formatting delimiter might appear
	// in the next chunk between the backtick and its closer, and going optimistic
	// would make the code span consume the formatting closer as raw text.
	if (has_inline_formatting_on_stack(state)) {
		return false; // hold for more input
	}

	// no formatting on stack — open Code optimistically.
	// Content streams via text/append_text inside the container.
	// Closes on matching backtick, reverts on newline.
	flush_text(state);
	ensure_paragraph(state);
	const id = alloc_id(state);
	const code_start = offset(state, start);
	emit(state, {type: 'open', id, node_type: 'Code', start: code_start});
	push_stack_entry(state, id, 'Code', code_start, '`');
	state.in_code = true;
	state.active_text_id = null;
	state.pos = start + 1; // past opening backtick
	state.column++;
	state.prev_char = BACKTICK;
	return true;
};

/**
 * Compute search limit for inline code scanning.
 * Finds the closest closing delimiter for any open formatting on the stack.
 * This prevents backtick scanning from crossing bold/italic/etc boundaries.
 *
 * @nodocs
 */
export const code_search_limit = (state: MdzStreamParserState, from: number): number => {
	let limit = state.buffer.length;
	for (let s = state.stack.length - 1; s >= 0; s--) {
		const entry = state.stack[s]!;
		if (is_run_boundary(entry.node_type)) break;
		const delimiter = entry.delimiter;
		if (!delimiter) continue;
		// an open Link contributes no bound: the sync lexer never narrows its
		// scan bound to a link's `]` (the link children loop checks `]` only
		// between children), so a code span may swallow `]` and the link still
		// completes on a later one — in "[a `b ] c`](/u)" the `]` sits inside
		// the code span in both parsers
		if (entry.node_type === 'Link') continue;
		// for tags the stored delimiter is the opening form (kept for revert
		// replacement text) — the scan must stop at the closing form, so the
		// code span can't swallow the enclosing tag's closer (parity with the
		// sync lexer's per-iteration `#max_search_index` narrowing)
		const needle = entry.tag_name === undefined ? delimiter : `</${entry.tag_name}>`;
		// find the closing delimiter in the buffer (memoized — see `buffer_index_of`)
		const idx = buffer_index_of(state, needle, from);
		if (idx !== -1 && idx < limit) {
			limit = idx;
		}
	}
	return limit;
};

/**
 * Check if any inline formatting container (Bold, Italic, Strikethrough, Link)
 * is on the stack above the current block boundary.
 * Used to decide whether backtick can go optimistic — when formatting is open,
 * the code span might cross the formatting boundary, so we hold instead.
 *
 * @nodocs
 */
export const has_inline_formatting_on_stack = (state: MdzStreamParserState): boolean => {
	for (let s = state.stack.length - 1; s >= 0; s--) {
		const entry = state.stack[s]!;
		if (is_run_boundary(entry.node_type)) return false;
		if (entry.delimiter) return true;
	}
	return false;
};

/**
 * Process content inside an optimistic inline Code container.
 * Scans raw text (no inline formatting) until closing backtick or newline.
 * Backtick closes (or reverts if empty). Newline reverts (code can't span lines).
 *
 * @nodocs
 */
export const process_code_content = (state: MdzStreamParserState): void => {
	const char_code = state.buffer.charCodeAt(state.pos);

	if (char_code === BACKTICK) {
		flush_text(state);
		const entry = pop_stack_entry(state);
		if (!entry.has_children) {
			// empty code `` — revert opener, accumulate closer as text
			emit(state, {type: 'revert', id: entry.id, replacement_text: '`', start: entry.start});
			accumulate_text(state, '`', offset(state));
		} else {
			emit(state, {type: 'close', id: entry.id, end: offset(state) + 1});
		}
		state.in_code = false;
		state.active_text_id = null;
		state.pos++;
		state.column++;
		state.prev_char = BACKTICK;
		return;
	}

	if (char_code === NEWLINE) {
		// code spans can't cross lines — revert
		flush_text(state);
		const entry = pop_stack_entry(state);
		emit(state, {type: 'revert', id: entry.id, replacement_text: '`', start: entry.start});
		state.in_code = false;
		state.active_text_id = null;
		// don't consume newline — outer loop handles it
		return;
	}

	// scan raw text until backtick or newline (paragraph already ensured at code open)
	const start = state.pos;
	state.pos++;
	while (state.pos < state.buffer.length) {
		const c = state.buffer.charCodeAt(state.pos);
		if (c === BACKTICK || c === NEWLINE) break;
		state.pos++;
	}
	accumulate_text(state, state.buffer.slice(start, state.pos), offset(state, start));
	state.prev_char = state.buffer.charCodeAt(state.pos - 1);
	state.column += state.pos - start;
};
