<script lang="ts">
	import type {
		MdzCodeComponent,
		MdzCodeblockComponent,
		MdzComponents,
		MdzElements
	} from '#lib/mdz_contexts.ts';
	import MdzRoot from '#lib/MdzRoot.svelte';
	import Mdz from '#lib/Mdz.svelte';

	// test-only harness: wraps `Mdz` in `MdzRoot` so SSR tests can register
	// `elements`/`components` and inject `code`/`codeblock` (which `Mdz` reads
	// from context, not props)
	const {
		content,
		elements,
		components,
		code,
		codeblock,
		source_offsets
	}: {
		content: string;
		elements?: MdzElements;
		components?: MdzComponents;
		code?: MdzCodeComponent;
		codeblock?: MdzCodeblockComponent;
		source_offsets?: boolean;
	} = $props();
</script>

<MdzRoot {elements} {components} {code} {codeblock}>
	<Mdz {content} {source_offsets} />
</MdzRoot>
