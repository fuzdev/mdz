import {test, assert, describe, vi} from 'vitest';

import {
	run_preprocess,
	DEFAULT_TEST_OPTIONS,
} from './fixtures/svelte_preprocess_mdz/svelte_preprocess_mdz_test_helpers.ts';

describe('dynamic content preservation', () => {
	test('preserves variable reference', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	let content = $state('**bold**');
</script>

<Mdz content={content} />`;

		const result = await run_preprocess(input);
		assert.equal(result, input, 'should be unchanged for dynamic content');
	});

	test('preserves template literal with interpolation', async () => {
		const input =
			"<script lang=\"ts\">\n\timport Mdz from '@fuzdev/mdz/Mdz.svelte';\n\tlet value = 'x';\n</script>\n\n<Mdz content={`**${value}**`} />";

		const result = await run_preprocess(input);
		assert.equal(result, input, 'should be unchanged for dynamic content');
	});

	test('preserves ternary with one dynamic branch', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	let dynamic = $state('**x**');
	let show = $state(true);
</script>

<Mdz content={show ? dynamic : '**b**'} />`;

		const result = await run_preprocess(input);
		assert.equal(result, input, 'should be unchanged when one branch is dynamic');
	});

	test('preserves function call expression', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	const get_content = () => '**bold**';
</script>

<Mdz content={get_content()} />`;

		const result = await run_preprocess(input);
		assert.equal(result, input, 'should be unchanged for dynamic content');
	});

	test('preserves $state rune const', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	const content = $state('**bold**');
</script>

<Mdz content={content} />`;

		const result = await run_preprocess(input);
		assert.equal(result, input, 'should be unchanged for $state rune');
	});

	test('preserves $derived rune const', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	const base = $state('**bold**');
	const content = $derived(base);
</script>

<Mdz content={content} />`;

		const result = await run_preprocess(input);
		assert.equal(result, input, 'should be unchanged for $derived rune');
	});
});

describe('const variable tracing', () => {
	test('transforms const variable reference', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	const msg = '**bold**';
</script>

<Mdz content={msg} />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes('<strong>bold</strong>'), 'should transform const variable');
	});

	test('transforms template with const interpolation', async () => {
		const input =
			"<script lang=\"ts\">\n\timport Mdz from '@fuzdev/mdz/Mdz.svelte';\n\tconst name = 'world';\n</script>\n\n<Mdz content={`hello ${name}`} />";

		const result = await run_preprocess(input);
		assert.ok(result.includes('hello world'), 'should resolve const interpolation');
	});
});

describe('spread attributes', () => {
	test('skips usage with spread attributes', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	const props = { content: '**bold**' };
</script>

<Mdz {...props} />`;

		const result = await run_preprocess(input);
		assert.equal(result, input, 'should be unchanged with spread attributes');
	});

	test('skips when spread and static content coexist', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	const props = { class: 'foo' };
</script>

<Mdz {...props} content="**bold**" />`;

		const result = await run_preprocess(input);
		assert.equal(result, input, 'should be unchanged with spread attributes');
	});
});

describe('unconfigured tags', () => {
	test('skips usage with unconfigured component', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="<Unknown>text</Unknown>" />`;

		const result = await run_preprocess(input);
		assert.equal(result, input, 'should be unchanged for unconfigured component');
	});

	test('skips usage with unconfigured element', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="<blockquote>text</blockquote>" />`;

		const result = await run_preprocess(input);
		assert.equal(result, input, 'should be unchanged for unconfigured element');
	});

	test('transforms configured but skips unconfigured in same file', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="**bold**" />
<Mdz content="<Unknown>text</Unknown>" />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes('<strong>bold</strong>'), 'should transform configured content');
		assert.ok(
			result.includes('content="<Unknown>text</Unknown>"'),
			'should keep unconfigured content',
		);
	});

	test('skips unconfigured components with empty config', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="<Alert>text</Alert>" />`;

		const result = await run_preprocess(input, {});
		assert.equal(result, input, 'should be unchanged for unconfigured component with empty config');
	});

	test('transforms plain markup with empty config', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="**bold** text" />`;

		const result = await run_preprocess(input, {});
		assert.ok(result.includes('<strong>bold</strong>'), 'should transform without config');
	});
});

describe('missing or wrong imports', () => {
	test('skips Mdz without content attribute', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz />`;

		const result = await run_preprocess(input);
		assert.equal(result, input, 'should be unchanged');
	});

	test('skips files without Mdz import', async () => {
		const input = `<p>Hello</p>`;
		const result = await run_preprocess(input);
		assert.equal(result, input, 'should be unchanged');
	});

	test('skips files without matching import source', async () => {
		const input = `<script lang="ts">
	import Mdz from 'other-package/Mdz.svelte';
</script>

<Mdz content="**bold**" />`;

		const result = await run_preprocess(input);
		assert.equal(result, input, 'should be unchanged');
	});

	test('skips namespace import', async () => {
		const input = `<script lang="ts">
	import * as Mdz from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="**bold**" />`;

		const result = await run_preprocess(input);
		assert.equal(result, input, 'should be unchanged for namespace import');
	});

	test('skips import type declaration', async () => {
		const input = `<script lang="ts">
	import type Mdz from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="**bold**" />`;

		const result = await run_preprocess(input);
		assert.equal(result, input, 'should be unchanged for import type');
	});
});

