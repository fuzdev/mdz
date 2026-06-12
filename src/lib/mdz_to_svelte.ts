/**
 * Converts parsed `MdzNode` arrays to Svelte markup strings.
 *
 * Used by the `svelte_preprocess_mdz` preprocessor to expand static `<Mdz content="...">` usages
 * into pre-rendered Svelte markup at build time. The output for each node type matches what
 * `MdzNodeView.svelte` renders at runtime, so precompiled and runtime rendering are identical.
 *
 * @module
 */

import {UnreachableError} from '@fuzdev/fuz_util/error.js';
import {escape_svelte_text} from '@fuzdev/fuz_util/svelte_preprocess_helpers.js';
import {escape_js_string} from '@fuzdev/fuz_util/string.js';

import type {MdzNode} from './mdz.js';
import {mdz_resolve_relative_path, mdz_is_void_element} from './mdz_helpers.js';

/**
 * Result of converting `MdzNode` arrays to Svelte markup.
 */
export interface MdzToSvelteResult {
	/** Generated Svelte markup string. */
	markup: string;

	/** Required imports: `Map<local_name, {path, kind}>`. */
	imports: Map<string, {path: string; kind: 'default' | 'named'}>;

	/** Whether content references unconfigured Component or Element tags. */
	has_unconfigured_tags: boolean;
}

/** Derives an import's local identifier from a `.svelte` import path's basename. */
const component_local_name = (import_path: string): string =>
	import_path.slice(import_path.lastIndexOf('/') + 1).replace(/\.svelte$/, '');

/**
 * Options for `mdz_to_svelte`.
 */
export interface MdzToSvelteOptions {
	/**
	 * Component name to import path mapping (e.g., `{Alert: '$lib/Alert.svelte'}`).
	 * If content references a component not in this map, `has_unconfigured_tags` is set.
	 */
	components: Record<string, string>;

	/**
	 * Allowed HTML elements (e.g., `{aside: true, details: true}`).
	 * Values are boolean placeholders for future per-element configuration,
	 * mirroring the runtime `MdzElements` registry.
	 * If content references an element not in this record, `has_unconfigured_tags` is set.
	 */
	elements: Record<string, boolean>;

	/**
	 * Base path for resolving relative links (e.g., `'/docs/usage/'`).
	 * When provided, relative references (`./`, `../`) are resolved to absolute paths
	 * and passed through `resolve()`. Trailing slash recommended.
	 */
	base?: string;

	/**
	 * Import path for the inline `code` component (receives `reference`).
	 * When omitted, inline code renders as a plain `<code>` element — matching
	 * `MdzNodeView.svelte`'s runtime default, so precompiled and runtime output
	 * stay identical per configuration.
	 */
	code_component_import?: string;

	/**
	 * Import path for the codeblock component (receives `lang` and `content`).
	 * When omitted, code blocks render as a plain `<pre><code>` element —
	 * matching `MdzNodeView.svelte`'s runtime default.
	 */
	codeblock_component_import?: string;
}

/**
 * Converts an array of `MdzNode` to a Svelte markup string.
 *
 * Each node type produces output matching what `MdzNodeView.svelte` renders at runtime.
 * Collects required imports and flags unconfigured component/element references.
 *
 * @param nodes - parsed mdz nodes to render
 * @param options - rendering configuration matching the runtime context surface
 */
