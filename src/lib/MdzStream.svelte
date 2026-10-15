<script lang="ts">
	import type { SvelteHTMLElements } from 'svelte/elements';

	import MdzStreamNodeView from './MdzStreamNodeView.svelte';
	import {
		mdz_base_context,
		mdz_set_context_with_fallback,
		type MdzWhitespace
	} from './mdz_contexts.ts';
	import type { MdzStreamState } from './mdz_stream_state.svelte.ts';

	const {
		stream,
		inline = false,
		whitespace,
		base,
		...rest
	}: (SvelteHTMLElements['div'] | SvelteHTMLElements['span']) & {
		stream: MdzStreamState;
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
</script>

<svelte:element this={inline ? 'span' : 'div'} {...rest} style:white-space={whitespace}>
	<!-- the array form renders the whole stream through one MdzStreamNodeView
	instance (one set of context reads) instead of one per top-level block -->
	<MdzStreamNodeView nodes={stream.root} />
</svelte:element>
