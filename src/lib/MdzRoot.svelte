<script lang="ts">
	import type {Snippet} from 'svelte';

	import {
		mdz_base_context,
		mdz_code_context,
		mdz_codeblock_context,
		mdz_components_context,
		mdz_elements_context,
		mdz_set_context_with_fallback,
		type MdzCodeComponent,
		type MdzCodeblockComponent,
		type MdzComponents,
		type MdzElements,
	} from './mdz_contexts.ts';

	const {
		base,
		components,
		elements,
		code,
		codeblock,
		children,
	}: {
		base?: string;
		components?: MdzComponents;
		elements?: MdzElements;
		code?: MdzCodeComponent;
		codeblock?: MdzCodeblockComponent;
		children: Snippet;
	} = $props();

	mdz_set_context_with_fallback(mdz_base_context, () => base);
	mdz_set_context_with_fallback(mdz_components_context, () => components);
	mdz_set_context_with_fallback(mdz_elements_context, () => elements);
	mdz_set_context_with_fallback(mdz_code_context, () => code);
	mdz_set_context_with_fallback(mdz_codeblock_context, () => codeblock);
</script>

{@render children()}
