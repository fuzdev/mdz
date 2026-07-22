import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import adapter from '@sveltejs/adapter-static';
import { svelte_preprocess_fuz_code } from '@fuzdev/fuz_code/svelte_preprocess_fuz_code.js';
import { execSync } from 'node:child_process';

// Self-referencing import from dist — unavailable on the first build after a clean
// checkout, but subsequent builds use the preprocessor for static Mdz compilation.
// The docs site injects fuz_ui's DocsLink for inline code and fuz_code's Code for
// code blocks (both dev-only here); the published package depends on neither.
/** @type {Array<import('svelte/compiler').PreprocessorGroup>} */
let mdz_preprocessors = [];
try {
	const { svelte_preprocess_mdz } = await import('@fuzdev/mdz/svelte_preprocess_mdz.js');
	mdz_preprocessors = [
		svelte_preprocess_mdz({
			mdz_component_imports: ['$lib/Mdz.svelte', '@fuzdev/mdz/Mdz.svelte'],
			compiled_component_import: '$lib/MdzPrecompiled.svelte',
			code_component_import: '@fuzdev/fuz_ui/DocsLink.svelte',
			codeblock_component_import: '@fuzdev/fuz_code/Code.svelte'
		})
	];
} catch {}

/** @type {import('@sveltejs/kit').Config} */
export default {
	preprocess: [...mdz_preprocessors, svelte_preprocess_fuz_code(), vitePreprocess()],
	compilerOptions: { runes: true },
	vitePlugin: { inspector: true },
	kit: {
		adapter: adapter(),
		paths: { relative: false }, // use root-absolute paths for SSR path comparison: https://svelte.dev/docs/kit/configuration#paths
		alias: { $routes: 'src/routes', '@fuzdev/mdz': 'src/lib' },
		prerender: {
			// the fixtures page renders the parser test corpus verbatim, including
			// sample internal links (e.g. `/docs/introduction`) that aren't real routes here —
			// don't fail the build on those, but keep real dead links elsewhere fatal
			// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
			handleHttpError: ({ status, referrer, message }) => {
				if (status === 404 && referrer?.startsWith('/docs/fixtures')) return;
				throw new Error(message);
			},
			// likewise, the corpus carries sample same-page fragment links (`[x](#frag)`)
			// whose ids only exist in the fixture's imagined document, not on the page —
			// tolerate those on the fixtures page, but keep missing-id checks fatal elsewhere
			// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
			handleMissingId: ({ path, message }) => {
				if (path?.startsWith('/docs/fixtures')) return;
				throw new Error(message);
			}
		},
		version: { name: execSync('git rev-parse HEAD').toString().trim() }
	}
};
