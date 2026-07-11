/**
 * SSR render tests for the runtime renderer (`Mdz` → `MdzNodeView`).
 *
 * The renderers previously had no test coverage at all — these bind the
 * component output to the parser across the full fixture corpus via
 * `svelte/server`'s `render` (no DOM environment needed).
 */

import {describe, test, assert, vi} from 'vitest';
import {render} from 'svelte/server';
import type {Component} from 'svelte';
import {DEV} from 'esm-env';

import MdzComponent from '$lib/Mdz.svelte';
import type {MdzComponents, MdzElements} from '$lib/mdz_contexts.ts';
import MdzRenderHarnessComponent from './MdzRenderHarness.svelte';
import EchoProp from './EchoProp.svelte';
import {load_fixtures} from './fixtures/mdz/mdz_test_helpers.ts';

// narrowed component type — the wrapper's `SvelteHTMLElements` rest-prop
// union is too complex for `render()`'s generic inference
const Mdz = MdzComponent as unknown as Component<{content: string}>;

// harness that provides the `elements`/`components` contexts around `Mdz`
const Harness = MdzRenderHarnessComponent as unknown as Component<{
	content: string;
	elements?: MdzElements;
	components?: MdzComponents;
}>;

describe('Mdz SSR rendering', () => {
	test('renders simple content', () => {
		const result = render(Mdz, {props: {content: 'hello **bold** and `code`'}});
		assert.include(result.body, '<strong>');
		assert.include(result.body, 'bold');
		assert.include(result.body, '<code>code</code>');
	});

	test('renders every mdz fixture without throwing', async () => {
		const fixtures = await load_fixtures();
		assert.isAbove(fixtures.length, 0);
		for (const fixture of fixtures) {
			const result = render(Mdz, {props: {content: fixture.input}});
			assert.isString(result.body, fixture.name);
		}
	});
});

describe('tag attributes', () => {
	test('renders an allowed element attribute', () => {
		const result = render(Harness, {
			props: {content: '<aside class="x">hi</aside>', elements: new Map([['aside', true]])},
		});
		assert.include(result.body, 'class="x"');
		assert.include(result.body, 'hi');
	});

	test('drops a disallowed element attribute (DEV-warns)', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const result = render(Harness, {
			props: {
				content: '<aside class="x" onclick="bad()">hi</aside>',
				elements: new Map([['aside', true]]),
			},
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
				'expected a DEV drop-warning naming the element and attribute',
			);
		}
	});

	test('renders a bare boolean allowed attribute', () => {
		const result = render(Harness, {
			props: {content: '<aside aria-hidden>x</aside>', elements: new Map([['aside', true]])},
		});
		assert.include(result.body, 'aria-hidden');
	});

	test('passes component attributes through as props', () => {
		const result = render(Harness, {
			props: {content: '<Echo msg="hi" />', components: new Map([['Echo', EchoProp]])},
		});
		assert.include(result.body, 'data-echo');
		assert.include(result.body, 'hi');
	});

	test('unregistered tag placeholder includes attribute text', () => {
		// no registry entry → the source-faithful literal placeholder
		const result = render(Harness, {props: {content: '<Foo bar="baz">x</Foo>'}});
		assert.include(result.body, 'bar="baz"');
	});

	test('capstone: nested Mdz renders pass-through content and inline boolean', () => {
		// mirrors the homepage demo — a `content` string prop and a bare `inline`
		// boolean pass through to a recursively-rendered `Mdz`, which renders
		// bold text inside an inline `<span>` (not a block `<div>`)
		const result = render(Harness, {
			props: {
				content: '<Mdz content="**hi**" inline />',
				components: new Map([['Mdz', MdzComponent]]),
			},
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
