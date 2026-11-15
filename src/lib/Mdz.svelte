<script lang="ts">
	import type { SvelteHTMLElements } from 'svelte/elements';
	import { DEV } from 'esm-env';

	import { mdz_parse, type MdzNode } from './mdz.ts';
	import MdzNodeView from './MdzNodeView.svelte';
	import { mdz_unwrap_inline } from './mdz_helpers.ts';
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
		source_offsets = false,
		...rest
	}: (SvelteHTMLElements['div'] | SvelteHTMLElements['span']) & {
		/**
		 * Renders a `span` wrapper and unwraps a lone paragraph so the content
		 * can sit inside other text. Multiple blocks still render as blocks.
		 */
		inline?: boolean;
		/**
		 * Sets `white-space` on the wrapper. When omitted, whitespace collapses
		 * like standard markdown — single newlines render as soft breaks.
		 * Use `pre-line` to render every newline as a line break.
		 */
		whitespace?: MdzWhitespace;
		base?: string;
		/**
		 * Puts each node's source offsets on the elements rendered for it, as
		 * `data-mdz-start` and `data-mdz-end`, so a consumer can map rendered
		 * output back to the source: scroll sync with an editor, marking the
		 * block under its caret, click-to-source, or matching a rendered link
		 * to its `MdzNode` by offset rather than document order.
		 *
		 * The values are the node's `start` and `end` (exclusive) — string
		 * indices into `content`, or into the string `nodes` was parsed from.
		 * Every element mdz renders for a node carries them: blocks (`p`,
		 * headings, `ul`/`ol`, `li`, `blockquote`, `table`, `tr`, `th`/`td`,
		 * `hr`, a codeblock's `pre`), inline formatting (`strong`, `em`, `s`,
		 * `code`), every rendered link's `a` (markdown links and auto-linked
		 * URLs and paths alike), and registered HTML elements. Nothing carries
		 * them where mdz renders no element for a node: text, a link whose
		 * reference fails the safety check (it renders as its text), padding
		 * cells, placeholders for unregistered tags, and the paragraph `inline`
		 * unwraps. Elements nest, so an
		 * element can share its `start` with a descendant's (a paragraph and
		 * its first link) — match by element and both offsets.
		 *
		 * Injected `code` and `codeblock` components receive the offsets as
		 * props (`MdzSourceOffsetProps`), which one that spreads rest props
		 * onto its root element carries — on whatever root it renders, so an
		 * injected `code` that renders a link puts a `Code` node's offsets on an
		 * `a`; registered content components don't
		 * (their props are what they register), though the content inside
		 * them carries its own. The switch isn't inherited — a nested `Mdz`
		 * has its own. Precompiled static content (`svelte_preprocess_mdz`)
		 * renders at runtime when this is set, and `MdzStream` has no
		 * offsets to offer. Off, the output is unchanged.
		 *
		 * @default false
		 */
		source_offsets?: boolean;
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
		const parsed = nodes_prop ?? mdz_parse(content ?? '');
		return inline ? mdz_unwrap_inline(parsed) : parsed;
	});
</script>

<svelte:element this={inline ? 'span' : 'div'} {...rest} style:white-space={whitespace}>
	<MdzNodeView {nodes} {source_offsets} />
</svelte:element>
