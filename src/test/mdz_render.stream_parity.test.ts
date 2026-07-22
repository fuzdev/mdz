/**
 * Binds the streaming renderer (`MdzStream`/`MdzStreamNodeView`) to the static
 * renderer (`Mdz`/`MdzNodeView`) at the rendered-HTML level: every fixture is
 * SSR'd through both and the normalized markup is diffed. Closes the gap that
 * `MdzStreamNodeView` otherwise has no committed correctness test — tree parity
 * (`mdz_parser_parity.test.ts`) binds opcode/tree output, not rendered HTML, so
 * a markup-only divergence in the stream view (a missed attribute, wrong tag)
 * would pass CI without this.
 *
 * Skipped: fixtures whose tree contains an `Element`/`Component` node.
 * `MdzStreamState` deliberately does NOT apply the MDX single-tag-paragraph
 * unwrap (`mdz_extract_single_tag`) that `mdz_parse`/`mdz_opcodes_to_nodes` do —
 * it keeps per-id node identity for granular streaming updates — so a lone tag
 * paragraph child stays `<p>`-wrapped in the stream tree, a real HTML difference.
 * The coarse skip over-skips (not every tag node is a sole paragraph child) but
 * is simple and safe; the tag-rendering paths stay covered by the SSR corpus in
 * `mdz_render.test.ts` and the tree-level parity suite.
 */

import { describe, test, assert } from 'vitest';
import { render } from 'svelte/server';
import type { Component } from 'svelte';

import MdzComponent from '$lib/Mdz.svelte';
import MdzStreamComponent from '$lib/MdzStream.svelte';
import { MdzStreamParser } from '$lib/mdz_stream_parser.ts';
import { MdzStreamState } from '$lib/mdz_stream_state.svelte.ts';
import type { MdzNode } from '$lib/mdz.ts';
import { load_fixtures } from './fixtures/mdz/mdz_test_helpers.ts';

const Mdz = MdzComponent as unknown as Component<{ content: string }>;
const MdzStream = MdzStreamComponent as unknown as Component<{ stream: MdzStreamState }>;

/** Strip hydration comments and unwrap the `<div>…</div>` SSR wrapper. */
const ssr_inner_html = (body: string): string => {
	const stripped = body.replaceAll(/<!--.*?-->/gs, '');
	assert.isTrue(stripped.startsWith('<div>') && stripped.endsWith('</div>'), 'wrapper div');
	return stripped.slice('<div>'.length, -'</div>'.length);
};

const stream_ssr = (content: string): string => {
	const parser = new MdzStreamParser();
	parser.feed(content);
	parser.finish();
	const state = new MdzStreamState();
	state.apply_batch(parser.take_opcodes());
	return ssr_inner_html(render(MdzStream, { props: { stream: state } }).body);
};

/** See the module comment — the stream tree keeps lone tags `<p>`-wrapped. */
const has_tag_node = (nodes: Array<MdzNode>): boolean =>
	nodes.some(
		(n) =>
			n.type === 'Component' ||
			n.type === 'Element' ||
			('children' in n && has_tag_node(n.children))
	);

describe('Mdz vs MdzStream SSR parity', () => {
	test('every fixture renders identical HTML statically and streamed', async () => {
		const fixtures = await load_fixtures();
		const failures: Array<string> = [];
		let compared = 0;
		for (const fixture of fixtures) {
			if (has_tag_node(fixture.expected)) continue;
			const static_html = ssr_inner_html(render(Mdz, { props: { content: fixture.input } }).body);
			const stream_html = stream_ssr(fixture.input);
			if (static_html !== stream_html) {
				failures.push(`${fixture.name}:\n  static→ ${static_html}\n  stream→ ${stream_html}`);
			}
			compared++;
		}
		assert.isAbove(compared, 400, 'compared fixture count');
		assert.deepEqual(failures.slice(0, 5), [], `${failures.length} of ${compared} diverge`);
	});
});
