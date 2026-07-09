/**
 * mdz lexer — tokenizes input into a flat `MdzToken[]` stream.
 *
 * Phase 1 of the synchronous parsing pipeline behind `mdz_parse`.
 * Phase 2 (token parser) is in `mdz_token_parser.ts`.
 *
 * @module
 */

import {
	mdz_is_url,
	mdz_is_safe_reference,
	is_letter,
	is_tag_name_char,
	is_word_char,
	is_valid_path_char,
	mdz_trim_url_punctuation,
	BACKTICK,
	ASTERISK,
	UNDERSCORE,
	TILDE,
	NEWLINE,
	HYPHEN,
	HASH,
	SPACE,
	LEFT_ANGLE,
	RIGHT_ANGLE,
	SLASH,
	PERIOD,
	LEFT_BRACKET,
	LEFT_PAREN,
	RIGHT_BRACKET,
	A_UPPER,
	Z_UPPER,
	ZERO,
	ONE,
	NINE,
	HR_HYPHEN_COUNT,
	MIN_CODEBLOCK_BACKTICKS,
	MAX_HEADING_LEVEL,
	MAX_LIST_NUMBER_DIGITS,
	match_url_prefix_case_insensitive,
	is_at_absolute_path,
	is_at_relative_path,
	is_line_whitespace,
	mdz_match_blockquote_prefix,
	mdz_blockquote_line_has_content,
	mdz_blockquote_strip_width,
	mdz_remap_segments,
	mdz_split_table_row,
	mdz_parse_table_delimiter,
	PIPE,
	TEXT_CLASS_BACKSLASH,
	TEXT_CLASS_NEWLINE,
	TEXT_CLASS_STOP,
	TEXT_CLASS_URL,
	TEXT_SCAN_CLASS,
} from './mdz_helpers.ts';

import type {MdzTableAlign} from './mdz.ts';

//
// Token types
//

export interface MdzTokenBase {
	start: number;
	end: number;
}

export type MdzToken =
	| MdzTokenText
	| MdzTokenCode
	| MdzTokenCodeblock
	| MdzTokenBoldOpen
	| MdzTokenBoldClose
	| MdzTokenItalicOpen
	| MdzTokenItalicClose
	| MdzTokenStrikethroughOpen
	| MdzTokenStrikethroughClose
	| MdzTokenLinkTextOpen
	| MdzTokenLinkTextClose
	| MdzTokenLinkRef
	| MdzTokenAutolink
	| MdzTokenHeadingStart
	| MdzTokenHr
	| MdzTokenTagOpen
	| MdzTokenTagSelfClose
	| MdzTokenTagClose
	| MdzTokenHeadingEnd
	| MdzTokenParagraphBreak
	| MdzTokenListOpen
	| MdzTokenListClose
	| MdzTokenListItemOpen
	| MdzTokenListItemClose
	| MdzTokenBlockquoteOpen
	| MdzTokenBlockquoteClose
	| MdzTokenTableOpen
	| MdzTokenTableClose
	| MdzTokenTableRowOpen
	| MdzTokenTableRowClose
	| MdzTokenTableCellOpen
	| MdzTokenTableCellClose;

export interface MdzTokenText extends MdzTokenBase {
	type: 'text';
	content: string;
}

export interface MdzTokenCode extends MdzTokenBase {
	type: 'code';
	content: string;
}

export interface MdzTokenCodeblock extends MdzTokenBase {
	type: 'codeblock';
	lang: string | null;
	content: string;
}

export interface MdzTokenBoldOpen extends MdzTokenBase {
	type: 'bold_open';
}

export interface MdzTokenBoldClose extends MdzTokenBase {
	type: 'bold_close';
}

export interface MdzTokenItalicOpen extends MdzTokenBase {
	type: 'italic_open';
}

export interface MdzTokenItalicClose extends MdzTokenBase {
	type: 'italic_close';
}

export interface MdzTokenStrikethroughOpen extends MdzTokenBase {
	type: 'strikethrough_open';
}

export interface MdzTokenStrikethroughClose extends MdzTokenBase {
	type: 'strikethrough_close';
}

export interface MdzTokenLinkTextOpen extends MdzTokenBase {
	type: 'link_text_open';
}

export interface MdzTokenLinkTextClose extends MdzTokenBase {
	type: 'link_text_close';
}

export interface MdzTokenLinkRef extends MdzTokenBase {
	type: 'link_ref';
	reference: string;
	link_type: 'external' | 'internal';
}

export interface MdzTokenAutolink extends MdzTokenBase {
	type: 'autolink';
	reference: string;
	link_type: 'external' | 'internal';
}

export interface MdzTokenHeadingStart extends MdzTokenBase {
	type: 'heading_start';
	level: 1 | 2 | 3 | 4 | 5 | 6;
}

export interface MdzTokenHr extends MdzTokenBase {
	type: 'hr';
}

export interface MdzTokenTagOpen extends MdzTokenBase {
	type: 'tag_open';
	name: string;
	is_component: boolean;
}

export interface MdzTokenTagSelfClose extends MdzTokenBase {
	type: 'tag_self_close';
	name: string;
	is_component: boolean;
}

export interface MdzTokenTagClose extends MdzTokenBase {
	type: 'tag_close';
	name: string;
}

export interface MdzTokenHeadingEnd extends MdzTokenBase {
	type: 'heading_end';
}

export interface MdzTokenParagraphBreak extends MdzTokenBase {
	type: 'paragraph_break';
}

export interface MdzTokenListOpen extends MdzTokenBase {
	type: 'list_open';
	ordered: boolean;
}

export interface MdzTokenListClose extends MdzTokenBase {
	type: 'list_close';
}

export interface MdzTokenListItemOpen extends MdzTokenBase {
	type: 'list_item_open';
	/** Authored number (ordered lists only). */
	number?: number;
}

export interface MdzTokenListItemClose extends MdzTokenBase {
	type: 'list_item_close';
}

export interface MdzTokenBlockquoteOpen extends MdzTokenBase {
	type: 'blockquote_open';
}

export interface MdzTokenBlockquoteClose extends MdzTokenBase {
	type: 'blockquote_close';
}

export interface MdzTokenTableOpen extends MdzTokenBase {
	type: 'table_open';
	/** Per-column alignment from the delimiter row; length is the column count. */
	align: Array<MdzTableAlign>;
}

export interface MdzTokenTableClose extends MdzTokenBase {
	type: 'table_close';
}

export interface MdzTokenTableRowOpen extends MdzTokenBase {
	type: 'table_row_open';
	/** `true` for the header row, `false` for body rows. */
	header: boolean;
}

export interface MdzTokenTableRowClose extends MdzTokenBase {
	type: 'table_row_close';
}

export interface MdzTokenTableCellOpen extends MdzTokenBase {
	type: 'table_cell_open';
}

export interface MdzTokenTableCellClose extends MdzTokenBase {
	type: 'table_cell_close';
}

/**
 * A matched list marker: `- ` (unordered) or `N. ` (ordered, 1-9 digits).
 * `empty` markers have nothing but whitespace after the marker — valid only
 * as mid-list empty items, never starting a list.
 */
interface MdzListMarker {
	ordered: boolean;
	/** Parsed integer for ordered markers (`007.` → 7); `0` for unordered. */
	number: number;
	/** Source position of the marker character. */
	start: number;
	/** Index just past the marker chars (`-` or `N.`), before the space. */
	marker_end: number;
	/** Index just past the marker space — the inline run's content. */
	content_start: number;
	empty: boolean;
}

/** An open list level during `#tokenize_list` — the column of its markers. */
interface MdzListLevel {
	indent: number;
	ordered: boolean;
}

//
// Lexer
//

/**
 * Tokenizes mdz input into a flat `MdzToken` stream for `MdzTokenParser`.
 *
 * The lexer owns all structural decisions — block boundaries, list level
 * stacks, blockquote prefix stripping (sub-lexing quote content as a
 * mini-document with positions remapped to source offsets), and inline
 * delimiter pairing bounded by `#max_search_index` — so the token parser
 * only assembles the tree.
 */
export class MdzLexer {
	#text: string;
	#index: number = 0;
	#tokens: Array<MdzToken> = [];
	#max_search_index: number = Number.MAX_SAFE_INTEGER;
	#search_memo: Map<string, {from: number; result: number}> = new Map();
	#break_memo: {from: number; result: number} | null = null;
	/**
	 * Whether `#tokenize_text` is inside a list-item inline run: single
	 * newlines are soft breaks whose following structural indent strips from
	 * content, and paragraph-break/block-lookahead checks are skipped (the run
	 * scanner pre-validated every line in the run as continuation).
	 */
	#list_run_strip: boolean = false;
	/**
	 * Whether `#tokenize_text` is inside a table cell: `#max_search_index` is a
	 * hard stop (the cell's trimmed end, mid-line with no newline to halt on)
	 * and `\|` unescapes to a literal pipe.
	 */
	#in_table_cell: boolean = false;

