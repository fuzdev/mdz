/**
 * Converts a stream of mdz opcodes to the `MdzNode[]` tree representation.
 *
 * Stack-based replay over a single flat children buffer: leaves push to the
 * shared buffer, and each `open` frame records where its children begin
 * (`children_start`). `close` slices the frame's range out into the built
 * node; `revert` dissolves the frame boundary in place — its accumulated
 * children become the parent's without copying — and merges the replacement
 * delimiter text into an adjacent text node. Adjacent text left behind by
 * reverts is coalesced once per container by `mdz_merge_adjacent_text` at
 * close, so cascading reverts of deeply nested unclosed containers cost O(n)
 * total instead of re-parenting (O(n²)) at every level.
 *
 * The output is identical to `mdz_parse()` from `mdz.ts`, enabling
 * validation of the streaming parser against the existing fixture suite.
 *
 * @module
 */

import {DEV} from 'esm-env';

import type {
	MdzNode,
	MdzNodeText,
	MdzNodeLink,
	MdzNodeHeading,
	MdzNodeCode,
	MdzNodeListItem,
	MdzNodeTableRow,
	MdzNodeTableCell,
	MdzTableAlign,
} from './mdz.ts';
import type {MdzOpcode, MdzNodeId} from './mdz_opcodes.ts';
import {mdz_extract_single_tag, mdz_heading_id, mdz_merge_adjacent_text} from './mdz_helpers.ts';

interface StackFrame {
	id: MdzNodeId;
	node_type: string;
	/** Index into the shared flat children buffer where this frame's children begin. */
	children_start: number;
	start: number;
	// metadata from open opcode
	level?: number;
	name?: string;
	lang?: string | null;
	ordered?: boolean;
	start_number?: number;
	number?: number;
	align?: Array<MdzTableAlign>;
	header?: boolean;
	// metadata from close opcode (deferred)
	end?: number;
	reference?: string;
	link_type?: 'external' | 'internal';
	heading_id?: string;
}

/**
 * Convert an array of mdz opcodes to the `MdzNode[]` tree.
 * Produces output identical to `mdz_parse()`.
 */
