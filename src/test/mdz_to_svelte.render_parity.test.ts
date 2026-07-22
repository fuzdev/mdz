/**
 * Render parity: `mdz_to_svelte`'s generated markup must match what the
 * runtime renderer (`Mdz` → `MdzNodeView`) actually produces.
 *
 * The render semantics live in three hand-synced implementations
 * (`MdzNodeView.svelte`, `MdzStreamNodeView.svelte`, `mdz_to_svelte.ts`);
 * the other suites bind trees and preprocessor output, but nothing else
 * compares the *markup*. This suite SSRs every fixture through `Mdz` and
 * normalizes `mdz_to_svelte`'s Svelte-template output to the equivalent
 * HTML, then diffs.
 *
 * Scope: the plain default configuration (no components/elements, plain
 * code/codeblock). Fixtures with unconfigured tags are skipped — the two
 * implementations intentionally diverge there (`mdz_to_svelte` emits
 * nothing and sets `has_unconfigured_tags`; the runtime renders the
 * unregistered-tag fallback).
 */

import { describe, test, assert } from 'vitest';
import { render } from 'svelte/server';
import type { Component } from 'svelte';

import MdzComponent from '$lib/Mdz.svelte';
import { mdz_parse } from '$lib/mdz.ts';
import { mdz_to_svelte } from '$lib/mdz_to_svelte.ts';
import { load_fixtures } from './fixtures/mdz/mdz_test_helpers.ts';

// narrowed component type — the wrapper's `SvelteHTMLElements` rest-prop
// union is too complex for `render()`'s generic inference
const Mdz = MdzComponent as unknown as Component<{ content: string }>;

// escape_svelte_text's brace escapes — the only source of these forms in
// generated markup (attr expression strings never contain braces: references
// are valid-path-chars only, heading ids are slugs)
const TEXT_OPEN_BRACE = /\{'\{'\}/g;
const TEXT_CLOSE_BRACE = /\{'\}'\}/g;

const js_unescape = (s: string): string => s.replaceAll(/\\(.)/g, '$1');
const attr_escape = (s: string): string => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;');

/**
 * Convert `mdz_to_svelte` output (Svelte template markup, plain default
 * config) to the HTML the equivalent runtime template server-renders.
 * `resolve()` is the identity here — the test env has no SvelteKit base.
 */
const svelte_markup_to_html = (markup: string): string =>
	markup
		// sentinel the text-level brace escapes so attr regexes can't misfire
		.replaceAll(TEXT_OPEN_BRACE, '\u0001')
		.replaceAll(TEXT_CLOSE_BRACE, '\u0002')
		.replaceAll(
			/=\{resolve\('((?:[^'\\]|\\.)*)'\)\}/g,
			(_, s: string) => `="${attr_escape(js_unescape(s))}"`
		)
		.replaceAll(/=\{'((?:[^'\\]|\\.)*)'\}/g, (_, s: string) => `="${attr_escape(js_unescape(s))}"`)
		.replaceAll(/=\{(\d+)\}/g, '="$1"')
		// Svelte SSR prints self-closing void elements without the space
		.replaceAll('<hr />', '<hr/>')
		.replaceAll('\u0001', '{')
		.replaceAll('\u0002', '}');

/** SSR body → the wrapper div's inner HTML with hydration comments stripped. */
const ssr_inner_html = (body: string): string => {
	const stripped = body.replaceAll(/<!--.*?-->/gs, '');
	assert.isTrue(stripped.startsWith('<div>') && stripped.endsWith('</div>'), 'wrapper div');
	return stripped.slice('<div>'.length, -'</div>'.length);
};

describe('mdz_to_svelte matches the runtime renderer', () => {
	test('all fixtures (plain default config)', async () => {
		const fixtures = await load_fixtures();
		const failures: Array<string> = [];
		let compared = 0;
		for (const fixture of fixtures) {
			const result = mdz_to_svelte(mdz_parse(fixture.input), { components: {}, elements: {} });
			if (result.has_unconfigured_tags) continue; // intentional divergence — see module docs
			const expected = svelte_markup_to_html(result.markup);
			const actual = ssr_inner_html(render(Mdz, { props: { content: fixture.input } }).body);
			if (expected !== actual) {
				failures.push(`${fixture.name}:\n  markup→ ${expected}\n  ssr→    ${actual}`);
			}
			compared++;
		}
		// the corpus is mostly tag-free — a low count means the skip filter broke
		assert.isAbove(compared, 300, 'compared fixture count');
		assert.deepEqual(failures.slice(0, 5), [], `${failures.length} of ${compared} diverge`);
	});
});
