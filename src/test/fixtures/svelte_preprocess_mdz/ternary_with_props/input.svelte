<script lang="ts">
	// @ts-nocheck
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	let show = $state.raw(true);
</script>

<Mdz content={show ? '**a**' : '**b**'} class="mb_lg" inline />
