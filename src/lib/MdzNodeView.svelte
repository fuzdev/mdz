<script lang="ts">
	import { DEV } from 'esm-env';
	import { resolve } from '$app/paths';

	import type { MdzAttribute, MdzNode, MdzNodeTableRow, MdzTableAlign } from './mdz.ts';
	import {
		mdz_classify_link,
		mdz_is_void_element,
		mdz_filter_element_attributes,
		mdz_filter_component_attributes,
		mdz_component_config,
		mdz_format_unregistered_attributes,
		ALLOWED_ELEMENT_ATTRIBUTES
	} from './mdz_helpers.ts';
	import {
		mdz_components_context,
		mdz_elements_context,
		mdz_base_context,
		mdz_code_context,
		mdz_codeblock_context
	} from './mdz_contexts.ts';

	const {
		node,
		nodes,
		source_offsets = false
	}: {
		/**
		 * Puts each node's source offsets on the elements rendered for it, as
		 * `data-mdz-start` and `data-mdz-end` — see `Mdz`'s `source_offsets` for
		 * the contract. A prop rather than a context because offsets index one
		 * source string, so a nested `Mdz` (inside a registered component, say)
		 * must not inherit the switch.
		 *
		 * @default false
		 */
		source_offsets?: boolean;
	} & // exactly one of `node`/`nodes` — the array form renders a whole tree
		// through this single component instance (used by `Mdz`)
		({ node: MdzNode; nodes?: undefined } | { node?: undefined; nodes: Array<MdzNode> }) = $props();

	const get_components = mdz_components_context.get_maybe();
	const get_elements = mdz_elements_context.get_maybe();
	const get_mdz_base = mdz_base_context.get_maybe();
	const get_code = mdz_code_context.get_maybe();
	const get_codeblock = mdz_codeblock_context.get_maybe();

	// `resolve()`'s pathname branch, widened to runtime strings: the app's `Path` union
	// only types known routes, and mdz references are authored content. Sound because
	// `mdz_classify_link` strips the leading slash, so the call never takes the route-id branch.
	const resolve_pathname = resolve as (pathname: string) => string;

	// the boundary renders the placeholder silently, so surface the cause in DEV
	const on_component_error = DEV
		? (error: unknown) => console.error('mdz: component failed to render', error)
		: undefined;
</script>

