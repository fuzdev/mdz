<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	let inline = $state.raw(true);
</script>

<Mdz content="text" {inline} />
