import type {Task} from '@fuzdev/gro';
import {join} from 'node:path';

import {mdz_parse} from '$lib/mdz.js';
import {run_update_task} from '../../test_helpers.js';

export const task: Task = {
	summary: 'generate expected.json files for mdz fixtures',
	run: async ({log}) => {
		await run_update_task(
			{
				fixtures_dir: join(import.meta.dirname),
				input_extension: '.mdz',
				process: (input) => mdz_parse(input),
			},
			log,
		);
	},
};
