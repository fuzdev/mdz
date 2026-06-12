/**
 * mdz token parser — consumes a `MdzToken[]` stream to build the `MdzNode[]` AST.
 *
 * Phase 2 of the synchronous parsing pipeline behind `mdz_parse`.
 * Phase 1 (lexer) is in `mdz_lexer.ts`.
 *
 * @module
 */

import type {
	MdzNode,
	MdzNodeText,
	MdzNodeBold,
	MdzNodeItalic,
	MdzNodeStrikethrough,
	MdzNodeLink,
	MdzNodeHeading,
	MdzNodeList,
	MdzNodeListItem,
	MdzNodeBlockquote,
	MdzNodeElement,
	MdzNodeComponent,
} from './mdz.js';
import {
	has_non_whitespace,
	mdz_extract_single_tag,
	mdz_heading_id,
	mdz_merge_adjacent_text,
	mdz_push_merging_text,
} from './mdz_helpers.js';
import {
	type MdzToken,
	type MdzTokenHeadingStart,
	type MdzTokenLinkTextOpen,
	type MdzTokenLinkRef,
	type MdzTokenAutolink,
	type MdzTokenTagOpen,
	type MdzTokenTagSelfClose,
	type MdzTokenListOpen,
	type MdzTokenListItemOpen,
} from './mdz_lexer.js';

/**
 * Builds an `MdzNode[]` tree from a lexed `MdzToken[]` stream.
 * Used by `mdz_parse`, which should be preferred for simple usage.
 */
export class MdzTokenParser {
	#tokens: Array<MdzToken>;
	#index: number = 0;

	constructor(tokens: Array<MdzToken>) {
		this.#tokens = tokens;
	}

	parse(): Array<MdzNode> {
		return this.#parse_block_stream(false);
	}

	/**
	 * Parse a run of block-level tokens into nodes — the document root, or a
	 * blockquote's contents (a quote's content is a mini-document, so both
	 * share one loop). When `in_blockquote`, a `blockquote_close` token ends
	 * the run; at the root the token stream's end does.
	 */
	#parse_block_stream(in_blockquote: boolean): Array<MdzNode> {
		const nodes: Array<MdzNode> = [];
		const paragraph_children: Array<MdzNode> = [];

		while (this.#index < this.#tokens.length) {
			const token = this.#tokens[this.#index]!;

			if (in_blockquote && token.type === 'blockquote_close') {
				this.#index++;
				break;
			}

			// Block-level tokens
			if (token.type === 'heading_start') {
				const flushed = this.#flush_paragraph(paragraph_children, true);
				if (flushed) nodes.push(flushed);
				nodes.push(this.#parse_heading());
				continue;
			}

			if (token.type === 'hr') {
				const flushed = this.#flush_paragraph(paragraph_children, true);
				if (flushed) nodes.push(flushed);
				nodes.push({type: 'Hr', start: token.start, end: token.end});
				this.#index++;
				continue;
			}

			if (token.type === 'codeblock') {
				const flushed = this.#flush_paragraph(paragraph_children, true);
				if (flushed) nodes.push(flushed);
				nodes.push({
					type: 'Codeblock',
					lang: token.lang,
					content: token.content,
					start: token.start,
					end: token.end,
				});
				this.#index++;
				continue;
			}

			if (token.type === 'list_open') {
				const flushed = this.#flush_paragraph(paragraph_children, true);
				if (flushed) nodes.push(flushed);
				nodes.push(this.#parse_list());
				continue;
			}

			if (token.type === 'blockquote_open') {
				const flushed = this.#flush_paragraph(paragraph_children, true);
				if (flushed) nodes.push(flushed);
				nodes.push(this.#parse_blockquote());
				continue;
			}

			if (token.type === 'paragraph_break') {
				const flushed = this.#flush_paragraph(paragraph_children, true);
				if (flushed) nodes.push(flushed);
				this.#index++;
				continue;
			}

			// Inline tokens → paragraph children
			const node = this.#parse_inline();
			if (node) paragraph_children.push(node);
		}

		// Flush remaining content
		const final_paragraph = this.#flush_paragraph(paragraph_children, true);
		if (final_paragraph) nodes.push(final_paragraph);

		return nodes;
	}

	#parse_blockquote(): MdzNodeBlockquote {
		const open = this.#tokens[this.#index]!;
		this.#index++;
		const children = this.#parse_block_stream(true);
		// children-derived end, like List — no-empty-start means children exist,
		// with the open's position as a defensive fallback
		const end = children.length > 0 ? children[children.length - 1]!.end : open.end;
		return {type: 'Blockquote', children, start: open.start, end};
	}

	#parse_heading(): MdzNodeHeading {
		const token = this.#tokens[this.#index]! as MdzTokenHeadingStart;
		const start = token.start;
		const level = token.level;
		this.#index++;

		const children: Array<MdzNode> = [];

		// Collect inline nodes until heading_end marker
		while (this.#index < this.#tokens.length) {
			const t = this.#tokens[this.#index]!;
			if (t.type === 'heading_end') {
				this.#index++; // consume the marker
				break;
			}
			const node = this.#parse_inline();
			if (node) children.push(node);
		}

		const merged = mdz_merge_adjacent_text(children);
		const end = merged.length > 0 ? merged[merged.length - 1]!.end : start + level + 1;

		return {type: 'Heading', level, id: mdz_heading_id(merged), children: merged, start, end};
	}

