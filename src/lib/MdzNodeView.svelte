<script lang="ts">
	import {resolve} from '$app/paths';

	import type {MdzNode, MdzNodeTableRow, MdzTableAlign} from './mdz.ts';
	import {
		mdz_resolve_relative_path,
		mdz_is_safe_reference,
		mdz_is_void_element,
	} from './mdz_helpers.ts';
	import MdzNodeView from './MdzNodeView.svelte';
	import {
		mdz_components_context,
		mdz_elements_context,
		mdz_base_context,
		mdz_code_context,
		mdz_codeblock_context,
	} from './mdz_contexts.ts';

	const {
		node,
	}: {
		node: MdzNode;
	} = $props();

	const get_components = mdz_components_context.get_maybe();
	const get_elements = mdz_elements_context.get_maybe();
	const get_mdz_base = mdz_base_context.get_maybe();
	const get_code = mdz_code_context.get_maybe();
	const get_codeblock = mdz_codeblock_context.get_maybe();
</script>

{#if node.type === 'Element'}
	{@const element_config = get_elements?.()?.get(node.name)}
	{#if element_config !== undefined}
		{#if mdz_is_void_element(node.name)}
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
		{@render render_unregistered_tag(node.name, node.children)}
	{/if}
{:else if node.type === 'Component'}
	{@const Component = get_components?.()?.get(node.name)}
	{#if Component}
		<Component>
			{#if node.children.length > 0}
				{@render render_children(node.children)}
			{/if}
		</Component>
	{:else}
		{@render render_unregistered_tag(node.name, node.children)}
	{/if}
{:else if node.type === 'Text'}
	{node.content}
{:else if node.type === 'Code'}
	{@const Code = get_code?.()}
	{#if Code}
		<Code reference={node.content} />
	{:else}
		<code>{node.content}</code>
	{/if}
{:else if node.type === 'Bold'}
	<strong>{@render render_children(node.children)}</strong>
{:else if node.type === 'Italic'}
	<em>{@render render_children(node.children)}</em>
{:else if node.type === 'Strikethrough'}
	<s>{@render render_children(node.children)}</s>
{:else if node.type === 'Link'}
	{@const {reference} = node}
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
{:else if node.type === 'Table'}
	{@const header_rows = node.children.filter((r) => r.header)}
	{@const body_rows = node.children.filter((r) => !r.header)}
	<table>
		{#if header_rows.length > 0}
			<thead>
				{#each header_rows as row (row)}
					<tr>{@render render_cells(row, 'th', node.align)}</tr>
				{/each}
			</thead>
		{/if}
		{#if body_rows.length > 0}
			<tbody>
				{#each body_rows as row (row)}
					<tr>{@render render_cells(row, 'td', node.align)}</tr>
				{/each}
			</tbody>
		{/if}
	</table>
{:else if node.type === 'Hr'}
	<hr />
{:else if node.type === 'Heading'}
	<svelte:element this={`h${node.level}`} id={node.id || undefined}>
		{@render render_children(node.children)}
	</svelte:element>
{:else if node.type === 'Codeblock'}
	{@const Codeblock = get_codeblock?.()}
	{#if Codeblock}
		<Codeblock lang={node.lang} content={node.content} />
	{:else}
		<pre><code>{node.content}</code></pre>
	{/if}
{/if}

{#snippet render_children(nodes: Array<MdzNode>)}
	{#each nodes as node (node)}
		<MdzNodeView {node} />
	{/each}
{/snippet}

{#snippet render_cells(row: MdzNodeTableRow, tag: 'th' | 'td', align: Array<MdzTableAlign>)}
	<!-- normalize to the column count: pad short rows, ignore extra cells -->
	{#each align as a, i (i)}
		{@const cell = row.children[i]}
		<svelte:element this={tag} style={a ? `text-align:${a}` : undefined}>
			{#if cell}{@render render_children(cell.children)}{/if}
		</svelte:element>
	{/each}
{/snippet}

{#snippet render_unregistered_tag(name: string, children: Array<MdzNode>)}
	{#if children.length > 0}
		<code class="color_c_50">&lt;{name}&gt;</code>{@render render_children(children)}<code
			class="color_c_50">&lt;/{name}&gt;</code
		>
	{:else}
		<code class="color_c_50">&lt;{name} /&gt;</code>
	{/if}
{/snippet}
