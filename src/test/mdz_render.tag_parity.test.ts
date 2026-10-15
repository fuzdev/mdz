/**
 * Binds the streaming renderer's tag paths (`MdzStreamNodeView`) to the static
 * renderer's (`MdzNodeView`) at the rendered-HTML level, with registries set:
 * element attribute filtering, component prop filtering, the per-component
 * error boundary, and the unregistered-tag placeholder.
 *
 * `mdz_render.stream_parity.test.ts` skips every tag-bearing fixture (the
 * stream tree keeps a lone tag `<p>`-wrapped, where `mdz_parse` unwraps it), so
 * without this suite the stream view's tag branches would have no markup
 * coverage. Every input here keeps text beside its tags, so no paragraph holds
 * a lone tag and the wrapping difference never arises.
 */

import { describe, test, assert, vi } from 'vitest';
import { render } from 'svelte/server';
import type { Component } from 'svelte';

import MdzComponent from '#lib/Mdz.svelte';
import type { MdzComponents, MdzElements } from '#lib/mdz_contexts.ts';
import { MdzStreamParser } from '#lib/mdz_stream_parser.ts';
import { MdzStreamState } from '#lib/mdz_stream_state.svelte.ts';
import MdzRenderHarnessComponent from './MdzRenderHarness.svelte';
import MdzStreamRenderHarnessComponent from './MdzStreamRenderHarness.svelte';
import EchoProp from './EchoProp.svelte';
import LookupProp from './LookupProp.svelte';

interface Registries {
	elements?: MdzElements;
	components?: MdzComponents;
}

const Harness = MdzRenderHarnessComponent as unknown as Component<{ content: string } & Registries>;
const StreamHarness = MdzStreamRenderHarnessComponent as unknown as Component<
	{ stream: MdzStreamState } & Registries
>;

const REGISTRIES: Registries = {
	elements: new Map([
		['aside', true],
		['span', true],
		['br', true],
		['div', false]
	]),
	components: new Map<string, MdzComponents extends Map<string, infer V> ? V : never>([
		['Bare', EchoProp],
		['Listed', { component: EchoProp, props: ['msg'] }],
		['All', { component: EchoProp, props: 'all' }],
		['Lookup', { component: LookupProp, props: ['kind'] }],
		['Mdz', { component: MdzComponent, props: ['content', 'inline'] }]
	])
};

const INPUTS = [
	// elements: allowed, dropped, booleans, void, `false`-registered, unregistered
	'a <span class="x" aria-label="l">b</span> c',
	'a <span class="x" onclick="y()" style="color:red" id="i">b</span> c',
	'a <span aria-hidden title>b</span> c',
	'one<br class="a" />two',
	'a <div class="x">b</div> c',
	'a <section class="x">b</section> c',
	// components: bare (no props), listed, `'all'`, nested, unregistered
	'a <Bare msg="hi" /> c',
	'a <Listed msg="hi" style="x" /> c',
	'a <All msg="hi" other="x" /> c',
	'a <Mdz content="**hi**" inline /> c',
	'a <Unknown msg="hi">**b**</Unknown> c',
	// a throwing component falls back to its placeholder, children intact
	'a <Lookup kind="nope">**b**</Lookup> c',
	'a <Lookup kind="ok" /> c',
	// tags inside other block structure
	'- item <span class="x">b</span>\n- <Listed msg="hi" /> two',
	'> quote <span class="x">b</span> end',
	'| h |\n| - |\n| a <span class="x">b</span> c |'
];

const stream_state = (content: string): MdzStreamState => {
	const parser = new MdzStreamParser();
	parser.feed(content);
	parser.finish();
	const state = new MdzStreamState();
	state.apply_batch(parser.take_opcodes());
	return state;
};

const normalize = (body: string): string => body.replaceAll(/<!--.*?-->/gs, '');

// server boundaries only catch when the host passes `transformError`
const transformError = (e: unknown): unknown => e;

describe('MdzStream tag rendering matches Mdz', () => {
	for (const content of INPUTS) {
		test(content, () => {
			// the drop warnings and boundary error logs are expected noise here
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const error = vi.spyOn(console, 'error').mockImplementation(() => {});
			try {
				const expected = normalize(
					render(Harness, { props: { content, ...REGISTRIES }, transformError }).body
				);
				const actual = normalize(
					render(StreamHarness, {
						props: { stream: stream_state(content), ...REGISTRIES },
						transformError
					}).body
				);
				assert.equal(actual, expected);
			} finally {
				warn.mockRestore();
				error.mockRestore();
			}
		});
	}
});
