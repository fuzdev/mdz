import {test, assert, describe, beforeAll} from 'vitest';

import {mdz_parse} from '$lib/mdz.js';
import {
	stream_parse,
	load_fixtures,
	validate_positions,
	type MdzFixture,
} from './fixtures/mdz/mdz_test_helpers.js';

let fixtures: Array<MdzFixture> = [];

beforeAll(async () => {
	fixtures = await load_fixtures();
});

// -- Both parsers compared with full positions --

const all_parsers = [
	{name: 'sync', parse: mdz_parse},
	{name: 'streaming', parse: stream_parse},
];

for (const {name, parse} of all_parsers) {
	describe(`mdz parser (${name})`, () => {
		test('all fixtures parse correctly', () => {
			for (const fixture of fixtures) {
				const result = parse(fixture.input);
				assert.deepEqual(result, fixture.expected, `Fixture "${fixture.name}" failed`);
			}
		});

		test('all fixtures have valid positions', () => {
			for (const fixture of fixtures) {
				const result = parse(fixture.input);
				validate_positions(result);
			}
		});
	});
}

describe('mdz parsers agree', () => {
	test('sync and streaming parsers produce identical output on all fixtures', () => {
		for (const fixture of fixtures) {
			const sync = mdz_parse(fixture.input);
			const streaming = stream_parse(fixture.input);
			assert.deepEqual(streaming, sync, `Fixture "${fixture.name}": streaming differs from sync`);
		}
	});
});
