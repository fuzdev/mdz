<script lang="ts">
	import type {Snippet} from 'svelte';
	import type {SvelteHTMLElements} from 'svelte/elements';

	import type {MdzWhitespace} from './mdz_contexts.js';

	/**
	 * Wrapper for precompiled mdz content. Used by `svelte_preprocess_mdz`.
	 * Not intended for direct use.
	 *
	 * @module
	 */

	const {
		inline = false,
		whitespace,
		children,
		...rest
	}: (SvelteHTMLElements['div'] | SvelteHTMLElements['span']) & {
		inline?: boolean;
		/**
		 * Sets `white-space` on the wrapper. When omitted, whitespace collapses
		 * like standard markdown — single newlines render as soft breaks.
		 * Use `pre-line` to render every newline as a line break.
		 */
		whitespace?: MdzWhitespace;
		children: Snippet;
	} = $props();
</script>

<svelte:element this={inline ? 'span' : 'div'} {...rest} style:white-space={whitespace}>
	{@render children()}
</svelte:element>
