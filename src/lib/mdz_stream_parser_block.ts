/**
 * Block-element handlers for the streaming mdz parser.
 *
 * Each `try_*` returns {@link TryResult} so the orchestrator in
 * {@link ./mdz_stream_parser.ts} can fall through or wait for more input.
 *
 * @module
 */

import {
	BACKTICK,
	HASH,
	HR_HYPHEN_COUNT,
	HYPHEN,
	MAX_HEADING_LEVEL,
	MIN_CODEBLOCK_BACKTICKS,
	NEWLINE,
	SPACE,
	is_line_whitespace
} from './mdz_helpers.ts';
import {
	type CodeblockState,
	type MdzStreamParserState,
	type TryResult,
	alloc_id,
	close_paragraph,
	emit,
	flush_text,
	offset,
	push_stack_entry
} from './mdz_stream_parser_state.ts';

/**
 * Try to parse a heading at column 0.
 *
 * @nodocs
 */
export const try_heading = (state: MdzStreamParserState): TryResult => {
	const start = state.pos;
	let i = start;

	// count hashes
	let hash_count = 0;
	while (
		i < state.buffer.length &&
		state.buffer.charCodeAt(i) === HASH &&
		hash_count <= MAX_HEADING_LEVEL
	) {
		hash_count++;
		i++;
	}

	if (hash_count === 0 || hash_count > MAX_HEADING_LEVEL) return 'not_match';

	// need at least one more char to check for space
	if (i >= state.buffer.length) return 'need_more';

	// must have space after hashes
	if (state.buffer.charCodeAt(i) !== SPACE) return 'not_match';
	i++; // consume space

	// must have at least one non-whitespace char before the newline (mirrors
	// the sync lexer's has-content probe) — hold until it can be decided. A
	// line-bounded hold: the heading opens the moment its first content char
	// arrives. In forced mode the orchestrator treats `need_more` as text.
	let j = i;
	while (j < state.buffer.length && is_line_whitespace(state.buffer.charCodeAt(j))) {
		j++;
	}
	if (j >= state.buffer.length) return 'need_more';
	if (state.buffer.charCodeAt(j) === NEWLINE) return 'not_match'; // no content — literal text

	// close any open paragraph first
	flush_text(state);
	close_paragraph(state);

	const id = alloc_id(state);
	const heading_start = offset(state, start);
	emit(state, {
		type: 'open',
		id,
		node_type: 'Heading',
		start: heading_start,
		level: hash_count as 1 | 2 | 3 | 4 | 5 | 6
	});
	push_stack_entry(state, id, 'Heading', heading_start);
	state.in_heading = true;
	state.heading_text_parts = [''];
	state.pos = i;
	state.column = i - start;
	state.prev_char = SPACE;
	return 'consumed';
};

/**
 * Try to parse a horizontal rule at column 0.
 * When `forced` is true, treats buffer end as EOF (no more input coming).
 *
 * @nodocs
 */
export const try_hr = (state: MdzStreamParserState, forced = false): TryResult => {
	const start = state.pos;
	let i = start;

	// must have exactly 3 hyphens
	if (i + HR_HYPHEN_COUNT > state.buffer.length) return 'need_more';
	for (let j = 0; j < HR_HYPHEN_COUNT; j++) {
		if (state.buffer.charCodeAt(i + j) !== HYPHEN) return 'not_match';
	}
	i += HR_HYPHEN_COUNT;

	// after hyphens, only line whitespace allowed before newline/EOF
	while (i < state.buffer.length) {
		const c = state.buffer.charCodeAt(i);
		if (c === NEWLINE) break;
		if (!is_line_whitespace(c)) return 'not_match';
		i++;
	}

	// if buffer ends without newline/EOF confirmation, need more input (unless forced)
	if (i >= state.buffer.length && !forced) {
		return 'need_more';
	}

	flush_text(state);
	close_paragraph(state);

	const id = alloc_id(state);
	emit(state, {
		type: 'void',
		id,
		node_type: 'Hr',
		start: offset(state, start),
		end: offset(state, i)
	});
	// `i` sits at the line's newline, or at the buffer end — in forced mode
	// always the buffer end (a newline would have resolved this line during
	// `feed`, so a forced HR is only ever the document's final line). Trailing
	// newline and blank lines absorb at the process-loop top.
	state.pos = i;
	state.skip_blank_lines = true;
	state.column = 0;
	state.prev_char = NEWLINE;
	return 'consumed';
};

