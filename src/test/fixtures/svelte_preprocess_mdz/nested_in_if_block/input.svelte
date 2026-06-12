<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	let show = $state.raw(true);
</script>

{#if show}
	<Mdz content="**bold**" />
{/if}
