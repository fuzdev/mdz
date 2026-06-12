/**
 * Plain-text run consumption for the streaming mdz parser.
 *
 * @module
 */

import {
	ASTERISK,
	BACKTICK,
	HTTPS_PREFIX_LENGTH,
	H_LOWER,
	H_UPPER,
	LEFT_ANGLE,
	LEFT_BRACKET,
	NEWLINE,
	PERIOD,
	RIGHT_BRACKET,
	SLASH,
	SPACE,
	TAB,
	TILDE,
	UNDERSCORE,
	is_word_char,
	match_url_prefix_case_insensitive,
} from './mdz_helpers.js';
import {
	type MdzStreamParserState,
	accumulate_text,
	ensure_paragraph,
	offset,
} from './mdz_stream_parser_state.js';

/**
 * Consume a delimiter at the current position as literal text — the shared
 * tail of every "this delimiter doesn't open/close anything here" decision
 * (failed boundary, EOF degrade, greedy-rejected closer, lone `*`/`]`).
 *
 * @mutates `state`
 * @nodocs
 */
export const consume_delimiter_as_text = (state: MdzStreamParserState, delimiter: string): void => {
	ensure_paragraph(state);
	accumulate_text(state, delimiter, offset(state));
	state.prev_char = delimiter.charCodeAt(delimiter.length - 1);
	state.column += delimiter.length;
	state.pos += delimiter.length;
};

/**
 * Consume a run of plain text characters. Scans ahead to the next
 * structurally interesting character and accumulates the whole run
 * as a single slice, avoiding per-character string concatenation
 * and dispatch overhead.
 *
 * @nodocs
 */
export const consume_text_run = (state: MdzStreamParserState): void => {
	ensure_paragraph(state);
	const start = state.pos;
	state.pos++;
	while (state.pos < state.buffer.length) {
		const c = state.buffer.charCodeAt(state.pos);
		if (
			c === BACKTICK ||
			c === ASTERISK ||
			c === UNDERSCORE ||
			c === TILDE ||
			c === LEFT_BRACKET ||
			c === RIGHT_BRACKET ||
			c === LEFT_ANGLE ||
			c === NEWLINE ||
			// URL/path: only break when actually at a URL or path start.
			// Most h/H/./slash in prose are not URLs/paths — continuing the scan
			// avoids the full dispatch cycle through process_loop → process_inline.
			// For `h`/`H` at a word boundary, also break when there isn't enough
			// buffer left to confirm `https://` / `http://` — process_inline's
			// speculator then carries the prefix match across chunk boundaries.
			// Scheme matching is case-insensitive (RFC 3986).
			((c === H_LOWER || c === H_UPPER) &&
				(match_url_prefix_case_insensitive(state.buffer, state.pos) > 0 ||
					(state.buffer.length - state.pos < HTTPS_PREFIX_LENGTH &&
						!is_word_char(state.buffer.charCodeAt(state.pos - 1))))) ||
			((c === SLASH || c === PERIOD) &&
				(state.buffer.charCodeAt(state.pos - 1) === SPACE ||
					state.buffer.charCodeAt(state.pos - 1) === NEWLINE ||
					state.buffer.charCodeAt(state.pos - 1) === TAB))
		) {
			break;
		}
		state.pos++;
	}
	accumulate_text(state, state.buffer.slice(start, state.pos), offset(state, start));
	state.prev_char = state.buffer.charCodeAt(state.pos - 1);
	state.column += state.pos - start;
};
