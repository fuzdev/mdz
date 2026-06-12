/**
 * Shared constants and pure helper functions for mdz parsers.
 *
 * Used by both the synchronous parser (`mdz_lexer.ts` + `mdz_token_parser.ts`)
 * and the streaming parser (`mdz_stream_parser.ts`).
 *
 * @module
 */

import type {MdzNode, MdzNodeText, MdzNodeComponent, MdzNodeElement} from './mdz.js';

// Character codes for performance
/** @nodocs */
export const BACKTICK = 96; // `
/** @nodocs */
export const ASTERISK = 42; // *
/** @nodocs */
export const UNDERSCORE = 95; // _
/** @nodocs */
export const TILDE = 126; // ~
/** @nodocs */
export const NEWLINE = 10; // \n
/** @nodocs */
export const HYPHEN = 45; // -
/** @nodocs */
export const HASH = 35; // #
/** @nodocs */
export const SPACE = 32; // (space)
/** @nodocs */
export const TAB = 9; // \t
/** @nodocs */
export const CARRIAGE_RETURN = 13; // \r
/** @nodocs */
export const LEFT_ANGLE = 60; // <
/** @nodocs */
export const RIGHT_ANGLE = 62; // >
/** @nodocs */
export const SLASH = 47; // /
/** @nodocs */
export const LEFT_BRACKET = 91; // [
/** @nodocs */
export const RIGHT_BRACKET = 93; // ]
/** @nodocs */
export const LEFT_PAREN = 40; // (
/** @nodocs */
export const RIGHT_PAREN = 41; // )
/** @nodocs */
export const COLON = 58; // :
/** @nodocs */
export const PERIOD = 46; // .
/** @nodocs */
export const COMMA = 44; // ,
/** @nodocs */
export const SEMICOLON = 59; // ;
/** @nodocs */
export const EXCLAMATION = 33; // !
/** @nodocs */
export const QUESTION = 63; // ?
// RFC 3986 URI characters
/** @nodocs */
export const DOLLAR = 36; // $
/** @nodocs */
export const PERCENT = 37; // %
/** @nodocs */
export const AMPERSAND = 38; // &
/** @nodocs */
export const APOSTROPHE = 39; // '
/** @nodocs */
export const PLUS = 43; // +
/** @nodocs */
export const EQUALS = 61; // =
/** @nodocs */
export const AT = 64; // @
// Character ranges
/** @nodocs */
export const A_UPPER = 65; // A
/** @nodocs */
export const Z_UPPER = 90; // Z
/** @nodocs */
export const A_LOWER = 97; // a
/** @nodocs */
export const Z_LOWER = 122; // z
/** @nodocs */
export const ZERO = 48; // 0
/** @nodocs */
export const ONE = 49; // 1
/** @nodocs */
export const NINE = 57; // 9
// mdz specification constants
/** @nodocs */
export const HR_HYPHEN_COUNT = 3; // Horizontal rule requires exactly 3 hyphens
/** @nodocs */
export const MIN_CODEBLOCK_BACKTICKS = 3; // Code blocks require minimum 3 backticks
/** @nodocs */
export const MAX_LIST_NUMBER_DIGITS = 9; // Ordered list markers cap at 9 digits (CommonMark's cap)
/** @nodocs */
export const MAX_HEADING_LEVEL = 6; // Headings support levels 1-6
/** @nodocs */
export const HTTPS_PREFIX_LENGTH = 8; // Length of "https://"
/** @nodocs */
export const HTTP_PREFIX_LENGTH = 7; // Length of "http://"
/** @nodocs */
export const H_LOWER = 104; // h
/** @nodocs */
export const H_UPPER = 72; // H

/**
 * Whether a char code is whitespace within a line — space, tab, or `\r` —
 * everything but the newline itself. A line consisting only of these counts
 * as blank (paragraph breaks), and trailing runs of them are tolerated but
 * never significant (HR and fence lines). `\r` is included so CRLF input
 * gets blank-line and end-of-line behavior for free; mdz does no other CRLF
 * handling.
 *
 * @nodocs
 */
export const is_line_whitespace = (char_code: number): boolean =>
	char_code === SPACE || char_code === TAB || char_code === CARRIAGE_RETURN;

