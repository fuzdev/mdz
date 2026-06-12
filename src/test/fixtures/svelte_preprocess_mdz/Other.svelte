<script lang="ts">
	import type {Snippet} from 'svelte';

	const {children}: {children?: Snippet} = $props();
</script>

<div class="other">
	{#if children}{@render children()}{/if}
</div>
