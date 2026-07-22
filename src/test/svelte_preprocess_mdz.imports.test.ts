import { test, assert, describe } from 'vitest';

import {
	run_preprocess,
	DEFAULT_TEST_OPTIONS
} from './fixtures/svelte_preprocess_mdz/svelte_preprocess_mdz_test_helpers.ts';

describe('import addition', () => {
	test('adds DocsLink import for inline code', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="\`some_fn\`" />`;

		const result = await run_preprocess(input);
		assert.ok(
			result.includes("import DocsLink from '@fuzdev/fuz_ui/DocsLink.svelte'"),
			'should add DocsLink import'
		);
	});

	test('adds Code import for codeblocks', async () => {
		const input =
			'<script lang="ts">\n\timport Mdz from \'@fuzdev/mdz/Mdz.svelte\';\n</script>\n\n<Mdz content={`\\`\\`\\`ts\nconst x = 1;\n\\`\\`\\``} />';

		const result = await run_preprocess(input);
		assert.ok(
			result.includes("import Code from '@fuzdev/fuz_code/Code.svelte'"),
			'should add Code import'
		);
	});

	test('adds resolve import for internal links', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="[docs](/docs/foo)" />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes("import {resolve} from '$app/paths'"), 'should add resolve import');
		assert.ok(result.includes("resolve('/docs/foo')"), 'should use resolve for internal link');
	});

	test('does not add resolve import for fragment links', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="[section](#foo)" />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes("href={'#foo'}"), 'should use fragment href directly');
		assert.ok(!result.includes('resolve'), 'should not import resolve for fragment links');
	});

	test('adds component import from config', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="<Alert>warning</Alert>" />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes("import Alert from '$lib/Alert.svelte'"), 'should add Alert import');
	});
});

describe('import deduplication', () => {
	test('does not duplicate existing imports', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	import DocsLink from '@fuzdev/fuz_ui/DocsLink.svelte';
</script>

<Mdz content="\`some_fn\`" />`;

		const result = await run_preprocess(input);
		const matches = result.match(/import DocsLink/g);
		assert.equal(matches?.length, 1, 'should not duplicate DocsLink import');
	});

	test('merges imports across multiple transformations', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="\`fn_a\`" />
<Mdz content="\`fn_b\`" />`;

		const result = await run_preprocess(input);
		const matches = result.match(/import DocsLink/g);
		assert.equal(matches?.length, 1, 'should add DocsLink only once');
	});

	test('skips silently on name collision from different source', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	import DocsLink from './local/DocsLink.svelte';
</script>

<Mdz content="\`some_fn\`" />`;

		const result = await run_preprocess(input);
		// DocsLink already imported from a different source — preprocessor should not add a duplicate
		const matches = result.match(/import DocsLink/g);
		assert.equal(matches?.length, 1, 'should not add conflicting DocsLink import');
		// The existing import from the different source should be preserved
		assert.ok(
			result.includes("import DocsLink from './local/DocsLink.svelte'"),
			'should keep existing DocsLink import'
		);
	});
});

