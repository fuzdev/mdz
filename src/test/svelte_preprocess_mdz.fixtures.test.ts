import {test, assert, describe, beforeAll} from 'vitest';
import {parse} from 'svelte/compiler';

import {
	load_fixtures,
	run_preprocess,
	DEFAULT_TEST_OPTIONS,
	type PreprocessMdzFixture,
} from './fixtures/svelte_preprocess_mdz/svelte_preprocess_mdz_test_helpers.js';

let fixtures: Array<PreprocessMdzFixture> = [];

beforeAll(async () => {
	fixtures = await load_fixtures();
});

describe('svelte_preprocess_mdz fixtures', () => {
	test('all fixtures transform correctly', async () => {
		for (const fixture of fixtures) {
			const result = await run_preprocess(
				fixture.input,
				DEFAULT_TEST_OPTIONS,
				`${fixture.name}.svelte`,
			);
			assert.equal(result, fixture.expected.code, `Fixture "${fixture.name}" failed`);
		}
	});

	test('all transformed fixtures produce parseable Svelte output', async () => {
		for (const fixture of fixtures) {
			const result = await run_preprocess(
				fixture.input,
				DEFAULT_TEST_OPTIONS,
				`${fixture.name}.svelte`,
			);
			// every transformation must produce valid Svelte
			const ast = parse(result, {filename: `${fixture.name}.svelte`, modern: true});
			assert.ok(ast.fragment, `Fixture "${fixture.name}" output not parseable`);
		}
	});

	test('generates source map for transformed fixtures', async () => {
		// pick a fixture that transforms (bold_double_quoted always does)
		const fixture = fixtures.find((f) => f.name === 'bold_double_quoted');
		assert.ok(fixture, 'bold_double_quoted fixture should exist');
		const {preprocess} = await import('svelte/compiler');
		const {svelte_preprocess_mdz} = await import('$lib/svelte_preprocess_mdz.js');
		const result = await preprocess(fixture.input, [svelte_preprocess_mdz(DEFAULT_TEST_OPTIONS)], {
			filename: 'Test.svelte',
		});
		assert.ok(result.map != null, 'should generate source map');
		const map = result.map as {sources: Array<string>};
		assert.ok(map.sources.includes('Test.svelte'), 'should reference source file');
	});
});
