<script lang="ts">
	import type {SvelteHTMLElements} from 'svelte/elements';

	import {mdz_parse} from './mdz.js';
	import MdzNodeView from './MdzNodeView.svelte';
	import {
		mdz_base_context,
		mdz_set_context_with_fallback,
		type MdzWhitespace,
	} from './mdz_contexts.js';

	const {
		content,
		inline = false,
		whitespace,
		base,
		...rest
	}: (SvelteHTMLElements['div'] | SvelteHTMLElements['span']) & {
		content: string;
		inline?: boolean;
		/**
		 * Sets `white-space` on the wrapper. When omitted, whitespace collapses
		 * like standard markdown — single newlines render as soft breaks.
		 * Use `pre-line` to render every newline as a line break.
		 */
		whitespace?: MdzWhitespace;
		base?: string;
	} = $props();

	mdz_set_context_with_fallback(mdz_base_context, () => base);

	const nodes = $derived(mdz_parse(content));
</script>

<svelte:element this={inline ? 'span' : 'div'} {...rest} style:white-space={whitespace}>
	{#each nodes as node (node)}
		<MdzNodeView {node} />
	{/each}
</svelte:element>