describe('dynamic base prop', () => {
	test('skips precompilation when base is dynamic', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	let base_path = $state('/docs/foo/');
</script>

<Mdz content="see ./bar" base={base_path} />`;

		const result = await run_preprocess(input);
		assert.equal(result, input, 'should be unchanged for dynamic base');
	});

	test('transforms when base is static string', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="see ./bar" base="/docs/foo/" />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes("resolve('/docs/foo/bar')"), 'should resolve relative path');
		assert.ok(result.includes('<MdzPrecompiled>'), 'should use MdzPrecompiled');
		assert.ok(!result.includes('base='), 'should exclude base from output');
	});

	test('normalizes base without trailing slash', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="see ./bar" base="/docs/foo" />`;

		const result = await run_preprocess(input);
		assert.ok(
			result.includes("resolve('/docs/foo/bar')"),
			'should resolve with normalized trailing slash',
		);
	});
});

describe('excluded files', () => {
	test('skips excluded files with regex', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="**bold**" />`;

		const result = await run_preprocess(
			input,
			{...DEFAULT_TEST_OPTIONS, exclude: [/Test\.svelte$/]},
			'Test.svelte',
		);
		assert.equal(result, input, 'should be unchanged');
	});

	test('skips excluded files with string pattern', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="**bold**" />`;

		const result = await run_preprocess(
			input,
			{...DEFAULT_TEST_OPTIONS, exclude: ['fixtures/']},
			'src/test/fixtures/Test.svelte',
		);
		assert.equal(result, input, 'should be unchanged for excluded file');
	});
});