/**
 * Try to open a code block at column 0. A complete opener line is decisive —
 * raw mode is absolute, so fence-ness never depends on a closer arriving:
 * an unclosed fence consumes to EOF as content. Any open paragraph closes
 * first (fences interrupt paragraphs, matching the sync parser). The only
 * hold is the opener line itself; an opener cut off at EOF without its
 * newline stays text (the orchestrator treats `need_more` as text in forced
 * mode).
 *
 * @nodocs
 */
export const try_codeblock_open = (state: MdzStreamParserState): TryResult => {
	const start = state.pos;
	let i = start;

	// count backticks
	let backtick_count = 0;
	while (i < state.buffer.length && state.buffer.charCodeAt(i) === BACKTICK) {
		backtick_count++;
		i++;
	}

	if (backtick_count < MIN_CODEBLOCK_BACKTICKS) {
		// if buffer ended mid-backtick-sequence, need more input
		if (i >= state.buffer.length) return 'need_more';
		// definitely not enough backticks
		return 'not_match';
	}

	// find end of opening fence line (need newline)
	const lang_start = i;
	while (i < state.buffer.length) {
		const c = state.buffer.charCodeAt(i);
		if (c === NEWLINE || is_line_whitespace(c)) break;
		i++;
	}
	const lang = i > lang_start ? state.buffer.slice(lang_start, i) : null;

	// skip trailing whitespace on opening fence line
	while (i < state.buffer.length && is_line_whitespace(state.buffer.charCodeAt(i))) {
		i++;
	}

	// must find newline
	if (i >= state.buffer.length) return 'need_more';
	if (state.buffer.charCodeAt(i) !== NEWLINE) return 'not_match';
	i++; // consume newline

	flush_text(state);
	close_paragraph(state);

	const id = alloc_id(state);
	const cb_start = offset(state, start);
	emit(state, { type: 'open', id, node_type: 'Codeblock', start: cb_start, lang });
	state.codeblock = { id, backtick_count, text_id: null, fence_indent: 0, start: cb_start };
	state.pos = i;
	state.column = 0;
	state.prev_char = NEWLINE;
	return 'consumed';
};

/**
 * Emit codeblock content as `text` (first chunk) or `append_text` (subsequent
 * chunks), updating `cb.text_id` on first emit. `content_start` is the local
 * buffer position where the content slice began — only used to compute the
 * global byte offset for the first `text` opcode.
 *
 * @nodocs
 */
export const emit_codeblock_text = (
	state: MdzStreamParserState,
	cb: CodeblockState,
	content: string,
	content_start: number
): void => {
	if (cb.text_id !== null) {
		emit(state, { type: 'append_text', id: cb.text_id, content });
	} else {
		const id = alloc_id(state);
		const text_start = offset(state, content_start);
		emit(state, {
			type: 'text',
			id,
			content,
			text_type: 'Text',
			start: text_start,
			end: text_start + content.length
		});
		cb.text_id = id;
	}
};

/**
 * Drain the remaining buffer as codeblock content at EOF, looking for a closing
 * fence whose terminator is EOF rather than `\n`. Matches the sync lexer's
 * `#match_fence`, which allows a fence at the end of the document.
 *
 * If a fence is found, the codeblock closes normally. Otherwise the remaining
 * buffer becomes content and `close_codeblock_at_eof` (in
 * `mdz_stream_parser_state.ts`) emits the plain close after process completes
 * (an unclosed fence consumes to EOF — never reverted).
 *
 * @nodocs
 */
