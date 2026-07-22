import { test, assert, describe } from 'vitest';
import { mdz_from_tsdoc } from '$lib/tsdoc_mdz.ts';

describe('mdz_from_tsdoc', () => {
	test('converts {@link url|text} to markdown link', () => {
		assert.equal(mdz_from_tsdoc('{@link https://fuz.dev|Example}'), '[Example](https://fuz.dev)');
	});

	test('converts {@link url} to bare URL', () => {
		assert.equal(mdz_from_tsdoc('{@link https://fuz.dev}'), 'https://fuz.dev');
	});

	test('converts {@link identifier} to backticks', () => {
		assert.equal(mdz_from_tsdoc('{@link SomeType}'), '`SomeType`');
	});

	test('passes through bare URL', () => {
		assert.equal(mdz_from_tsdoc('https://fuz.dev'), 'https://fuz.dev');
	});

	test('wraps bare identifier in backticks', () => {
		assert.equal(mdz_from_tsdoc('SomeType'), '`SomeType`');
	});

	test('handles {@see ...} syntax same as {@link ...}', () => {
		assert.equal(mdz_from_tsdoc('{@see SomeType}'), '`SomeType`');
	});

	test('trims whitespace', () => {
		assert.equal(mdz_from_tsdoc('  {@link Foo}  '), '`Foo`');
	});

	test('handles http:// URLs in {@link}', () => {
		assert.equal(mdz_from_tsdoc('{@link http://fuz.dev}'), 'http://fuz.dev');
	});

	test('handles bare http:// URLs', () => {
		assert.equal(mdz_from_tsdoc('http://fuz.dev'), 'http://fuz.dev');
	});

	test('handles {@link} with http:// URL and text', () => {
		assert.equal(mdz_from_tsdoc('{@link http://fuz.dev|Docs}'), '[Docs](http://fuz.dev)');
	});

	test('handles complex identifiers like Foo<Bar>', () => {
		assert.equal(mdz_from_tsdoc('{@link Foo<Bar>}'), '`Foo<Bar>`');
	});

	test('handles malformed {@link with unclosed brace', () => {
		// Malformed input: unclosed brace splits at first space
		assert.equal(mdz_from_tsdoc('{@link SomeType'), '`{@link` SomeType');
	});

	test('returns empty string for empty input', () => {
		assert.equal(mdz_from_tsdoc(''), '');
	});

	test('returns empty string for whitespace-only input', () => {
		assert.equal(mdz_from_tsdoc('   '), '');
	});

	test('trims whitespace inside {@link}', () => {
		assert.equal(mdz_from_tsdoc('{@link   SomeType   }'), '`SomeType`');
	});

	test('handles spaces around pipe', () => {
		assert.equal(
			mdz_from_tsdoc('{@link https://fuz.dev | Example Site }'),
			'[Example Site](https://fuz.dev)'
		);
	});

	test('handles multiple pipes by using first as separator', () => {
		assert.equal(
			mdz_from_tsdoc('{@link https://fuz.dev|Text|More}'),
			'[Text|More](https://fuz.dev)'
		);
	});

	test('handles identifiers with dots', () => {
		assert.equal(mdz_from_tsdoc('{@link module.function}'), '`module.function`');
	});

	test('handles bare identifiers with dots', () => {
		assert.equal(mdz_from_tsdoc('some_module.some_function'), '`some_module.some_function`');
	});

	test('splits identifier from description text', () => {
		assert.equal(
			mdz_from_tsdoc('tome.ts for the documentation system'),
			'`tome.ts` for the documentation system'
		);
	});

	test('splits module filename from description', () => {
		assert.equal(
			mdz_from_tsdoc('library_pipeline.ts for pipeline helpers'),
			'`library_pipeline.ts` for pipeline helpers'
		);
	});

	test('passes through URL with description as-is', () => {
		assert.equal(mdz_from_tsdoc('https://fuz.dev for more info'), 'https://fuz.dev for more info');
	});

	test('accepts TS-lenient space-separated {@link url text}', () => {
		assert.equal(
			mdz_from_tsdoc('{@link https://example.com Example Site}'),
			'[Example Site](https://example.com)'
		);
	});

	test('space-separated {@link} does not split when first token is not a URL', () => {
		// Identifier-style references must stay intact — only URLs split on space.
		assert.equal(mdz_from_tsdoc('{@link module.function rest}'), '`module.function rest`');
	});

	test('passes through bare markdown link', () => {
		assert.equal(
			mdz_from_tsdoc('[Example](https://example.com)'),
			'[Example](https://example.com)'
		);
	});

	test('passes through bare markdown link with description', () => {
		assert.equal(
			mdz_from_tsdoc('[svelte-docinfo](https://github.com/x/y) for the analysis library'),
			'[svelte-docinfo](https://github.com/x/y) for the analysis library'
		);
	});
});