describe('nesting depth', () => {
	test('transforms Mdz deeply nested in control flow and components', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	import Wrapper from './Wrapper.svelte';
	const items = ['a'];
	const show = true;
</script>

<Wrapper>
	{#if show}
		{#each items as item}
			<Mdz content="**bold**" />
		{/each}
	{/if}
</Wrapper>`;

		const result = await run_preprocess(input);
		assert.ok(result.includes('<strong>bold</strong>'), 'should transform deeply nested Mdz');
		assert.ok(result.includes('<MdzPrecompiled>'), 'should use MdzPrecompiled');
	});
});

describe('empty children', () => {
	test('transforms component with empty children in mdz content', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="<Alert></Alert>" />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes('<Alert></Alert>'), 'should render empty component');
		assert.ok(result.includes('<MdzPrecompiled>'), 'should use MdzPrecompiled');
	});

	test('transforms element with empty children in mdz content', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="<aside></aside>" />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes('<aside></aside>'), 'should render empty element');
		assert.ok(result.includes('<MdzPrecompiled>'), 'should use MdzPrecompiled');
	});
});

describe('on_error', () => {
	test('throw mode throws on parse failure', async () => {
		const mdz_module = await import('$lib/mdz.ts');
		const spy = vi.spyOn(mdz_module, 'mdz_parse').mockImplementation(() => {
			throw new Error('mock parse failure');
		});

		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="**bold**" />`;

		try {
			let threw = false;
			try {
				await run_preprocess(input, {...DEFAULT_TEST_OPTIONS, on_error: 'throw'});
			} catch (error) {
				threw = true;
				assert.ok(error instanceof Error);
				assert.ok(error.message.includes('[fuz-mdz]'));
				assert.ok(error.message.includes('mock parse failure'));
			}
			assert.ok(threw, 'should have thrown');
		} finally {
			spy.mockRestore();
		}
	});

	test('log mode skips failed transformation and logs error', async () => {
		const mdz_module = await import('$lib/mdz.ts');
		const parse_spy = vi.spyOn(mdz_module, 'mdz_parse').mockImplementation(() => {
			throw new Error('mock parse failure');
		});

		const error_spy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content="**bold**" />`;

		try {
			const result = await run_preprocess(input, {...DEFAULT_TEST_OPTIONS, on_error: 'log'});
			assert.equal(result, input, 'should be unchanged when parse fails in log mode');
			assert.equal(error_spy.mock.calls.length, 1, 'should log exactly one error');
			assert.ok(
				(error_spy.mock.calls[0]![0] as string).includes('[fuz-mdz]'),
				'error message should include preprocessor prefix',
			);
			assert.ok(
				(error_spy.mock.calls[0]![0] as string).includes('mock parse failure'),
				'error message should include original error',
			);
		} finally {
			parse_spy.mockRestore();
			error_spy.mockRestore();
		}
	});
});

describe('ternary/conditional expressions', () => {
	test('transforms ternary with static string branches', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	let show = $state(true);
</script>

<Mdz content={show ? '**a**' : '**b**'} />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes('{#if show}'), 'should produce {#if} block');
		assert.ok(result.includes('{:else}'), 'should have {:else} block');
		assert.ok(result.includes('<strong>a</strong>'), 'should render consequent');
		assert.ok(result.includes('<strong>b</strong>'), 'should render alternate');
		assert.ok(result.includes('<MdzPrecompiled>'), 'should use MdzPrecompiled');
		assert.ok(!result.includes('import Mdz from'), 'should remove Mdz import');
	});

	test('transforms ternary with const bindings in branches', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	const text_a = '**bold**';
	const text_b = '_italic_';
	let show = $state(true);
</script>

<Mdz content={show ? text_a : text_b} />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes('{#if show}'), 'should produce {#if} block');
		assert.ok(result.includes('<strong>bold</strong>'), 'should render consequent from binding');
		assert.ok(result.includes('<em>italic</em>'), 'should render alternate from binding');
	});

	test('skips nested ternary when one branch has unconfigured tag', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	let a = $state(true);
	let b = $state(false);
</script>

<Mdz content={a ? '**ok**' : b ? '<Unknown>bad</Unknown>' : '**also ok**'} />`;

		const result = await run_preprocess(input);
		assert.equal(result, input, 'should be unchanged when nested branch has unconfigured tag');
	});

	test('transforms ternary with empty string in consequent', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	let show = $state(true);
</script>

<Mdz content={show ? '' : '**bold**'} />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes('{#if show}'), 'should produce {#if} block');
		assert.ok(result.includes('{:else}'), 'should produce {:else} block');
		assert.ok(result.includes('<strong>bold</strong>'), 'should render bold branch');
		assert.ok(result.includes('<MdzPrecompiled>'), 'should use MdzPrecompiled');
	});

	test('skips ternary when one branch has unconfigured tag', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	let show = $state(true);
</script>

<Mdz content={show ? '**ok**' : '<Unknown>bad</Unknown>'} />`;

		const result = await run_preprocess(input);
		assert.equal(result, input, 'should be unchanged when branch has unconfigured tag');
	});

	test('preserves props on MdzPrecompiled for ternary', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	let show = $state(true);
</script>

<Mdz content={show ? '**a**' : '**b**'} class="foo" inline />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes('<MdzPrecompiled class="foo" inline>'), 'should preserve props');
		assert.ok(result.includes('{#if show}'), 'should produce {#if} block');
		assert.ok(result.includes('{:else}'), 'should have {:else} block');
	});

	test('skips ternary with both branches dynamic', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	let a = $state('**x**');
	let b = $state('**y**');
	let show = $state(true);
</script>

<Mdz content={show ? a : b} />`;

		const result = await run_preprocess(input);
		assert.equal(result, input, 'should be unchanged when both branches are dynamic');
	});

	test('transforms nested ternary with static branches', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	let a = $state(true);
	let b = $state(false);
</script>

<Mdz content={a ? '**x**' : b ? '**y**' : '**z**'} />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes('{#if a}'), 'should produce {#if} block');
		assert.ok(result.includes('{:else if b}'), 'should produce {:else if} block');
		assert.ok(result.includes('{:else}'), 'should produce {:else} block');
		assert.ok(result.includes('<strong>x</strong>'), 'should render first branch');
		assert.ok(result.includes('<strong>y</strong>'), 'should render second branch');
		assert.ok(result.includes('<strong>z</strong>'), 'should render else branch');
		assert.ok(result.includes('<MdzPrecompiled>'), 'should use MdzPrecompiled');
		assert.ok(!result.includes('import Mdz from'), 'should remove Mdz import');
	});

	test('transforms 4-branch nested ternary', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	let a = $state(true);
	let b = $state(false);
	let c = $state(false);
</script>

<Mdz content={a ? '**w**' : b ? '**x**' : c ? '**y**' : '**z**'} />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes('{#if a}'), 'should produce {#if} block');
		assert.ok(result.includes('{:else if b}'), 'should produce first {:else if} block');
		assert.ok(result.includes('{:else if c}'), 'should produce second {:else if} block');
		assert.ok(result.includes('{:else}'), 'should produce {:else} block');
		assert.ok(result.includes('<strong>w</strong>'), 'should render first branch');
		assert.ok(result.includes('<strong>x</strong>'), 'should render second branch');
		assert.ok(result.includes('<strong>y</strong>'), 'should render third branch');
		assert.ok(result.includes('<strong>z</strong>'), 'should render else branch');
	});

	test('preserves complex condition expression in test_source', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	let items: Array<string> = $state([]);
</script>

<Mdz content={items.length > 0 ? '**has items**' : '**empty**'} />`;

		const result = await run_preprocess(input);
		assert.ok(
			result.includes('{#if items.length > 0}'),
			'should preserve full condition expression',
		);
		assert.ok(result.includes('<strong>has items</strong>'), 'should render consequent');
		assert.ok(result.includes('<strong>empty</strong>'), 'should render alternate');
	});

	test('transforms ternary with template literal branches', async () => {
		const input =
			'<script lang="ts">\n\timport Mdz from \'@fuzdev/mdz/Mdz.svelte\';\n\tlet show = $state(true);\n</script>\n\n<Mdz content={show ? `**bold**` : `_italic_`} />';

		const result = await run_preprocess(input);
		assert.ok(result.includes('{#if show}'), 'should produce {#if} block');
		assert.ok(result.includes('<strong>bold</strong>'), 'should render consequent');
		assert.ok(result.includes('<em>italic</em>'), 'should render alternate');
	});

	test('transforms multiple ternaries in same file', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	let a = $state(true);
	let b = $state(false);
</script>

<Mdz content={a ? '**x**' : '**y**'} />
<Mdz content={b ? '_p_' : '_q_'} />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes('{#if a}'), 'should produce {#if} for first ternary');
		assert.ok(result.includes('{#if b}'), 'should produce {#if} for second ternary');
		assert.ok(result.includes('<strong>x</strong>'), 'should render first consequent');
		assert.ok(result.includes('<strong>y</strong>'), 'should render first alternate');
		assert.ok(result.includes('<em>p</em>'), 'should render second consequent');
		assert.ok(result.includes('<em>q</em>'), 'should render second alternate');
		assert.ok(!result.includes('import Mdz from'), 'should remove Mdz import when all transformed');
	});

	test('transforms ternary coexisting with plain static Mdz', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	let show = $state(true);
</script>

<Mdz content="**static**" />
<Mdz content={show ? '**a**' : '**b**'} />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes('<strong>static</strong>'), 'should transform static usage');
		assert.ok(result.includes('{#if show}'), 'should transform ternary usage');
		assert.ok(!result.includes('import Mdz from'), 'should remove Mdz import when all transformed');
	});

	test('transforms ternary with empty string in alternate', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	let show = $state(true);
</script>

<Mdz content={show ? '**bold**' : ''} />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes('{#if show}'), 'should produce {#if} block');
		assert.ok(result.includes('<strong>bold</strong>'), 'should render consequent');
		assert.ok(result.includes('{:else}'), 'should have {:else} block');
		assert.ok(result.includes('<MdzPrecompiled>'), 'should use MdzPrecompiled');
	});

	test('on_error throw mode throws on ternary branch parse failure', async () => {
		const mdz_module = await import('$lib/mdz.ts');
		const spy = vi.spyOn(mdz_module, 'mdz_parse').mockImplementation(() => {
			throw new Error('mock ternary parse failure');
		});

		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	let show = $state(true);
</script>

<Mdz content={show ? '**a**' : '**b**'} />`;

		try {
			let threw = false;
			try {
				await run_preprocess(input, {...DEFAULT_TEST_OPTIONS, on_error: 'throw'});
			} catch (error) {
				threw = true;
				assert.ok(error instanceof Error);
				assert.ok(error.message.includes('[fuz-mdz]'));
				assert.ok(error.message.includes('mock ternary parse failure'));
			}
			assert.ok(threw, 'should have thrown');
		} finally {
			spy.mockRestore();
		}
	});

	test('on_error log mode skips ternary on branch parse failure', async () => {
		const mdz_module = await import('$lib/mdz.ts');
		const parse_spy = vi.spyOn(mdz_module, 'mdz_parse').mockImplementation(() => {
			throw new Error('mock ternary parse failure');
		});

		const error_spy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	let show = $state(true);
</script>

<Mdz content={show ? '**a**' : '**b**'} />`;

		try {
			const result = await run_preprocess(input, {...DEFAULT_TEST_OPTIONS, on_error: 'log'});
			assert.equal(result, input, 'should be unchanged when ternary parse fails in log mode');
			assert.equal(error_spy.mock.calls.length, 1, 'should log exactly one error');
			assert.ok(
				(error_spy.mock.calls[0]![0] as string).includes('[fuz-mdz]'),
				'error message should include preprocessor prefix',
			);
		} finally {
			parse_spy.mockRestore();
			error_spy.mockRestore();
		}
	});
});

describe('dead const removal', () => {
	test('removes dead const when all Mdz usages transformed', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	const msg = '**bold**';
</script>

<Mdz content={msg} />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes('<strong>bold</strong>'), 'should transform content');
		assert.ok(!result.includes("const msg = '**bold**'"), 'should remove dead const');
	});

	test('keeps const when used in non-Mdz context', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	const msg = '**bold**';
	console.log(msg);
</script>

<Mdz content={msg} />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes('<strong>bold</strong>'), 'should transform content');
		assert.ok(result.includes("const msg = '**bold**'"), 'should keep const used elsewhere');
	});

	test('skips multi-declarator const', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	const msg = '**bold**', other = 'x';
</script>

<Mdz content={msg} />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes('<strong>bold</strong>'), 'should transform content');
		assert.ok(result.includes('const msg'), 'should keep multi-declarator const');
	});

	test('removes directly consumed const but keeps transitive dependency', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	const a = '**bold**';
	const b = a;
</script>

<Mdz content={b} />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes('<strong>bold</strong>'), 'should transform content');
		assert.ok(!result.includes('const b = a'), 'should remove directly consumed const b');
		assert.ok(result.includes("const a = '**bold**'"), 'should keep transitive const a');
	});

	test('removes dead const consumed via ternary branch', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	const x = '**from const**';
	let show = $state(true);
</script>

<Mdz content={show ? x : '**literal**'} />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes('{#if show}'), 'should produce {#if} block');
		assert.ok(result.includes('<strong>from const</strong>'), 'should render const branch');
		assert.ok(result.includes('<strong>literal</strong>'), 'should render literal branch');
		assert.ok(
			!result.includes("const x = '**from const**'"),
			'should remove dead const from ternary',
		);
	});

	test('keeps let binding even when only used in transformed Mdz', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	let msg = '**bold**';
</script>

<Mdz content={msg} />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes("let msg = '**bold**'"), 'should keep let binding');
	});

	test('keeps const declared in module script', async () => {
		const input = `<script module>
	const msg = '**bold**';
</script>

<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
</script>

<Mdz content={msg} />`;

		const result = await run_preprocess(input);
		assert.ok(result.includes('<strong>bold</strong>'), 'should transform content');
		assert.ok(result.includes("const msg = '**bold**'"), 'should keep module script const');
	});

	test('keeps const when referenced in template expression', async () => {
		const input = `<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	const msg = '**bold**';
</script>

<Mdz content={msg} />
<p>{msg}</p>`;

		const result = await run_preprocess(input);
		assert.ok(result.includes('<strong>bold</strong>'), 'should transform content');
		assert.ok(result.includes("const msg = '**bold**'"), 'should keep const used in template');
	});
});