/**
 * Whether `text` contains any non-whitespace character — the
 * whitespace-only-paragraph drop shared by both parsers. Hot path in the
 * streaming parser (called from `emit` on every text emission); the char
 * loop avoids the regex allocation `/\S/.test()` incurs per call.
 *
 * Deliberately ASCII-only (space, tab, LF, CR, FF, VT), matching the
 * grammar's blank-line definition: a line of Unicode-only whitespace
 * (U+00A0 NBSP, U+3000, etc.) is content, not blank — CommonMark agrees.
 * `/\S/` and `String.prototype.trim()` would recognize Unicode whitespace
 * and silently drop such paragraphs.
 *
 * @nodocs
 */
export const has_non_whitespace = (text: string): boolean => {
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		// 0x09=tab, 0x0a=LF, 0x0b=VT, 0x0c=FF, 0x0d=CR, 0x20=space
		if (c !== 0x20 && (c < 0x09 || c > 0x0d)) return true;
	}
	return false;
};

/**
 * A matched blockquote prefix: a run of `>` markers — tight (`>>`) or
 * separated by single spaces (`> >`), interchangeably — terminated by exactly
 * one space or the end of the line. Depth is the count of `>`.
 *
 * @nodocs
 */
export interface MdzBlockquotePrefix {
	/** Count of `>` markers. */
	depth: number;
	/**
	 * Index just past the prefix: after the terminating space, or at the
	 * line-end whitespace/newline for a bare (empty) prefix line.
	 */
	content_start: number;
}

/**
 * Match a blockquote prefix at `i` (the position of a `>`). Shared by both
 * parsers — the sync lexer calls with `forced` true (its text is complete);
 * the streaming parser gets `'pending'` when the buffer ends before the
 * prefix can resolve.
 *
 * Returns null when the line has no valid prefix: a `>` followed directly by
 * content (`>a`), a tab instead of the marker space (`>\ta`), or a tight run
 * with trailing content (`>>x`). The backtrack pin: a `>` not followed by
 * space, end-of-line, or a continuing run is content, and the separator space
 * before it re-serves as the terminator — `> >x` is a depth-1 prefix with
 * content `>x`. A `>` followed by only whitespace to the line end is a valid
 * bare prefix (trailing whitespace tolerated, never significant).
 *
 * @nodocs
 */
export const mdz_match_blockquote_prefix = (
	text: string,
	i: number,
	forced: boolean,
): MdzBlockquotePrefix | 'pending' | null => {
	let depth = 0;
	let pos = i;
	while (true) {
		// only reachable at entry — separators are consumed only when a `>` follows
		if (text.charCodeAt(pos) !== RIGHT_ANGLE) return null;
		depth++;
		pos++;
		if (pos >= text.length) {
			return forced ? {depth, content_start: pos} : 'pending';
		}
		const c = text.charCodeAt(pos);
		if (c === RIGHT_ANGLE) continue; // tight run
		if (c === SPACE) {
			if (pos + 1 >= text.length) {
				// could be a separator (next chunk starts with `>`) or the terminator
				return forced ? {depth, content_start: pos + 1} : 'pending';
			}
			if (text.charCodeAt(pos + 1) === RIGHT_ANGLE) {
				pos++; // separator — continue the run at the next `>`
				continue;
			}
			return {depth, content_start: pos + 1}; // terminating space
		}
		if (c === NEWLINE) {
			return {depth, content_start: pos}; // bare prefix line
		}
		if (is_line_whitespace(c)) {
			// tab/CR is not the marker space — valid only as tolerated trailing
			// whitespace on a bare prefix line
			let j = pos;
			while (j < text.length && is_line_whitespace(text.charCodeAt(j))) {
				j++;
			}
			if (j >= text.length) {
				return forced ? {depth, content_start: pos} : 'pending';
			}
			if (text.charCodeAt(j) === NEWLINE) {
				return {depth, content_start: pos};
			}
			// trailing content after non-space whitespace — fall through to backtrack
		}
		// invalid char directly after a `>`: this `>` is content; the separator
		// space before it (if any) re-serves as the terminator
		if (depth >= 2 && text.charCodeAt(pos - 2) === SPACE) {
			return {depth: depth - 1, content_start: pos - 1};
		}
		return null;
	}
};

/**
 * Whether the line at a quote prefix's `content_start` has non-whitespace
 * content before its end — the no-empty-start probe for quote opens
 * (contentless prefix lines never start a quote). `'pending'` when the buffer
 * ends inside the trailing whitespace run while streaming.
 *
 * @nodocs
 */