export const mdz_opcodes_to_nodes = (opcodes: Array<MdzOpcode>): Array<MdzNode> => {
	// flat children buffer shared by all open frames — see module docs.
	// once every frame is closed it holds exactly the top-level nodes.
	const children: Array<MdzNode> = [];
	const stack: Array<StackFrame> = [];
	// index node IDs to their text content (for append_text, trim_text, and wrap)
	const text_nodes = new Map<MdzNodeId, MdzNodeText | MdzNodeCode>();

	for (const op of opcodes) {
		switch (op.type) {
			case 'open': {
				stack.push({
					id: op.id,
					node_type: op.node_type,
					children_start: children.length,
					start: op.start,
					level: op.level,
					name: op.name,
					lang: op.lang,
					ordered: op.ordered,
					start_number: op.start_number,
					number: op.number,
					align: op.align,
					header: op.header,
				});
				break;
			}

			case 'close': {
				if (DEV && stack.length === 0) {
					throw new Error(`mdz_opcodes_to_nodes: close for id ${op.id} but stack is empty`);
				}
				const frame = stack.pop();
				if (!frame) break;

				// discard signal: the parser determined this node and its descendants
				// should not appear in the tree (e.g. whitespace-only paragraph)
				if (op.discard) {
					children.length = frame.children_start;
					break;
				}

				// apply deferred metadata
				frame.end = op.end;
				if (op.reference !== undefined) frame.reference = op.reference;
				if (op.link_type !== undefined) frame.link_type = op.link_type;
				if (op.heading_id !== undefined) frame.heading_id = op.heading_id;

				const node = build_node(frame, children.splice(frame.children_start));
				if (node) children.push(node);
				break;
			}

			case 'text': {
				const node: MdzNodeText | MdzNodeCode =
					op.text_type === 'Code'
						? {type: 'Code', content: op.content, start: op.start, end: op.end}
						: {type: 'Text', content: op.content, start: op.start, end: op.end};
				text_nodes.set(op.id, node);
				children.push(node);
				break;
			}

			case 'append_text': {
				if (DEV && !text_nodes.has(op.id)) {
					throw new Error(`mdz_opcodes_to_nodes: append_text for unknown id ${op.id}`);
				}
				const existing = text_nodes.get(op.id);
				if (existing) {
					existing.content += op.content;
					// an explicit end covers stripped structural indent (list
					// continuation lines), where content is shorter than its span
					existing.end = op.end ?? existing.end + op.content.length;
				}
				break;
			}

			case 'trim_text': {
				if (DEV && !text_nodes.has(op.id)) {
					throw new Error(`mdz_opcodes_to_nodes: trim_text for unknown id ${op.id}`);
				}
				const existing = text_nodes.get(op.id);
				if (existing) {
					existing.content = existing.content.slice(0, existing.content.length - op.count);
					existing.end -= op.count;
					if (existing.content.length === 0) {
						// trim targets the most recent text run, so the node is near the
						// end of the buffer — backward identity scan
						for (let i = children.length - 1; i >= 0; i--) {
							if (children[i] === existing) {
								children.splice(i, 1);
								break;
							}
						}
						text_nodes.delete(op.id);
					}
				}
				break;
			}

			case 'void': {
				children.push({type: 'Hr', start: op.start, end: op.end});
				break;
			}

			case 'revert': {
				// find and remove the reverted node's frame from the stack.
				// fast path: most reverts are top-down (revert_above, via
				// close_paragraph/close_heading); a failed-closer revert
				// (revert_failed_close) targets a mid-stack frame,
				// dissolving it while the frames above stay open.
				let reverted: StackFrame | null = null;
				let reverted_idx = -1;
				if (stack.length > 0 && stack[stack.length - 1]!.id === op.id) {
					reverted_idx = stack.length - 1;
					reverted = stack.pop()!;
				} else {
					for (let i = stack.length - 1; i >= 0; i--) {
						if (stack[i]!.id === op.id) {
							reverted_idx = i;
							reverted = stack.splice(i, 1)[0]!;
							break;
						}
					}
				}

				if (DEV && !reverted) {
					throw new Error(`mdz_opcodes_to_nodes: revert for id ${op.id} but not found on stack`);
				}
				if (!reverted) break;

				if (op.replacement_text) {
					// the frame dissolves — its children already sit in the buffer
					// and now belong to the parent; only the replacement delimiter
					// text needs to materialize at the frame's open position.
					insert_replacement(children, stack, reverted_idx, reverted.children_start, op);
				}
				break;
			}

			case 'wrap': {
				const text_node = text_nodes.get(op.target_id);
				if (!text_node) break;

				// wraps always target a text node in the still-open container, near
				// the end of the buffer — backward identity scan
				let idx = -1;
				for (let i = children.length - 1; i >= 0; i--) {
					if (children[i] === text_node) {
						idx = i;
						break;
					}
				}
				if (idx === -1) break;

				// handle trailing punctuation trim
				let trimmed_node: MdzNodeText | null = null;
				if (op.trim_end && op.trim_end > 0 && op.trim_id != null) {
					const trimmed_content = text_node.content.slice(text_node.content.length - op.trim_end);
					text_node.content = text_node.content.slice(0, text_node.content.length - op.trim_end);
					text_node.end -= op.trim_end;
					trimmed_node = {
						type: 'Text',
						content: trimmed_content,
						start: text_node.end,
						end: text_node.end + trimmed_content.length,
					};
					text_nodes.set(op.trim_id, trimmed_node);
				}

				// create Link wrapping the text node
				const link: MdzNodeLink = {
					type: 'Link',
					reference: op.reference,
					children: [text_node],
					link_type: op.link_type,
					start: op.start,
					end: op.end,
				};

				// replace text node with [Link, trimmed?] in the buffer
				if (trimmed_node) {
					children.splice(idx, 1, link as MdzNode, trimmed_node as MdzNode);
				} else {
					children[idx] = link;
				}
				break;
			}
		}
	}

	return children;
};

