/**
 * Auto-URL and auto-path handlers (text-first scanning) for the streaming
 * mdz parser. Operates in two phases:
 *
 *  1. Speculative prefix matching: chars stream as visible text while we
 *     verify a `https://` / `http://` prefix.
 *  2. Confirmed mode: chars stream as text and on terminator a `wrap`
 *     opcode retroactively wraps the text node in a Link.
 *
 * Paths (`/...`, `./...`, `../...`) skip phase 1 — their prefix is validated
 * by hold (require enough lookahead).
 *
 * @module
 */

import {
	NEWLINE,
	SPACE,
	TAB,
	PERIOD,
	SLASH,
	ascii_to_lower,
	is_valid_path_char,
	is_word_char,
	match_url_prefix_case_insensitive,
	mdz_trim_url_punctuation,
} from './mdz_helpers.ts';
import {
	type MdzStreamParserState,
	type TryResult,
	accumulate_text,
	alloc_id,
	emit,
	ensure_paragraph,
	flush_text,
	offset,
} from './mdz_stream_parser_state.ts';

const HTTPS_PREFIX = 'https://';
const HTTP_PREFIX = 'http://';

/**
 * Forced-mode URL detection: the full prefix must be in the buffer.
 * Used at EOF when speculative prefix matching isn't needed.
 * Scheme match is case-insensitive (RFC 3986).
 *
 * @nodocs
 */
export const try_auto_url_forced = (state: MdzStreamParserState): TryResult => {
	if (state.prev_char !== -1 && is_word_char(state.prev_char)) return 'not_match';

	const prefix_len = match_url_prefix_case_insensitive(state.buffer, state.pos);
	if (prefix_len === 0) return 'not_match';

	// must have content after protocol
	if (state.pos + prefix_len >= state.buffer.length) return 'not_match';
	const after = state.buffer.charCodeAt(state.pos + prefix_len);
	if (after === SPACE || after === NEWLINE) return 'not_match';

	return scan_auto_link_forced(state, 'external');
};

/** @nodocs */
export const try_auto_path_absolute = (state: MdzStreamParserState, forced = false): TryResult => {
	// must be at word boundary (preceded by space/newline/start)
	if (
		state.prev_char !== -1 &&
		state.prev_char !== SPACE &&
		state.prev_char !== NEWLINE &&
		state.prev_char !== TAB
	) {
		return 'not_match';
	}

	// reject // and /space
	if (state.pos + 1 >= state.buffer.length) return forced ? 'not_match' : 'need_more';
	const next = state.buffer.charCodeAt(state.pos + 1);
	if (next === SLASH || next === SPACE || next === NEWLINE || next === TAB) {
		return 'not_match';
	}

	if (forced) return scan_auto_link_forced(state, 'internal');
	start_pending_url(state, 'internal');
	return 'consumed';
};

/** @nodocs */
export const try_auto_path_relative = (state: MdzStreamParserState, forced = false): TryResult => {
	if (
		state.prev_char !== -1 &&
		state.prev_char !== SPACE &&
		state.prev_char !== NEWLINE &&
		state.prev_char !== TAB
	) {
		return 'not_match';
	}

	// check for ./ or ../
	const remaining = state.buffer.length - state.pos;
	if (remaining < 3) return forced ? 'not_match' : 'need_more';

	if (
		state.buffer.charCodeAt(state.pos + 1) === PERIOD &&
		state.buffer.charCodeAt(state.pos + 2) === SLASH
	) {
		// ../
		if (remaining < 4) return forced ? 'not_match' : 'need_more';
		const after = state.buffer.charCodeAt(state.pos + 3);
		if (after === SPACE || after === NEWLINE || after === TAB || after === SLASH) {
			return 'not_match';
		}
		if (forced) return scan_auto_link_forced(state, 'internal');
		start_pending_url(state, 'internal');
		return 'consumed';
	}

	if (state.buffer.charCodeAt(state.pos + 1) === SLASH) {
		// ./
		const after = state.buffer.charCodeAt(state.pos + 2);
		if (after === SPACE || after === NEWLINE || after === TAB || after === SLASH) {
			return 'not_match';
		}
		if (forced) return scan_auto_link_forced(state, 'internal');
		start_pending_url(state, 'internal');
		return 'consumed';
	}

	return 'not_match';
};

