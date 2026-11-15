/**
 * SSR tests for `Mdz`'s `source_offsets` — each node's `start`/`end` as
 * `data-mdz-start`/`data-mdz-end` on the elements rendered for it.
 *
 * Off is the default and leaves the output as it was; the parity suite
 * (`mdz_to_svelte.render_parity.test.ts`) binds that default output to the
 * precompiler's, which knows nothing of offsets.
 */

import { describe, test, assert } from 'vitest';
import { render } from 'svelte/server';
import type { Component } from 'svelte';

import MdzComponent from '#lib/Mdz.svelte';
import { mdz_parse, type MdzNode } from '#lib/mdz.ts';
import { mdz_classify_link } from '#lib/mdz_helpers.ts';
import type {
	MdzCodeComponent,
	MdzCodeblockComponent,
	MdzComponents,
	MdzElements
} from '#lib/mdz_contexts.ts';
import MdzRenderHarnessComponent from './MdzRenderHarness.svelte';
import RestCode from './RestCode.svelte';
import NestedMdz from './NestedMdz.svelte';
import { load_fixtures } from './fixtures/mdz/mdz_test_helpers.ts';

// narrowed component types — the wrapper's `SvelteHTMLElements` rest-prop
// union is too complex for `render()`'s generic inference
const Mdz = MdzComponent as unknown as Component<{
	content: string;
	inline?: boolean;
	source_offsets?: boolean;
}>;
const Harness = MdzRenderHarnessComponent as unknown as Component<{
	content: string;
	elements?: MdzElements;
	components?: MdzComponents;
	code?: MdzCodeComponent;
	codeblock?: MdzCodeblockComponent;
	source_offsets?: boolean;
}>;

const render_mdz = (content: string, source_offsets?: boolean): string =>
	render(Mdz, { props: { content, source_offsets } }).body;

interface RenderedOffsets {
	tag: string;
	start: number;
	end: number;
}

/** Every element carrying offsets in an SSR body, in document order. */
const rendered_offsets = (body: string): Array<RenderedOffsets> =>
	Array.from(
		body.matchAll(/<([a-z][a-z0-9]*)\b[^>]*? data-mdz-start="(\d+)" data-mdz-end="(\d+)"/g),
		(m) => ({ tag: m[1]!, start: Number(m[2]), end: Number(m[3]) })
	);

/** The source each element with offsets spans, by tag, in document order. */
const spans = (content: string, body: string): Array<[string, string]> =>
	rendered_offsets(body).map(({ tag, start, end }) => [tag, content.slice(start, end)]);

// the tags each node type renders as in the plain (no injected components) runtime
const NODE_TAGS: Record<string, ReadonlyArray<string>> = {
	Paragraph: ['p'],
	Heading: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
	List: ['ul', 'ol'],
	ListItem: ['li'],
	Blockquote: ['blockquote'],
	Table: ['table'],
	TableRow: ['tr'],
	TableCell: ['th', 'td'],
	Hr: ['hr'],
	Codeblock: ['pre'],
	Code: ['code'],
	Bold: ['strong'],
	Italic: ['em'],
	Strikethrough: ['s'],
	Link: ['a']
};

/**
 * The nodes mdz renders an element for, in the plain runtime with no
 * registries — text has no element, an unsafe link renders as its text, an
 * unregistered tag as a placeholder, and a table cell past the column count
 * not at all.
 */
const collect_rendered_nodes = (
	nodes: Array<MdzNode>,
	out: Array<MdzNode> = []
): Array<MdzNode> => {
	for (const node of nodes) {
		if (node.type === 'Table') {
			out.push(node);
			for (const row of node.children) {
				out.push(row);
				for (const cell of row.children.slice(0, node.align.length)) {
					out.push(cell);
					collect_rendered_nodes(cell.children, out);
				}
			}
			continue;
		}
		const renders_element =
			node.type in NODE_TAGS &&
			!(
				node.type === 'Link' &&
				mdz_classify_link(node.reference, node.link_type, undefined).kind === 'unsafe'
			);
		if (renders_element) out.push(node);
		if ('children' in node) collect_rendered_nodes(node.children, out);
	}
	return out;
};

const to_key = (type_or_tag: string, start: number, end: number): string =>
	`${type_or_tag}:${start}:${end}`;