export const mdz_blockquote_line_has_content = (
	text: string,
	content_start: number,
	forced: boolean,
): boolean | 'pending' => {
	let i = content_start;
	while (i < text.length && is_line_whitespace(text.charCodeAt(i))) {
		i++;
	}
	if (i >= text.length) return forced ? false : 'pending';
	return text.charCodeAt(i) !== NEWLINE;
};

/**
 * The one-level strip width for a quote line: the first `>` plus its single
 * following space when present. Stripping one level leaves any deeper prefix
 * in the content for the nested document to parse — `>> a` strips to `> a`.
 *
 * @nodocs
 */
export const mdz_blockquote_strip_width = (text: string, i: number): number =>
	i + 1 < text.length && text.charCodeAt(i + 1) === SPACE ? 2 : 1;

/**
 * Map a position in a blockquote's stripped inner document back to its
 * source offset. Each segment covers one quote line's content plus its
 * terminating newline — contiguous in both coordinate spaces, so the map is
 * affine per segment. A binary search for the rightmost segment at or before
 * `p` always lands correctly, including the end-exclusive position past the
 * final line.
 *
 * @nodocs
 */
export const mdz_remap_segments = (
	segments: Array<{inner_start: number; source_start: number}>,
	p: number,
): number => {
	let lo = 0;
	let hi = segments.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (segments[mid]!.inner_start <= p) {
			lo = mid;
		} else {
			hi = mid - 1;
		}
	}
	const seg = segments[lo]!;
	return seg.source_start + (p - seg.inner_start);
};

/**
 * Lowercase an ASCII letter code; passes other chars through.
 * Mirrors the `[A-Z] → [a-z]` shift without touching non-ASCII.
 *
 * @nodocs
 */
export const ascii_to_lower = (char_code: number): number =>
	char_code >= A_UPPER && char_code <= Z_UPPER ? char_code + 32 : char_code;

/**
 * Case-insensitive URL scheme prefix check. Returns the prefix length
 * (8 for `https://`, 7 for `http://`) or 0 if neither matches at `pos`.
 *
 * URI schemes are case-insensitive per RFC 3986 §3.1, and mobile keyboards
 * routinely auto-capitalize the first letter of a sentence, producing
 * `Https://` etc. The original case is preserved in the emitted reference —
 * browsers normalize schemes themselves.
 *
 * @nodocs
 */
export const match_url_prefix_case_insensitive = (s: string, pos: number): 0 | 7 | 8 => {
	if (pos + HTTP_PREFIX_LENGTH > s.length) return 0;
	// h | H
	if (ascii_to_lower(s.charCodeAt(pos)) !== H_LOWER) return 0;
	// 'ttps://' (7 chars) or 'ttp://' (6 chars)
	if (
		ascii_to_lower(s.charCodeAt(pos + 1)) === 116 /* t */ &&
		ascii_to_lower(s.charCodeAt(pos + 2)) === 116 /* t */ &&
		ascii_to_lower(s.charCodeAt(pos + 3)) === 112 /* p */
	) {
		if (
			pos + HTTPS_PREFIX_LENGTH <= s.length &&
			ascii_to_lower(s.charCodeAt(pos + 4)) === 115 /* s */ &&
			s.charCodeAt(pos + 5) === COLON &&
			s.charCodeAt(pos + 6) === SLASH &&
			s.charCodeAt(pos + 7) === SLASH
		) {
			return HTTPS_PREFIX_LENGTH;
		}
		if (
			s.charCodeAt(pos + 4) === COLON &&
			s.charCodeAt(pos + 5) === SLASH &&
			s.charCodeAt(pos + 6) === SLASH
		) {
			return HTTP_PREFIX_LENGTH;
		}
	}
	return 0;
};

/**
 * Check if character code is a letter (A-Z, a-z).
 *
 * @nodocs
 */
export const is_letter = (char_code: number): boolean =>
	(char_code >= A_UPPER && char_code <= Z_UPPER) || (char_code >= A_LOWER && char_code <= Z_LOWER);

/**
 * Check if character code is valid for tag name (letter, number, hyphen, underscore).
 *
 * @nodocs
 */
export const is_tag_name_char = (char_code: number): boolean =>
	is_letter(char_code) ||
	(char_code >= ZERO && char_code <= NINE) ||
	char_code === HYPHEN ||
	char_code === UNDERSCORE;