	#parse_list(): MdzNodeList {
		const open = this.#tokens[this.#index]! as MdzTokenListOpen;
		this.#index++;

		const children: Array<MdzNodeListItem> = [];

		while (this.#index < this.#tokens.length) {
			const t = this.#tokens[this.#index]!;
			if (t.type === 'list_item_open') {
				children.push(this.#parse_list_item());
				continue;
			}
			if (t.type === 'list_close') {
				this.#index++;
				break;
			}
			this.#index++; // skip anything unexpected (defensive)
		}

		const end = children.length > 0 ? children[children.length - 1]!.end : open.end;
		if (open.ordered) {
			return {
				type: 'List',
				ordered: true,
				start_number: children[0]?.number ?? 1,
				children,
				start: open.start,
				end,
			};
		}
		return {type: 'List', ordered: false, children, start: open.start, end};
	}

	#parse_list_item(): MdzNodeListItem {
		const open = this.#tokens[this.#index]! as MdzTokenListItemOpen;
		this.#index++;

		// the item's first inline run is a direct child run; after a
		// `paragraph_break`, subsequent runs become `Paragraph` block children
		const children: Array<MdzNode> = [];
		const paragraph: Array<MdzNode> = [];
		let in_paragraph = false;

		const flush = () => {
			const flushed = this.#flush_paragraph(paragraph, true);
			if (flushed) children.push(flushed);
		};

