/**
 * Plain-text run consumption for the streaming mdz parser.
 *
 * @module
 */

import {
	HTTPS_PREFIX_LENGTH,
	NEWLINE,
	SPACE,
	TAB,
	TEXT_CLASS_NEWLINE,
	TEXT_CLASS_PATH,
	TEXT_CLASS_STOP,
	TEXT_CLASS_URL,
	TEXT_SCAN_CLASS,
	is_word_char,
	match_url_prefix_case_insensitive,
} from './mdz_helpers.ts';
import {
	type MdzStreamParserState,
	accumulate_text,
	ensure_paragraph,
	offset,
} from './mdz_stream_parser_state.ts';
import {mdz_debug_work} from './mdz_debug_work.ts';

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
		// one table load classifies the char; zero (the common case) continues
		// the run without any further checks. `TEXT_SCAN_CLASS` is shared with
		// the sync lexer's `#tokenize_text` (`mdz_lexer.ts`); the dispatch bodies
		// intentionally differ — that one handles `\|` escapes and list-run
		// strip, this one URL speculation across chunk boundaries.
		const char_class = c < 128 ? TEXT_SCAN_CLASS[c]! : 0;
		if (char_class === 0) {
			state.pos++;
			continue;
		}
		if ((char_class & (TEXT_CLASS_STOP | TEXT_CLASS_NEWLINE)) !== 0) break;
		if ((char_class & TEXT_CLASS_URL) !== 0) {
			// URL: only break when actually at a URL start. Most h/H in prose are
			// not URLs — continuing the scan avoids the full dispatch cycle
			// through process_loop → process_inline. At a word boundary, also
			// break when there isn't enough buffer left to confirm `https://` /
			// `http://` — process_inline's speculator then carries the prefix
			// match across chunk boundaries. Scheme matching is case-insensitive
			// (RFC 3986).
			if (
				match_url_prefix_case_insensitive(state.buffer, state.pos) > 0 ||
				(state.buffer.length - state.pos < HTTPS_PREFIX_LENGTH &&
					!is_word_char(state.buffer.charCodeAt(state.pos - 1)))
			) {
				break;
			}
		} else if ((char_class & TEXT_CLASS_PATH) !== 0) {
			// path (`/` or `.`): only break at a plausible path start
			const prev = state.buffer.charCodeAt(state.pos - 1);
			if (prev === SPACE || prev === NEWLINE || prev === TAB) break;
		}
		// backslash (or a non-starting path char) — ordinary text
		state.pos++;
	}
	if (mdz_debug_work.enabled) mdz_debug_work.total += state.pos - start;
	accumulate_text(state, state.buffer.slice(start, state.pos), offset(state, start));
	state.prev_char = state.buffer.charCodeAt(state.pos - 1);
	state.column += state.pos - start;
};
