import type {MdzNode} from '$lib/mdz.js';
import type {MdzFixture} from '../../../test/fixtures/mdz/mdz_test_helpers.js';

/**
 * Loads the parser test corpus at build time via Vite glob imports.
 *
 * Lives in the component (not a `+page.server.ts` load) so the fixtures page
 * renders identically whether visited at its own route or mounted inline by
 * `DocsContent` on the `/docs` index — route `data` is unavailable in the
 * latter case.
 */
export const load_mdz_fixtures = (): Array<MdzFixture> => {
	const input_modules = import.meta.glob<string>('../../../test/fixtures/mdz/**/input.mdz', {
		eager: true,
		query: '?raw',
		import: 'default',
	});
	const expected_modules = import.meta.glob<Array<MdzNode>>(
		'../../../test/fixtures/mdz/**/expected.json',
		{eager: true, import: 'default'},
	);

	// extract fixture names from paths like `.../fixtures/bold_simple/input.mdz`
	const fixture_names: Set<string> = new Set();
	const pattern = /\/([^/]+)\/input\.mdz$/;
	for (const path of Object.keys(input_modules)) {
		const match = pattern.exec(path);
		if (match) {
			fixture_names.add(match[1]!);
		}
	}

	// load each fixture
	const fixtures: Array<MdzFixture> = [];
	for (const name of Array.from(fixture_names).sort()) {
		const input_path = Object.keys(input_modules).find((p) => p.includes(`/${name}/input.mdz`));
		const expected_path = Object.keys(expected_modules).find((p) =>
			p.includes(`/${name}/expected.json`),
		);

		if (input_path && expected_path) {
			fixtures.push({
				name,
				input: input_modules[input_path]!,
				expected: expected_modules[expected_path]!,
			});
		}
	}

	return fixtures;
};
