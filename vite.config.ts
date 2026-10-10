import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import adapter from '@sveltejs/adapter-static';
import type { PreprocessorGroup } from 'svelte/compiler';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { svelte_preprocess_fuz_code } from '@fuzdev/fuz_code/svelte_preprocess_fuz_code.ts';
import { vite_plugin_fuz_css } from '@fuzdev/fuz_css/vite_plugin_fuz_css.ts';
import svelte_docinfo from 'svelte-docinfo/vite.js';
import { vite_plugin_pkg_json } from '@fuzdev/fuz_ui/vite_plugin_pkg_json.ts';

// Self-referencing import from dist — unavailable on the first build after a clean
// checkout, but subsequent builds use the preprocessor for static Mdz compilation.
// The docs site injects fuz_ui's DocsLink for inline code and fuz_code's Code for
// code blocks (both dev-only here); the published package depends on neither.
let mdz_preprocessors: Array<PreprocessorGroup> = [];
try {
	const { svelte_preprocess_mdz } = await import('@fuzdev/mdz/svelte_preprocess_mdz.ts');
	mdz_preprocessors = [
		svelte_preprocess_mdz({
			mdz_component_imports: ['#lib/Mdz.svelte', '@fuzdev/mdz/Mdz.svelte'],
			// injected into any preprocessed file, dependencies' too, where `#lib` would resolve
			// against the dependency's package, so the package name, which the self-alias resolves
			compiled_component_import: '@fuzdev/mdz/MdzPrecompiled.svelte',
			code_component_import: '@fuzdev/fuz_ui/DocsLink.svelte',
			codeblock_component_import: '@fuzdev/fuz_code/Code.svelte'
		})
	];
} catch {}

export default defineConfig({
	server: {
		// Vite watches the whole root, an inotify watch per file, and gro's `.gro/` output
		// needn't come out of the user's `max_user_watches` budget
		watch: { ignored: ['**/.gro/**'] }
	},
	plugins: [
		sveltekit({
			preprocess: [...mdz_preprocessors, svelte_preprocess_fuz_code(), vitePreprocess()],
			compilerOptions: { runes: true },
			inspector: true,
			adapter: adapter(),
			paths: { relative: false }, // use root-absolute paths for SSR path comparison: https://svelte.dev/docs/kit/configuration#paths
			prerender: {
				// the fixtures page renders the parser test corpus verbatim, including
				// sample internal links (e.g. `/docs/introduction`) that aren't real routes here —
				// don't fail the build on those, but keep real dead links elsewhere fatal
				handleHttpError: ({ status, referrer, message }) => {
					if (status === 404 && referrer?.startsWith('/docs/fixtures')) return;
					throw new Error(message);
				},
				// likewise, the corpus carries sample same-page fragment links (`[x](#frag)`)
				// whose ids only exist in the fixture's imagined document, not on the page —
				// tolerate those on the fixtures page, but keep missing-id checks fatal elsewhere
				handleMissingId: ({ path, message }) => {
					if (path?.startsWith('/docs/fixtures')) return;
					throw new Error(message);
				}
			},
			version: { name: execSync('git rev-parse HEAD').toString().trim() }
		}),
		svelte_docinfo(),
		// mdz renders arbitrary markdown that can't be detected,
		// so this avoids optimizing away needed styles with `'all'`
		vite_plugin_fuz_css({ additional_elements: 'all' }),
		vite_plugin_pkg_json()
	],
	resolve: {
		// fuz_ui imports `@fuzdev/mdz/*` (an optional peer that isn't installed here), so point
		// it at the source to share one module instance (and its contexts) with the site's
		// `#lib` imports
		alias: [
			{
				find: /^@fuzdev\/mdz\//,
				replacement: fileURLToPath(new URL('./src/lib/', import.meta.url))
			}
		]
	},
	optimizeDeps: { exclude: ['@fuzdev/blake3-wasm'] }
});
