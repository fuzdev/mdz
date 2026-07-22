import { test, assert, describe } from 'vitest';

import { MdzStreamState } from '$lib/mdz_stream_state.svelte.ts';
import type {
	MdzOpcodeOpen,
	MdzOpcodeClose,
	MdzOpcodeText,
	MdzOpcodeAppendText,
	MdzOpcodeVoid,
	MdzOpcodeRevert,
	MdzOpcodeWrap
} from '$lib/mdz_opcodes.ts';

// -- Helpers --

const open_paragraph = (id: number, start = 0): MdzOpcodeOpen => ({
	type: 'open',
	id,
	node_type: 'Paragraph',
	start
});

const open_bold = (id: number, start = 0): MdzOpcodeOpen => ({
	type: 'open',
	id,
	node_type: 'Bold',
	start
});

const close = (id: number, end = 0): MdzOpcodeClose => ({
	type: 'close',
	id,
	end
});

const text = (id: number, content: string, start = 0, end = 0): MdzOpcodeText => ({
	type: 'text',
	id,
	content,
	text_type: 'Text',
	start,
	end
});

const append_text = (id: number, content: string): MdzOpcodeAppendText => ({
	type: 'append_text',
	id,
	content
});

const void_hr = (id: number, start = 0, end = 0): MdzOpcodeVoid => ({
	type: 'void',
	id,
	node_type: 'Hr',
	start,
	end
});

const revert = (id: number, replacement_text: string, start = 0): MdzOpcodeRevert => ({
	type: 'revert',
	id,
	replacement_text,
	start
});

// -- Happy path tests --

