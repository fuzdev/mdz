/**
 * SSR render tests for the runtime renderer (`Mdz` → `MdzNodeView`).
 *
 * The renderers previously had no test coverage at all — these bind the
 * component output to the parser across the full fixture corpus via
 * `svelte/server`'s `render` (no DOM environment needed).
 */

import { describe, test, assert } from 'vitest';
import { render } from 'svelte/server';
import type { Component } from 'svelte';

import MdzComponent from '#lib/Mdz.svelte';
import MdzStreamComponent from '#lib/MdzStream.svelte';
import type { MdzNode } from '#lib/mdz.ts';
import { MdzStreamParser } from '#lib/mdz_stream_parser.ts';
import { MdzStreamState } from '#lib/mdz_stream_state.svelte.ts';
import { load_fixtures } from './fixtures/mdz/mdz_test_helpers.ts';

// narrowed component types — the wrapper's `SvelteHTMLElements` rest-prop
// union is too complex for `render()`'s generic inference
const Mdz = MdzComponent as unknown as Component<{ content: string }>;
const MdzNodes = MdzComponent as unknown as Component<{ nodes: Array<MdzNode>; base?: string }>;
const MdzWithBase = MdzComponent as unknown as Component<{ content: string; base: string }>;
const MdzStream = MdzStreamComponent as unknown as Component<{ stream: MdzStreamState }>;

/** The `href` of every `<a>` in an SSR body, in document order. */
const hrefs = (body: string): Array<string> =>
	Array.from(body.matchAll(/<a href="([^"]*)"/g), (m) => m[1]!);

/** A one-paragraph tree holding a single internal link — bypasses the parser. */
const link_tree = (reference: string): Array<MdzNode> => [
	{
		type: 'Paragraph',
		start: 0,
		end: reference.length,
		children: [
			{
				type: 'Link',
				reference,
				link_type: 'internal',
				start: 0,
				end: reference.length,
				children: [{ type: 'Text', content: reference, start: 0, end: reference.length }]
			}
		]
	}
];

/**
 * SSR `MdzStream` for `content`, with every link reference rewritten through
 * `rewrite` — reaches references the parser never produces (like `[x]`).
 */
const stream_hrefs = (content: string, rewrite: (reference: string) => string): Array<string> => {
	const parser = new MdzStreamParser();
	parser.feed(content);
	parser.finish();
	const state = new MdzStreamState();
	state.apply_batch(
		parser
			.take_opcodes()
			.map((op) =>
				'reference' in op && op.reference !== undefined
					? { ...op, reference: rewrite(op.reference) }
					: op
			)
	);
	return hrefs(render(MdzStream, { props: { stream: state } }).body);
};

describe('Mdz SSR rendering', () => {
	test('renders simple content', () => {
		const result = render(Mdz, { props: { content: 'hello **bold** and `code`' } });
		assert.include(result.body, '<strong>');
		assert.include(result.body, 'bold');
		assert.include(result.body, '<code>code</code>');
	});

	test('renders every mdz fixture without throwing', async () => {
		const fixtures = await load_fixtures();
		assert.isAbove(fixtures.length, 0);
		for (const fixture of fixtures) {
			const result = render(Mdz, { props: { content: fixture.input } });
			assert.isString(result.body, fixture.name);
		}
	});
});

// Internal references are authored URLs, rendered verbatim under the base —
// SvelteKit's route-id form of `resolve()` would strip `(group)` and empty
// segments, decode `[x+nn]` escapes, and throw on `[param]` segments.
describe('internal link hrefs', () => {
	const render_hrefs = (content: string): Array<string> =>
		hrefs(render(Mdz, { props: { content } }).body);

	test('keeps `(group)` segments', () => {
		assert.deepEqual(render_hrefs('see /a/(b)/c'), ['/a/(b)/c']);
	});

	test('keeps empty segments', () => {
		assert.deepEqual(render_hrefs('see /a//b and /a/b/'), ['/a//b', '/a/b/']);
	});

	test('keeps fragments and queries verbatim', () => {
		assert.deepEqual(render_hrefs('/docs#x /docs?y=1 /docs?y=1#x /docs#a//b /docs#/(g)'), [
			'/docs#x',
			'/docs?y=1',
			'/docs?y=1#x',
			'/docs#a//b',
			'/docs#/(g)'
		]);
	});

	test('keeps link-syntax references verbatim', () => {
		// (a `)` ends the link reference, so `(group)` segments are autolink-only)
		assert.deepEqual(render_hrefs('[x](/a//b?q=1#d//e)'), ['/a//b?q=1#d//e']);
	});

	test('collapses a leading `//` so the link stays under the base', () => {
		assert.deepEqual(render_hrefs('[x](//example.com/a)'), ['/example.com/a']);
	});

	test('renders the root path', () => {
		assert.deepEqual(render_hrefs('[home](/)'), ['/']);
	});

	test('keeps segments of relative paths resolved against `base`', () => {
		const body = render(MdzWithBase, {
			props: { content: 'see ./(b)/c and ../d', base: '/docs/(g)/' }
		}).body;
		assert.deepEqual(hrefs(body), ['/docs/(g)/(b)/c', '/docs/d']);
	});

	test('renders `[x]` and `[x+nn]` segments of hand-built trees without throwing', () => {
		for (const reference of ['/a/[x]', '/a/[[x]]', '/a/[...x]', '/docs/[x+2f]']) {
			const body = render(MdzNodes, { props: { nodes: link_tree(reference) } }).body;
			assert.deepEqual(hrefs(body), [reference]);
		}
	});

	test('streaming renderer matches', () => {
		assert.deepEqual(
			stream_hrefs('see /a/(b)/c and /a//b#x', (r) => r),
			['/a/(b)/c', '/a//b#x']
		);
		assert.deepEqual(
			stream_hrefs('see /a/x', () => '/a/[x]'),
			['/a/[x]']
		);
	});
});