	constructor(text: string) {
		this.#text = text;
	}

	/**
	 * Rebind to a new text, so one lexer instance can be reused across inputs —
	 * the streaming table path reuses one across a table's rows via
	 * `MdzTableCellParser` instead of allocating a lexer (and its memo `Map`)
	 * per row. The search memos survive when the text is identical (they're
	 * valid over the immutable text — the common case for rows parsed from one
	 * buffered chunk) and clear otherwise. Per-parse cursor state is reset by
	 * `lex_table_cell` itself.
	 *
	 * @nodocs
	 */
	rebind(text: string): void {
		if (this.#text === text) return;
		this.#text = text;
		this.#search_memo.clear();
		this.#break_memo = null;
	}

	/**
	 * Memoized `String#indexOf` over the immutable text.
	 *
	 * Delimiter and closing-tag searches scan forward from the current lex
	 * position, and a needle that never occurs again would otherwise rescan to
	 * the end of the text on every attempt — making inputs dense in unclosed
	 * candidates quadratic (e.g. `Vec<String>`-style generics searching for
	 * `</String>` at every occurrence). Caching the last result per needle
	 * makes each missing needle scan the remaining text at most once.
	 */
	#index_of(needle: string, from: number): number {
		const memo = this.#search_memo.get(needle);
		if (memo !== undefined && memo.from <= from && (memo.result === -1 || memo.result >= from)) {
			return memo.result;
		}
		const result = this.#text.indexOf(needle, from);
		if (memo === undefined) {
			this.#search_memo.set(needle, {from, result});
		} else {
			memo.from = from;
			memo.result = result;
		}
		return result;
	}

	tokenize(): Array<MdzToken> {
		// Skip leading blank lines
		this.#skip_blank_lines();

		while (this.#index < this.#text.length) {
			// Check for block elements at column 0
			if (this.#is_at_column_0()) {
				if (this.#tokenize_heading()) continue;
				if (this.#tokenize_hr()) continue;
				if (this.#tokenize_codeblock()) continue;
				if (this.#tokenize_list()) continue;
				if (this.#tokenize_blockquote()) continue;
				if (this.#tokenize_table()) continue;
			}

			// Check for paragraph break
			if (this.#is_at_paragraph_break()) {
				const start = this.#index;
				this.#skip_blank_lines();
				this.#tokens.push({type: 'paragraph_break', start, end: this.#index});
				continue;
			}

			// Inline tokenization
			this.#tokenize_inline();
		}

		return this.#tokens;
	}

	/**
	 * Tokenize a table cell's inline content `[cell_start, cell_end)` as a
	 * bounded inline run, with no wrapping cell tokens (the bare form of
	 * `#emit_table_cell`, sharing `#tokenize_cell_inline`). The streaming parser
	 * reuses it across a row's cells via `MdzTableCellParser`: the token buffer
	 * resets per call while the search memo — valid over the immutable bound
	 * text — carries across cells (the same reuse the sync lexer does in place).
	 *
	 * @nodocs
	 */
	lex_table_cell(cell_start: number, cell_end: number): Array<MdzToken> {
		this.#tokens = [];
		this.#tokenize_cell_inline(cell_start, cell_end);
		return this.#tokens;
	}

	#is_at_column_0(): boolean {
		return this.#index === 0 || this.#text.charCodeAt(this.#index - 1) === NEWLINE;
	}

	/**
	 * Whether a paragraph break starts at the current position: a newline
	 * followed (across optional line whitespace) by another newline — i.e. the
	 * next line is blank. Linear in total despite the inner scan: the scan only
	 * runs at newline positions and covers each whitespace run at most once
	 * per newline preceding it.
	 */
	#is_at_paragraph_break(): boolean {
		if (this.#text.charCodeAt(this.#index) !== NEWLINE) return false;
		let i = this.#index + 1;
		while (i < this.#text.length && is_line_whitespace(this.#text.charCodeAt(i))) {
			i++;
		}
		return i < this.#text.length && this.#text.charCodeAt(i) === NEWLINE;
	}

	#match(str: string): boolean {
		return this.#text.startsWith(str, this.#index);
	}

	/**
	 * Skip newlines and whitespace-only lines (including a trailing
	 * whitespace-only line at EOF). Stops at the start of any line with
	 * content — leading whitespace on a content line stays in the text.
	 */
	#skip_blank_lines(): void {
		while (this.#index < this.#text.length) {
			const char_code = this.#text.charCodeAt(this.#index);
			if (char_code === NEWLINE) {
				this.#index++;
				continue;
			}
			if (!is_line_whitespace(char_code)) return;
			let i = this.#index;
			while (i < this.#text.length && is_line_whitespace(this.#text.charCodeAt(i))) {
				i++;
			}
			if (i < this.#text.length && this.#text.charCodeAt(i) !== NEWLINE) return; // line has content
			this.#index = i; // blank to end of line (or EOF); newline consumed next iteration
		}
	}

	// -- Block tokenizers --

	#tokenize_heading(): boolean {
		let i = this.#index;

		// Count hashes (must be 1-6)
		let hash_count = 0;
		while (
			i < this.#text.length &&
			this.#text.charCodeAt(i) === HASH &&
			hash_count <= MAX_HEADING_LEVEL
		) {
			hash_count++;
			i++;
		}

		if (hash_count === 0 || hash_count > MAX_HEADING_LEVEL) return false;

		// Must have space after hashes
		if (i >= this.#text.length || this.#text.charCodeAt(i) !== SPACE) return false;
		i++; // consume the space

		// Must have at least one non-whitespace character after the space
		let has_content = false;
		for (let j = i; j < this.#text.length; j++) {
			const char_code = this.#text.charCodeAt(j);
			if (char_code === NEWLINE) break;
			if (!is_line_whitespace(char_code)) {
				has_content = true;
				break;
			}
		}

		if (!has_content) return false;

		const start = this.#index;
		// Advance past "## " (hashes + space)
		this.#index = start + hash_count + 1;

		this.#tokens.push({
			type: 'heading_start',
			level: hash_count as 1 | 2 | 3 | 4 | 5 | 6,
			start,
			end: this.#index, // end of "## " prefix
		});

		// Find end-of-line to bound nested tokenizers (prevents tag scanner from scanning past heading)
		let eol = this.#text.indexOf('\n', this.#index);
		if (eol === -1) eol = this.#text.length;

		const saved_max = this.#max_search_index;
		this.#max_search_index = eol;

		// Tokenize inline content until newline or EOF
		// tokenize_text may consume a newline as part of block-element lookahead,
		// so we check emitted text tokens for embedded newlines and trim.
		while (this.#index < eol) {
			const token_count_before = this.#tokens.length;
			this.#tokenize_inline();

			// Check if the last emitted token is text containing a newline
			if (this.#tokens.length > token_count_before) {
				const last_token = this.#tokens[this.#tokens.length - 1]!;
				if (last_token.type === 'text') {
					const newline_idx = last_token.content.indexOf('\n');
					if (newline_idx !== -1) {
						const trimmed = last_token.content.slice(0, newline_idx);
						if (trimmed) {
							last_token.content = trimmed;
							last_token.end = last_token.start + trimmed.length;
						} else {
							this.#tokens.pop();
						}
						this.#index = last_token.start + newline_idx;
						break;
					}
				}
			}
		}

		this.#max_search_index = saved_max;

		// Emit heading_end marker so the token parser knows where heading content stops
		this.#tokens.push({type: 'heading_end', start: this.#index, end: this.#index});

		// Skip newlines after heading
		this.#skip_blank_lines();

		return true;
	}

	#tokenize_hr(): boolean {
		let i = this.#index;

		// Must have exactly three hyphens
		if (
			i + HR_HYPHEN_COUNT > this.#text.length ||
			this.#text.charCodeAt(i) !== HYPHEN ||
			this.#text.charCodeAt(i + 1) !== HYPHEN ||
			this.#text.charCodeAt(i + 2) !== HYPHEN
		) {
			return false;
		}
		i += HR_HYPHEN_COUNT;

		// After the three hyphens, only whitespace and newline (or EOF) allowed
		while (i < this.#text.length) {
			const char_code = this.#text.charCodeAt(i);
			if (char_code === NEWLINE) break;
			if (!is_line_whitespace(char_code)) return false;
			i++;
		}

		const start = this.#index;
		this.#index = i; // consume up to but not including newline

		this.#tokens.push({type: 'hr', start, end: this.#index});

		// Skip newlines after HR
		this.#skip_blank_lines();

		return true;
	}

	#tokenize_codeblock(): boolean {
		// a top-level fence is the indent-0 case of the general fence matcher
		const fence = this.#match_fence(this.#index, 0);
		if (fence === null) return false;

		this.#tokens.push(fence.token);
		this.#index = fence.end;

		// Skip newlines after codeblock
		this.#skip_blank_lines();

		return true;
	}

