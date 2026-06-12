import type {MdzNode} from '$lib/mdz.js';
import {MdzStreamParser} from '$lib/mdz_stream_parser.js';
import {mdz_opcodes_to_nodes} from '$lib/mdz_opcodes_to_nodes.js';
import {load_fixtures_generic} from '../../test_helpers.js';

/**
 * Parse text through the streaming parser and convert to an MdzNode[] tree.
 */
export const stream_parse = (text: string): Array<MdzNode> => {
	const parser = new MdzStreamParser();
	parser.feed(text);
	parser.finish();
	return mdz_opcodes_to_nodes(parser.take_opcodes());
};

export interface MdzFixture {
	name: string;
	input: string;
	expected: Array<MdzNode>;
}

/**
 * Extract node types from an array of nodes for easier testing.
 */
export const node_types = (nodes: Array<MdzNode>): Array<string> => nodes.map((n) => n.type);

/**
 * Extract text content from a node, recursively for container nodes.
 */
export const text_content = (node: MdzNode): string => {
	if (node.type === 'Text') return node.content;
	if (node.type === 'Code') return node.content;
	if ('children' in node) {
		return node.children.map(text_content).join('');
	}
	return '';
};

/**
 * Validate position indices in parsed nodes.
 * Checks that all start/end positions are valid and contiguous.
 */
export const validate_positions = (
	nodes: Array<MdzNode>,
	parent_start?: number,
	parent_end?: number,
): void => {
	if (nodes.length === 0) return;

	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i]!;

		// Basic position validation
		if (node.start < 0 || node.end < 0) {
			throw Error(`Node ${i} has negative position: start=${node.start}, end=${node.end}`);
		}
		if (node.start >= node.end) {
			throw Error(`Node ${i} has invalid range: start=${node.start}, end=${node.end}`);
		}

		// Validate node fits within parent bounds
		if (parent_start !== undefined && parent_end !== undefined) {
			if (node.start < parent_start || node.end > parent_end) {
				throw Error(
					`Node ${i} (${node.start}-${node.end}) exceeds parent bounds (${parent_start}-${parent_end})`,
				);
			}
		}

		// Validate children positions recursively
		if ('children' in node && node.children.length > 0) {
			validate_positions(node.children, node.start, node.end);

			// Verify children are contiguous within parent
			const first_child = node.children[0]!;
			const last_child = node.children[node.children.length - 1]!;

			// Children should span from parent start to parent end
			// (allowing for delimiters at boundaries)
			if (first_child.start < node.start || last_child.end > node.end) {
				throw Error(
					`Children (${first_child.start}-${last_child.end}) exceed parent bounds (${node.start}-${node.end})`,
				);
			}
		}
	}

	// Validate sibling nodes are contiguous (no gaps or overlaps)
	for (let i = 0; i < nodes.length - 1; i++) {
		const current = nodes[i]!;
		const next = nodes[i + 1]!;

		if (current.end > next.start) {
			throw Error(
				`Overlapping nodes at ${i}: node[${i}] ends at ${current.end}, node[${i + 1}] starts at ${next.start}`,
			);
		}
	}
};

/**
 * Load all fixtures from the mdz fixtures directory.
 */
export const load_fixtures = async (): Promise<Array<MdzFixture>> => {
	return load_fixtures_generic<Array<MdzNode>>({
		fixtures_dir: import.meta.dirname,
		input_extension: '.mdz',
	});
};