export const process_codeblock_forced = (state: MdzStreamParserState): void => {
	const cb = state.codeblock!;
	const start = state.pos;

	while (state.pos < state.buffer.length) {
		if (state.column === 0) {
			const fence_match = match_codeblock_close(state, cb.backtick_count, true);
			if (fence_match !== -1) {
				// emit content up to the closing fence (excluding trailing newline before fence)
				let content_end = state.pos;
				if (content_end > start && state.buffer.charCodeAt(content_end - 1) === NEWLINE) {
					content_end--;
				}
				const content = state.buffer.slice(start, content_end);
				if (content.length > 0) {
					emit_codeblock_text(state, cb, content, start);
				}

				// the closer here is always EOF-terminated (`fence_match` is the
				// buffer end): a newline-terminated closer resolves during `feed`,
				// whose hold retains at most a trailing newline plus a partial
				// fence line. So — like the non-forced path's `fence_match - 1` —
				// the close `end` excludes any line terminator
				emit(state, { type: 'close', id: cb.id, end: offset(state, fence_match) });
				state.pos = fence_match;
				state.codeblock = null;
				return;
			}
		}

		const c = state.buffer.charCodeAt(state.pos);
		if (c === NEWLINE) {
			state.column = 0;
		} else {
			state.column++;
		}
		state.pos++;
	}

	// no closing fence — dump the rest as codeblock content; caller's
	// `close_codeblock_at_eof` then closes the codeblock at EOF
	const remaining = state.buffer.slice(start, state.pos);
	if (remaining.length > 0) {
		emit_codeblock_text(state, cb, remaining, start);
	}
};

/**
 * Process bytes while in codeblock mode.
 * Returns true if processing should continue, false if more input needed.
 *
 * @nodocs
 */
export const process_codeblock = (state: MdzStreamParserState): boolean => {
	const cb = state.codeblock!;
	const start = state.pos;

	while (state.pos < state.buffer.length) {
		// check for closing fence at column 0
		if (state.column === 0) {
			const fence_match = match_codeblock_close(state, cb.backtick_count);
			if (fence_match === -2) {
				// need more input — hold from this position (don't consume potential fence chars)
				break;
			}
			if (fence_match !== -1) {
				// emit content up to the closing fence (excluding trailing newline before fence)
				let content_end = state.pos;
				if (content_end > start && state.buffer.charCodeAt(content_end - 1) === NEWLINE) {
					content_end--;
				}
				const content = state.buffer.slice(start, content_end);
				if (content.length > 0) {
					emit_codeblock_text(state, cb, content, start);
				}

				// codeblock end = position of newline after closing fence (exclusive)
				emit(state, { type: 'close', id: cb.id, end: offset(state, fence_match - 1) });
				state.pos = fence_match;
				state.codeblock = null;
				state.column = 0;
				state.prev_char = NEWLINE;
				// trailing newlines and blank lines absorb at the process-loop top
				state.skip_blank_lines = true;
				return true;
			}
		}

		// not a closing fence — advance
		const c = state.buffer.charCodeAt(state.pos);
		if (c === NEWLINE) {
			state.column = 0;
		} else {
			state.column++;
		}
		state.pos++;
	}

	// buffer exhausted or broke for potential fence — emit content so far, hold trailing data.
	// Hold trailing \n (could be before a closing fence in next chunk), and also hold
	// \n + backticks when we broke mid-fence-check (the \n precedes the backticks and
	// would be stripped by fence close, so must not be emitted as content yet).
	let emit_end = state.pos;
	if (emit_end > start && state.buffer.charCodeAt(emit_end - 1) === NEWLINE) {
		emit_end--;
		state.pos = emit_end; // leave \n (+ any held backticks after it) in buffer
	}
	const content = state.buffer.slice(start, emit_end);
	if (content.length > 0) {
		emit_codeblock_text(state, cb, content, start);
	}
	return false; // need more input
};

/**
 * Process buffered lines while inside an in-item code block
 * (`fence_indent > 0`). Operates on complete lines only — a partial line at
 * the buffer end holds until its newline arrives (line-bounded, like the
 * opener hold), keeping the per-line indent strip and closer probe
 * deterministic across chunk boundaries. Content lines strip
 * `min(fence_indent, line_indent)` and emit joined by `'\n'` separators
 * (first line bare, later lines prefixed), so emitted content never carries
 * the region's final newline — `close_codeblock_at_eof` therefore skips its
 * trailing-newline trim for in-item fences.
 *
 * A closing fence — any indent <= the opener's, a run of >= the opener's
 * backticks, only whitespace to the line end — closes the block with `pos`
 * left at its terminating newline, so the list line classifier dispatches
 * what follows (mirroring the sync lexer's loop shape). In forced mode EOF
 * terminates closer and content lines.
 *
 * Returns `false` when more input is needed; never in forced mode.
 *
 * @nodocs
 */