/**
 * Materialize an inline revert's replacement text at `at` (the dissolved
 * frame's `children_start`), merging into an adjacent Text node when possible
 * so the hot path — cascading reverts of nested unclosed containers — never
 * shifts buffer elements:
 *
 * 1. append to the preceding sibling when it's a Text within the parent's range
 * 2. else prepend into the frame's first child when it's a Text (top-of-stack
 *    reverts only — for a mid-stack revert the node at `at` may belong to a
 *    still-open inner frame)
 * 3. else splice in a standalone Text node
 *
 * Mutating the adjacent nodes is safe: a `revert` seals the parser's active
 * text run (no later `append_text`/`trim_text` targets them), and pending
 * auto-link wraps always complete before an enclosing container reverts.
 * Adjacent Text nodes this leaves behind are coalesced by
 * `mdz_merge_adjacent_text` when the enclosing container closes.
 *
 * @mutates `children` and possibly the `children_start` of open frames on `stack`
 */
const insert_replacement = (
	children: Array<MdzNode>,
	stack: Array<StackFrame>,
	reverted_idx: number,
	at: number,
	op: {replacement_text?: string; start: number},
): void => {
	const text = op.replacement_text!;
	const parent_start = reverted_idx > 0 ? stack[reverted_idx - 1]!.children_start : 0;
	// 1. append to the preceding sibling within the parent's range
	if (at > parent_start) {
		const prev = children[at - 1]!;
		if (prev.type === 'Text') {
			prev.content += text;
			prev.end = op.start + text.length;
			return;
		}
	}
	// after pop/splice, the frame was top of stack iff its index equals the new length
	const was_top = reverted_idx === stack.length;
	// 2. prepend into the frame's first child
	if (was_top && at < children.length) {
		const first = children[at]!;
		if (first.type === 'Text') {
			first.content = text + first.content;
			first.start = op.start;
			return;
		}
	}
	// 3. standalone Text node
	const node: MdzNode = {type: 'Text', content: text, start: op.start, end: op.start + text.length};
	if (at >= children.length) {
		children.push(node);
	} else {
		children.splice(at, 0, node);
	}
	// shift the ranges of open frames above the reverted one (they opened
	// later, so their children_start is at or after the insertion point) —
	// also when the insert was an append: a mid-stack revert can land at the
	// buffer end while childless frames above share the same children_start,
	// and without the shift the replacement text falls inside their ranges
	for (let i = reverted_idx; i < stack.length; i++) {
		stack[i]!.children_start++;
	}
};

/**
 * Build an `MdzNode` from a completed stack frame and its children
 * (sliced out of the shared flat buffer by the caller).
 */