/**
 * Check if character is part of a word for word boundary detection.
 * Used to prevent intraword emphasis with the `_` delimiter.
 *
 * Only alphanumeric characters (A-Z, a-z, 0-9) are word characters.
 * Formatting delimiters (`*`, `_`, `~`) fall outside all three ranges,
 * so they're naturally excluded without explicit checks.
 *
 * This prevents false positives with snake_case identifiers while allowing
 * adjacent formatting like `**bold**_italic_`.
 *
 * @nodocs
 */
export const is_word_char = (char_code: number): boolean =>
	(char_code >= A_UPPER && char_code <= Z_UPPER) ||
	(char_code >= A_LOWER && char_code <= Z_LOWER) ||
	(char_code >= ZERO && char_code <= NINE);

/**
 * Lookup table for valid URI path characters per RFC 3986.
 * Replaces a 16-comparison chain with a single array access.
 *
 * Valid characters:
 * - unreserved: A-Z a-z 0-9 - . _ ~
 * - sub-delims: ! $ & ' ( ) * + , ; =
 * - path allowed: : @
 * - separators: / ? #
 * - percent-encoding: %
 */
const PATH_CHAR_TABLE: Uint8Array = (() => {
	const t = new Uint8Array(128);
	for (let i = A_UPPER; i <= Z_UPPER; i++) t[i] = 1;
	for (let i = A_LOWER; i <= Z_LOWER; i++) t[i] = 1;
	for (let i = ZERO; i <= NINE; i++) t[i] = 1;
	// unreserved: - . _ ~
	t[HYPHEN] = 1;
	t[PERIOD] = 1;
	t[UNDERSCORE] = 1;
	t[TILDE] = 1;
	// sub-delims: ! $ & ' ( ) * + , ; =
	t[EXCLAMATION] = 1;
	t[DOLLAR] = 1;
	t[AMPERSAND] = 1;
	t[APOSTROPHE] = 1;
	t[LEFT_PAREN] = 1;
	t[RIGHT_PAREN] = 1;
	t[ASTERISK] = 1;
	t[PLUS] = 1;
	t[COMMA] = 1;
	t[SEMICOLON] = 1;
	t[EQUALS] = 1;
	// path allowed: : @
	t[COLON] = 1;
	t[AT] = 1;
	// separators: / ? #
	t[SLASH] = 1;
	t[QUESTION] = 1;
	t[HASH] = 1;
	// percent-encoding: %
	t[PERCENT] = 1;
	return t;
})();

/** @nodocs */
export const is_valid_path_char = (char_code: number): boolean =>
	char_code < 128 && PATH_CHAR_TABLE[char_code] === 1;

/**
 * Trim trailing punctuation from URL/path per RFC 3986 and GFM rules.
 * - Trims simple trailing: .,;:!?]
 * - Balanced logic for () only (valid in path components)
 *
 * Note on `]`: the mdz parsers (`mdz.ts`, `mdz_stream_parser_url.ts`,
 * `mdz_lexer.ts`) scan URL/path chars through `is_valid_path_char`, which
 * already rejects `]` — so it can never reach this function via parser flow.
 * The `]` branch here is for external callers using this helper directly on
 * arbitrary URL-ish input as part of the published `@fuzdev/mdz` surface.
 *
 * Optimized to avoid O(n²) string slicing - tracks end index and slices once at the end.
 */
export const mdz_trim_url_punctuation = (url: string): string => {
	let end = url.length;

	while (end > 0) {
		const last_char = url.charCodeAt(end - 1);
		if (
			last_char === PERIOD ||
			last_char === COMMA ||
			last_char === SEMICOLON ||
			last_char === COLON ||
			last_char === EXCLAMATION ||
			last_char === QUESTION ||
			last_char === RIGHT_BRACKET
		) {
			end--;
		} else {
			break;
		}
	}

	// Handle balanced parentheses ONLY (parens are valid in URI path components)
	// Only count parens when the trimmed URL ends with ')' — otherwise the
	// trailing-paren loop below can't trim anything.
	if (end > 0 && url.charCodeAt(end - 1) === RIGHT_PAREN) {
		let open_count = 0;
		let close_count = 0;
		for (let i = 0; i < end; i++) {
			const char = url.charCodeAt(i);
			if (char === LEFT_PAREN) open_count++;
			if (char === RIGHT_PAREN) close_count++;
		}

		// Trim unmatched trailing closing parens
		while (end > 0 && close_count > open_count) {
			const last_char = url.charCodeAt(end - 1);
			if (last_char === RIGHT_PAREN) {
				end--;
				close_count--;
			} else {
				break;
			}
		}
	}

	// Return original string if no trimming, otherwise slice once
	return end === url.length ? url : url.slice(0, end);
};

