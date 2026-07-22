/**
 * Opcode types for the mdz streaming parser.
 *
 * Opcodes are serializable rendering instructions emitted by `MdzStreamParser`.
 * They tell a renderer what to do next — open a container, append text, close it,
 * or revert an optimistic assumption. Target-agnostic: works for HTML, Svelte, PDF, etc.
 *
 * The parser makes optimistic assumptions about ambiguous syntax (e.g., `**` is probably bold)
 * and emits `revert` opcodes to correct when wrong. This enables true streaming rendering
 * without ever re-parsing.
 *
 * @module
 */

import type { MdzTableAlign } from './mdz.ts';

/**
 * Unique monotonic identifier for each node created by the parser.
 * IDs are never reused within a parser instance.
 */
export type MdzNodeId = number;

/**
 * Node types that can be opened as containers.
 *
 * `Code` appears here *and* in `MdzNodeTypeText`: inline code resolved within
 * one chunk emits as a single `text` opcode, while a backtick with no closer
 * visible yet opens an optimistic `Code` container whose content streams as
 * text children (collapsed back to `content` by consumers at `close`).
 */
export type MdzNodeTypeContainer =
	| 'Paragraph'
	| 'Bold'
	| 'Italic'
	| 'Strikethrough'
	| 'Link'
	| 'Heading'
	| 'List'
	| 'ListItem'
	| 'Blockquote'
	| 'Element'
	| 'Component'
	| 'Codeblock'
	| 'Code'
	| 'Table'
	| 'TableRow'
	| 'TableCell';

/** Node types for self-contained leaf elements. */
export type MdzNodeTypeVoid = 'Hr';

/** Discriminant for leaf text nodes (see `MdzNodeTypeContainer` for `Code`'s dual form). */
export type MdzNodeTypeText = 'Text' | 'Code';

/**
 * Open a container node. The renderer starts a new element/wrapper.
 * Children are subsequent opcodes until the matching `close`.
 */
export interface MdzOpcodeOpen {
	type: 'open';
	id: MdzNodeId;
	node_type: MdzNodeTypeContainer;
	/** Byte offset in the full input where the opening delimiter begins. */
	start: number;
	/** Heading level (1-6). Present when `node_type` is `'Heading'`. */
	level?: 1 | 2 | 3 | 4 | 5 | 6;
	/** Tag name. Present when `node_type` is `'Element'` or `'Component'`. */
	name?: string;
	/** Language hint. Present when `node_type` is `'Codeblock'`. */
	lang?: string | null;
	/** Whether the list is ordered. Present when `node_type` is `'List'`. */
	ordered?: boolean;
	/** First item's authored number — the `<ol start>` attribute. Present for ordered `'List'`. */
	start_number?: number;
	/** Authored item number. Present when `node_type` is `'ListItem'` in an ordered list. */
	number?: number;
	/** Per-column alignment from the delimiter row. Present when `node_type` is `'Table'`. */
	align?: Array<MdzTableAlign>;
	/** Whether this is the header row (`thead`/`th`). Present when `node_type` is `'TableRow'`. */
	header?: boolean;
}

/**
 * Close a previously opened container node.
 * Carries deferred metadata that wasn't known at open time.
 */
export interface MdzOpcodeClose {
	type: 'close';
	id: MdzNodeId;
	/** Byte offset in the full input immediately after the closing delimiter. */
	end: number;
	/** Link URL/path, resolved when `](url)` completes. */
	reference?: string;
	/** Link type, resolved alongside `reference`. */
	link_type?: 'external' | 'internal';
	/** Heading slug, computed from full heading content. */
	heading_id?: string;
	/**
	 * If true, consumer drops this node and its descendants from the tree.
	 * Used for whitespace-only paragraphs that match nothing in `mdz_parse`'s
	 * output — the streaming parser emits open/text speculatively, then
	 * retroactively drops the empty wrapper at close.
	 */
	discard?: boolean;
}

/**
 * Create a leaf text or code node.
 * The parent is implicit — the innermost open container on the renderer's stack.
 */
export interface MdzOpcodeText {
	type: 'text';
	id: MdzNodeId;
	content: string;
	text_type: MdzNodeTypeText;
	/** Byte offset where this node begins (for Code, the opening backtick). */
	start: number;
	/** Byte offset immediately after this node ends (for Code, after the closing backtick). */
	end: number;
}