describe('script handling', () => {
	test('handles module-only script by adding instance script', async () => {
		const input = `<script module>
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="\`some_fn\`" />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes("<DocsLink reference={'some_fn'} />"), 'should render DocsLink');
		assert.ok(result.includes('import DocsLink'), 'should add DocsLink import');
		assert.ok(result.includes('<script lang="ts">'), 'should create instance script');
	});

	test('module-only: instance script appears after module script', async () => {
		const input = `<script module>
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="\`some_fn\`" />`;

		const result = await run_preprocess(input);
		const module_pos = result.indexOf('<script module>');
		const instance_pos = result.indexOf('<script lang="ts">');
		assert.ok(instance_pos > module_pos, 'instance script should come after module script');
	});

	test('bail out when file has no Mdz import string', async () => {
		// This tests the quick bail-out path — file doesn't even mention
		// the import source string, so no AST parsing happens.
		const input = `<Mdz content="**bold**" />`;
		const result = await run_preprocess(input);
		assert.equal(result, input, 'should be unchanged without Mdz import source');
	});
});

describe('import resolution', () => {
	test('handles renamed import', async () => {
		const input = `<script lang="ts">
	import Markdown from '@fuzdev/mdz/Mdz.svelte';
</script>

<Markdown content="**bold**" />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes('<strong>bold</strong>'), 'should transform renamed Mdz');
	});

	test('handles import in module script block', async () => {
		const input = `<script module>
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="**bold**" />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes('<strong>bold</strong>'), 'should transform');
	});

	test('respects custom mdz_component_imports', async () => {
		const input = `<script lang="ts">
	import Mdz from '$lib/Mdz.svelte';
</script>

<Mdz content="**bold**" />`;

		const result = await run_preprocess(input, {
			...DEFAULT_TEST_OPTIONS,
			mdz_component_imports: ['$lib/Mdz.svelte']
		});
		assert.ok(result.includes('<strong>bold</strong>'), 'should transform with custom import');
	});

	test('handles multiple Mdz aliases in same file', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	import {default as Markdown} from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="**bold**" />
<Markdown content="_italic_" />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes('<strong>bold</strong>'), 'should transform Mdz');
		assert.ok(result.includes('<em>italic</em>'), 'should transform Markdown alias');
	});
});

describe('import removal', () => {
	test('removes Mdz import when all usages transformed', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="**bold**" />`;

		const result = await run_preprocess(input);
		assert.ok(!result.includes('import Mdz from'), 'should remove Mdz import');
		assert.ok(result.includes('import MdzPrecompiled from'), 'should add MdzPrecompiled import');
		assert.ok(result.includes('<MdzPrecompiled>'), 'should use MdzPrecompiled tag');
	});

	test('keeps Mdz import when mixed static and dynamic usages', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	let dynamic = $state('text');
</script>

<Mdz content="**bold**" />
<Mdz content={dynamic} />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes('import Mdz from'), 'should keep Mdz import for dynamic usage');
		assert.ok(result.includes('import MdzPrecompiled from'), 'should add MdzPrecompiled import');
	});

	test('keeps Mdz import when referenced in script', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	const X = Mdz;
</script>

<Mdz content="**bold**" />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes('import Mdz from'), 'should keep Mdz import for script reference');
	});

	test('keeps Mdz import when referenced in template expression', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	import Foo from './Foo.svelte';
</script>

<Mdz content="**bold**" />
<Foo comp={Mdz} />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes('import Mdz from'), 'should keep Mdz import for template expression');
	});

	test('bails on entire file when MdzPrecompiled name is already imported', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	import MdzPrecompiled from './other/MdzPrecompiled.svelte';
</script>

<Mdz content="**bold**" />`;

		const result = await run_preprocess(input);
		assert.equal(result, input, 'should bail when MdzPrecompiled name collides');
	});

	test('removes multiple Mdz aliases when all transformed', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	import {default as Markdown} from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="**bold**" />
<Markdown content="_italic_" />`;

		const result = await run_preprocess(input);
		assert.ok(!result.includes('import Mdz from'), 'should remove Mdz import');
		assert.ok(!result.includes('import {default as Markdown}'), 'should remove Markdown import');
		assert.ok(result.includes('import MdzPrecompiled from'), 'should add MdzPrecompiled import');
	});

	test('removes only fully transformed alias when partial', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	import {default as Markdown} from '@fuzdev/mdz/Mdz.svelte';
	let dynamic = $state('text');
</script>

<Mdz content="**bold**" />
<Markdown content={dynamic} />`;

		const result = await run_preprocess(input);
		assert.ok(!result.includes('import Mdz from'), 'should remove Mdz (all transformed)');
		assert.ok(
			result.includes('import {default as Markdown}'),
			'should keep Markdown (has dynamic)'
		);
	});

	test('output uses MdzPrecompiled regardless of original import name', async () => {
		const input = `<script lang="ts">
	import Markdown from '@fuzdev/mdz/Mdz.svelte';
</script>

<Markdown content="**bold**" />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes('<MdzPrecompiled>'), 'should use MdzPrecompiled not Markdown');
		assert.ok(!result.includes('<Markdown>'), 'should not use original alias');
	});

	test('removes import cleanly without extra whitespace', async () => {
		const input = `<script lang="ts">
	import Wrapper from './Wrapper.svelte';
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	import Other from './Other.svelte';
</script>

<Mdz content="**bold**" />`;

		const result = await run_preprocess(input);
		assert.ok(!result.includes('\n\n\n'), 'should not leave extra whitespace');
		assert.ok(result.includes('import Wrapper'), 'should keep Wrapper import');
		assert.ok(result.includes('import Other'), 'should keep Other import');
	});

	test('partially removes Mdz from multi-specifier import when all usages transformed', async () => {
		const input = `<script lang="ts">
	import Mdz, {something} from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="**bold**" />`;

		const result = await run_preprocess(input);
		assert.ok(!result.includes('import Mdz,'), 'should remove Mdz default specifier');
		assert.ok(
			result.includes("import {something} from '@fuzdev/mdz/Mdz.svelte'"),
			'should keep remaining specifier'
		);
		assert.ok(result.includes('import MdzPrecompiled from'), 'should add MdzPrecompiled import');
	});

	test('removes default from import Mdz, {MdzNode}', async () => {
		const input = `<script lang="ts">
	import Mdz, {MdzNode} from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="**bold**" />`;

		const result = await run_preprocess(input);
		assert.ok(
			result.includes("import {MdzNode} from '@fuzdev/mdz/Mdz.svelte'"),
			'should keep named import'
		);
		assert.ok(!result.includes('import Mdz,'), 'should remove default import');
	});

	test('removes named from import {default as Mdz, MdzNode}', async () => {
		const input = `<script lang="ts">
	import {default as Mdz, MdzNode} from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="**bold**" />`;

		const result = await run_preprocess(input);
		assert.ok(
			result.includes("import {MdzNode} from '@fuzdev/mdz/Mdz.svelte'"),
			'should keep MdzNode import'
		);
		assert.ok(!result.includes('default as Mdz'), 'should remove Mdz alias');
	});

	test('partial removal bundles additional imports via carrier', async () => {
		const input = `<script lang="ts">
	import Mdz, {something} from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="\`some_fn\`" />`;

		const result = await run_preprocess(input);
		assert.ok(
			result.includes("import {something} from '@fuzdev/mdz/Mdz.svelte'"),
			'should keep remaining specifier'
		);
		assert.ok(result.includes('import MdzPrecompiled from'), 'should add MdzPrecompiled import');
		assert.ok(
			result.includes("import DocsLink from '@fuzdev/fuz_ui/DocsLink.svelte'"),
			'should add DocsLink import via carrier'
		);
	});

	test('partial removal works when not the last import', async () => {
		const input = `<script lang="ts">
	import Mdz, {something} from '@fuzdev/mdz/Mdz.svelte';
	import Other from 'other-pkg';
</script>

<Mdz content="**bold**" />`;

		const result = await run_preprocess(input);
		assert.ok(
			result.includes("import {something} from '@fuzdev/mdz/Mdz.svelte'"),
			'should keep remaining specifier'
		);
		assert.ok(result.includes('import Other'), 'should keep Other import');
		assert.ok(result.includes('import MdzPrecompiled from'), 'should add MdzPrecompiled import');
	});

	test('removes Mdz import from module script when all transformed', async () => {
		const input = `<script module>
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="**bold**" />`;

		const result = await run_preprocess(input);
		assert.ok(!result.includes('import Mdz from'), 'should remove Mdz import from module script');
		assert.ok(result.includes('import MdzPrecompiled from'), 'should add MdzPrecompiled import');
	});

	test('removes Mdz import when only usage is a transformed ternary', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	let show = $state(true);
</script>

<Mdz content={show ? '**a**' : '**b**'} />`;

		const result = await run_preprocess(input);
		assert.ok(!result.includes('import Mdz from'), 'should remove Mdz import');
		assert.ok(result.includes('import MdzPrecompiled from'), 'should add MdzPrecompiled import');
	});

	test('keeps Mdz import when ternary coexists with dynamic usage', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	let show = $state(true);
	let dynamic = $state('text');
</script>

<Mdz content={show ? '**a**' : '**b**'} />
<Mdz content={dynamic} />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes('import Mdz from'), 'should keep Mdz import for dynamic usage');
		assert.ok(result.includes('import MdzPrecompiled from'), 'should add MdzPrecompiled import');
		assert.ok(result.includes('{#if show}'), 'should transform ternary');
	});

	test('merges imports from both ternary branches', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	let show = $state(true);
</script>

<Mdz content={show ? '\`fn_a\`' : '[link](/docs)'} />`;

		const result = await run_preprocess(input);
		assert.ok(
			result.includes("import DocsLink from '@fuzdev/fuz_ui/DocsLink.svelte'"),
			'should add DocsLink import from consequent branch'
		);
		assert.ok(
			result.includes("import {resolve} from '$app/paths'"),
			'should add resolve import from alternate branch'
		);
	});
});
