<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	let cls = $state.raw('foo');
</script>

<Mdz content="text" class={cls} />