/**
 * Append content to an existing text node.
 * Streaming optimization — avoids creating a new node per chunk
 * during plain text runs.
 */
export interface MdzOpcodeAppendText {
	type: 'append_text';
	id: MdzNodeId;
	content: string;
	/**
	 * Byte offset immediately after the appended content in the full input.
	 * When absent, consumers extend the node's `end` by `content.length`;
	 * present when the two differ — list continuation lines strip structural
	 * indent from content, so the source span outgrows the content length.
	 */
	end?: number;
}

/**
 * Trim `count` characters from the end of an existing text node.
 * If trimming empties the node, the consumer removes it from its parent.
 *
 * Used by paragraph/codeblock close to drop the trailing newline that
 * separates inline content from the block boundary. Emitted instead of
 * retroactively mutating the prior `text`/`append_text` opcode, so the
 * opcode stream is append-only.
 */
export interface MdzOpcodeTrimText {
	type: 'trim_text';
	id: MdzNodeId;
	count: number;
}

/**
 * Create a self-contained leaf node (e.g., horizontal rule).
 * Inserted as a child of the innermost open container, or at root level.
 */
export interface MdzOpcodeVoid {
	type: 'void';
	id: MdzNodeId;
	node_type: MdzNodeTypeVoid;
	/** Byte offset in the full input where this element begins. */
	start: number;
	/** Byte offset immediately after this element ends. */
	end: number;
}

/**
 * Undo an optimistic open. Removes the container wrapper,
 * inserts `replacement_text` as literal text at the container's position,
 * and re-parents the container's children to the grandparent.
 *
 * Only inline containers revert — block structure (paragraphs, headings,
 * codeblocks, lists, blockquotes) is decided from bounded input before
 * opening, so block opens are never speculative.
 */
export interface MdzOpcodeRevert {
	type: 'revert';
	id: MdzNodeId;
	/** The delimiter text to emit as literal content (e.g., `"**"`, `"["`, `"<Tag>"`). */
	replacement_text: string;
	/** Byte offset of the original opening delimiter in the full input. */
	start: number;
}

/**
 * Retroactively wrap an existing text node in a container.
 * Used for text-first auto-links: URL/path text streams as plain text,
 * then gets wrapped in a Link when the URL boundary is found.
 *
 * Specific to text-first auto-detected content — not a general
 * retroactive-container mechanism. Delimiter-paired inlines (bold, italic,
 * strikethrough) use optimistic `open` + `revert` instead: their opening
 * delimiter is an explicit open event, and the delimiters are discarded
 * rather than retained as content.
 *
 * When `trim_end` is set, trailing characters (punctuation) are trimmed
 * from the target text node and placed in a new sibling Text node after
 * the Link wrapper, identified by `trim_id`.
 */
export interface MdzOpcodeWrap {
	type: 'wrap';
	/** ID for the new Link container node. */
	id: MdzNodeId;
	/** Container type to wrap in (always `'Link'` for now). */
	node_type: 'Link';
	/** ID of the existing text node to wrap. */
	target_id: MdzNodeId;
	/** Resolved URL or path reference. */
	reference: string;
	/** Whether the link is external (URL) or internal (path). */
	link_type: 'external' | 'internal';
	/** Byte offset where the URL/path begins. */
	start: number;
	/** Byte offset immediately after the URL/path (before any trimmed punctuation). */
	end: number;
	/** Number of trailing chars to trim from target and place after the link. */
	trim_end?: number;
	/** ID for the trimmed-text sibling node. Required when `trim_end` > 0. */
	trim_id?: MdzNodeId;
}

/** All node types that can appear in the mdz tree. */
export type MdzNodeType = MdzNodeTypeContainer | MdzNodeTypeVoid | MdzNodeTypeText;

/** Discriminated union of all mdz opcodes. */
export type MdzOpcode =
	| MdzOpcodeOpen
	| MdzOpcodeClose
	| MdzOpcodeText
	| MdzOpcodeAppendText
	| MdzOpcodeTrimText
	| MdzOpcodeVoid
	| MdzOpcodeRevert
	| MdzOpcodeWrap;
