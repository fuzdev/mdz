import { preprocess } from 'svelte/compiler';

import {
	svelte_preprocess_mdz,
	type SveltePreprocessMdzOptions
} from '$lib/svelte_preprocess_mdz.ts';
import { load_fixtures_generic } from '../../test_helpers.ts';

/**
 * Default options used by most fixture and behavioral tests. Models a fully
 * configured consumer (like the docs site): inline code renders via fuz_ui's
 * `DocsLink` and code blocks via fuz_code's `Code`. `mdz_to_svelte.test.ts`
 * covers the unconfigured plain `<code>` / `<pre><code>` defaults.
 */
export const DEFAULT_TEST_OPTIONS = {
	components: { Alert: '$lib/Alert.svelte', Card: '$lib/Card.svelte' },
	elements: { aside: true, details: true, summary: true, br: true },
	compiled_component_import: '$lib/MdzPrecompiled.svelte',
	code_component_import: '@fuzdev/fuz_ui/DocsLink.svelte',
	codeblock_component_import: '@fuzdev/fuz_code/Code.svelte'
} satisfies SveltePreprocessMdzOptions;

export interface PreprocessMdzFixture {
	name: string;
	input: string;
	expected: { code: string };
}

/** Load all fixtures from the svelte_preprocess_mdz fixtures directory. */
export const load_fixtures = async (): Promise<Array<PreprocessMdzFixture>> =>
	load_fixtures_generic<{ code: string }>({
		fixtures_dir: import.meta.dirname,
		input_extension: '.svelte'
	});

/** Run the preprocessor on input and return the transformed code. */
export const run_preprocess = async (
	input: string,
	options: SveltePreprocessMdzOptions = DEFAULT_TEST_OPTIONS,
	filename = 'Test.svelte'
): Promise<string> => {
	const result = await preprocess(input, [svelte_preprocess_mdz(options)], { filename });
	return result.code;
};
