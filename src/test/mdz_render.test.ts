/**
 * SSR render tests for the runtime renderer (`Mdz` → `MdzNodeView`).
 *
 * The renderers previously had no test coverage at all — these bind the
 * component output to the parser across the full fixture corpus via
 * `svelte/server`'s `render` (no DOM environment needed).
 */

import { describe, test, assert, vi } from 'vitest';
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import { DEV } from 'esm-env';

import MdzComponent from '#lib/Mdz.svelte';
import MdzStreamComponent from '#lib/MdzStream.svelte';
import type { MdzNode } from '#lib/mdz.ts';
import type { MdzComponents, MdzElements } from '#lib/mdz_contexts.ts';
import { MdzStreamParser } from '#lib/mdz_stream_parser.ts';
import { MdzStreamState } from '#lib/mdz_stream_state.svelte.ts';
import MdzRenderHarnessComponent from './MdzRenderHarness.svelte';
import EchoProp from './EchoProp.svelte';
import LookupProp from './LookupProp.svelte';
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

// harness that provides the `elements`/`components` contexts around `Mdz`
const Harness = MdzRenderHarnessComponent as unknown as Component<{
	content: string;
	elements?: MdzElements;
	components?: MdzComponents;
}>;

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

describe('tag attributes', () => {
	test('renders an allowed element attribute', () => {
		const result = render(Harness, {
			props: { content: '<aside class="x">hi</aside>', elements: new Map([['aside', true]]) }
		});
		assert.include(result.body, 'class="x"');
		assert.include(result.body, 'hi');
	});

	test('an element registered with `false` falls back to a literal placeholder', () => {
		// only `true` enables an element — a `false` value is treated as
		// unregistered, so the tag renders as source-faithful literal text
		// (attributes included) rather than a real `<aside>`
		const result = render(Harness, {
			props: { content: '<aside class="x">hi</aside>', elements: new Map([['aside', false]]) }
		});
		assert.notInclude(result.body, '<aside');
		assert.include(result.body, '&lt;aside class="x">');
	});

	test('drops a disallowed element attribute (DEV-warns)', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const result = render(Harness, {
			props: {
				content: '<aside class="x" onclick="bad()">hi</aside>',
				elements: new Map([['aside', true]])
			}
		});
		// `render()` is lazy — force the body (which runs the filter + its warn)
		// while the spy is active, then snapshot the calls before `mockRestore`
		const body = result.body;
		const warned = warn.mock.calls.map((c) => String(c[0]));
		warn.mockRestore();
		assert.include(body, 'class="x"');
		assert.notInclude(body, 'onclick');
		// the drop is a policy outcome surfaced as a DEV console.warn naming the
		// element and the dropped attribute (silent in prod)
		if (DEV) {
			assert.ok(
				warned.some((m) => m.includes('aside') && m.includes('onclick')),
				'expected a DEV drop-warning naming the element and attribute'
			);
		}
	});

	test('renders a bare boolean allowed attribute', () => {
		const result = render(Harness, {
			props: { content: '<aside aria-hidden>x</aside>', elements: new Map([['aside', true]]) }
		});
		assert.include(result.body, 'aria-hidden');
	});

	test('passes registered props through to a component', () => {
		const result = render(Harness, {
			props: {
				content: '<Echo msg="hi" />',
				components: new Map([['Echo', { component: EchoProp, props: ['msg'] }]])
			}
		});
		assert.include(result.body, 'data-echo');
		assert.include(result.body, 'hi');
	});

	test('a bare component entry receives no attributes (DEV-warns)', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const result = render(Harness, {
			props: { content: '<Echo msg="hi" />', components: new Map([['Echo', EchoProp]]) }
		});
		const body = result.body;
		const warned = warn.mock.calls.map((c) => String(c[0]));
		warn.mockRestore();
		assert.include(body, 'data-echo');
		assert.notInclude(body, 'hi');
		if (DEV) {
			assert.ok(warned.some((m) => m.includes('Echo') && m.includes('msg')));
		}
	});

	test('drops component attributes outside the registered props', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const result = render(Harness, {
			props: {
				content: '<Echo msg="hi" style="color:red" />',
				components: new Map([['Echo', { component: EchoProp, props: ['msg'] }]])
			}
		});
		const body = result.body;
		warn.mockRestore();
		assert.include(body, 'hi');
		assert.notInclude(body, 'color:red');
	});

	test("`props: 'all'` passes every attribute through", () => {
		const result = render(Harness, {
			props: {
				content: '<Echo msg="hi" other="x" />',
				components: new Map([['Echo', { component: EchoProp, props: 'all' as const }]])
			}
		});
		assert.include(result.body, 'hi');
	});

	test('a component that throws renders its literal placeholder', () => {
		// server boundaries only catch when the host passes `transformError`
		// (SvelteKit does); browsers always catch
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const result = render(Harness, {
			props: {
				content: 'before <Lookup kind="nope">child **text**</Lookup> after',
				components: new Map([['Lookup', { component: LookupProp, props: ['kind'] }]])
			},
			transformError: (e: unknown) => e
		});
		const body = result.body.replaceAll(/<!--.*?-->/gs, '');
		error.mockRestore();
		assert.notInclude(body, 'data-lookup');
		assert.include(body, '&lt;Lookup kind="nope">');
		assert.include(body, '<strong>text</strong>');
		assert.include(body, 'before');
		assert.include(body, 'after');
	});

	test('a component that renders fine is unaffected by its boundary', () => {
		const result = render(Harness, {
			props: {
				content: '<Lookup kind="ok" />',
				components: new Map([['Lookup', { component: LookupProp, props: ['kind'] }]])
			},
			transformError: (e: unknown) => e
		});
		assert.include(result.body, 'all good');
	});

	test('unregistered tag placeholder includes attribute text', () => {
		// no registry entry → the source-faithful literal placeholder
		const result = render(Harness, { props: { content: '<Foo bar="baz">x</Foo>' } });
		assert.include(result.body, 'bar="baz"');
	});

	test('capstone: nested Mdz renders pass-through content and inline boolean', () => {
		// mirrors the homepage demo — a `content` string prop and a bare `inline`
		// boolean pass through to a recursively-rendered `Mdz`, which renders
		// bold text inside an inline `<span>` (not a block `<div>`)
		const result = render(Harness, {
			props: {
				content: '<Mdz content="**hi**" inline />',
				components: new Map([['Mdz', { component: MdzComponent, props: ['content', 'inline'] }]])
			}
		});
		// SSR interleaves `<!---->` markers, so assert structure not an exact
		// `<strong>hi</strong>` slice: bold text is present, and a `<span>` (the
		// inline wrapper, not a block `<div>`) encloses the recursively-rendered
		// bold
		assert.include(result.body, '<strong>');
		assert.include(result.body, 'hi');
		assert.match(result.body, /<span>[\s\S]*?<strong>[\s\S]*?hi/);
	});
});
