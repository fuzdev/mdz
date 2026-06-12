/**
 * mdz — strict markdown dialect built for streaming, Svelte authoring, docs
 * sites, and untrusted content.
 *
 * Created for two motivating use cases: rendering TSDoc/JSDoc comments on
 * docs websites (with domain-specific behavior like linkifying backticked
 * identifiers) and authoring content with Svelte components. It also has a
 * streaming parser that extends the same grammar to LLM output.
 *
 * This module is the synchronous entry: `mdz_parse` parses a complete string
 * to an `MdzNode` tree. It is the canonical reference parser — the streaming
 * pipeline (`mdz_stream_parser.ts`) emits opcodes that converge on the same
 * tree, asserted by parity tests.
 *
 * The dialect supports:
 * - inline formatting: `code`, **bold**, _italic_, ~~strikethrough~~
 * - auto-detected links: external URLs (`https://...`) and internal paths (`/path`)
 * - markdown links: `[text](url)` with custom display text
 * - inline code in backticks (creates `Code` nodes; auto-linking to identifiers/modules
 *   is handled by the rendering layer via `MdzNodeView.svelte`)
 * - paragraph breaks (blank lines)
 * - block elements: headings, horizontal rules, lists, blockquotes, code blocks
 * - HTML elements and Svelte components (opt-in via context)
 *
 * Whitespace: the parser preserves whitespace in text node content (single
 * newlines stay literal `\n`, no `<br>` nodes), while structural whitespace is
 * interpreted — blank lines separate paragraphs, extra blank lines collapse,
 * and a line of only whitespace (spaces, tabs, `\r`) counts as blank, so an
 * invisible trailing space never changes document structure.
 * Presentation is the renderer's choice: by default whitespace collapses like
 * standard markdown (single newlines are soft breaks), and the `whitespace`
 * prop on `Mdz`/`MdzStream` opts into `pre-line` or `pre-wrap` rendering.
 *
 * ## Design philosophy
 *
 * - **False negatives over false positives**: When in doubt, treat as plain text.
 *   Block elements can interrupt paragraphs without blank lines; inline formatting is strict.
 * - **One way to do things**: Single unambiguous syntax per feature. No alternatives.
 * - **Explicit over implicit**: Clear delimiters and column-0 requirements avoid ambiguity.
 * - **Simple over complete**: Prefer simple parsing rules over complex edge case handling.
 * - **No implicit retroactivity**: the grammar admits no construct where later input changes
 *   the rendering of unboundedly-earlier output, so the streaming pipeline corrects only via
 *   bounded, explicit opcodes and never re-parses.
 *
 * ## Status
 *
 * Pre-stable — breaking changes are expected as the dialect matures.
 * Next: attributes, editing.
 *
 * @module
 */

import {MdzLexer} from './mdz_lexer.js';
import {MdzTokenParser} from './mdz_token_parser.js';

// TODO design incremental parsing or some system that preserves Svelte components across re-renders when possible

/**
 * Parses text to an array of `MdzNode`.
 *
 * Two phases: `MdzLexer` tokenizes the input into a flat `MdzToken[]` stream,
 * then `MdzTokenParser` builds the `MdzNode[]` tree from the tokens.
 */
export const mdz_parse = (text: string): Array<MdzNode> =>
	new MdzTokenParser(new MdzLexer(text).tokenize()).parse();

export type MdzNode =
	| MdzNodeText
	| MdzNodeCode
	| MdzNodeCodeblock
	| MdzNodeBold
	| MdzNodeItalic
	| MdzNodeStrikethrough
	| MdzNodeLink
	| MdzNodeParagraph
	| MdzNodeHr
	| MdzNodeHeading
	| MdzNodeList
	| MdzNodeListItem
	| MdzNodeBlockquote
	| MdzNodeElement
	| MdzNodeComponent;

export interface MdzNodeBase {
	type: string;
	start: number;
	end: number;
}

export interface MdzNodeText extends MdzNodeBase {
	type: 'Text';
	content: string;
}

export interface MdzNodeCode extends MdzNodeBase {
	type: 'Code';
	/** The code content (identifier/module name). */
	content: string;
}

export interface MdzNodeCodeblock extends MdzNodeBase {
	type: 'Codeblock';
	/** Language hint, if provided. */
	lang: string | null;
	/** Raw code content. */
	content: string;
}

export interface MdzNodeBold extends MdzNodeBase {
	type: 'Bold';
	children: Array<MdzNode>;
}

export interface MdzNodeItalic extends MdzNodeBase {
	type: 'Italic';
	children: Array<MdzNode>;
}

export interface MdzNodeStrikethrough extends MdzNodeBase {
	type: 'Strikethrough';
	children: Array<MdzNode>;
}

export interface MdzNodeLink extends MdzNodeBase {
	type: 'Link';
	/** URL or path. */
	reference: string;
	/** Display content (can include inline formatting). */
	children: Array<MdzNode>;
	/** `external` is `https`/`http`; `internal` is `/path`, `./path`, or `../path`. */
	link_type: 'external' | 'internal';
}

export interface MdzNodeParagraph extends MdzNodeBase {
	type: 'Paragraph';
	children: Array<MdzNode>;
}

export interface MdzNodeHr extends MdzNodeBase {
	type: 'Hr';
}

export interface MdzNodeHeading extends MdzNodeBase {
	type: 'Heading';
	level: 1 | 2 | 3 | 4 | 5 | 6;
	/** Slugified heading text for fragment links. */
	id: string;
	/** Inline formatting allowed. */
	children: Array<MdzNode>;
}

export interface MdzNodeList extends MdzNodeBase {
	type: 'List';
	ordered: boolean;
	/** First item's authored number (ordered only) — the `<ol start>` attribute. */
	start_number?: number;
	children: Array<MdzNodeListItem>;
}

export interface MdzNodeListItem extends MdzNodeBase {
	type: 'ListItem';
	/** Authored number (ordered only); the renderer ignores it, tooling and the future formatter use it. */
	number?: number;
	/** Inline run first, then block children (`Paragraph` | `List` | `Codeblock` | `Blockquote`). */
	children: Array<MdzNode>;
}

export interface MdzNodeBlockquote extends MdzNodeBase {
	type: 'Blockquote';
	/**
	 * Block children — a quote's content is a mini-document, so anything that
	 * can appear at the top level can appear here (`Paragraph` | `Heading` |
	 * `Hr` | `List` | `Codeblock` | `Blockquote`).
	 */
	children: Array<MdzNode>;
}

export interface MdzNodeElement extends MdzNodeBase {
	type: 'Element';
	/** HTML element name (e.g. `div`, `span`, `aside`). */
	name: string;
	children: Array<MdzNode>;
}

export interface MdzNodeComponent extends MdzNodeBase {
	type: 'Component';
	/** Svelte component name (e.g. `Alert`, `Card`). */
	name: string;
	children: Array<MdzNode>;
}