const build_node = (frame: StackFrame, frame_children: Array<MdzNode>): MdzNode | null => {
	switch (frame.node_type) {
		case 'Paragraph': {
			const children = mdz_merge_adjacent_text(frame_children);
			if (children.length === 0) return null;

			// extract single tag (MDX convention)
			const single_tag = mdz_extract_single_tag(children);
			if (single_tag) return single_tag;

			return {
				type: 'Paragraph',
				children,
				start: children[0]!.start,
				end: children[children.length - 1]!.end,
			};
		}

		case 'Heading': {
			const children = mdz_merge_adjacent_text(frame_children);
			const id = frame.heading_id ?? mdz_heading_id(children);
			return {
				type: 'Heading',
				level: frame.level ?? 1,
				id,
				children,
				start: frame.start,
				end: frame.end!,
			} as MdzNodeHeading;
		}

		case 'Bold':
			return {
				type: 'Bold',
				children: mdz_merge_adjacent_text(frame_children),
				start: frame.start,
				end: frame.end!,
			};

		case 'Italic':
			return {
				type: 'Italic',
				children: mdz_merge_adjacent_text(frame_children),
				start: frame.start,
				end: frame.end!,
			};

		case 'Strikethrough':
			return {
				type: 'Strikethrough',
				children: mdz_merge_adjacent_text(frame_children),
				start: frame.start,
				end: frame.end!,
			};

		case 'Link':
			return {
				type: 'Link',
				reference: frame.reference ?? '',
				children: mdz_merge_adjacent_text(frame_children),
				link_type: frame.link_type ?? 'internal',
				start: frame.start,
				end: frame.end!,
			};

		case 'List': {
			// items are the only possible children; `end` derives from the last
			// one, matching the sync token parser (the close offset is cosmetic)
			const children = frame_children as Array<MdzNodeListItem>;
			const end = children.length > 0 ? children[children.length - 1]!.end : frame.end!;
			if (frame.ordered) {
				return {
					type: 'List',
					ordered: true,
					start_number: frame.start_number ?? 1,
					children,
					start: frame.start,
					end,
				};
			}
			return {type: 'List', ordered: false, children, start: frame.start, end};
		}

		case 'ListItem': {
			const children = mdz_merge_adjacent_text(frame_children);
			// childless means an empty item — its close carried the marker end
			const end = children.length > 0 ? children[children.length - 1]!.end : frame.end!;
			if (frame.number !== undefined) {
				return {type: 'ListItem', number: frame.number, children, start: frame.start, end};
			}
			return {type: 'ListItem', children, start: frame.start, end};
		}

		case 'Blockquote': {
			// block children only — `end` derives from the last one, matching the
			// sync token parser (the close offset is cosmetic)
			const end =
				frame_children.length > 0 ? frame_children[frame_children.length - 1]!.end : frame.end!;
			return {type: 'Blockquote', children: frame_children, start: frame.start, end};
		}

		case 'Table': {
			// rows are the only children — `end` derives from the last, matching
			// the sync token parser
			const children = frame_children as Array<MdzNodeTableRow>;
			const end = children.length > 0 ? children[children.length - 1]!.end : frame.end!;
			return {type: 'Table', align: frame.align ?? [], children, start: frame.start, end};
		}

		case 'TableRow': {
			const children = frame_children as Array<MdzNodeTableCell>;
			return {
				type: 'TableRow',
				header: frame.header ?? false,
				children,
				start: frame.start,
				end: frame.end!,
			};
		}

		case 'TableCell':
			return {
				type: 'TableCell',
				children: mdz_merge_adjacent_text(frame_children),
				start: frame.start,
				end: frame.end!,
			};

		case 'Code': {
			// optimistic inline code container — concatenate children text into leaf MdzNodeCode
			let content = '';
			for (const c of frame_children) {
				if (c.type === 'Text') content += c.content;
			}
			return {
				type: 'Code',
				content,
				start: frame.start,
				end: frame.end!,
			};
		}

		case 'Codeblock': {
			// code block content is in children as text
			let content = '';
			for (const c of frame_children) {
				if (c.type === 'Text') content += c.content;
			}
			return {
				type: 'Codeblock',
				lang: frame.lang ?? null,
				content,
				start: frame.start,
				end: frame.end!,
			};
		}

		case 'Element':
			return {
				type: 'Element',
				name: frame.name ?? '',
				children: mdz_merge_adjacent_text(frame_children),
				start: frame.start,
				end: frame.end!,
			};

		case 'Component':
			return {
				type: 'Component',
				name: frame.name ?? '',
				children: mdz_merge_adjacent_text(frame_children),
				start: frame.start,
				end: frame.end!,
			};

		default:
			return null;
	}
};