		while (this.#index < this.#tokens.length) {
			const t = this.#tokens[this.#index]!;
			if (t.type === 'list_item_close') {
				this.#index++;
				break;
			}
			if (t.type === 'list_open') {
				flush();
				in_paragraph = false;
				children.push(this.#parse_list());
				continue;
			}
			if (t.type === 'blockquote_open') {
				flush();
				in_paragraph = false;
				children.push(this.#parse_blockquote());
				continue;
			}
			if (t.type === 'codeblock') {
				flush();
				in_paragraph = false;
				children.push({
					type: 'Codeblock',
					lang: t.lang,
					content: t.content,
					start: t.start,
					end: t.end,
				});
				this.#index++;
				continue;
			}
			if (t.type === 'paragraph_break') {
				flush();
				in_paragraph = true;
				this.#index++;
				continue;
			}
			const node = this.#parse_inline();
			if (node) {
				if (in_paragraph) {
					paragraph.push(node);
				} else {
					mdz_push_merging_text(children, node);
				}
			}
		}
		flush();

		const end = children.length > 0 ? children[children.length - 1]!.end : open.end;
		if (open.number !== undefined) {
			return {type: 'ListItem', number: open.number, children, start: open.start, end};
		}
		return {type: 'ListItem', children, start: open.start, end};
	}

	#parse_inline(): MdzNode | null {
		if (this.#index >= this.#tokens.length) return null;

		const token = this.#tokens[this.#index]!;

		switch (token.type) {
			case 'text':
				this.#index++;
				return {type: 'Text', content: token.content, start: token.start, end: token.end};

			case 'code':
				this.#index++;
				return {type: 'Code', content: token.content, start: token.start, end: token.end};

			case 'bold_open':
				return this.#parse_delimiter_pair('bold_close', 'Bold', '**');

			case 'italic_open':
				return this.#parse_delimiter_pair('italic_close', 'Italic', '_');

			case 'strikethrough_open':
				return this.#parse_delimiter_pair('strikethrough_close', 'Strikethrough', '~~');

			case 'link_text_open':
				return this.#parse_link();

			case 'autolink':
				return this.#parse_autolink();

			case 'tag_open':
				return this.#parse_tag_node();

			case 'tag_self_close':
				return this.#parse_self_close_tag();

			// Orphaned close tokens - treat as text
			case 'bold_close':
				this.#index++;
				return {type: 'Text', content: '**', start: token.start, end: token.end};

			case 'italic_close':
				this.#index++;
				return {type: 'Text', content: '_', start: token.start, end: token.end};

			case 'strikethrough_close':
				this.#index++;
				return {type: 'Text', content: '~~', start: token.start, end: token.end};

			case 'link_text_close':
				this.#index++;
				return {type: 'Text', content: ']', start: token.start, end: token.end};

			case 'link_ref':
				this.#index++;
				return {
					type: 'Text',
					content: `(${token.reference})`,
					start: token.start,
					end: token.end,
				};

			case 'tag_close':
				this.#index++;
				return {
					type: 'Text',
					content: `</${token.name}>`,
					start: token.start,
					end: token.end,
				};

			default:
				this.#index++;
				return null;
		}
	}

	/**
	 * Parse a delimiter-paired inline (the cursor is on a
	 * `bold_open`/`italic_open`/`strikethrough_open` token) into its container
	 * node, consuming through the matching close token. An opener whose close
	 * token never arrives (block boundary or end of tokens first) degrades to
	 * the literal delimiter text — the parse bodies are identical across the
	 * three pairs, only the token/node types and delimiter text differ.
	 */
	#parse_delimiter_pair(
		close_type: 'bold_close' | 'italic_close' | 'strikethrough_close',
		node_type: 'Bold' | 'Italic' | 'Strikethrough',
		delimiter: '**' | '_' | '~~',
	): MdzNodeBold | MdzNodeItalic | MdzNodeStrikethrough | MdzNodeText {
		const start = this.#tokens[this.#index]!.start;
		this.#index++;

		const children: Array<MdzNode> = [];

		while (this.#index < this.#tokens.length) {
			const t = this.#tokens[this.#index]!;
			if (t.type === close_type) {
				this.#index++;
				return {type: node_type, children, start, end: t.end};
			}
			if (
				t.type === 'paragraph_break' ||
				t.type === 'heading_start' ||
				t.type === 'hr' ||
				t.type === 'codeblock' ||
				t.type === 'list_open' ||
				t.type === 'list_item_close' ||
				t.type === 'blockquote_open'
			) {
				break;
			}
			const node = this.#parse_inline();
			if (node) mdz_push_merging_text(children, node);
		}

		// Unclosed - treat as text
		return {type: 'Text', content: delimiter, start, end: start + delimiter.length};
	}

	#parse_link(): MdzNodeLink | MdzNodeText {
		const open_token = this.#tokens[this.#index]! as MdzTokenLinkTextOpen;
		const start = open_token.start;
		this.#index++;

		const children: Array<MdzNode> = [];

