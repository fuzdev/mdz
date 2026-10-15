/**
 * Attribute render parity: `mdz_to_svelte`'s element attribute and component
 * prop emission must server-render identically to the runtime views' spread.
 *
 * `mdz_to_svelte.render_parity.test.ts` normalizes generated markup to HTML
 * with regexes, which can't model how Svelte renders an attribute (a bare
 * `aria-hidden` compiles to `aria-hidden=""`, a spread `true` renders
 * `aria-hidden="true"`), and it skips tag-bearing fixtures anyway. This suite
 * instead compiles the generated markup with the Svelte compiler, renders it,
 * and diffs against the runtime renderer's SSR, so attribute semantics are
 * Svelte's own on both sides. Component cases import a real test component by
 * absolute path, so prop filtering is compared through what it renders.
 */

import { describe, test, assert, beforeAll, afterAll, vi } from 'vitest';
import { render } from 'svelte/server';
import { compile } from 'svelte/compiler';
import type { Component } from 'svelte';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { mdz_parse } from '#lib/mdz.ts';
import { mdz_to_svelte, type MdzToSvelteResult } from '#lib/mdz_to_svelte.ts';
import MdzRenderHarnessComponent from './MdzRenderHarness.svelte';
import type { MdzComponents, MdzElements } from '#lib/mdz_contexts.ts';
import EchoProp from './EchoProp.svelte';

const Harness = MdzRenderHarnessComponent as unknown as Component<{
	content: string;
	elements?: MdzElements;
}>;

const ComponentHarness = MdzRenderHarnessComponent as unknown as Component<{
	content: string;
	components?: MdzComponents;
}>;

const ELEMENT_NAMES = ['aside', 'span', 'br'];

// each input renders through allowed, dropped, string, and bare-boolean paths
const INPUTS = [
	'<aside class="box">hi</aside>',
	'<aside aria-hidden>hi</aside>',
	'<aside aria-hidden="false" role="note">hi</aside>',
	'<aside title>hi</aside>',
	'<aside title="">hi</aside>',
	'<aside class="box" onclick="x()" style="color:red" id="y">hi</aside>',
	`<aside title='say "hi"' lang="en" dir="rtl">hi</aside>`,
	'<aside title="a & b < c > d {e}">hi</aside>',
	'<aside title="\\ backslash \' quote">hi</aside>',
	'a <span class="x" aria-label="label">b</span> c',
	'one<br class="a" />two',
	'<aside class="outer">**bold** <span class="inner">x</span></aside>'
];

let dir: string;
let n = 0;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), 'mdz_attr_parity_'));
});
afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

/**
 * Compiles Svelte markup to a server component and imports it, with `imports`
 * (from `MdzToSvelteResult`) as the component's default imports.
 */
const load_markup_component = async (
	markup: string,
	imports: MdzToSvelteResult['imports'] = new Map()
): Promise<Component> => {
	const script = Array.from(imports, ([name, { path }]) => `import ${name} from '${path}';`).join(
		'\n'
	);
	const { js } = compile(`<script>${script}</script><div>${markup}</div>`, {
		generate: 'server',
		dev: false
	});
	// the compiled module imports `svelte/...`, which won't resolve from the
	// temp dir — rewrite each specifier to its resolved absolute URL
	const code = js.code.replaceAll(
		/from '(svelte\/[^']+)'/g,
		(_, specifier: string) => `from '${import.meta.resolve(specifier)}'`
	);
	const path = join(dir, `component_${n++}.js`);
	await writeFile(path, code);
	return ((await import(/* @vite-ignore */ pathToFileURL(path).href)) as { default: Component })
		.default;
};

// strips hydration comments, and the `/` a static void element serializes with
// (`<br/>`) that `<svelte:element>` omits — equivalent HTML
const normalize = (body: string): string =>
	body.replaceAll(/<!--.*?-->/gs, '').replaceAll(/<(br|hr)([^>]*?)\/>/g, '<$1$2>');

describe('mdz_to_svelte attributes match the runtime renderer', () => {
	for (const input of INPUTS) {
		test(input, async () => {
			const result = mdz_to_svelte(mdz_parse(input), {
				components: {},
				elements: Object.fromEntries(ELEMENT_NAMES.map((name) => [name, true]))
			});
			assert.isFalse(result.has_unconfigured_tags);
			const Precompiled = await load_markup_component(result.markup);
			const expected = normalize(render(Precompiled).body);
			const actual = normalize(
				render(Harness, {
					props: {
						content: input,
						elements: new Map(ELEMENT_NAMES.map((name) => [name, true]))
					}
				}).body
			);
			assert.equal(expected, actual);
		});
	}
});

// test components by absolute path, so the compiled temp module can import them
const ECHO_PATH = fileURLToPath(new URL('./EchoProp.svelte', import.meta.url));

const COMPONENT_INPUTS = [
	'<Bare msg="hi" />',
	'<Listed msg="hi" style="x" />',
	'<Listed msg="hi" />',
	'<All msg="hi" other="x" />',
	'<All msg />',
	`<Listed msg='a "quoted" {braced} \\ value' />`,
	'a <Listed msg="hi">**child**</Listed> b'
];

describe('mdz_to_svelte component props match the runtime renderer', () => {
	for (const input of COMPONENT_INPUTS) {
		test(input, async () => {
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
			try {
				const result = mdz_to_svelte(mdz_parse(input), {
					components: {
						Bare: ECHO_PATH,
						Listed: { path: ECHO_PATH, props: ['msg'] },
						All: { path: ECHO_PATH, props: 'all' }
					},
					elements: {}
				});
				assert.isFalse(result.has_unconfigured_tags);
				const Precompiled = await load_markup_component(result.markup, result.imports);
				const expected = normalize(render(Precompiled).body);
				const actual = normalize(
					render(ComponentHarness, {
						props: {
							content: input,
							components: new Map<string, MdzComponents extends Map<string, infer V> ? V : never>([
								['Bare', EchoProp],
								['Listed', { component: EchoProp, props: ['msg'] }],
								['All', { component: EchoProp, props: 'all' }]
							])
						}
					}).body
				);
				assert.equal(expected, actual);
			} finally {
				warn.mockRestore();
			}
		});
	}
});
