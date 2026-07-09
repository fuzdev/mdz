/**
 * SSR render tests for the runtime renderer (`Mdz` → `MdzNodeView`).
 *
 * The renderers previously had no test coverage at all — these bind the
 * component output to the parser across the full fixture corpus via
 * `svelte/server`'s `render` (no DOM environment needed).
 */

import {describe, test, assert} from 'vitest';
import {render} from 'svelte/server';
import type {Component} from 'svelte';

import MdzComponent from '$lib/Mdz.svelte';
import {load_fixtures} from './fixtures/mdz/mdz_test_helpers.ts';

// narrowed component type — the wrapper's `SvelteHTMLElements` rest-prop
// union is too complex for `render()`'s generic inference
const Mdz = MdzComponent as unknown as Component<{content: string}>;

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
