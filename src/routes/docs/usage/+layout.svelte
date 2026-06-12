<script lang="ts">
	import type {Snippet} from 'svelte';
	import {page} from '$app/state';
	import Code from '@fuzdev/fuz_code/Code.svelte';
	import DocsLink from '@fuzdev/fuz_ui/DocsLink.svelte';

	import MdzRoot from '$lib/MdzRoot.svelte';

	const {
		children,
	}: {
		children: Snippet;
	} = $props();
</script>

<!--
	Set `mdz_base_context` to the current page URL so relative auto-links
	in `.mdz` content (`./sibling`, `../uncle`) resolve via
	`mdz_resolve_relative_path` (filesystem-style) instead of the browser's
	default RFC 3986 resolution (which strips the last URL segment and
	gives the wrong directory when `trailingSlash` is `'never'`).

	Descendant `<MdzRoot>` or `<Mdz base=...>` overrides this via
	`mdz_set_context_with_fallback`, so the usage `+page.svelte`'s
	explicit `MdzRoot base="/docs/usage/"` continues to win.
-->
<MdzRoot base={page.url.pathname} code={DocsLink} codeblock={Code}>
	{@render children()}
</MdzRoot>