describe('source_offsets off', () => {
	test('renders no offsets, the same as an explicit false, across the fixture corpus', async () => {
		const fixtures = await load_fixtures();
		assert.isAbove(fixtures.length, 0);
		for (const fixture of fixtures) {
			const body = render_mdz(fixture.input);
			assert.notInclude(body, 'data-mdz-', fixture.name);
			assert.equal(render_mdz(fixture.input, false), body, fixture.name);
		}
	});

	test('differs from on only by the offset attributes, across the fixture corpus', async () => {
		const fixtures = await load_fixtures();
		for (const fixture of fixtures) {
			const on = render_mdz(fixture.input, true);
			assert.equal(
				on.replaceAll(/ data-mdz-start="\d+" data-mdz-end="\d+"/g, ''),
				render_mdz(fixture.input),
				fixture.name
			);
		}
	});

	test('passes injected components nothing they render', () => {
		const content = 'a `x` b\n\n```ts\ny\n```';
		const body = render(Harness, {
			props: { content, code: RestCode, codeblock: RestCode }
		}).body;
		assert.notInclude(body, 'data-mdz-');
		assert.include(body, '<code data-rest-code="true">x</code>');
		assert.include(body, '<code data-rest-code="true">y</code>');
	});
});

describe('source_offsets on', () => {
	test("every element mdz renders for a node carries that node's offsets, across the fixture corpus", async () => {
		const fixtures = await load_fixtures();
		for (const fixture of fixtures) {
			const body = render_mdz(fixture.input, true);
			assert.equal(
				body.match(/data-mdz-start=/g)?.length ?? 0,
				body.match(/data-mdz-end=/g)?.length ?? 0,
				fixture.name
			);
			const rendered = rendered_offsets(body).map(({ tag, start, end }) => {
				const type = Object.keys(NODE_TAGS).find((t) => NODE_TAGS[t]!.includes(tag));
				assert.ok(type, `${fixture.name}: unexpected <${tag}> with offsets`);
				return to_key(type, start, end);
			});
			const expected = collect_rendered_nodes(mdz_parse(fixture.input)).map((n) =>
				to_key(n.type, n.start, n.end)
			);
			assert.deepEqual(rendered.toSorted(), expected.toSorted(), fixture.name);
		}
	});

	test('block nodes', () => {
		const content = '# Title\n\nsome text\n\n---\n\n```ts\ncode\n```\n\n> quoted\n\n- item';
		assert.deepEqual(spans(content, render_mdz(content, true)), [
			['h1', '# Title'],
			['p', 'some text'],
			['hr', '---'],
			['pre', '```ts\ncode\n```'],
			['blockquote', '> quoted'],
			['p', 'quoted'],
			['ul', '- item'],
			['li', '- item']
		]);
	});

	test('inline nodes', () => {
		const content = '**b** _i_ ~~s~~ `c`';
		assert.deepEqual(spans(content, render_mdz(content, true)), [
			['p', content],
			['strong', '**b**'],
			['em', '_i_'],
			['s', '~~s~~'],
			['code', '`c`']
		]);
	});

	test.each([
		['a markdown link to an internal path', '[docs](/docs)', 'see [docs](/docs) here'],
		['a markdown link to a URL', '[site](https://fuz.dev/)', 'see [site](https://fuz.dev/) here'],
		['a markdown link to a relative path', '[up](../a.md)', 'see [up](../a.md) here'],
		['a markdown link to a fragment', '[top](#top)', 'see [top](#top) here'],
		['a markdown link with formatted text', '[**b** `c`](/x)', 'see [**b** `c`](/x) here'],
		['an autolinked URL', 'https://fuz.dev/a', 'see https://fuz.dev/a here'],
		['an autolinked URL with trailing punctuation', 'https://fuz.dev/a', 'see https://fuz.dev/a.'],
		['an autolinked absolute path', '/docs/a', 'see /docs/a here'],
		['an autolinked relative path', './a.md', 'see ./a.md here'],
		['an autolinked path in parens', './a.md', 'see (./a.md) here']
	])('%s', (_label, link_source, content) => {
		const anchors = spans(content, render_mdz(content, true)).filter(([tag]) => tag === 'a');
		assert.deepEqual(anchors, [['a', link_source]]);
	});

	test('a link whose reference fails the safety check renders no anchor', () => {
		const content: Array<MdzNode> = [
			{
				type: 'Paragraph',
				start: 0,
				end: 9,
				children: [
					{
						type: 'Link',
						reference: 'data:x',
						link_type: 'external',
						start: 0,
						end: 9,
						children: [{ type: 'Text', content: 'x', start: 1, end: 2 }]
					}
				]
			}
		];
		const NodesMdz = MdzComponent as unknown as Component<{
			nodes: Array<MdzNode>;
			source_offsets?: boolean;
		}>;
		const body = render(NodesMdz, { props: { nodes: content, source_offsets: true } }).body;
		assert.notInclude(body, '<a');
		assert.deepEqual(rendered_offsets(body), [{ tag: 'p', start: 0, end: 9 }]);
	});

	test('anchors match their link nodes by offsets in any document order', () => {
		const content = '- [a](/a) and https://fuz.dev\n\n> see ./b.md\n\n| [c](#c) |\n| - |\n| /d |';
		const body = render_mdz(content, true);
		const links: Array<MdzNode> = [];
		const walk = (nodes: Array<MdzNode>): void => {
			for (const n of nodes) {
				if (n.type === 'Link') links.push(n);
				if ('children' in n) walk(n.children);
			}
		};
		walk(mdz_parse(content));
		const anchors = rendered_offsets(body).filter((r) => r.tag === 'a');
		assert.equal(anchors.length, 5);
		assert.deepEqual(
			anchors.map((a) => to_key('Link', a.start, a.end)),
			links.map((l) => to_key('Link', l.start, l.end))
		);
	});

	test('nested lists', () => {
		const content = '- a\n  - b\n    - c\n- d';
		assert.deepEqual(spans(content, render_mdz(content, true)), [
			['ul', content],
			['li', '- a\n  - b\n    - c'],
			['ul', '- b\n    - c'],
			['li', '- b\n    - c'],
			['ul', '- c'],
			['li', '- c'],
			['li', '- d']
		]);
	});

	test('an ordered list', () => {
		const content = '3. a\n4. b';
		const body = render_mdz(content, true);
		assert.include(body, '<ol start="3" data-mdz-start="0" data-mdz-end="9">');
		assert.deepEqual(spans(content, body).slice(1), [
			['li', '3. a'],
			['li', '4. b']
		]);
	});

	test('nested blockquotes', () => {
		const content = '> a\n>\n> > b\n> >\n> > - c';
		assert.deepEqual(spans(content, render_mdz(content, true)), [
			['blockquote', content],
			['p', 'a'],
			['blockquote', '> b\n> >\n> > - c'],
			['p', 'b'],
			['ul', '- c'],
			['li', '- c']
		]);
	});

	test('a table, padding cells carrying nothing', () => {
		const content = '| a | b |\n| - | - |\n| 1 |';
		const body = render_mdz(content, true);
		assert.deepEqual(spans(content, body), [
			['table', content],
			['tr', '| a | b |'],
			['th', 'a'],
			['th', 'b'],
			['tr', '| 1 |'],
			['td', '1']
		]);
		assert.include(body, '<td>'); // the padding cell
	});

	test('a lone paragraph unwrapped by inline keeps its inline offsets', () => {
		const content = 'a **b**';
		const Inline = MdzComponent as unknown as Component<{
			content: string;
			inline: boolean;
			source_offsets: boolean;
		}>;
		const body = render(Inline, { props: { content, inline: true, source_offsets: true } }).body;
		assert.deepEqual(spans(content, body), [['strong', '**b**']]);
	});

	test('injected code and codeblock components receive the offsets as props', () => {
		const content = 'a `x` b\n\n```ts\ny\n```';
		const body = render(Harness, {
			props: { content, code: RestCode, codeblock: RestCode, source_offsets: true }
		}).body;
		assert.deepEqual(spans(content, body), [
			['p', 'a `x` b'],
			['code', '`x`'],
			['code', '```ts\ny\n```']
		]);
	});

	test('registered elements carry offsets', () => {
		const content = '<aside>**a**</aside>';
		const body = render(Harness, {
			props: { content, elements: new Map([['aside', true]]), source_offsets: true }
		}).body;
		assert.deepEqual(spans(content, body), [
			['aside', content],
			['strong', '**a**']
		]);
	});

	test('a registered component gets none, its content does, and a nested Mdz has its own switch', () => {
		const content = '<Nested>_b_</Nested>';
		const body = render(Harness, {
			props: { content, components: new Map([['Nested', NestedMdz]]), source_offsets: true }
		}).body;
		// the component's own `Mdz` renders a different string, so its bold carries no offsets
		assert.include(body, '<strong>');
		assert.include(body, 'inner');
		assert.deepEqual(spans(content, body), [['em', '_b_']]);
	});
});