/**
 * Check if position in text is the start of an absolute path (starts with `/`).
 * Must be preceded by whitespace or be at the start of the string.
 * Rejects `//` (comments/protocol-relative) and slash followed by whitespace.
 *
 * @nodocs
 */
export const is_at_absolute_path = (text: string, index: number): boolean => {
	if (text.charCodeAt(index) !== SLASH) return false;
	if (index > 0) {
		const prev_char = text.charCodeAt(index - 1);
		if (prev_char !== SPACE && prev_char !== NEWLINE && prev_char !== TAB) return false;
	}
	if (index + 1 >= text.length) return false;
	const next_char = text.charCodeAt(index + 1);
	return next_char !== SLASH && next_char !== SPACE && next_char !== NEWLINE && next_char !== TAB;
};

/**
 * Check if position in text is the start of a relative path (`./` or `../`).
 * Must be preceded by whitespace or be at the start of the string.
 * Rejects prefix followed by whitespace, slash, or end of string.
 *
 * @nodocs
 */
export const is_at_relative_path = (text: string, index: number): boolean => {
	if (text.charCodeAt(index) !== PERIOD) return false;
	if (index > 0) {
		const prev_char = text.charCodeAt(index - 1);
		if (prev_char !== SPACE && prev_char !== NEWLINE && prev_char !== TAB) return false;
	}
	const remaining = text.length - index;
	// Check for ../ (at least 4 chars: ../x)
	if (
		remaining >= 4 &&
		text.charCodeAt(index + 1) === PERIOD &&
		text.charCodeAt(index + 2) === SLASH
	) {
		const after = text.charCodeAt(index + 3);
		return after !== SPACE && after !== NEWLINE && after !== TAB && after !== SLASH;
	}
	// Check for ./ (at least 3 chars: ./x)
	if (remaining >= 3 && text.charCodeAt(index + 1) === SLASH) {
		const after = text.charCodeAt(index + 2);
		return after !== SPACE && after !== NEWLINE && after !== TAB && after !== SLASH;
	}
	return false;
};

/**
 * Extracts plain text content from an array of mdz nodes, recursing into children.
 */
export const mdz_text_content = (nodes: Array<MdzNode>): string =>
	nodes
		.map((n) => ('children' in n ? mdz_text_content(n.children) : 'content' in n ? n.content : ''))
		.join('');

// lowercase slug for heading ids: lowercase, strip chars outside word/space/hyphen,
// then collapse whitespace and hyphen runs into a single `-` (empty segments dropped)
const slugify = (str: string): string =>
	str
		.toLowerCase()
		.replace(/[^\s\w-]/g, '')
		.split(/[\s-]+/g)
		.filter(Boolean)
		.join('-');

/**
 * Generates a lowercase slug id for a heading from its child nodes.
 * Follows standard markdown conventions (GitHub, etc.) where heading IDs are lowercased.
 */
export const mdz_heading_id = (nodes: Array<MdzNode>): string => slugify(mdz_text_content(nodes));

/**
 * Generates a lowercase slug id for a heading from plain text content.
 * Used by the streaming parser which tracks text content directly
 * rather than building `MdzNode[]` trees.
 */
export const mdz_heading_id_from_text = (text: string): string => slugify(text);

/**
 * Check if a string is a URL (`https://` or `http://`).
 * Requires at least one valid character after the protocol.
 * Rejects whitespace and characters that can't start a valid hostname.
 */
const URL_PATTERN = /^https?:\/\/[^\s)\]}<>.,:/?#!]/i;
export const mdz_is_url = (s: string): boolean => URL_PATTERN.test(s);

/**
 * Check if a link reference is safe to use as an `href` attribute.
 * References without a colon are always safe (paths, fragments, queries).
 * References with a colon must use `http(s)://` — rejects `javascript:`, `data:`, etc.
 */
const SAFE_PROTOCOL_PATTERN = /^https?:\/\//i;
export const mdz_is_safe_reference = (reference: string): boolean =>
	!reference.includes(':') || SAFE_PROTOCOL_PATTERN.test(reference);

