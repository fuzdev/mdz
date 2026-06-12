import type {Tome} from '@fuzdev/fuz_ui/tome.js';
import ApiPage from '$routes/docs/api/+page.svelte';
import LibraryPage from '$routes/docs/library/+page.svelte';
import introduction from '$routes/docs/introduction/+page.svelte';
import usage from '$routes/docs/usage/+page.svelte';
import streaming from '$routes/docs/streaming/+page.svelte';
import svelte_preprocess_mdz from '$routes/docs/svelte_preprocess_mdz/+page.svelte';
import fixtures from '$routes/docs/fixtures/+page.svelte';

export const tomes: Array<Tome> = [
	{
		slug: 'introduction',
		category: 'guide',
		Component: introduction,
		related_tomes: ['usage', 'streaming', 'svelte_preprocess_mdz'],
		related_modules: [],
		related_declarations: [],
	},
	{
		slug: 'usage',
		category: 'guide',
		Component: usage,
		related_tomes: ['streaming', 'svelte_preprocess_mdz', 'fixtures'],
		related_modules: ['mdz.ts'],
		related_declarations: ['Mdz', 'MdzRoot', 'MdzNodeView', 'mdz_parse'],
	},
	{
		slug: 'streaming',
		category: 'guide',
		Component: streaming,
		related_tomes: ['usage'],
		related_modules: [
			'mdz_stream_parser.ts',
			'mdz_stream_state.svelte.ts',
			'mdz_opcodes.ts',
			'mdz_opcodes_to_nodes.ts',
		],
		related_declarations: [
			'MdzStream',
			'MdzStreamNodeView',
			'MdzStreamParser',
			'MdzStreamState',
			'MdzOpcode',
			'mdz_opcodes_to_nodes',
		],
	},
	{
		slug: 'svelte_preprocess_mdz',
		category: 'helpers',
		Component: svelte_preprocess_mdz,
		related_tomes: ['usage'],
		related_modules: ['svelte_preprocess_mdz.ts', 'mdz_to_svelte.ts'],
		related_declarations: ['svelte_preprocess_mdz', 'mdz_to_svelte', 'MdzPrecompiled'],
	},
	{
		slug: 'api',
		category: 'reference',
		Component: ApiPage,
		related_tomes: [],
		related_modules: [],
		related_declarations: [],
	},
	{
		slug: 'library',
		category: 'reference',
		Component: LibraryPage,
		related_tomes: [],
		related_modules: [],
		related_declarations: [],
	},
	{
		slug: 'fixtures',
		category: 'reference',
		Component: fixtures,
		related_tomes: ['usage'],
		related_modules: ['mdz.ts'],
		related_declarations: ['mdz_parse', 'MdzNode'],
	},
];