		while (this.#index < this.#tokens.length) {
			const t = this.#tokens[this.#index]!;
			if (t.type === 'link_text_close') {
				this.#index++;

				// Expect link_ref next
				if (this.#index < this.#tokens.length && this.#tokens[this.#index]!.type === 'link_ref') {
					const ref_token = this.#tokens[this.#index]! as MdzTokenLinkRef;
					this.#index++;
					return {
						type: 'Link',
						reference: ref_token.reference,
						children,
						link_type: ref_token.link_type,
						start,
						end: ref_token.end,
					};
				}

				// No link_ref - treat as text
				return {type: 'Text', content: '[', start, end: start + 1};
			}
			if (
				t.type === 'paragraph_break' ||
				t.type === 'heading_start' ||
				t.type === 'hr' ||
				t.type === 'codeblock' ||
				t.type === 'list_open' ||
				t.type === 'list_item_close' ||
				t.type === 'blockquote_open'
			) {
				break;
			}
			const node = this.#parse_inline();
			if (node) mdz_push_merging_text(children, node);
		}

		return {type: 'Text', content: '[', start, end: start + 1};
	}

	#parse_autolink(): MdzNodeLink {
		const token = this.#tokens[this.#index]! as MdzTokenAutolink;
		this.#index++;
		return {
			type: 'Link',
			reference: token.reference,
			children: [{type: 'Text', content: token.reference, start: token.start, end: token.end}],
			link_type: token.link_type,
			start: token.start,
			end: token.end,
		};
	}

	#parse_tag_node(): MdzNodeElement | MdzNodeComponent | MdzNodeText {
		const open_token = this.#tokens[this.#index]! as MdzTokenTagOpen;
		const start = open_token.start;
		const tag_name = open_token.name;
		const node_type: 'Component' | 'Element' = open_token.is_component ? 'Component' : 'Element';
		this.#index++;

		const children: Array<MdzNode> = [];

		while (this.#index < this.#tokens.length) {
			const t = this.#tokens[this.#index]!;
			if (t.type === 'tag_close' && t.name === tag_name) {
				this.#index++;
				return {type: node_type, name: tag_name, children, start, end: t.end};
			}
			const node = this.#parse_inline();
			if (node) mdz_push_merging_text(children, node);
		}

		// Unclosed tag
		return {type: 'Text', content: '<', start, end: start + 1};
	}

	#parse_self_close_tag(): MdzNodeElement | MdzNodeComponent {
		const token = this.#tokens[this.#index]! as MdzTokenTagSelfClose;
		const node_type: 'Component' | 'Element' = token.is_component ? 'Component' : 'Element';
		this.#index++;
		return {type: node_type, name: token.name, children: [], start: token.start, end: token.end};
	}

	// -- Paragraph flushing --

	#flush_paragraph(paragraph_children: Array<MdzNode>, trim_trailing = false): MdzNode | null {
		if (paragraph_children.length === 0) return null;

		if (trim_trailing) {
			// Trim trailing newlines from last text node. The end adjusts by the
			// trimmed amount only — recomputing from the content length would
			// clobber source-accurate spans where structural stripping (list
			// continuation indent, quote prefixes) made content shorter than its
			// source span.
			const last = paragraph_children[paragraph_children.length - 1]!;
			if (last.type === 'Text') {
				const trimmed = last.content.replace(/\n+$/, '');
				if (trimmed) {
					if (trimmed !== last.content) {
						last.end -= last.content.length - trimmed.length;
						last.content = trimmed;
					}
				} else {
					paragraph_children.pop();
				}
			}

			// Skip whitespace-only paragraphs — ASCII whitespace only, matching
			// the grammar's blank-line definition and the streaming parser's
			// `has_non_whitespace_content` (Unicode whitespace like NBSP is
			// content; `.trim()` here would silently drop it)
			const has_content = paragraph_children.some(
				(n) => n.type !== 'Text' || has_non_whitespace(n.content),
			);
			if (!has_content) {
				paragraph_children.length = 0;
				return null;
			}
		}

		// Single tag extraction (MDX convention)
		const single_tag = mdz_extract_single_tag(paragraph_children);
		if (single_tag) {
			paragraph_children.length = 0;
			return single_tag;
		}

		// Merge adjacent text nodes
		const merged = mdz_merge_adjacent_text(paragraph_children.slice());
		paragraph_children.length = 0;

		if (merged.length === 0) return null;

		return {
			type: 'Paragraph',
			children: merged,
			start: merged[0]!.start,
			end: merged[merged.length - 1]!.end,
		};
	}
}