const VOID_ELEMENTS = new Set([
	'area',
	'base',
	'br',
	'col',
	'embed',
	'hr',
	'img',
	'input',
	'link',
	'meta',
	'source',
	'track',
	'wbr',
]);

/**
 * Check if an element name is an HTML void element (`br`, `img`, `hr`, ...).
 * Void elements render self-closing; any parsed children are dropped.
 */
// TODO the parsers don't know void-ness — `<br>text</br>` parses as an open/close
// pair with children that renderers silently drop; consider treating void tags as
// implicitly self-closing at parse time, or rejecting the open/close form
export const mdz_is_void_element = (name: string): boolean => VOID_ELEMENTS.has(name);

/**
 * Resolves a relative path (`./` or `../`) against a base path.
 * The base is treated as a directory regardless of trailing slash
 * (`'/docs/usage'` and `'/docs/usage/'` behave identically).
 * Handles embedded `.` and `..` segments within the reference
 * (e.g., `'./a/../b'` → navigates up then down).
 * Clamps at root — excess `..` segments stop at `/` rather than escaping.
 *
 * @param reference - a relative path starting with `./` or `../`
 * @param base - An absolute base path (e.g., `'/docs/usage/'`). Empty string is treated as root.
 * @returns an absolute resolved path (e.g., `'/docs/usage/grammar'`)
 */
export const mdz_resolve_relative_path = (reference: string, base: string): string => {
	const segments = base.split('/');
	// Remove trailing empty from split (e.g., '/docs/usage/' → ['', 'docs', 'mdz', ''])
	// but keep the root segment ([''] from '' base or ['', ''] from '/').
	if (segments.length > 1 && segments.at(-1) === '') segments.pop();
	const trailing = reference.endsWith('/');
	for (const segment of reference.split('/')) {
		if (segment === '.' || segment === '') continue;
		if (segment === '..') {
			if (segments.length > 1) segments.pop(); // clamp at root
		} else {
			segments.push(segment);
		}
	}
	if (trailing) segments.push('');
	return segments.join('/');
};

/**
 * Push a node into a children array, coalescing with the previous Text node.
 * Mutates `prev.content` and `prev.end` when both are Text, avoiding array growth
 * and an extra allocation. Callers must own `dest` and not retain references to
 * the prior last element across the call.
 */
export const mdz_push_merging_text = (dest: Array<MdzNode>, node: MdzNode): void => {
	if (node.type === 'Text') {
		const last = dest[dest.length - 1];
		if (last?.type === 'Text') {
			last.content += node.content;
			last.end = node.end;
			return;
		}
	}
	dest.push(node);
};

/**
 * Return a new array with adjacent Text nodes merged into single nodes.
 * Fast path: returns the original array when no merging is needed.
 */
export const mdz_merge_adjacent_text = (nodes: Array<MdzNode>): Array<MdzNode> => {
	if (nodes.length <= 1) return nodes;

	let needs_merge = false;
	for (let i = 1; i < nodes.length; i++) {
		if (nodes[i - 1]!.type === 'Text' && nodes[i]!.type === 'Text') {
			needs_merge = true;
			break;
		}
	}
	if (!needs_merge) return nodes;

	const merged: Array<MdzNode> = [];
	let pending: MdzNodeText | null = null;

	for (const node of nodes) {
		if (node.type === 'Text') {
			if (pending) {
				pending = {
					type: 'Text',
					content: pending.content + node.content,
					start: pending.start,
					end: node.end,
				};
			} else {
				pending = {...node};
			}
		} else {
			if (pending) {
				merged.push(pending);
				pending = null;
			}
			merged.push(node);
		}
	}

	if (pending) merged.push(pending);

	return merged;
};

/**
 * Extracts a single tag (component or element) if it's the only non-whitespace content.
 *
 * @returns the tag node if paragraph wrapping should be skipped (MDX convention),
 *   or `null` if the content should be wrapped in a paragraph
 */
export const mdz_extract_single_tag = (
	nodes: Array<MdzNode>,
): MdzNodeComponent | MdzNodeElement | null => {
	let tag: MdzNodeComponent | MdzNodeElement | null = null;

	for (const node of nodes) {
		if (node.type === 'Component' || node.type === 'Element') {
			if (tag) return null; // Multiple tags
			tag = node;
		} else if (node.type === 'Text') {
			// Allow only whitespace-only text nodes
			if (node.content.trim() !== '') return null;
		} else {
			// Any other node type means not a single tag
			return null;
		}
	}

	return tag;
};