export const process_codeblock_in_item = (
	state: MdzStreamParserState,
	forced: boolean
): boolean => {
	const cb = state.codeblock!;
	while (state.pos < state.buffer.length) {
		const line_start = state.pos;
		let j = line_start;
		while (j < state.buffer.length && is_line_whitespace(state.buffer.charCodeAt(j))) {
			j++;
		}
		if (j >= state.buffer.length && !forced) return false; // partial line — hold
		const line_indent = j - line_start;
		// closer probe
		if (
			line_indent <= cb.fence_indent &&
			j < state.buffer.length &&
			state.buffer.charCodeAt(j) === BACKTICK
		) {
			let k = j;
			let count = 0;
			while (k < state.buffer.length && state.buffer.charCodeAt(k) === BACKTICK) {
				count++;
				k++;
			}
			if (k >= state.buffer.length && !forced) return false; // run could still grow
			if (count >= cb.backtick_count) {
				let m = k;
				while (m < state.buffer.length && is_line_whitespace(state.buffer.charCodeAt(m))) {
					m++;
				}
				if (m >= state.buffer.length && !forced) return false; // trailing content could disqualify
				if (m >= state.buffer.length || state.buffer.charCodeAt(m) === NEWLINE) {
					emit(state, { type: 'close', id: cb.id, end: offset(state, m) });
					state.codeblock = null;
					state.pos = m; // at the closer's newline (or EOF)
					state.column = m - line_start;
					return true;
				}
			}
			// not a closer — the line is content
		}
		// content line — emit it whole once its newline arrives (or at EOF when forced)
		const nl = state.buffer.indexOf('\n', j);
		if (nl === -1 && !forced) return false; // hold the partial line
		const line_end = nl === -1 ? state.buffer.length : nl;
		const strip = line_start + Math.min(cb.fence_indent, line_indent);
		const content = state.buffer.slice(strip, line_end);
		emit_codeblock_text(state, cb, cb.text_id !== null ? '\n' + content : content, strip);
		state.pos = nl === -1 ? line_end : line_end + 1;
		state.column = 0;
		state.prev_char = NEWLINE;
	}
	return true;
};

/**
 * Check if the buffer at current position has a codeblock closing fence —
 * a run of at least `backtick_count` backticks with only whitespace to end
 * of line. Returns the position after the fence (including trailing newline)
 * on success, `-1` when definitely not a fence, or `-2` when more input is
 * needed to decide.
 *
 * When `forced` is true, EOF after the fence counts as a valid terminator
 * (matches `mdz_parse`'s handling of code blocks at end of input).
 *
 * @nodocs
 */
export const match_codeblock_close = (
	state: MdzStreamParserState,
	backtick_count: number,
	forced: boolean = false
): number => {
	let i = state.pos;

	// count backticks
	let count = 0;
	while (i < state.buffer.length && state.buffer.charCodeAt(i) === BACKTICK) {
		count++;
		i++;
	}
	if (count < backtick_count) {
		// buffer ended mid-backtick-sequence — could still grow into a fence
		if (!forced && i >= state.buffer.length) return -2;
		return -1;
	}

	// trailing whitespace allowed
	while (i < state.buffer.length && is_line_whitespace(state.buffer.charCodeAt(i))) {
		i++;
	}

	// must be followed by newline or EOF
	if (i < state.buffer.length && state.buffer.charCodeAt(i) === NEWLINE) {
		return i + 1;
	}
	if (i >= state.buffer.length) {
		// in forced mode, EOF terminates the fence
		if (forced) return i;
		// enough backticks but buffer ended — the run could still grow, or
		// whitespace/newline/disqualifying content could follow
		return -2;
	}
	return -1;
};
