import type {Task} from '@fuzdev/gro';
import {join} from 'node:path';
import {preprocess} from 'svelte/compiler';

import {svelte_preprocess_mdz} from '$lib/svelte_preprocess_mdz.js';
import {run_update_task} from '../../test_helpers.js';
import {DEFAULT_TEST_OPTIONS} from './svelte_preprocess_mdz_test_helpers.js';

export const task: Task = {
	summary: 'generate expected.json files for svelte_preprocess_mdz fixtures',
	run: async ({log}) => {
		await run_update_task(
			{
				fixtures_dir: join(import.meta.dirname),
				input_extension: '.svelte',
				process: async (input, name) => {
					const result = await preprocess(input, [svelte_preprocess_mdz(DEFAULT_TEST_OPTIONS)], {
						filename: `${name}.svelte`,
					});
					return {code: result.code};
				},
			},
			log,
		);
	},
};