	// -- Blockquote tokenizers --

	/**
	 * Match a quote prefix in the complete sync text — never `'pending'`.
	 * See `mdz_match_blockquote_prefix`.
	 */
	#match_blockquote_prefix(i: number): {depth: number; content_start: number} | null {
		const prefix = mdz_match_blockquote_prefix(this.#text, i, true);
		return prefix === 'pending' ? null : prefix;
	}

	/**
	 * Whether the line at `i` opens a quote: a valid prefix with non-whitespace
	 * content after the full prefix on the same line (contentless prefix lines
	 * never start a quote — no empty start, mirroring lists).
	 */
	#is_blockquote_opener(i: number): boolean {
		const prefix = this.#match_blockquote_prefix(i);
		return (
			prefix !== null &&
			mdz_blockquote_line_has_content(this.#text, prefix.content_start, true) === true
		);
	}

	/**
	 * Tokenize a blockquote whose opener line is at column 0. Returns false
	 * with no side effects when the line doesn't open one. Consumes trailing
	 * blank lines after the quote, mirroring the other block tokenizers.
	 */
	#tokenize_blockquote(): boolean {
		if (this.#text.charCodeAt(this.#index) !== RIGHT_ANGLE) return false;
		if (!this.#is_blockquote_opener(this.#index)) return false;
		this.#tokenize_blockquote_at(this.#index, -1);
		this.#skip_blank_lines();
		return true;
	}

	/**
	 * Tokenize a blockquote starting at the validated opener position `first`.
	 * A quote's content is a mini-document behind the per-line prefix: the
	 * extent scan collects consecutive prefix lines (a blank or non-prefix
	 * line ends the quote — no lazy continuation), one prefix level strips
	 * from each line (deeper `>`s stay in the content for the nested document
	 * to parse), and the stripped content sub-lexes through a fresh `MdzLexer`
	 * with token positions remapped to source offsets. Nested quotes, lists,
	 * fences, and headings inside all follow from the recursion.
	 *
	 * `item_indent` is -1 for top-level quotes (continuation prefixes sit at
	 * column 0 exactly) or the attach item's marker indent for in-item quotes
	 * (continuation lines carry any indent deeper than it before their
	 * prefix). Leaves `#index` at the last quote line's end, before its
	 * newline (or at EOF).
	 */
	#tokenize_blockquote_at(first: number, item_indent: number): void {
		// the inner document is the stripped source region including each line's
		// terminating newline — only a source-EOF-cut final line lacks one, so a
		// quote's content parses exactly like a standalone document (a complete
		// fence opener line on the last quote line opens an empty fence, not text)
		const parts: Array<string> = [];
		const segments: Array<{inner_start: number; source_start: number}> = [];
		let inner_len = 0;
		let line_first = first;
		let last_line_end = first;
		while (true) {
			const strip = line_first + mdz_blockquote_strip_width(this.#text, line_first);
			let nl = this.#text.indexOf('\n', line_first);
			if (nl === -1) nl = this.#text.length;
			segments.push({inner_start: inner_len, source_start: strip});
			const content = this.#text.slice(Math.min(strip, nl), nl < this.#text.length ? nl + 1 : nl);
			parts.push(content);
			inner_len += content.length;
			last_line_end = nl;
			if (nl >= this.#text.length) break;
			// the next line continues the quote iff it carries a valid prefix at
			// the required position: column 0 exactly for top-level quotes, any
			// indent deeper than the item's marker for in-item quotes
			const line_start = nl + 1;
			let next_first = line_start;
			if (item_indent >= 0) {
				while (
					next_first < this.#text.length &&
					is_line_whitespace(this.#text.charCodeAt(next_first))
				) {
					next_first++;
				}
				if (next_first - line_start <= item_indent) break;
			}
			if (this.#text.charCodeAt(next_first) !== RIGHT_ANGLE) break;
			if (this.#match_blockquote_prefix(next_first) === null) break;
			line_first = next_first;
		}

		this.#tokens.push({type: 'blockquote_open', start: first, end: first});
		const inner_tokens = new MdzLexer(parts.join('')).tokenize();
		for (const token of inner_tokens) {
			token.start = mdz_remap_segments(segments, token.start);
			token.end = mdz_remap_segments(segments, token.end);
			this.#tokens.push(token);
		}
		this.#tokens.push({type: 'blockquote_close', start: last_line_end, end: last_line_end});
		this.#index = last_line_end;
	}

	// -- Table tokenizers --

	/**
	 * Tokenize a table starting at a column-0 pipe row, emitting
	 * `table_open`/`table_row_open`/`table_cell_open` … structure tokens (the
	 * header row's cells first, then each body row's). Returns false with no
	 * side effects when the current line isn't a table: not a `| … |` row, or
	 * not followed by a delimiter row whose column count matches the header. The
	 * delimiter row's colons set `align`; body rows continue until a blank line,
	 * a non-pipe-row line, or EOF.
	 */
	#tokenize_table(): boolean {
		const table_start = this.#index;
		let header_end = this.#index_of('\n', this.#index);
		if (header_end === -1) header_end = this.#text.length;
		const header_cells = mdz_split_table_row(this.#text, this.#index, header_end);
		if (header_cells === null) return false;
		if (header_end >= this.#text.length) return false; // a header needs a delimiter row beneath it
		const delim_start = header_end + 1;
		let delim_end = this.#index_of('\n', delim_start);
		if (delim_end === -1) delim_end = this.#text.length;
		const align = mdz_parse_table_delimiter(this.#text, delim_start, delim_end);
		if (align === null || align.length !== header_cells.length) return false;

		// committed — emit the table; the delimiter row is structural (not emitted)
		this.#tokens.push({type: 'table_open', align, start: table_start, end: header_end});
		this.#emit_table_row(header_cells, true, table_start, header_end);

		this.#index = delim_end;
		let table_end = delim_end;

		// body rows: consecutive valid pipe rows, until a blank/non-row line or EOF
		while (this.#index < this.#text.length) {
			const row_start = this.#index + 1; // past the newline at #index
			let row_end = this.#index_of('\n', row_start);
			if (row_end === -1) row_end = this.#text.length;
			const cells = mdz_split_table_row(this.#text, row_start, row_end);
			if (cells === null) break;
			this.#emit_table_row(cells, false, row_start, row_end);
			this.#index = row_end;
			table_end = row_end;
		}

		this.#tokens.push({type: 'table_close', start: table_end, end: table_end});
		this.#skip_blank_lines();
		return true;
	}

	/** Emit one table row's open / cell / close tokens. */
	#emit_table_row(
		cells: Array<{start: number; end: number}>,
		header: boolean,
		row_start: number,
		row_end: number,
	): void {
		this.#tokens.push({type: 'table_row_open', header, start: row_start, end: row_start});
		for (const cell of cells) {
			this.#emit_table_cell(cell.start, cell.end);
		}
		this.#tokens.push({type: 'table_row_close', start: row_end, end: row_end});
	}

	/**
	 * Emit one cell's `table_cell_open`, inline-content tokens, and
	 * `table_cell_close`. Inline tokenization is bounded to the cell's trimmed
	 * span via `#max_search_index`, with `#in_table_cell` set so `#tokenize_text`
	 * stops at that bound and unescapes `\|`.
	 */
	#emit_table_cell(cell_start: number, cell_end: number): void {
		this.#tokens.push({type: 'table_cell_open', start: cell_start, end: cell_start});
		this.#tokenize_cell_inline(cell_start, cell_end);
		this.#tokens.push({type: 'table_cell_close', start: cell_end, end: cell_end});
	}

	/**
	 * Tokenize a cell's trimmed inline span `[cell_start, cell_end)` into the
	 * current token buffer, bounded by `#max_search_index` with `#in_table_cell`
	 * set so `#tokenize_text` stops at the bound and unescapes `\|`. Shared by
	 * `#emit_table_cell` (wrapped in cell tokens) and `lex_table_cell` (bare).
	 */
	#tokenize_cell_inline(cell_start: number, cell_end: number): void {
		const saved_max = this.#max_search_index;
		this.#max_search_index = cell_end;
		this.#in_table_cell = true;
		this.#index = cell_start;
		while (this.#index < cell_end) {
			this.#tokenize_inline();
		}
		this.#in_table_cell = false;
		this.#max_search_index = saved_max;
	}

	/**
	 * Recognize an in-item table whose header row's leading `|` is at `first`
	 * (the line's indent already skipped): a pipe row whose next line is a
	 * delimiter row, both indented past `marker_indent` (so both stay inside the
	 * item). Returns the parsed header/delimiter, or null. Pure — no emission.
	 */
	#match_item_table_head(
		first: number,
		marker_indent: number,
	): {
		header_cells: Array<{start: number; end: number}>;
		header_end: number;
		align: Array<MdzTableAlign>;
		delim_end: number;
	} | null {
		const header_end = this.#index_of('\n', first);
		if (header_end === -1) return null; // a header needs a delimiter line beneath it
		const header_cells = mdz_split_table_row(this.#text, first, header_end);
		if (header_cells === null) return null;
		const delim_line_start = header_end + 1;
		let dj = delim_line_start;
		while (dj < this.#text.length && is_line_whitespace(this.#text.charCodeAt(dj))) dj++;
		if (dj - delim_line_start <= marker_indent) return null; // delimiter dedented out of the item
		let delim_end = this.#index_of('\n', dj);
		if (delim_end === -1) delim_end = this.#text.length;
		const align = mdz_parse_table_delimiter(this.#text, dj, delim_end);
		if (align === null || align.length !== header_cells.length) return null;
		return {header_cells, header_end, align, delim_end};
	}

	/** Whether a table opens at `first` as a block child of an item at `marker_indent`. */
	#is_item_table_start(first: number, marker_indent: number): boolean {
		return this.#match_item_table_head(first, marker_indent) !== null;
	}

	/**
	 * Tokenize an in-item table at `first` (a recognized table start). Mirrors
	 * `#tokenize_table` but per row skips the line's indent to the `|` and ends
	 * when a row dedents to `marker_indent` or shallower, leaving `#index` at the
	 * table's terminating newline so the list loop classifies what follows (no
	 * `#skip_blank_lines` — the list owns blank-line containment).
	 */
	#tokenize_item_table(first: number, marker_indent: number): void {
		const head = this.#match_item_table_head(first, marker_indent)!;
		this.#tokens.push({type: 'table_open', align: head.align, start: first, end: head.header_end});
		this.#emit_table_row(head.header_cells, true, first, head.header_end);
		this.#index = head.delim_end;
		let table_end = head.delim_end;
		while (this.#index < this.#text.length) {
			const row_line_start = this.#index + 1; // past the newline at #index
			let rj = row_line_start;
			while (rj < this.#text.length && is_line_whitespace(this.#text.charCodeAt(rj))) rj++;
			if (rj - row_line_start <= marker_indent) break; // dedent ends the table
			if (this.#text.charCodeAt(rj) !== PIPE) break;
			let row_end = this.#index_of('\n', rj);
			if (row_end === -1) row_end = this.#text.length;
			const cells = mdz_split_table_row(this.#text, rj, row_end);
			if (cells === null) break;
			this.#emit_table_row(cells, false, rj, row_end);
			this.#index = row_end;
			table_end = row_end;
		}
		this.#tokens.push({type: 'table_close', start: table_end, end: table_end});
	}

	// -- List tokenizers --

	/**
	 * Tokenize an entire list starting at a column-0 marker line, emitting
	 * `list_open`/`list_item_open`/`list_item_close`/`list_close` structure
	 * tokens (plus `paragraph_break` and `codeblock` for in-item block
	 * children). Returns false with no side effects when the current line
	 * doesn't open a list: not a marker, an empty marker (empty items never
	 * start a list), or a non-`1.` ordered marker interrupting a paragraph.
	 */
	#tokenize_list(): boolean {
		const first_marker = this.#match_list_marker(this.#index);
		if (first_marker === null || first_marker.empty) return false;
		// ordered interrupt guard: only `1.` opens an ordered list against a
		// current paragraph, so hard-wrapped `2024. The…` lines stay prose
		if (first_marker.ordered && first_marker.number !== 1 && this.#in_paragraph()) return false;

		const levels: Array<MdzListLevel> = [];
		this.#list_open(levels, 0, first_marker);
		this.#list_run(levels, first_marker.content_start);

		// line loop — each iteration starts with #index at the newline (or EOF)
		// that terminated the previous run, block child, or empty-marker line
		while (this.#index < this.#text.length) {
			this.#index++; // consume the newline

			// blank lines are contained, not terminal: scan to the next content
			// line and let its shape decide (sibling/nest/paragraph-child/close)
			let line_start = this.#index;
			let first = line_start;
			let at_eof = false;
			while (true) {
				let i = first;
				while (i < this.#text.length && is_line_whitespace(this.#text.charCodeAt(i))) {
					i++;
				}
				if (i >= this.#text.length) {
					// blank to EOF — consume it; the list closes at EOF
					this.#index = i;
					at_eof = true;
					break;
				}
				if (this.#text.charCodeAt(i) === NEWLINE) {
					line_start = i + 1; // blank line — keep scanning
					first = line_start;
					continue;
				}
				first = i; // content line found
				break;
			}
			if (at_eof) break;

			const indent = first - line_start;
			const deepest = levels[levels.length - 1]!;
			const marker = this.#match_list_marker(first);

			if (marker !== null && !marker.empty) {
				if (indent > deepest.indent) {
					// indenting past the deepest level nests (any ordered number here:
					// the `2024.`-guard lives in the run scanner, and reaching this
					// line means a blank or block boundary intervened)
					this.#list_open(levels, indent, marker);
				} else {
					// a dedent snaps to the nearest surviving level
					while (levels.length > 1 && levels[levels.length - 1]!.indent > indent) {
						this.#list_close(levels);
					}
					if (levels[levels.length - 1]!.ordered === marker.ordered) {
						// sibling item
						this.#tokens.push({type: 'list_item_close', start: first, end: first});
						this.#list_item_open(marker);
					} else {
						// marker-type switch: close the list, open a new one at this indent
						this.#list_close(levels);
						this.#list_open(levels, indent, marker);
					}
				}
				this.#list_run(levels, marker.content_start);
				continue;
			}

			if (marker !== null && marker.empty) {
				// empty item: only at an indent exactly matching an open level of
				// the same marker type — anything else degrades below
				const level_idx = levels.findIndex(
					(l) => l.indent === indent && l.ordered === marker.ordered,
				);
				if (level_idx !== -1) {
					while (levels.length - 1 > level_idx) {
						this.#list_close(levels);
					}
					this.#tokens.push({type: 'list_item_close', start: first, end: first});
					this.#list_item_open(marker);
					// consume the marker and any trailing whitespace, leaving #index
					// at the line's newline (or EOF)
					let j = marker.marker_end;
					while (j < this.#text.length && is_line_whitespace(this.#text.charCodeAt(j))) {
						j++;
					}
					this.#index = j;
					continue;
				}
			}

			// a deeper line that classifies as a valid fence open becomes a code
			// block child of the item it would otherwise continue
			if (indent > 0 && this.#text.charCodeAt(first) === BACKTICK) {
				const target_idx = this.#list_continuation_target(levels, indent);
				if (target_idx !== -1) {
					const fence = this.#match_fence(first, indent);
					if (fence !== null) {
						while (levels.length - 1 > target_idx) {
							this.#list_close(levels);
						}
						this.#tokens.push(fence.token);
						this.#index = fence.end;
						continue;
					}
				}
			}

			// a deeper quote-opener line becomes a blockquote child of the item
			// it would otherwise continue (the fence precedent — interrupts a
			// current run without a blank line)
			if (indent > 0 && this.#text.charCodeAt(first) === RIGHT_ANGLE) {
				const target_idx = this.#list_continuation_target(levels, indent);
				if (target_idx !== -1 && this.#is_blockquote_opener(first)) {
					while (levels.length - 1 > target_idx) {
						this.#list_close(levels);
					}
					this.#tokenize_blockquote_at(first, levels[levels.length - 1]!.indent);
					continue;
				}
			}

			// a deeper pipe-row line whose next line is a delimiter becomes a
			// table child of the item it would otherwise continue (the fence/quote
			// precedent, but a two-line lookahead)
			if (indent > 0 && this.#text.charCodeAt(first) === PIPE) {
				const target_idx = this.#list_continuation_target(levels, indent);
				if (target_idx !== -1) {
					const marker_indent = levels[target_idx]!.indent;
					if (this.#is_item_table_start(first, marker_indent)) {
						while (levels.length - 1 > target_idx) {
							this.#list_close(levels);
						}
						this.#tokenize_item_table(first, marker_indent);
						continue;
					}
				}
			}

			// any other line deeper than an open item's marker opens a new
			// `Paragraph` block child of that item (the item's inline run is never
			// current here — a blank, block child, or dedent intervened)
			if (indent > 0) {
				const target_idx = this.#list_continuation_target(levels, indent);
				if (target_idx !== -1) {
					while (levels.length - 1 > target_idx) {
						this.#list_close(levels);
					}
					this.#tokens.push({type: 'paragraph_break', start: line_start, end: line_start});
					this.#list_run(levels, first);
					continue;
				}
			}

			// nothing list-shaped — the list ends; the main loop re-dispatches
			// this line (paragraph, heading, HR, fence)
			this.#index = line_start;
			break;
		}

		while (levels.length > 0) {
			this.#list_close(levels);
		}
		return true;
	}

	/**
	 * Match a list marker at `i`: `-` or 1-9 digits + `.`, followed by exactly
	 * one space and content — or by nothing but whitespace to end of line,
	 * which is an `empty` marker. Returns null for anything else (`-x`, `--`,
	 * a tab after the marker, a 10+ digit number).
	 */
	#match_list_marker(i: number): MdzListMarker | null {
		const c = this.#text.charCodeAt(i);
		if (c === HYPHEN) {
			const after = i + 1;
			if (this.#rest_is_blank(after)) {
				return {
					ordered: false,
					number: 0,
					start: i,
					marker_end: after,
					content_start: after,
					empty: true,
				};
			}
			if (this.#text.charCodeAt(after) !== SPACE) return null;
			const content_start = after + 1;
			const empty = this.#rest_is_blank(content_start);
			return {ordered: false, number: 0, start: i, marker_end: after, content_start, empty};
		}
		if (c >= ZERO && c <= NINE) {
			let j = i + 1;
			while (
				j < this.#text.length &&
				this.#text.charCodeAt(j) >= ZERO &&
				this.#text.charCodeAt(j) <= NINE
			) {
				j++;
			}
			if (j - i > MAX_LIST_NUMBER_DIGITS) return null;
			if (j >= this.#text.length || this.#text.charCodeAt(j) !== PERIOD) return null;
			const number = Number(this.#text.slice(i, j));
			const after = j + 1;
			if (this.#rest_is_blank(after)) {
				return {
					ordered: true,
					number,
					start: i,
					marker_end: after,
					content_start: after,
					empty: true,
				};
			}
			if (this.#text.charCodeAt(after) !== SPACE) return null;
			const content_start = after + 1;
			const empty = this.#rest_is_blank(content_start);
			return {ordered: true, number, start: i, marker_end: after, content_start, empty};
		}
		return null;
	}

	/** Whether only line whitespace remains between `from` and the line's end (or EOF). */
	#rest_is_blank(from: number): boolean {
		let i = from;
		while (i < this.#text.length && is_line_whitespace(this.#text.charCodeAt(i))) {
			i++;
		}
		return i >= this.#text.length || this.#text.charCodeAt(i) === NEWLINE;
	}

	/**
	 * Whether a paragraph's inline run is current — used by the ordered
	 * interrupt guard. True when the last emitted token isn't a block boundary.
	 */
	#in_paragraph(): boolean {
		if (this.#tokens.length === 0) return false;
		const type = this.#tokens[this.#tokens.length - 1]!.type;
		return (
			type !== 'paragraph_break' &&
			type !== 'hr' &&
			type !== 'codeblock' &&
			type !== 'heading_end' &&
			type !== 'list_close' &&
			type !== 'blockquote_close'
		);
	}

	/** Open a new list level (list + first item) at `indent`. */
	#list_open(levels: Array<MdzListLevel>, indent: number, marker: MdzListMarker): void {
		this.#tokens.push({
			type: 'list_open',
			ordered: marker.ordered,
			start: marker.start,
			end: marker.start,
		});
		this.#list_item_open(marker);
		levels.push({indent, ordered: marker.ordered});
	}

	/** Emit a `list_item_open` token for `marker`. */
	#list_item_open(marker: MdzListMarker): void {
		const end = marker.empty ? marker.marker_end : marker.content_start;
		if (marker.ordered) {
			this.#tokens.push({type: 'list_item_open', number: marker.number, start: marker.start, end});
		} else {
			this.#tokens.push({type: 'list_item_open', start: marker.start, end});
		}
	}

	/** Close the deepest open level: its current item, then its list. */
	#list_close(levels: Array<MdzListLevel>): void {
		this.#tokens.push({type: 'list_item_close', start: this.#index, end: this.#index});
		this.#tokens.push({type: 'list_close', start: this.#index, end: this.#index});
		levels.pop();
	}

	/**
	 * The level index of the deepest open item a line at `indent` can attach
	 * to — the deepest level with marker indent strictly less than `indent` —
	 * or -1. Levels above it get popped by the caller.
	 */
	#list_continuation_target(levels: Array<MdzListLevel>, indent: number): number {
		for (let i = levels.length - 1; i >= 0; i--) {
			if (levels[i]!.indent < indent) return i;
		}
		return -1;
	}

	/**
	 * Tokenize one inline run (a marker line's content, or a paragraph block
	 * child) including its continuation lines. The run is a
	 * paragraph-equivalent region: `#max_search_index` bounds delimiter
	 * searches to the run's end, so inline pairs never cross item boundaries,
	 * and `#list_run_strip` makes single newlines soft breaks with the
	 * continuation indent stripped from content. Leaves `#index` at the run's
	 * terminating newline (or EOF).
	 */
	#list_run(levels: Array<MdzListLevel>, content_start: number): void {
		// extra whitespace after the marker space is content-leading slop, trimmed
		let i = content_start;
		while (i < this.#text.length && is_line_whitespace(this.#text.charCodeAt(i))) {
			i++;
		}
		this.#index = i;
		const run_end = this.#list_run_end(i, levels[levels.length - 1]!.indent);
		const saved_max = this.#max_search_index;
		this.#max_search_index = run_end;
		this.#list_run_strip = true;
		while (this.#index < run_end) {
			this.#tokenize_inline();
		}
		this.#list_run_strip = false;
		this.#max_search_index = saved_max;
	}

	/**
	 * Scan forward from `from` for the end of the current inline run: the
	 * newline (or EOF) before the first line that isn't a continuation. A line
	 * continues the run when it's non-blank, indented deeper than the deepest
	 * open marker, and isn't a nesting marker or a fence opener line. A deeper
	 * non-`1.` ordered marker against the current run is continuation text
	 * (the hard-wrap `2024.` guard); a deeper empty marker is plain text.
	 */
	#list_run_end(from: number, deepest_indent: number): number {
		let i = from;
		while (true) {
			const nl = this.#text.indexOf('\n', i);
			if (nl === -1) return this.#text.length;
			const line_start = nl + 1;
			let j = line_start;
			while (j < this.#text.length && is_line_whitespace(this.#text.charCodeAt(j))) {
				j++;
			}
			if (j >= this.#text.length || this.#text.charCodeAt(j) === NEWLINE) return nl; // blank
			const indent = j - line_start;
			if (indent <= deepest_indent) return nl; // sibling, dedent, or list end
			const marker = this.#match_list_marker(j);
			if (marker !== null && !marker.empty && (!marker.ordered || marker.number === 1)) {
				return nl; // a nested list opens
			}
			if (this.#text.charCodeAt(j) === BACKTICK && this.#is_fence_opener(j)) {
				return nl; // a fence opener line interrupts the run
			}
			if (this.#text.charCodeAt(j) === RIGHT_ANGLE && this.#is_blockquote_opener(j)) {
				return nl; // a quote opener line interrupts the run
			}
			if (this.#text.charCodeAt(j) === PIPE && this.#is_item_table_start(j, deepest_indent)) {
				return nl; // a table opener (pipe row + delimiter) interrupts the run
			}
			i = line_start; // continuation — keep scanning
		}
	}

	/**
	 * Match a fenced code block whose opener is at `first` with the given
	 * `fence_indent` — 0 for top-level fences, the line's indent for in-item
	 * fences. A complete opener line always opens the fence, and raw mode is
	 * absolute: every following line is content until a closing fence (>= the
	 * opener's backticks, only trailing whitespace, at any indent <= the
	 * opener's) or EOF — a dedented or column-0 content line never
	 * force-closes, and an unclosed fence consumes to EOF (one trailing
	 * newline trimmed, matching closed fences' content shape). Content lines
	 * strip `min(fence_indent, line_indent)` leading whitespace. Returns null
	 * only when the opener line is malformed — including an opener cut off at
	 * EOF without its newline; `end` is the closer line's end before its
	 * newline, or EOF when unclosed.
	 */
	#match_fence(
		first: number,
		fence_indent: number,
	): {token: MdzTokenCodeblock; end: number} | null {
		let i = first;
		let backtick_count = 0;
		while (i < this.#text.length && this.#text.charCodeAt(i) === BACKTICK) {
			backtick_count++;
			i++;
		}
		if (backtick_count < MIN_CODEBLOCK_BACKTICKS) return null;

		const lang_start = i;
		while (i < this.#text.length) {
			const c = this.#text.charCodeAt(i);
			if (c === NEWLINE || is_line_whitespace(c)) break;
			i++;
		}
		const lang = i > lang_start ? this.#text.slice(lang_start, i) : null;
		while (i < this.#text.length && is_line_whitespace(this.#text.charCodeAt(i))) {
			i++;
		}
		if (i >= this.#text.length || this.#text.charCodeAt(i) !== NEWLINE) return null;
		i++; // past the opener's newline

		const content_start = i;
		const content_lines: Array<string> = [];
		while (i <= this.#text.length) {
			const line_start = i;
			let j = i;
			while (j < this.#text.length && is_line_whitespace(this.#text.charCodeAt(j))) {
				j++;
			}
			const line_indent = j - line_start;
			// closer probe: indent <= the opener's, a run of >= the opener's
			// backticks, then only whitespace to end of line
			if (
				line_indent <= fence_indent &&
				j < this.#text.length &&
				this.#text.charCodeAt(j) === BACKTICK
			) {
				let k = j;
				let count = 0;
				while (k < this.#text.length && this.#text.charCodeAt(k) === BACKTICK) {
					count++;
					k++;
				}
				if (count >= backtick_count) {
					let m = k;
					while (m < this.#text.length && is_line_whitespace(this.#text.charCodeAt(m))) {
						m++;
					}
					if (m >= this.#text.length || this.#text.charCodeAt(m) === NEWLINE) {
						// at indent 0 nothing ever strips, so content is one slice
						// (dropping the newline before the closer line)
						const content =
							fence_indent === 0
								? this.#text.slice(content_start, Math.max(content_start, line_start - 1))
								: content_lines.join('\n');
						return {
							token: {type: 'codeblock', lang, content, start: first, end: m},
							end: m,
						};
					}
				}
			}
			// content line — strip the structural indent, never non-whitespace
			const nl = this.#text.indexOf('\n', line_start);
			if (fence_indent > 0) {
				const line_end = nl === -1 ? this.#text.length : nl;
				content_lines.push(
					this.#text.slice(line_start + Math.min(fence_indent, line_indent), line_end),
				);
			}
			if (nl === -1) break;
			i = nl + 1;
		}
		// unclosed — raw mode is absolute, so the fence consumes to EOF; one
		// trailing newline trims, matching closed fences' content shape
		let content = fence_indent === 0 ? this.#text.slice(content_start) : content_lines.join('\n');
		if (content.endsWith('\n')) content = content.slice(0, -1);
		return {
			token: {type: 'codeblock', lang, content, start: first, end: this.#text.length},
			end: this.#text.length,
		};
	}

	/**
	 * Whether a complete fence opener line starts at `i`: a run of >=3
	 * backticks, an optional language word, then only whitespace up to a
	 * terminating newline — an opener cut off at EOF stays text. With
	 * raw-mode-absolute fences this alone decides fence-ness (`#match_fence`
	 * never fails on a complete opener), so run-end scans use this cheap
	 * probe instead of consuming the fence.
	 */
	#is_fence_opener(i: number): boolean {
		let j = i;
		let count = 0;
		while (j < this.#text.length && this.#text.charCodeAt(j) === BACKTICK) {
			count++;
			j++;
		}
		if (count < MIN_CODEBLOCK_BACKTICKS) return false;
		// optional language word: non-whitespace run ends at whitespace or the newline
		while (j < this.#text.length) {
			const c = this.#text.charCodeAt(j);
			if (c === NEWLINE || is_line_whitespace(c)) break;
			j++;
		}
		while (j < this.#text.length && is_line_whitespace(this.#text.charCodeAt(j))) {
			j++;
		}
		return j < this.#text.length && this.#text.charCodeAt(j) === NEWLINE;
	}

	// -- Inline tokenizers --

	#tokenize_inline(): void {
		const char_code = this.#text.charCodeAt(this.#index);

		switch (char_code) {
			case BACKTICK:
				this.#tokenize_code();
				return;
			case ASTERISK:
				this.#tokenize_double_delimiter('**', 'bold');
				return;
			case UNDERSCORE:
				this.#tokenize_italic();
				return;
			case TILDE:
				this.#tokenize_double_delimiter('~~', 'strikethrough');
				return;
			case LEFT_BRACKET:
				this.#tokenize_markdown_link();
				return;
			case LEFT_ANGLE:
				this.#tokenize_tag();
				return;
			default:
				this.#tokenize_text();
				return;
		}
	}

	#tokenize_code(): void {
		const start = this.#index;
		this.#index++; // consume `

		// Find closing backtick, stop at newline or search boundary
		let content_end = -1;
		const search_limit = Math.min(this.#max_search_index, this.#text.length);
		for (let i = this.#index; i < search_limit; i++) {
			const char_code = this.#text.charCodeAt(i);
			if (char_code === BACKTICK) {
				content_end = i;
				break;
			}
			if (char_code === NEWLINE) break;
		}

		if (content_end === -1) {
			// Unclosed backtick
			this.#emit_text('`', start);
			return;
		}

		const content = this.#text.slice(this.#index, content_end);

		// Empty inline code
		if (content.length === 0) {
			this.#index = content_end + 1;
			this.#emit_text('``', start);
			return;
		}

		this.#index = content_end + 1;
		this.#tokens.push({type: 'code', content, start, end: this.#index});
	}

	#tokenize_double_delimiter(delimiter: '**' | '~~', kind: 'bold' | 'strikethrough'): void {
		const start = this.#index;

		// Check for the doubled delimiter
		if (!this.#match(delimiter)) {
			// Single char - text
			this.#index++;
			this.#emit_text(delimiter[0]!, start);
			return;
		}

		// Find closing delimiter within current search boundary
		const search_end = Math.min(this.#max_search_index, this.#text.length);
		let close_index = this.#index_of(delimiter, start + 2);
		if (close_index !== -1 && close_index >= search_end) {
			close_index = -1;
		}
		if (close_index === -1) {
			// Unclosed
			this.#index += 2;
			this.#emit_text(delimiter, start);
			return;
		}

		// Check for paragraph break between open and close
		if (this.#has_paragraph_break_between(start + 2, close_index)) {
			this.#index += 2;
			this.#emit_text(delimiter, start);
			return;
		}

		// Emit open token, tokenize children up to close, emit close token
		this.#index += 2;
		const open_type = kind === 'bold' ? 'bold_open' : 'strikethrough_open';
		const close_type = kind === 'bold' ? 'bold_close' : 'strikethrough_close';
		const open_token_index = this.#tokens.length;
		this.#tokens.push({type: open_type, start, end: this.#index});

		// Set search boundary for nested parsers
		const saved_max = this.#max_search_index;
		this.#max_search_index = close_index;

		// Tokenize children inline content up to close_index
		while (this.#index < close_index) {
			if (this.#is_at_paragraph_break()) break;
			this.#tokenize_inline();
		}

		this.#max_search_index = saved_max;

		if (this.#index === close_index && this.#match(delimiter)) {
			// Check if empty
			const has_children = open_token_index < this.#tokens.length - 1;

			if (!has_children) {
				// Empty - convert to text
				this.#tokens.splice(open_token_index, 1);
				this.#index = start;
				this.#index += 4;
				this.#emit_text(delimiter + delimiter, start);
				return;
			}

			this.#tokens.push({type: close_type, start: close_index, end: close_index + 2});
			this.#index = close_index + 2;
		} else {
			// Didn't reach closing - convert opening to text
			this.#tokens[open_token_index] = {type: 'text', content: delimiter, start, end: start + 2};
		}
	}

	#tokenize_italic(): void {
		const start = this.#index;

		// Check opening word boundary
		if (!this.#is_at_word_boundary(this.#index, true, false)) {
			this.#index++;
			this.#emit_text('_', start);
			return;
		}

		// Find closing delimiter within search boundary
		const search_end = Math.min(this.#max_search_index, this.#text.length);
		let close_index = this.#index_of('_', start + 1);
		if (close_index !== -1 && close_index >= search_end) {
			close_index = -1;
		}
		if (close_index === -1) {
			this.#index++;
			this.#emit_text('_', start);
			return;
		}

		// Check closing word boundary
		if (!this.#is_at_word_boundary(close_index + 1, false, true)) {
			this.#index++;
			this.#emit_text('_', start);
			return;
		}

		// Check for paragraph break between
		if (this.#has_paragraph_break_between(start + 1, close_index)) {
			this.#index++;
			this.#emit_text('_', start);
			return;
		}

		// Emit open token
		this.#index++;
		const open_token_index = this.#tokens.length;
		this.#tokens.push({type: 'italic_open', start, end: this.#index});

		// Set search boundary for nested parsers
		const saved_max = this.#max_search_index;
		this.#max_search_index = close_index;

		// Tokenize children up to close_index
		while (this.#index < close_index) {
			if (this.#is_at_paragraph_break()) break;
			this.#tokenize_inline();
		}

		this.#max_search_index = saved_max;

		if (this.#index === close_index && this.#match('_')) {
			// Check if empty
			const has_children = open_token_index < this.#tokens.length - 1;

			if (!has_children) {
				// Empty - convert to text
				this.#tokens.splice(open_token_index, 1);
				this.#index = start;
				this.#index += 2;
				this.#emit_text('__', start);
				return;
			}

			this.#tokens.push({
				type: 'italic_close',
				start: close_index,
				end: close_index + 1,
			});
			this.#index = close_index + 1;
		} else {
			// Convert opening to text
			this.#tokens[open_token_index] = {
				type: 'text',
				content: '_',
				start,
				end: start + 1,
			};
		}
	}

	#tokenize_markdown_link(): void {
		const start = this.#index;
		this.#index++; // consume [ (dispatch guarantees it)

		// Emit link_text_open
		this.#tokens.push({type: 'link_text_open', start, end: this.#index});

		// Tokenize children until ] — only `]` delimits link text; a bare `)`
		// is ordinary content (matching the streaming parser, which has no `)`
		// dispatch case — the reference scan finds its own `)` after `](`)
		while (this.#index < this.#text.length) {
			if (this.#text.charCodeAt(this.#index) === RIGHT_BRACKET) break;
			if (this.#is_at_paragraph_break()) break;
			this.#tokenize_inline();
		}

		// Check for ]
		if (this.#index >= this.#text.length || this.#text.charCodeAt(this.#index) !== RIGHT_BRACKET) {
			// Revert - remove link_text_open and all children tokens added
			this.#revert_tokens_from_link_open(start);
			return;
		}

		const bracket_close_start = this.#index;
		this.#index++; // consume ]
		this.#tokens.push({
			type: 'link_text_close',
			start: bracket_close_start,
			end: this.#index,
		});

		// Check for (
		if (this.#index >= this.#text.length || this.#text.charCodeAt(this.#index) !== LEFT_PAREN) {
			this.#revert_tokens_from_link_open(start);
			return;
		}
		this.#index++; // consume (

		// Find closing )
		const close_paren = this.#index_of(')', this.#index);
		if (close_paren === -1) {
			this.#revert_tokens_from_link_open(start);
			return;
		}

		const reference = this.#text.slice(this.#index, close_paren);

		// Validate reference
		if (!reference.trim()) {
			this.#revert_tokens_from_link_open(start);
			return;
		}

		// Validate all characters
		for (let i = 0; i < reference.length; i++) {
			const char_code = reference.charCodeAt(i);
			if (!is_valid_path_char(char_code)) {
				this.#revert_tokens_from_link_open(start);
				return;
			}
		}

		// Reject unsafe protocols (javascript:, data:, etc.) — `is_valid_path_char`
		// permits `:` so we need an explicit filter here.
		if (!mdz_is_safe_reference(reference)) {
			this.#revert_tokens_from_link_open(start);
			return;
		}

		this.#index = close_paren + 1;

		const link_type = mdz_is_url(reference) ? 'external' : 'internal';

		this.#tokens.push({
			type: 'link_ref',
			reference,
			link_type,
			start: bracket_close_start + 1, // after ]
			end: this.#index,
		});
	}

	#revert_tokens_from_link_open(start: number): void {
		// Find and remove link_text_open and all tokens after it
		let open_idx = -1;
		for (let i = this.#tokens.length - 1; i >= 0; i--) {
			if (this.#tokens[i]!.type === 'link_text_open' && this.#tokens[i]!.start === start) {
				open_idx = i;
				break;
			}
		}
		if (open_idx !== -1) {
			this.#tokens.splice(open_idx);
		}
		this.#index = start + 1;
		this.#emit_text('[', start);
	}

	#tokenize_tag(): void {
		const start = this.#index;
		this.#index++; // consume <

		// Tag name must start with a letter
		if (this.#index >= this.#text.length || !is_letter(this.#text.charCodeAt(this.#index))) {
			this.#emit_text('<', start);
			return;
		}

		// Collect tag name
		const tag_name_start = this.#index;
		while (
			this.#index < this.#text.length &&
			is_tag_name_char(this.#text.charCodeAt(this.#index))
		) {
			this.#index++;
		}
		// non-empty: the is_letter check above guarantees at least one name char
		const tag_name = this.#text.slice(tag_name_start, this.#index);

		const first_char_code = tag_name.charCodeAt(0);
		const is_component = first_char_code >= A_UPPER && first_char_code <= Z_UPPER;

		// Skip whitespace
		while (this.#index < this.#text.length && this.#text.charCodeAt(this.#index) === SPACE) {
			this.#index++;
		}

		// Check for self-closing />
		if (
			this.#index + 1 < this.#text.length &&
			this.#text.charCodeAt(this.#index) === SLASH &&
			this.#text.charCodeAt(this.#index + 1) === RIGHT_ANGLE
		) {
			this.#index += 2;
			this.#tokens.push({
				type: 'tag_self_close',
				name: tag_name,
				is_component,
				start,
				end: this.#index,
			});
			return;
		}

		// Check for >
		if (this.#index >= this.#text.length || this.#text.charCodeAt(this.#index) !== RIGHT_ANGLE) {
			this.#index = start + 1;
			this.#emit_text('<', start);
			return;
		}
		this.#index++; // consume >

		// Check for closing tag existence before committing —
		// must exist within search boundary and before any paragraph break.
		// A closer at exactly `#max_search_index` is allowed: that bound can
		// only coincide with a closing-tag occurrence when an enclosing
		// same-name tag set it (the nesting handoff — this tag consumes the
		// closer and the enclosing tag re-verifies its own next iteration);
		// every other bound (heading EOL, list run end, delimiter close
		// position) points at a character that can't begin a closing tag.
		const closing_tag = `</${tag_name}>`;
		const search_limit = Math.min(this.#max_search_index, this.#text.length);
		const closing_tag_pos = this.#index_of(closing_tag, this.#index);
		if (closing_tag_pos === -1 || closing_tag_pos > search_limit) {
			this.#index = start + 1;
			this.#emit_text('<', start);
			return;
		}
		if (this.#has_paragraph_break_between(this.#index, closing_tag_pos)) {
			this.#index = start + 1;
			this.#emit_text('<', start);
			return;
		}

		// Emit tag_open
		const open_token_index = this.#tokens.length;
		this.#tokens.push({type: 'tag_open', name: tag_name, is_component, start, end: this.#index});

		// Tokenize children until the closing tag. Each iteration narrows
		// `#max_search_index` to the next closer so a child's delimiter scan
		// can never cross it (`` <b>`a</b>x` `` must not swallow `</b>` into
		// the code span). Recomputed per iteration because a nested same-name
		// tag legitimately consumes the nearest closer (`<b>x<b>y</b></b>`).
		const saved_max = this.#max_search_index;
		while (this.#index < this.#text.length) {
			if (this.#match(closing_tag)) {
				this.#max_search_index = saved_max;
				const close_start = this.#index;
				this.#index += closing_tag.length;
				this.#tokens.push({
					type: 'tag_close',
					name: tag_name,
					start: close_start,
					end: this.#index,
				});
				return;
			}
			const next_close = this.#index_of(closing_tag, this.#index);
			if (
				next_close === -1 ||
				next_close > Math.min(saved_max, this.#text.length) ||
				this.#has_paragraph_break_between(this.#index, next_close)
			) {
				break; // a nested same-name tag consumed the verified closer
			}
			this.#max_search_index = next_close;
			this.#tokenize_inline();
		}

		// No valid closer left — revert: drop the open token and all consumed
		// children tokens, emit `<` as text, and re-lex from the next char
		// (the `#revert_tokens_from_link_open` pattern; the old fallthrough
		// left a dangling `tag_open` whose parser fallback discarded content)
		this.#max_search_index = saved_max;
		this.#tokens.splice(open_token_index);
		this.#index = start + 1;
		this.#emit_text('<', start);
	}

	#tokenize_text(): void {
		const start = this.#index;

		// Check for URL or internal path at current position
		if (this.#is_at_url()) {
			this.#tokenize_auto_link_url();
			return;
		}
		if (is_at_absolute_path(this.#text, this.#index)) {
			this.#tokenize_auto_link_internal();
			return;
		}
		if (is_at_relative_path(this.#text, this.#index)) {
			this.#tokenize_auto_link_internal();
			return;
		}

		// in a list-item run, continuation-line structural indent strips from
		// content: parts accumulate around each stripped region
		let parts: Array<string> | null = null;
		let part_start = start;

		// in a table cell the trimmed cell end is a hard stop (no newline to
		// halt on mid-line) — hoisted to the loop bound
		const scan_end = this.#in_table_cell
			? Math.min(this.#max_search_index, this.#text.length)
			: this.#text.length;

		while (this.#index < scan_end) {
			const char_code = this.#text.charCodeAt(this.#index);
			// one table load classifies the char; zero (the common case — the
			// char can't end or interrupt the run) skips the dispatch below.
			// `TEXT_SCAN_CLASS` is shared with the streaming scanner
			// (`consume_text_run` in `mdz_stream_parser_text.ts`); the two dispatch
			// bodies intentionally differ around it — this one handles `\|` escapes
			// and list-run strip, that one URL speculation across chunk boundaries.
			const char_class = char_code < 128 ? TEXT_SCAN_CLASS[char_code]! : 0;
			if (char_class === 0) {
				this.#index++;
				continue;
			}

			// Stop at special characters
			if ((char_class & TEXT_CLASS_STOP) !== 0) break;

			if ((char_class & TEXT_CLASS_BACKSLASH) !== 0) {
				// `\|` is a literal pipe — the only mdz escape, scoped to table cells
				if (
					this.#in_table_cell &&
					this.#index + 1 < this.#max_search_index &&
					this.#text.charCodeAt(this.#index + 1) === PIPE
				) {
					(parts ??= []).push(this.#text.slice(part_start, this.#index));
					parts.push('|');
					this.#index += 2;
					part_start = this.#index;
					continue;
				}
				this.#index++;
				continue;
			}

			if ((char_class & TEXT_CLASS_NEWLINE) !== 0) {
				if (this.#list_run_strip) {
					if (this.#index >= this.#max_search_index) break; // the run's terminator
					// soft break: keep the newline, strip the next line's leading
					// whitespace (structural indent, never content)
					this.#index++;
					const ws_start = this.#index;
					let i = ws_start;
					while (i < this.#text.length && is_line_whitespace(this.#text.charCodeAt(i))) {
						i++;
					}
					if (i > ws_start) {
						(parts ??= []).push(this.#text.slice(part_start, ws_start));
						part_start = i;
						this.#index = i;
					}
					continue;
				}

				// Check for paragraph break
				if (this.#is_at_paragraph_break()) break;

				// When next line could start a block element, consume the newline and
				// stop (`1` covers ordered list markers — only `1.` interrupts)
				const next_i = this.#index + 1;
				if (next_i < this.#text.length) {
					const next_char = this.#text.charCodeAt(next_i);
					if (
						next_char === HASH ||
						next_char === HYPHEN ||
						next_char === BACKTICK ||
						next_char === ONE ||
						next_char === RIGHT_ANGLE ||
						next_char === PIPE
					) {
						this.#index++; // consume the newline
						break;
					}
				}
				this.#index++; // single newline — ordinary text
				continue;
			}

			// URL or internal path mid-text (class guard avoids probing every char)
			if ((char_class & TEXT_CLASS_URL) !== 0) {
				if (this.#is_at_url()) break;
			} else if (char_code === SLASH) {
				if (is_at_absolute_path(this.#text, this.#index)) break;
			} else if (is_at_relative_path(this.#text, this.#index)) {
				break;
			}

			this.#index++;
		}

		// Ensure we always consume at least one character
		if (this.#index === start && this.#index < this.#text.length) {
			this.#index++;
		}

		const content =
			parts === null
				? this.#text.slice(start, this.#index)
				: parts.join('') + this.#text.slice(part_start, this.#index);
		this.#tokens.push({type: 'text', content, start, end: this.#index});
	}

	// -- Auto-link tokenizers --

	#tokenize_auto_link_url(): void {
		const start = this.#index;

		// Consume protocol (case-insensitive match; original casing preserved in reference)
		this.#index += match_url_prefix_case_insensitive(this.#text, this.#index);

		// Collect URL characters
		while (this.#index < this.#text.length) {
			const char_code = this.#text.charCodeAt(this.#index);
			if (char_code === SPACE || char_code === NEWLINE || !is_valid_path_char(char_code)) {
				break;
			}
			this.#index++;
		}

		let reference = this.#text.slice(start, this.#index);
		reference = mdz_trim_url_punctuation(reference);
		this.#index = start + reference.length;

		this.#tokens.push({
			type: 'autolink',
			reference,
			link_type: 'external',
			start,
			end: this.#index,
		});
	}

	#tokenize_auto_link_internal(): void {
		const start = this.#index;

		// Collect path characters
		while (this.#index < this.#text.length) {
			const char_code = this.#text.charCodeAt(this.#index);
			if (char_code === SPACE || char_code === NEWLINE || !is_valid_path_char(char_code)) {
				break;
			}
			this.#index++;
		}

		let reference = this.#text.slice(start, this.#index);
		reference = mdz_trim_url_punctuation(reference);
		this.#index = start + reference.length;

		this.#tokens.push({
			type: 'autolink',
			reference,
			link_type: 'internal',
			start,
			end: this.#index,
		});
	}

	// -- Helper methods --

	#emit_text(content: string, start: number): void {
		this.#tokens.push({type: 'text', content, start, end: start + content.length});
	}

	#has_paragraph_break_between(from: number, to: number): boolean {
		// memoized search — a per-candidate char loop would rescan the same
		// region for every delimiter/tag candidate in a long paragraph. The
		// break can't straddle `to`: `to` is a found delimiter/tag position
		// (never whitespace or a newline), so a break starting before it
		// completes before it.
		const idx = this.#next_paragraph_break(from);
		return idx !== -1 && idx < to;
	}

	/**
	 * Position of the next paragraph break at or after `from` — a newline
	 * whose following line is blank (whitespace-only) — or `-1`. Memoized like
	 * `#index_of`: the text is immutable, so the first break at or after a
	 * scanned origin stays valid for any later origin it still follows.
	 */
	#next_paragraph_break(from: number): number {
		const memo = this.#break_memo;
		if (memo !== null && memo.from <= from && (memo.result === -1 || memo.result >= from)) {
			return memo.result;
		}
		let result = -1;
		let i = this.#text.indexOf('\n', from);
		while (i !== -1) {
			let j = i + 1;
			while (j < this.#text.length && is_line_whitespace(this.#text.charCodeAt(j))) {
				j++;
			}
			if (j < this.#text.length && this.#text.charCodeAt(j) === NEWLINE) {
				result = i;
				break;
			}
			// no break here; the next candidate newline is past the scanned run
			i = this.#text.indexOf('\n', j);
		}
		if (memo === null) {
			this.#break_memo = {from, result};
		} else {
			memo.from = from;
			memo.result = result;
		}
		return result;
	}

	#is_at_url(): boolean {
		// word boundary check: skip when preceded by [A-Za-z0-9] — `xhttps://...`
		// is plain text, matching the streaming parser (false negatives over
		// false positives)
		if (this.#index > 0 && is_word_char(this.#text.charCodeAt(this.#index - 1))) {
			return false;
		}
		// Scheme matching is case-insensitive (RFC 3986).
		const prefix_len = match_url_prefix_case_insensitive(this.#text, this.#index);
		if (prefix_len === 0) return false;
		if (this.#index + prefix_len >= this.#text.length) return false;
		const next_char = this.#text.charCodeAt(this.#index + prefix_len);
		return next_char !== SPACE && next_char !== NEWLINE;
	}

	/**
	 * Word-boundary check for the italic delimiter (the only delimiter with
	 * boundary rules — `**`/`~~` pair anywhere). `_` is self-opaque — it
	 * counts as a word char in its own boundary checks, so runs like
	 * `__init__` never form open/close pairs — while other delimiters stay
	 * transparent (so `_~~x~~_` nests).
	 */
	#is_at_word_boundary(index: number, check_before: boolean, check_after: boolean): boolean {
		if (check_before && index > 0) {
			const prev = this.#text.charCodeAt(index - 1);
			if (is_word_char(prev) || prev === UNDERSCORE) return false;
		}
		if (check_after && index < this.#text.length) {
			const next = this.#text.charCodeAt(index);
			if (is_word_char(next) || next === UNDERSCORE) return false;
		}
		return true;
	}
}
