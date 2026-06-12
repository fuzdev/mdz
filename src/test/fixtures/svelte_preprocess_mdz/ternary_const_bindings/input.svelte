<script lang="ts">
	// @ts-nocheck
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	const text_a = '**bold**';
	const text_b = '_italic_';
	let show = $state.raw(true);
</script>

<Mdz content={show ? text_a : text_b} />
