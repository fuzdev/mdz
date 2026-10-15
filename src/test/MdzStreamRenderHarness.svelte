<script lang="ts">
	import type { MdzComponents, MdzElements } from '#lib/mdz_contexts.ts';
	import MdzRoot from '#lib/MdzRoot.svelte';
	import MdzStream from '#lib/MdzStream.svelte';
	import type { MdzStreamState } from '#lib/mdz_stream_state.svelte.ts';

	// test-only harness: the streaming counterpart of `MdzRenderHarness`, wrapping
	// `MdzStream` in `MdzRoot` so SSR tests can register `elements`/`components`
	const {
		stream,
		elements,
		components
	}: { stream: MdzStreamState; elements?: MdzElements; components?: MdzComponents } = $props();
</script>

<MdzRoot {elements} {components}>
	<MdzStream {stream} />
</MdzRoot>
