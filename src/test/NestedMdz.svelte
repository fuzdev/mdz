<script lang="ts">
	import type { Snippet } from 'svelte';

	import Mdz from '#lib/Mdz.svelte';

	// test-only component: renders its own `Mdz` inside mdz content, whose
	// offsets would index a different string than the outer content's; the
	// content is a prop so `svelte_preprocess_mdz` can't precompile this `Mdz`
	// away, which would pass the test without rendering a runtime `Mdz` at all
	const { content = '**inner**', children }: { content?: string; children?: Snippet } = $props();
</script>

<Mdz {content} />{@render children?.()}
