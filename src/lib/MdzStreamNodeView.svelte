<script lang="ts">
	import {resolve} from '$app/paths';

	import {
		mdz_resolve_relative_path,
		mdz_is_safe_reference,
		mdz_is_void_element,
	} from './mdz_helpers.ts';
	import MdzStreamNodeView from './MdzStreamNodeView.svelte';
	import {
		mdz_components_context,
		mdz_elements_context,
		mdz_base_context,
		mdz_code_context,
		mdz_codeblock_context,
	} from './mdz_contexts.ts';
	import type {MdzStreamNode} from './mdz_stream_state.svelte.ts';

	const {
		node,
	}: {
		node: MdzStreamNode;
	} = $props();

	const get_components = mdz_components_context.get_maybe();
	const get_elements = mdz_elements_context.get_maybe();
	const get_mdz_base = mdz_base_context.get_maybe();
	const get_code = mdz_code_context.get_maybe();
	const get_codeblock = mdz_codeblock_context.get_maybe();

	// While a Code/Codeblock container is open, streamed text accumulates in
	// `children`; `MdzStreamState` collapses it into `content` at close. Joining
	// the children makes the content visible as it streams instead of popping in
	// all at once when the fence closes (`content` is preferred after close —
	// it's identical, the children are just retained in the render tree).
	const streaming_content = (n: MdzStreamNode): string =>
		n.content || n.children.map((c) => c.content).join('');
</script>

{#if node.type === 'Element'}
	{@const element_config = get_elements?.()?.get(node.name ?? '')}
	{#if element_config !== undefined}
		{#if mdz_is_void_element(node.name ?? '')}
			<!-- void elements cannot have content — any parsed children are dropped -->
			<svelte:element this={node.name} />
		{:else}
			<svelte:element this={node.name}>
				{#if node.children.length > 0}
					{@render render_children(node.children)}
				{/if}
			</svelte:element>
		{/if}
	{:else}
		{@render render_unregistered_tag(node.name ?? '', node.children)}
	{/if}
{:else if node.type === 'Component'}
	{@const Component = get_components?.()?.get(node.name ?? '')}
	{#if Component}
		<Component>
			{#if node.children.length > 0}
				{@render render_children(node.children)}
			{/if}
		</Component>
	{:else}
		{@render render_unregistered_tag(node.name ?? '', node.children)}
	{/if}
{:else if node.type === 'Text'}
	{node.content}
{:else if node.type === 'Code'}
	{@const Code = get_code?.()}
	{@const code_content = streaming_content(node)}
	{#if Code}
		<Code reference={code_content} />
	{:else}
		<code>{code_content}</code>
	{/if}
{:else if node.type === 'Bold'}
	<strong>{@render render_children(node.children)}</strong>
{:else if node.type === 'Italic'}
	<em>{@render render_children(node.children)}</em>
{:else if node.type === 'Strikethrough'}
	<s>{@render render_children(node.children)}</s>
{:else if node.type === 'Link'}
	{@const reference = node.reference ?? ''}
	{#if !mdz_is_safe_reference(reference)}
		{@render render_children(node.children)}
	{:else if node.link_type === 'internal'}
		{@const skip_resolve = reference.startsWith('#') || reference.startsWith('?')}
		{@const mdz_base = get_mdz_base?.()}
		{#if reference.startsWith('.') && mdz_base}
			{@const resolved = mdz_resolve_relative_path(reference, mdz_base)}
			<a href={resolve(resolved as any)}>{@render render_children(node.children)}</a>
		{:else if skip_resolve || reference.startsWith('.') || !reference.startsWith('/')}
			<!-- Fragment, query, and relative links (including bare references like `foo`) skip resolve() -->
			<!-- resolve() only accepts absolute pathnames or route IDs and throws on anything else -->
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a href={reference}>{@render render_children(node.children)}</a>
		{:else}
			<a href={resolve(reference as any)}>{@render render_children(node.children)}</a>
		{/if}
	{:else}
		<!-- external link -->
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a href={reference} target="_blank" rel="noopener">{@render render_children(node.children)}</a>
	{/if}
{:else if node.type === 'Paragraph'}
	<p>{@render render_children(node.children)}</p>
{:else if node.type === 'List'}
	{#if node.ordered}
		<ol start={node.start_number === 1 ? undefined : node.start_number}>
			{@render render_children(node.children)}
		</ol>
	{:else}
		<ul>{@render render_children(node.children)}</ul>
	{/if}
{:else if node.type === 'ListItem'}
	<li>{@render render_children(node.children)}</li>
{:else if node.type === 'Blockquote'}
	<blockquote>{@render render_children(node.children)}</blockquote>
{:else if node.type === 'Hr'}
	<hr />
{:else if node.type === 'Heading'}
	<svelte:element this={`h${node.level}`} id={node.heading_id || undefined}>
		{@render render_children(node.children)}
	</svelte:element>
{:else if node.type === 'Codeblock'}
	{@const Codeblock = get_codeblock?.()}
	{@const codeblock_content = streaming_content(node)}
	{#if Codeblock}
		<Codeblock lang={node.lang ?? null} content={codeblock_content} />
	{:else}
		<pre><code>{codeblock_content}</code></pre>
	{/if}
{/if}

{#snippet render_children(nodes: Array<MdzStreamNode>)}
	{#each nodes as node (node.id)}
		<MdzStreamNodeView {node} />
	{/each}
{/snippet}

{#snippet render_unregistered_tag(name: string, children: Array<MdzStreamNode>)}
	{#if children.length > 0}
		<code class="color_c_50">&lt;{name}&gt;</code>{@render render_children(children)}<code
			class="color_c_50">&lt;/{name}&gt;</code
		>
	{:else}
		<code class="color_c_50">&lt;{name} /&gt;</code>
	{/if}
{/snippet}
