/**
 * Reactive state for the mdz streaming renderer.
 *
 * Maintains a reactive tree of `MdzStreamNode` objects that Svelte 5 can
 * efficiently update. Opcodes from `MdzStreamParser` are applied via
 * `apply()` or `apply_batch()`, mutating the tree in place.
 *
 * @module
 */

import {DEV} from 'esm-env';

import type {MdzNodeId, MdzNodeType, MdzOpcode} from './mdz_opcodes.ts';

/**
 * A reactive node in the stream renderer tree.
 * Fields are `$state` so Svelte re-renders only what changes.
 */
export class MdzStreamNode {
	id: MdzNodeId;
	type: MdzNodeType;
	content: string = $state('');
	children: Array<MdzStreamNode> = $state([]);
	// metadata
	level?: 1 | 2 | 3 | 4 | 5 | 6;
	reference?: string = $state();
	link_type?: 'external' | 'internal' = $state();
	name?: string;
	lang?: string | null;
	heading_id?: string = $state();
	ordered?: boolean;
	start_number?: number;
	number?: number;

	constructor(id: MdzNodeId, type: MdzNodeType) {
		this.id = id;
		this.type = type;
	}
}

/**
 * Reactive state manager for streaming mdz content.
 * Apply opcodes to incrementally build and update the render tree.
 *
 * Lifecycle: one state instance per stream, paired with one `MdzStreamParser`.
 * Opcodes must be applied exactly once, in emission order — `take_opcodes()`
 * batches can be split or concatenated freely, but never reordered, skipped,
 * or replayed. There is no `reset()`; to restart a stream, construct a new
 * parser and a new state.
 */
export class MdzStreamState {
	root: Array<MdzStreamNode> = $state([]);

	/** Node lookup by ID. */
	#nodes = new Map<MdzNodeId, MdzStreamNode>();

	/** Stack of open container IDs (for knowing current parent). */
	#stack: Array<MdzNodeId> = [];