<!-- The tree renders through recursive snippets rather than recursive
component instances — one component (and one set of context reads) per
tree instead of per node. -->
{#if nodes}
	{@render render_children(nodes)}
{:else if node}
	{@render render_node(node)}
{/if}

{#snippet render_node(node: MdzNode)}
	{#if node.type === 'Element'}
		{@const element_config = get_elements?.()?.get(node.name)}
		{#if element_config === true}
			{@const attrs = mdz_filter_element_attributes(
				node.name,
				node.attributes,
				ALLOWED_ELEMENT_ATTRIBUTES
			)}
			{#if mdz_is_void_element(node.name)}
				<!-- void elements cannot have content — any parsed children are dropped -->
				<svelte:element
					this={node.name}
					{...attrs}
					data-mdz-start={source_offsets ? node.start : undefined}
					data-mdz-end={source_offsets ? node.end : undefined}
				/>
			{:else}
				<svelte:element
					this={node.name}
					{...attrs}
					data-mdz-start={source_offsets ? node.start : undefined}
					data-mdz-end={source_offsets ? node.end : undefined}
				>
					{#if node.children.length > 0}
						{@render render_children(node.children)}
					{/if}
				</svelte:element>
			{/if}
		{:else}
			{@render render_unregistered_tag(node.name, node.attributes, node.children)}
		{/if}
	{:else if node.type === 'Component'}
		{@const entry = get_components?.()?.get(node.name)}
		{#if entry}
			{@const config = mdz_component_config(entry)}
			{@const props = mdz_filter_component_attributes(node.name, node.attributes, config.props)}
			<!-- a per-node boundary: a component that throws (say on an unexpected prop
			value) degrades to its literal placeholder instead of taking down the tree -->
			<svelte:boundary onerror={on_component_error}>
				<config.component {...props}>
					{#if node.children.length > 0}
						{@render render_children(node.children)}
					{/if}
				</config.component>
				{#snippet failed()}
					{@render render_unregistered_tag(node.name, node.attributes, node.children)}
				{/snippet}
			</svelte:boundary>
		{:else}
			{@render render_unregistered_tag(node.name, node.attributes, node.children)}
		{/if}
	{:else if node.type === 'Text'}
		{node.content}
	{:else if node.type === 'Code'}
		{@const Code = get_code?.()}
		{#if Code}
			<Code
				reference={node.content}
				data-mdz-start={source_offsets ? node.start : undefined}
				data-mdz-end={source_offsets ? node.end : undefined}
			/>
		{:else}
			<code
				data-mdz-start={source_offsets ? node.start : undefined}
				data-mdz-end={source_offsets ? node.end : undefined}
			>
				{node.content}
			</code>
		{/if}
	{:else if node.type === 'Bold'}
		<strong
			data-mdz-start={source_offsets ? node.start : undefined}
			data-mdz-end={source_offsets ? node.end : undefined}
		>
			{@render render_children(node.children)}
		</strong>
	{:else if node.type === 'Italic'}
		<em
			data-mdz-start={source_offsets ? node.start : undefined}
			data-mdz-end={source_offsets ? node.end : undefined}
		>
			{@render render_children(node.children)}
		</em>
	{:else if node.type === 'Strikethrough'}
		<s
			data-mdz-start={source_offsets ? node.start : undefined}
			data-mdz-end={source_offsets ? node.end : undefined}
		>
			{@render render_children(node.children)}
		</s>
	{:else if node.type === 'Link'}
		{@const link = mdz_classify_link(node.reference, node.link_type, get_mdz_base?.())}
		{#if link.kind === 'unsafe'}
			{@render render_children(node.children)}
		{:else if link.kind === 'resolve'}
			<a
				href={resolve_pathname(link.path)}
				data-mdz-start={source_offsets ? node.start : undefined}
				data-mdz-end={source_offsets ? node.end : undefined}
			>
				{@render render_children(node.children)}
			</a>
		{:else if link.kind === 'external'}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a
				href={link.href}
				target="_blank"
				rel="noopener"
				data-mdz-start={source_offsets ? node.start : undefined}
				data-mdz-end={source_offsets ? node.end : undefined}
			>
				{@render render_children(node.children)}
			</a>
		{:else}
			<!-- fragment/query/relative/bare references aren't under the base, so they skip resolve() -->
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a
				href={link.href}
				data-mdz-start={source_offsets ? node.start : undefined}
				data-mdz-end={source_offsets ? node.end : undefined}
			>
				{@render render_children(node.children)}
			</a>
		{/if}
	{:else if node.type === 'Paragraph'}
		<p
			data-mdz-start={source_offsets ? node.start : undefined}
			data-mdz-end={source_offsets ? node.end : undefined}
		>
			{@render render_children(node.children)}
		</p>
	{:else if node.type === 'List'}
		{#if node.ordered}
			<ol
				start={node.start_number === 1 ? undefined : node.start_number}
				data-mdz-start={source_offsets ? node.start : undefined}
				data-mdz-end={source_offsets ? node.end : undefined}
			>
				{@render render_children(node.children)}
			</ol>
		{:else}
			<ul
				data-mdz-start={source_offsets ? node.start : undefined}
				data-mdz-end={source_offsets ? node.end : undefined}
			>
				{@render render_children(node.children)}
			</ul>
		{/if}
	{:else if node.type === 'ListItem'}
		<li
			data-mdz-start={source_offsets ? node.start : undefined}
			data-mdz-end={source_offsets ? node.end : undefined}
		>
			{@render render_children(node.children)}
		</li>
	{:else if node.type === 'Blockquote'}
		<blockquote
			data-mdz-start={source_offsets ? node.start : undefined}
			data-mdz-end={source_offsets ? node.end : undefined}
		>
			{@render render_children(node.children)}
		</blockquote>
	{:else if node.type === 'Table'}
		<!-- by grammar the header row is always first (and the only one) — read
		it by index and skip it per-row in the body, rather than filtering
		twice (matches the streaming view, where a filter would go O(n²)
		across a streamed table) -->
		{@const header_row = node.children[0]?.header ? node.children[0] : undefined}
		<table
			data-mdz-start={source_offsets ? node.start : undefined}
			data-mdz-end={source_offsets ? node.end : undefined}
		>
			{#if header_row}
				<thead>
					<tr
						data-mdz-start={source_offsets ? header_row.start : undefined}
						data-mdz-end={source_offsets ? header_row.end : undefined}
					>
						{@render render_cells(header_row, 'th', node.align)}
					</tr>
				</thead>
			{/if}
			{#if node.children.length > (header_row ? 1 : 0)}
				<tbody>
					{#each node.children as row, i (i)}
						{#if !row.header}
							<tr
								data-mdz-start={source_offsets ? row.start : undefined}
								data-mdz-end={source_offsets ? row.end : undefined}
							>
								{@render render_cells(row, 'td', node.align)}
							</tr>
						{/if}
					{/each}
				</tbody>
			{/if}
		</table>
	{:else if node.type === 'Hr'}
		<hr
			data-mdz-start={source_offsets ? node.start : undefined}
			data-mdz-end={source_offsets ? node.end : undefined}
		/>
	{:else if node.type === 'Heading'}
		<svelte:element
			this={`h${node.level}`}
			id={node.id || undefined}
			data-mdz-start={source_offsets ? node.start : undefined}
			data-mdz-end={source_offsets ? node.end : undefined}
		>
			{@render render_children(node.children)}
		</svelte:element>
	{:else if node.type === 'Codeblock'}
		{@const Codeblock = get_codeblock?.()}
		{#if Codeblock}
			<Codeblock
				lang={node.lang}
				content={node.content}
				data-mdz-start={source_offsets ? node.start : undefined}
				data-mdz-end={source_offsets ? node.end : undefined}
			/>
		{:else}
			<pre
				data-mdz-start={source_offsets ? node.start : undefined}
				data-mdz-end={source_offsets ? node.end : undefined}><code>{node.content}</code></pre>
		{/if}
	{/if}
{/snippet}

{#snippet render_children(nodes: Array<MdzNode>)}
	<!-- index keys, not object identity: `mdz_parse` yields a fresh node graph
	on every `content` change, so identity keys never match and Svelte rebuilds
	the whole subtree; positional keys let it patch in place. (Sync nodes have
	no stable id; the stream view keys by `node.id`.) -->
	{#each nodes as node, i (i)}
		{@render render_node(node)}
	{/each}
{/snippet}

{#snippet render_cells(row: MdzNodeTableRow, tag: 'th' | 'td', align: Array<MdzTableAlign>)}
	<!-- normalize to the column count: pad short rows, ignore extra cells -->
	{#each align as a, i (i)}
		{@const cell = row.children[i]}
		<svelte:element
			this={tag}
			style={a ? `text-align:${a}` : undefined}
			data-mdz-start={source_offsets && cell ? cell.start : undefined}
			data-mdz-end={source_offsets && cell ? cell.end : undefined}
		>
			{#if cell}{@render render_children(cell.children)}{/if}
		</svelte:element>
	{/each}
{/snippet}

{#snippet render_unregistered_tag(
	name: string,
	attributes: Array<MdzAttribute>,
	children: Array<MdzNode>
)}
	{@const formatted = mdz_format_unregistered_attributes(attributes)}
	{#if children.length > 0}
		<code class="color_c_50">&lt;{name}{formatted}&gt;</code>{@render render_children(
			children
		)}<code class="color_c_50">&lt;/{name}&gt;</code>
	{:else}
		<code class="color_c_50">&lt;{name}{formatted} /&gt;</code>
	{/if}
{/snippet}