/**
 * Start confirmed text-first mode for paths. Prefix already validated by hold.
 * Flushes prior text, resets active_text_id, sets pending_url with confirmed=true.
 *
 * @nodocs
 */
export const start_pending_url = (
	state: MdzStreamParserState,
	link_type: 'external' | 'internal',
): void => {
	flush_text(state);
	ensure_paragraph(state);
	state.active_text_id = null;
	state.pending_url = {
		url_text: '',
		start: offset(state),
		link_type,
		confirmed: true,
		viable_https: false,
		viable_http: false,
	};
	// don't advance pos — URL chars start at current position, handled by process_url_content
};

/**
 * Start speculative text-first mode for URL prefixes.
 * Chars stream as visible text while we verify `https://` or `http://`.
 * Cancels if prefix doesn't match (text stays as plain text).
 *
 * @nodocs
 */
export const start_speculative_url = (state: MdzStreamParserState): void => {
	flush_text(state);
	ensure_paragraph(state);
	state.active_text_id = null;
	state.pending_url = {
		url_text: '',
		start: offset(state),
		link_type: 'external',
		confirmed: false,
		viable_https: true,
		viable_http: true,
	};
};

/**
 * Speculative URL prefix matching. Checks each char against viable prefixes,
 * streaming as text. Confirms on full match, cancels on mismatch.
 *
 * Scheme letters (`h`, `t`, `p`, `s`) are matched case-insensitively (RFC 3986);
 * the `:` and `//` portion remains literal. Original casing is preserved in
 * the emitted reference.
 *
 * @nodocs
 */
export const process_url_prefix = (state: MdzStreamParserState): void => {
	const pu = state.pending_url!;
	const char_code = state.buffer.charCodeAt(state.pos);
	const pos = pu.url_text.length;

	// scheme letters (positions 0-4) match case-insensitively;
	// `:` and `/` (positions 5-7 for https, 4-6 for http) are literal.
	const cmp_code = pos < 5 ? ascii_to_lower(char_code) : char_code;

	// narrow viable prefixes
	if (
		pu.viable_https &&
		(pos >= HTTPS_PREFIX.length || cmp_code !== HTTPS_PREFIX.charCodeAt(pos))
	) {
		pu.viable_https = false;
	}
	if (pu.viable_http && (pos >= HTTP_PREFIX.length || cmp_code !== HTTP_PREFIX.charCodeAt(pos))) {
		pu.viable_http = false;
	}

	if (!pu.viable_https && !pu.viable_http) {
		// no viable prefix — cancel speculation, don't consume char
		state.pending_url = null;
		return;
	}

	// char matches — accumulate as text
	accumulate_text(state, state.buffer[state.pos]!, offset(state));
	pu.url_text += state.buffer[state.pos];
	state.pos++;
	state.column++;
	state.prev_char = char_code;

	// check if a prefix is fully confirmed
	if (
		(pu.viable_https && pos + 1 === HTTPS_PREFIX.length) ||
		(pu.viable_http && pos + 1 === HTTP_PREFIX.length)
	) {
		pu.confirmed = true;
	}
};

/**
 * Process URL/path chars in text-first mode. Scans path chars,
 * accumulates as visible text. Terminates on space/newline/non-path-char
 * and emits a `wrap` opcode.
 *
 * @nodocs
 */
export const process_url_content = (state: MdzStreamParserState, forced: boolean): void => {
	// speculative prefix matching phase
	if (!state.pending_url!.confirmed) {
		process_url_prefix(state);
		return;
	}

	const char_code = state.buffer.charCodeAt(state.pos);

	// URL terminator
	if (char_code === SPACE || char_code === NEWLINE || !is_valid_path_char(char_code)) {
		flush_text(state);
		complete_pending_url(state);
		// don't consume terminator — outer loop handles it
		return;
	}

	// scan URL chars
	const start = state.pos;
	state.pos++;
	while (state.pos < state.buffer.length) {
		const c = state.buffer.charCodeAt(state.pos);
		if (c === SPACE || c === NEWLINE || !is_valid_path_char(c)) break;
		state.pos++;
	}
	const text = state.buffer.slice(start, state.pos);
	accumulate_text(state, text, offset(state, start));
	state.pending_url!.url_text += text;
	state.prev_char = state.buffer.charCodeAt(state.pos - 1);
	state.column += state.pos - start;

	// at EOF in forced mode, finalize the URL
	if (state.pos >= state.buffer.length && forced) {
		flush_text(state);
		complete_pending_url(state);
	}
};