	/**
	 * Children array of the container at `stack_idx - 1` — the parent of a
	 * node sitting at `stack_idx` on the stack — or `root` when the node is
	 * top-level. There is no parent map: a stack-resident node's parent is
	 * the stack entry below it, and every other opcode target (text being
	 * trimmed, wrap targets) lives in the innermost open container, so the
	 * stack answers all parent lookups. See the matching invariants in
	 * `mdz_opcodes_to_nodes`.
	 */
	#parent_children_at(stack_idx: number): Array<MdzStreamNode> {
		if (stack_idx <= 0) return this.root;
		const parent = this.#nodes.get(this.#stack[stack_idx - 1]!);
		if (DEV && !parent) {
			throw new Error(
				`MdzStreamState: parent id ${this.#stack[stack_idx - 1]} on stack but missing from nodes`,
			);
		}
		return parent ? parent.children : this.root;
	}

	/**
	 * Register a new node and attach it to its current parent (innermost open
	 * container, or root). Shared by `open`, `text`, and `void` paths.
	 */
	#attach(node: MdzStreamNode): void {
		this.#nodes.set(node.id, node);
		this.#parent_children_at(this.#stack.length).push(node);
	}

	/**
	 * Apply a single opcode.
	 */
	apply(opcode: MdzOpcode): void {
		switch (opcode.type) {
			case 'open': {
				if (DEV && this.#nodes.has(opcode.id)) {
					throw new Error(
						`MdzStreamState: duplicate open for id ${opcode.id} (node_type '${opcode.node_type}')`,
					);
				}
				const node = new MdzStreamNode(opcode.id, opcode.node_type);
				if (opcode.level !== undefined) node.level = opcode.level;
				if (opcode.name !== undefined) node.name = opcode.name;
				if (opcode.lang !== undefined) node.lang = opcode.lang;
				if (opcode.ordered !== undefined) node.ordered = opcode.ordered;
				if (opcode.start_number !== undefined) node.start_number = opcode.start_number;
				if (opcode.number !== undefined) node.number = opcode.number;
				this.#attach(node);
				this.#stack.push(opcode.id);
				break;
			}

			case 'close': {
				const stack_idx = this.#stack.lastIndexOf(opcode.id);
				if (DEV) {
					if (!this.#nodes.has(opcode.id)) {
						throw new Error(`MdzStreamState: close for unknown id ${opcode.id}`);
					}
					if (stack_idx === -1) {
						throw new Error(`MdzStreamState: close for id ${opcode.id} which is not on the stack`);
					}
				}
				const node = this.#nodes.get(opcode.id);
				if (node) {
					if (opcode.discard) {
						// drop the node and its descendants from its parent's children —
						// it's the parent's last child (anything attached after it
						// opened went inside it), with a defensive backward scan
						if (stack_idx !== -1) {
							const parent_children = this.#parent_children_at(stack_idx);
							for (let i = parent_children.length - 1; i >= 0; i--) {
								if (parent_children[i] === node) {
									parent_children.splice(i, 1);
									break;
								}
							}
						}
					} else {
						// apply deferred metadata
						if (opcode.reference !== undefined) node.reference = opcode.reference;
						if (opcode.link_type !== undefined) node.link_type = opcode.link_type;
						if (opcode.heading_id !== undefined) node.heading_id = opcode.heading_id;
						// Code/Codeblock: collapse text children into `content` so renderers
						// can read it directly without walking children every render.
						if (node.type === 'Code' || node.type === 'Codeblock') {
							let content = '';
							for (const child of node.children) content += child.content;
							node.content = content;
						}
					}
				}
				// pop from stack
				if (stack_idx !== -1) this.#stack.splice(stack_idx, 1);
				// cleanup: closed nodes have no further opcode interactions.
				// children are retained in the render tree via children arrays
				// (discarded nodes' subtrees also need full cleanup, which the
				// traversal in `#cleanup_node` already handles).
				this.#cleanup_node(opcode.id);
				break;
			}

			case 'text': {
				if (DEV && this.#nodes.has(opcode.id)) {
					throw new Error(
						`MdzStreamState: duplicate text for id ${opcode.id} (text_type '${opcode.text_type}')`,
					);
				}
				const node = new MdzStreamNode(opcode.id, opcode.text_type);
				node.content = opcode.content;
				this.#attach(node);
				break;
			}

			case 'append_text': {
				if (DEV && !this.#nodes.has(opcode.id)) {
					throw new Error(`MdzStreamState: append_text for unknown id ${opcode.id}`);
				}
				const node = this.#nodes.get(opcode.id);
				if (node) {
					node.content += opcode.content;
				}
				break;
			}

			case 'trim_text': {
				if (DEV && !this.#nodes.has(opcode.id)) {
					throw new Error(`MdzStreamState: trim_text for unknown id ${opcode.id}`);
				}
				const node = this.#nodes.get(opcode.id);
				if (node) {
					node.content = node.content.slice(0, node.content.length - opcode.count);
					if (node.content.length === 0) {
						// trim targets the most recent text run with no structural
						// opcode since, so the node is the last child of the innermost
						// open container — backward scan from the end
						const parent_children = this.#parent_children_at(this.#stack.length);
						for (let i = parent_children.length - 1; i >= 0; i--) {
							if (parent_children[i] === node) {
								parent_children.splice(i, 1);
								break;
							}
						}
						this.#nodes.delete(opcode.id);
					}
				}
				break;
			}

			case 'void': {
				if (DEV && this.#nodes.has(opcode.id)) {
					throw new Error(
						`MdzStreamState: duplicate void for id ${opcode.id} (node_type '${opcode.node_type}')`,
					);
				}
				const node = new MdzStreamNode(opcode.id, opcode.node_type);
				this.#attach(node);
				break;
			}

			case 'revert': {
				// the reverted node is the last child of its parent even for a
				// mid-stack revert (a failed-closer revert with containers still
				// open above it) — anything attached after it opened went inside
				// it, so the pop+append fast path below covers both cases.
				// lastIndexOf finds the node's own stack position; its parent is
				// the entry below that position.
				const stack_idx = this.#stack.lastIndexOf(opcode.id);
				if (DEV) {
					if (!this.#nodes.has(opcode.id)) {
						throw new Error(`MdzStreamState: revert for unknown id ${opcode.id}`);
					}
					if (stack_idx === -1) {
						throw new Error(`MdzStreamState: revert for id ${opcode.id} which is not on the stack`);
					}
				}
				const node = this.#nodes.get(opcode.id);
				if (!node || stack_idx === -1) break;

				const parent_children = this.#parent_children_at(stack_idx);

				// find the node — last child of its parent, backward scan is defensive
				let node_idx = -1;
				for (let i = parent_children.length - 1; i >= 0; i--) {
					if (parent_children[i] === node) {
						node_idx = i;
						break;
					}
				}
				if (node_idx === -1) {
					if (DEV) {
						throw new Error(
							`MdzStreamState: revert for id ${opcode.id} but node not found in parent's children`,
						);
					}
					break;
				}

				// remove reverted node from stack before any pushes
				this.#stack.splice(stack_idx, 1);

				// replacement literal delimiter text. Reuses the reverted node's id
				// (unique — the node is deleted below) for a stable keyed-each key;
				// deliberately not registered in #nodes (no opcode ever targets it).
				let replacement_text_node: MdzStreamNode | null = null;
				if (opcode.replacement_text) {
					replacement_text_node = new MdzStreamNode(opcode.id, 'Text');
					replacement_text_node.content = opcode.replacement_text;
				}

				if (node_idx === parent_children.length - 1) {
					// inline revert: the node's children become the parent's, in place
					// at the end — pop + append, never a spread (a spread of the
					// accumulated children would hit the argument-count limit on
					// pathological inputs)
					parent_children.pop();
					if (replacement_text_node) parent_children.push(replacement_text_node);
					for (const child of node.children) {
						parent_children.push(child);
					}
				} else {
					// defensive mid-array fallback — unreachable for parser-produced
					// streams, where the reverted node is always the last child
					const replacement_nodes: Array<MdzStreamNode> = replacement_text_node
						? [replacement_text_node, ...node.children]
						: [...node.children];
					parent_children.splice(node_idx, 1, ...replacement_nodes);
				}

				this.#nodes.delete(opcode.id);
				break;
			}

			case 'wrap': {
				if (DEV) {
					if (!this.#nodes.has(opcode.target_id)) {
						throw new Error(`MdzStreamState: wrap target_id ${opcode.target_id} not in nodes`);
					}
					if (this.#nodes.has(opcode.id)) {
						throw new Error(`MdzStreamState: wrap id ${opcode.id} already exists in nodes`);
					}
				}
				const target = this.#nodes.get(opcode.target_id);
				if (!target) break;

				// wraps target a text node in the still-open innermost container,
				// emitted before any structural opcode could move it — so the
				// target sits at/near the end of the container's children
				const parent_children = this.#parent_children_at(this.#stack.length);

				// find target — backward scan from the end
				let target_idx = -1;
				for (let i = parent_children.length - 1; i >= 0; i--) {
					if (parent_children[i] === target) {
						target_idx = i;
						break;
					}
				}
				if (target_idx === -1) break;

				// handle trailing punctuation trim
				let trimmed_node: MdzStreamNode | null = null;
				if (opcode.trim_end && opcode.trim_end > 0 && opcode.trim_id != null) {
					const trimmed_content = target.content.slice(target.content.length - opcode.trim_end);
					target.content = target.content.slice(0, target.content.length - opcode.trim_end);
					trimmed_node = new MdzStreamNode(opcode.trim_id, 'Text');
					trimmed_node.content = trimmed_content;
					this.#nodes.set(opcode.trim_id, trimmed_node);
				}

				// create Link wrapper containing target
				const link = new MdzStreamNode(opcode.id, opcode.node_type);
				link.reference = opcode.reference;
				link.link_type = opcode.link_type;
				link.children.push(target);
				this.#nodes.set(opcode.id, link);

				// replace target with [Link, trimmed?] in parent's children
				if (trimmed_node) {
					parent_children.splice(target_idx, 1, link, trimmed_node);
				} else {
					parent_children[target_idx] = link;
				}

				// cleanup: Link is complete (no close opcode coming).
				// trim_id (if any) stays in maps — cleaned when parent closes.
				this.#cleanup_node(opcode.id);
				break;
			}
		}
	}

	/**
	 * Remove a node and its descendants from the `#nodes` lookup. Iterative to avoid
	 * stack overflow on deep trees.
	 *
	 * Parser invariant: once a container closes, no future opcode targets that
	 * subtree (no `append_text` to a closed Text, no nested `wrap`/`revert`).
	 * Children stay reachable via `parent.children` arrays — only the lookup
	 * map is pruned. If this invariant is violated, the misbehaving opcode
	 * triggers a DEV throw in `apply()` and silently no-ops in production.
	 */
	#cleanup_node(id: MdzNodeId): void {
		const queue: Array<MdzNodeId> = [id];
		while (queue.length > 0) {
			const current_id = queue.pop()!;
			const node = this.#nodes.get(current_id);
			if (node) {
				for (const child of node.children) {
					queue.push(child.id);
				}
			}
			this.#nodes.delete(current_id);
		}
	}

	/**
	 * Apply a batch of opcodes.
	 */
	apply_batch(opcodes: Array<MdzOpcode>): void {
		for (const op of opcodes) {
			this.apply(op);
		}
	}
}