describe('MdzStreamState', () => {
	describe('happy path', () => {
		test('open + text + close builds a tree', () => {
			const state = new MdzStreamState();
			state.apply(open_paragraph(1));
			state.apply(text(2, 'hello'));
			state.apply(close(1));

			assert.equal(state.root.length, 1);
			assert.equal(state.root[0]!.type, 'Paragraph');
			assert.equal(state.root[0]!.children.length, 1);
			assert.equal(state.root[0]!.children[0]!.content, 'hello');
		});

		test('append_text extends existing text node', () => {
			const state = new MdzStreamState();
			state.apply(open_paragraph(1));
			state.apply(text(2, 'hel'));
			state.apply(append_text(2, 'lo'));
			state.apply(close(1));

			assert.equal(state.root[0]!.children[0]!.content, 'hello');
		});

		test('void node added at root level', () => {
			const state = new MdzStreamState();
			state.apply(void_hr(1));

			assert.equal(state.root.length, 1);
			assert.equal(state.root[0]!.type, 'Hr');
		});

		test('inline revert replaces node with text + re-parented children', () => {
			const state = new MdzStreamState();
			state.apply(open_paragraph(1));
			state.apply(open_bold(2));
			state.apply(text(3, 'content'));
			state.apply(revert(2, '**'));
			state.apply(close(1));

			const para = state.root[0]!;
			// bold replaced by: text("**") + re-parented text("content")
			assert.equal(para.children.length, 2);
			assert.equal(para.children[0]!.content, '**');
			assert.equal(para.children[1]!.content, 'content');
		});

		test('close applies deferred metadata', () => {
			const state = new MdzStreamState();
			state.apply({ type: 'open', id: 1, node_type: 'Link', start: 0 });
			state.apply(text(2, 'click'));
			state.apply({
				type: 'close',
				id: 1,
				end: 20,
				reference: 'https://fuz.dev',
				link_type: 'external'
			});

			assert.equal(state.root[0]!.reference, 'https://fuz.dev');
			assert.equal(state.root[0]!.link_type, 'external');
		});

		test('apply_batch processes multiple opcodes', () => {
			const state = new MdzStreamState();
			state.apply_batch([open_paragraph(1), text(2, 'hello'), close(1)]);

			assert.equal(state.root.length, 1);
			assert.equal(state.root[0]!.children[0]!.content, 'hello');
		});
	});

	// -- Dev-mode validation tests --

	describe('dev-mode validation', () => {
		test('duplicate open throws', () => {
			const state = new MdzStreamState();
			state.apply(open_paragraph(1));
			assert.throws(() => state.apply(open_paragraph(1)), /duplicate open for id 1/);
		});

		test('close for unknown id throws', () => {
			const state = new MdzStreamState();
			assert.throws(() => state.apply(close(99)), /close for unknown id 99/);
		});

		test('close for id not on stack throws', () => {
			const state = new MdzStreamState();
			state.apply(open_paragraph(1));
			state.apply(text(2, 'hello'));
			// text node exists in #nodes but is not on the stack
			assert.throws(() => state.apply(close(2)), /close for id 2 which is not on the stack/);
		});

		test('duplicate text throws', () => {
			const state = new MdzStreamState();
			state.apply(open_paragraph(1));
			state.apply(text(2, 'hello'));
			assert.throws(() => state.apply(text(2, 'world')), /duplicate text for id 2/);
		});

		test('append_text for unknown id throws', () => {
			const state = new MdzStreamState();
			assert.throws(() => state.apply(append_text(99, 'hello')), /append_text for unknown id 99/);
		});

		test('duplicate void throws', () => {
			const state = new MdzStreamState();
			state.apply(void_hr(1));
			assert.throws(() => state.apply(void_hr(1)), /duplicate void for id 1/);
		});

		test('revert for unknown id throws', () => {
			const state = new MdzStreamState();
			assert.throws(() => state.apply(revert(99, '**')), /revert for unknown id 99/);
		});

		test('revert for id not on stack throws', () => {
			const state = new MdzStreamState();
			state.apply(open_paragraph(1));
			state.apply(text(2, 'hello'));
			assert.throws(
				() => state.apply(revert(2, '**')),
				/revert for id 2 which is not on the stack/
			);
		});

		test('append_text after parent close throws (cleaned up)', () => {
			const state = new MdzStreamState();
			state.apply(open_paragraph(1));
			state.apply(text(2, 'hello'));
			state.apply(close(1));
			// text node was cleaned up when paragraph closed
			assert.throws(() => state.apply(append_text(2, ' world')), /append_text for unknown id 2/);
		});
	});

	describe('replacement text nodes', () => {
		test('inline revert replacement text node uses reverted id', () => {
			const state = new MdzStreamState();
			state.apply(open_paragraph(1));
			state.apply(open_bold(2));
			state.apply(text(3, 'content'));
			state.apply(revert(2, '**'));
			state.apply(close(1));

			// replacement text node reuses the reverted node's id
			const para = state.root[0]!;
			assert.equal(para.children[0]!.id, 2);
			assert.equal(para.children[0]!.content, '**');
		});

		test('multiple inline reverts produce unique replacement ids', () => {
			const state = new MdzStreamState();
			state.apply(open_paragraph(1));
			state.apply(open_bold(2));
			state.apply(text(3, 'a'));
			state.apply(revert(2, '**'));
			state.apply({ type: 'open', id: 4, node_type: 'Italic', start: 0 });
			state.apply(text(5, 'b'));
			state.apply(revert(4, '_'));
			state.apply(close(1));

			const para = state.root[0]!;
			// **a_b — four children: "**", "a", "_", "b"
			assert.equal(para.children.length, 4);
			assert.equal(para.children[0]!.id, 2); // from revert of bold
			assert.equal(para.children[2]!.id, 4); // from revert of italic
		});
	});

	describe('cleanup on close', () => {
		test('closed container children are cleaned from maps', () => {
			const state = new MdzStreamState();
			state.apply(open_paragraph(1));
			state.apply(text(2, 'hello'));
			state.apply(close(1));

			// id 1 and 2 are cleaned — can reuse ids without "duplicate" error
			// (in practice the parser never reuses, but this verifies cleanup)
			state.apply(open_paragraph(1));
			state.apply(text(2, 'world'));
			state.apply(close(1));

			assert.equal(state.root.length, 2);
			assert.equal(state.root[1]!.children[0]!.content, 'world');
		});

		test('nested containers cleaned recursively', () => {
			const state = new MdzStreamState();
			state.apply(open_paragraph(1));
			state.apply(open_bold(2));
			state.apply(text(3, 'bold'));
			state.apply(close(2));
			state.apply(text(4, ' plain'));
			state.apply(close(1));

			// all ids 1-4 are cleaned — reuse without error
			state.apply(open_paragraph(1));
			state.apply(text(2, 'reused'));
			state.apply(close(1));

			assert.equal(state.root.length, 2);
		});

		test('append_text works before parent close', () => {
			const state = new MdzStreamState();
			state.apply(open_paragraph(1));
			state.apply(text(2, 'hel'));
			state.apply(append_text(2, 'lo'));
			// text node still accessible before close
			state.apply(append_text(2, ' world'));
			state.apply(close(1));

			assert.equal(state.root[0]!.children[0]!.content, 'hello world');
		});

		test('render tree preserved after cleanup', () => {
			const state = new MdzStreamState();
			state.apply(open_paragraph(1));
			state.apply(open_bold(2));
			state.apply(text(3, 'bold'));
			state.apply(close(2));
			state.apply(text(4, ' text'));
			state.apply(close(1));

			// render tree still intact via children arrays
			const para = state.root[0]!;
			assert.equal(para.type, 'Paragraph');
			assert.equal(para.children.length, 2);
			assert.equal(para.children[0]!.type, 'Bold');
			assert.equal(para.children[0]!.children[0]!.content, 'bold');
			assert.equal(para.children[1]!.content, ' text');
		});
	});

	describe('wrap opcode', () => {
		const wrap = (
			id: number,
			target_id: number,
			reference: string,
			link_type: 'external' | 'internal' = 'external',
			start = 0,
			end = 0
		): MdzOpcodeWrap => ({
			type: 'wrap',
			id,
			node_type: 'Link',
			target_id,
			reference,
			link_type,
			start,
			end
		});

		test('wrap converts text node to link', () => {
			const state = new MdzStreamState();
			state.apply(open_paragraph(1));
			state.apply(text(2, 'https://fuz.dev'));
			state.apply(wrap(3, 2, 'https://fuz.dev'));
			state.apply(close(1));

			const para = state.root[0]!;
			assert.equal(para.children.length, 1);
			const link = para.children[0]!;
			assert.equal(link.type, 'Link');
			assert.equal(link.reference, 'https://fuz.dev');
			assert.equal(link.link_type, 'external');
			assert.equal(link.children.length, 1);
			assert.equal(link.children[0]!.content, 'https://fuz.dev');
		});

		test('wrap with trim_end splits text node', () => {
			const state = new MdzStreamState();
			state.apply(open_paragraph(1));
			state.apply(text(2, 'https://fuz.dev.'));
			state.apply({
				type: 'wrap',
				id: 3,
				node_type: 'Link',
				target_id: 2,
				reference: 'https://fuz.dev',
				link_type: 'external',
				start: 0,
				end: 19,
				trim_end: 1,
				trim_id: 4
			});
			state.apply(close(1));

			const para = state.root[0]!;
			assert.equal(para.children.length, 2);
			assert.equal(para.children[0]!.type, 'Link');
			assert.equal(para.children[0]!.children[0]!.content, 'https://fuz.dev');
			assert.equal(para.children[1]!.type, 'Text');
			assert.equal(para.children[1]!.content, '.');
		});

		test('wrap with preceding text preserves order', () => {
			const state = new MdzStreamState();
			state.apply(open_paragraph(1));
			state.apply(text(2, 'see '));
			state.apply(text(3, 'https://fuz.dev'));
			state.apply(wrap(4, 3, 'https://fuz.dev'));
			state.apply(close(1));

			const para = state.root[0]!;
			assert.equal(para.children.length, 2);
			assert.equal(para.children[0]!.content, 'see ');
			assert.equal(para.children[1]!.type, 'Link');
		});

		test('wrap for unknown target_id throws in DEV', () => {
			const state = new MdzStreamState();
			state.apply(open_paragraph(1));
			assert.throws(() => state.apply(wrap(2, 99, 'url')), /wrap target_id 99 not in nodes/);
		});

		test('wrap with duplicate id throws in DEV', () => {
			const state = new MdzStreamState();
			state.apply(open_paragraph(1));
			state.apply(text(2, 'url'));
			assert.throws(() => state.apply(wrap(1, 2, 'url')), /wrap id 1 already exists in nodes/);
		});
	});
});
