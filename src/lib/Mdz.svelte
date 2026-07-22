<script lang="ts">
	import type { SvelteHTMLElements } from 'svelte/elements';
	import { DEV } from 'esm-env';

	import { mdz_parse, type MdzNode } from './mdz.ts';
	import MdzNodeView from './MdzNodeView.svelte';
	import {
		mdz_base_context,
		mdz_set_context_with_fallback,
		type MdzWhitespace
	} from './mdz_contexts.ts';

	const {
		content,
		nodes: nodes_prop,
		inline = false,
		whitespace,
		base,
		...rest
	}: (SvelteHTMLElements['div'] | SvelteHTMLElements['span']) & {
		inline?: boolean;
		/**
		 * Sets `white-space` on the wrapper. When omitted, whitespace collapses
		 * like standard markdown — single newlines render as soft breaks.
		 * Use `pre-line` to render every newline as a line break.
		 */
		whitespace?: MdzWhitespace;
		base?: string;
	} & // pass `content` to parse at render, or `nodes` to render a pre-parsed
		// tree (e.g. one parsed once and rendered in several places) and skip
		// `mdz_parse` entirely
		(
			{ content: string; nodes?: undefined } | { content?: undefined; nodes: Array<MdzNode> }
		) = $props();

	mdz_set_context_with_fallback(mdz_base_context, () => base);

	const nodes = $derived.by(() => {
		if (DEV && (content === undefined) === (nodes_prop === undefined)) {
			throw new Error('Mdz: pass exactly one of `content` or `nodes`');
		}
		return nodes_prop ?? mdz_parse(content ?? '');
	});
</script>

<svelte:element this={inline ? 'span' : 'div'} {...rest} style:white-space={whitespace}>
	<MdzNodeView {nodes} />
</svelte:element>
