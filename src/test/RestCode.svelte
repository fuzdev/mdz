<script lang="ts">
	import type { SvelteHTMLElements } from 'svelte/elements';

	// test-only component: stands in for an injected `code` or `codeblock`
	// component that spreads rest props onto its root element, like fuz_ui's
	// `DocsLink` and fuz_code's `Code`
	const {
		reference,
		content,
		lang: _lang,
		...rest
	}: SvelteHTMLElements['code'] & {
		reference?: string;
		content?: string;
		lang?: string | null;
	} = $props();
</script>

<code data-rest-code {...rest}>{reference ?? content}</code>
