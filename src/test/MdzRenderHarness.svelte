<script lang="ts">
	import type {MdzComponents, MdzElements} from '$lib/mdz_contexts.ts';
	import MdzRoot from '$lib/MdzRoot.svelte';
	import Mdz from '$lib/Mdz.svelte';

	// test-only harness: wraps `Mdz` in `MdzRoot` so SSR tests can register
	// `elements`/`components` (which `Mdz` reads from context, not props)
	const {
		content,
		elements,
		components,
	}: {content: string; elements?: MdzElements; components?: MdzComponents} = $props();
</script>

<MdzRoot {elements} {components}>
	<Mdz {content} />
</MdzRoot>