/**
 * Complete a pending URL: compute reference with trimmed punctuation,
 * emit a `wrap` opcode to retroactively wrap the text node in a Link.
 *
 * @nodocs
 */
export const complete_pending_url = (state: MdzStreamParserState): void => {
	const pu = state.pending_url!;
	state.pending_url = null;

	// unconfirmed speculative prefix (e.g. a trailing `ht` at EOF) can never
	// become a URL — paths start confirmed, URLs confirm only on a full
	// `https://`/`http://` match; text stays as plain text
	if (!pu.confirmed) return;

	const reference = mdz_trim_url_punctuation(pu.url_text);
	if (reference.length === 0) return; // empty after trimming — text stays as plain text

	// for external URLs, must have content after protocol prefix
	if (pu.link_type === 'external') {
		const prefix_len = match_url_prefix_case_insensitive(reference, 0);
		if (reference.length < prefix_len + 1) return; // just protocol, no content
	}

	const text_id = state.active_text_id;
	if (text_id === null) return; // no text node to wrap (shouldn't happen)

	const trim_end = pu.url_text.length - reference.length;
	const wrap_id = alloc_id(state);
	const url_end = pu.start + reference.length;

	if (trim_end > 0) {
		const trim_id = alloc_id(state);
		emit(state, {
			type: 'wrap',
			id: wrap_id,
			node_type: 'Link',
			target_id: text_id,
			reference,
			link_type: pu.link_type,
			start: pu.start,
			end: url_end,
			trim_end,
			trim_id,
		});
		state.active_text_id = trim_id;
	} else {
		emit(state, {
			type: 'wrap',
			id: wrap_id,
			node_type: 'Link',
			target_id: text_id,
			reference,
			link_type: pu.link_type,
			start: pu.start,
			end: url_end,
		});
		state.active_text_id = null;
	}
};

/**
 * Forced-mode auto-link: scan the full URL/path inline (no streaming needed
 * at EOF). Used when forced=true — the entire URL must be in the buffer.
 *
 * @nodocs
 */
export const scan_auto_link_forced = (
	state: MdzStreamParserState,
	link_type: 'external' | 'internal',
): TryResult => {
	let i = state.pos;
	while (i < state.buffer.length) {
		const c = state.buffer.charCodeAt(i);
		if (c === SPACE || c === NEWLINE || !is_valid_path_char(c)) break;
		i++;
	}

	let reference = state.buffer.slice(state.pos, i);
	reference = mdz_trim_url_punctuation(reference);
	if (reference.length === 0) return 'not_match';

	// for external URLs, must have content after protocol prefix
	if (link_type === 'external') {
		const prefix_len = match_url_prefix_case_insensitive(reference, 0);
		if (reference.length < prefix_len + 1) return 'not_match';
	}

	const end_pos = state.pos + reference.length;
	const link_start = offset(state);
	const link_end = offset(state, end_pos);

	flush_text(state);
	ensure_paragraph(state);

	const link_id = alloc_id(state);
	emit(state, {type: 'open', id: link_id, node_type: 'Link', start: link_start});
	const text_id = alloc_id(state);
	emit(state, {
		type: 'text',
		id: text_id,
		content: reference,
		text_type: 'Text',
		start: link_start,
		end: link_end,
	});
	emit(state, {type: 'close', id: link_id, end: link_end, reference, link_type});

	state.active_text_id = null;
	state.column += end_pos - state.pos;
	state.prev_char = reference.charCodeAt(reference.length - 1);
	state.pos = end_pos;
	return 'consumed';
};