export const mdz_to_svelte = (
	nodes: Array<MdzNode>,
	options: MdzToSvelteOptions,
): MdzToSvelteResult => {
	const {components, elements, base, code_component_import, codeblock_component_import} = options;
	const imports: Map<string, {path: string; kind: 'default' | 'named'}> = new Map();
	let has_unconfigured_tags = false;

	const render_nodes = (children: Array<MdzNode>): string => {
		return children.map((child) => render_node(child)).join('');
	};

	const render_node = (node: MdzNode): string => {
		switch (node.type) {
			case 'Text':
				return escape_svelte_text(node.content);

			case 'Code': {
				if (!code_component_import) {
					return `<code>${escape_svelte_text(node.content)}</code>`;
				}
				const name = component_local_name(code_component_import);
				imports.set(name, {path: code_component_import, kind: 'default'});
				return `<${name} reference={'${escape_js_string(node.content)}'} />`;
			}

			case 'Codeblock': {
				const lang_attr =
					node.lang === null ? 'lang={null}' : `lang={'${escape_js_string(node.lang)}'}`;
				if (!codeblock_component_import) {
					return `<pre><code>${escape_svelte_text(node.content)}</code></pre>`;
				}
				const name = component_local_name(codeblock_component_import);
				imports.set(name, {path: codeblock_component_import, kind: 'default'});
				return `<${name} ${lang_attr} content={'${escape_js_string(node.content)}'} />`;
			}

			case 'Bold':
				return `<strong>${render_nodes(node.children)}</strong>`;

			case 'Italic':
				return `<em>${render_nodes(node.children)}</em>`;

			case 'Strikethrough':
				return `<s>${render_nodes(node.children)}</s>`;

			case 'Link': {
				const children_markup = render_nodes(node.children);
				if (node.link_type === 'internal') {
					if (node.reference.startsWith('.') && base) {
						const resolved = mdz_resolve_relative_path(node.reference, base);
						imports.set('resolve', {path: '$app/paths', kind: 'named'});
						return `<a href={resolve('${escape_js_string(resolved)}')}>${children_markup}</a>`;
					}
					if (
						node.reference.startsWith('#') ||
						node.reference.startsWith('?') ||
						node.reference.startsWith('.') ||
						// Bare references (e.g. `foo`) aren't absolute — resolve() throws on them
						!node.reference.startsWith('/')
					) {
						return `<a href={'${escape_js_string(node.reference)}'}>${children_markup}</a>`;
					}
					imports.set('resolve', {path: '$app/paths', kind: 'named'});
					return `<a href={resolve('${escape_js_string(node.reference)}')}>${children_markup}</a>`;
				}
				// External link — matches MdzNodeView: target="_blank" rel="noopener"
				return `<a href={'${escape_js_string(node.reference)}'} target="_blank" rel="noopener">${children_markup}</a>`;
			}

			case 'Paragraph':
				return `<p>${render_nodes(node.children)}</p>`;

			case 'List': {
				const tag = node.ordered ? 'ol' : 'ul';
				const start_attr =
					node.ordered && node.start_number !== undefined && node.start_number !== 1
						? ` start={${node.start_number}}`
						: '';
				return `<${tag}${start_attr}>${render_nodes(node.children)}</${tag}>`;
			}

			case 'ListItem':
				return `<li>${render_nodes(node.children)}</li>`;

			case 'Blockquote':
				return `<blockquote>${render_nodes(node.children)}</blockquote>`;

			case 'Hr':
				return '<hr />';

			case 'Heading': {
				// matches MdzNodeView's `id={node.id || undefined}` — the slugified
				// fragment anchor, omitted when the text has no sluggable characters
				const id_attr = node.id ? ` id={'${escape_js_string(node.id)}'}` : '';
				return `<h${node.level}${id_attr}>${render_nodes(node.children)}</h${node.level}>`;
			}

			case 'Element': {
				if (elements[node.name] === undefined) {
					has_unconfigured_tags = true;
					return '';
				}
				if (mdz_is_void_element(node.name)) {
					// void elements cannot have content — any parsed children are dropped
					return `<${node.name} />`;
				}
				return `<${node.name}>${render_nodes(node.children)}</${node.name}>`;
			}

			case 'Component': {
				const import_path = components[node.name];
				if (!import_path) {
					has_unconfigured_tags = true;
					return '';
				}
				imports.set(node.name, {path: import_path, kind: 'default'});
				return `<${node.name}>${render_nodes(node.children)}</${node.name}>`;
			}

			default:
				throw new UnreachableError(node);
		}
	};

	const markup = render_nodes(nodes);
	return {markup, imports, has_unconfigured_tags};
};
