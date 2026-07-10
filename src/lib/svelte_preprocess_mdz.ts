/**
 * Svelte preprocessor that compiles static `Mdz` content to Svelte markup at build time.
 *
 * Detects `Mdz` components with static string `content` props, parses the mdz content,
 * renders each `MdzNode` to equivalent Svelte markup via `mdz_to_svelte`, and replaces
 * the `Mdz` with `MdzPrecompiled` containing pre-rendered children.
 *
 * Also handles ternary chains (`content={a ? 'x' : b ? 'y' : 'z'}`) where all leaf
 * values are statically resolvable strings, emitting `{#if a}markup_x{:else if b}markup_y{:else}markup_z{/if}`
 * as children of a single `MdzPrecompiled`.
 *
 * Truly dynamic `content` props are left untouched.
 *
 * @module
 */

import type {ImportDeclaration, VariableDeclaration} from 'estree';
import {parse, type PreprocessorGroup, type AST} from 'svelte/compiler';
import MagicString from 'magic-string';
import {walk} from 'zimmerframe';
import {should_exclude_path} from '@fuzdev/fuz_util/path.ts';
import {
	find_attribute,
	extract_static_string,
	try_extract_conditional_chain,
	build_static_bindings,
	resolve_component_names,
	has_identifier_in_tree,
	find_import_insert_position,
	generate_import_lines,
	remove_variable_declaration,
	remove_import_declaration,
	remove_import_specifier,
	handle_preprocess_error,
	type PreprocessImportInfo,
	type ResolvedComponentImport,
} from '@fuzdev/fuz_util/svelte_preprocess_helpers.ts';

import {mdz_parse} from './mdz.ts';
import {mdz_to_svelte, type MdzToSvelteResult} from './mdz_to_svelte.ts';

/**
 * An estree `ImportDeclaration` augmented with Svelte's position data.
 * Svelte's parser adds `start`/`end` to all AST nodes, but the estree
 * types don't declare them.
 */
type PositionedImportDeclaration = ImportDeclaration & AST.BaseNode;

/**
 * Options for `svelte_preprocess_mdz`.
 */
export interface SveltePreprocessMdzOptions {
	/** File patterns to exclude. */
	exclude?: Array<string | RegExp>;

	/**
	 * Component import mapping for mdz content.
	 * Key: component name as used in mdz (e.g., 'Alert').
	 * Value: import path (e.g., '$lib/Alert.svelte').
	 *
	 * If mdz content references a component not in this map,
	 * that `Mdz` usage is skipped (left as runtime).
	 */
	components?: Record<string, string>;

	/**
	 * Allowed HTML elements in mdz content (e.g., `{aside: true, details: true}`).
	 * Values are boolean placeholders for future per-element configuration,
	 * mirroring the runtime `MdzElements` registry.
	 * If mdz content references an element not in this record,
	 * that `Mdz` usage is skipped (left as runtime).
	 */
	elements?: Record<string, boolean>;

	/**
	 * Import sources that resolve to the `Mdz` component.
	 * Used to verify that `Mdz` in templates refers to mdz's `Mdz.svelte`.
	 *
	 * @default ['@fuzdev/mdz/Mdz.svelte']
	 */
	mdz_component_imports?: Array<string>;

	/**
	 * Import path for the precompiled wrapper component.
	 *
	 * @default '@fuzdev/mdz/MdzPrecompiled.svelte'
	 */
	compiled_component_import?: string;

	/**
	 * Import path for the inline `code` component (receives `reference`).
	 * When omitted, inline code compiles to a plain `<code>` element, matching
	 * `Mdz`'s runtime default. Set e.g. to `@fuzdev/fuz_ui/DocsLink.svelte` to
	 * auto-link backticked identifiers.
	 */
	code_component_import?: string;

	/**
	 * Import path for the codeblock component (receives `lang` and `content`).
	 * When omitted, code blocks compile to a plain `<pre><code>` element. Set
	 * e.g. to `@fuzdev/fuz_code/Code.svelte` for syntax highlighting.
	 */
	codeblock_component_import?: string;

	/**
	 * How to handle errors during mdz parsing or rendering.
	 *
	 * @default 'throw' in CI, 'log' otherwise
	 */
	on_error?: 'log' | 'throw';
}

const PRECOMPILED_NAME = 'MdzPrecompiled';

/**
 * Creates a Svelte preprocessor that compiles static `Mdz` content at build time.
 *
 * @param options - configuration for component/element resolution and file filtering
 * @returns a Svelte `PreprocessorGroup` for use in `svelte.config.js`
 */
export const svelte_preprocess_mdz = (
	options: SveltePreprocessMdzOptions = {},
): PreprocessorGroup => {
	const {
		exclude = [],
		components = {},
		elements = {},
		mdz_component_imports = ['@fuzdev/mdz/Mdz.svelte'],
		compiled_component_import = '@fuzdev/mdz/MdzPrecompiled.svelte',
		code_component_import,
		codeblock_component_import,
		on_error = process.env.CI === 'true' ? 'throw' : 'log',
	} = options;

	return {
		name: 'fuz-mdz',

		markup: ({content, filename}) => {
			if (should_exclude_path(filename, exclude)) {
				return {code: content};
			}

			// Quick bail: does file mention any known Mdz import source?
			if (!mdz_component_imports.some((source) => content.includes(source))) {
				return {code: content};
			}

			const ast = parse(content, {filename, modern: true});

			// Resolve which local names map to the Mdz component
			const mdz_names = resolve_component_names(ast, mdz_component_imports);
			if (mdz_names.size === 0) {
				return {code: content};
			}

			// Check for MdzPrecompiled name collision
			if (has_name_collision(ast, compiled_component_import)) {
				return {code: content};
			}

			const s = new MagicString(content);
			const bindings = build_static_bindings(ast);

			// Find and transform Mdz usages with static content
			const {transformations, total_usages, transformed_usages} = find_mdz_usages(ast, mdz_names, {
				components,
				elements,
				filename,
				source: content,
				bindings,
				on_error,
				code_component_import,
				codeblock_component_import,
			});

			if (transformations.length === 0) {
				return {code: content};
			}

			// Apply transformations
			for (const t of transformations) {
				s.overwrite(t.start, t.end, t.replacement);
			}

			// Remove dead const bindings that were consumed by transformations
			remove_dead_const_bindings(s, ast, transformations, content);

			// Determine which Mdz imports can be removed
			const removable_imports = find_removable_mdz_imports(
				ast,
				mdz_names,
				total_usages,
				transformed_usages,
			);

			// Add required imports and remove unused Mdz imports
			manage_imports(
				s,
				ast,
				transformations,
				removable_imports,
				compiled_component_import,
				content,
			);

			return {
				code: s.toString(),
				map: s.generateMap({hires: true}),
			};
		},
	};
};

interface MdzTransformation {
	start: number;
	end: number;
	replacement: string;
	required_imports: Map<string, PreprocessImportInfo>;
	/** Const binding names that were resolved to produce this transformation. */
	consumed_bindings: Set<string>;
	/** The original AST component node, used to skip during dead code analysis. */
	component_node: AST.Component;
}

interface FindMdzUsagesResult {
	transformations: Array<MdzTransformation>;
	/** Total template usages per `Mdz` local name. */
	total_usages: Map<string, number>;
	/** Successfully transformed usages per `Mdz` local name. */
	transformed_usages: Map<string, number>;
}

interface FindMdzUsagesContext {
	components: Record<string, string>;
	elements: Record<string, boolean>;
	filename: string | undefined;
	source: string;
	bindings: ReadonlyMap<string, string>;
	on_error: 'log' | 'throw';
	code_component_import: string | undefined;
	codeblock_component_import: string | undefined;
}

/**
 * Checks if `MdzPrecompiled` is already imported from a different source.
 * If so, the preprocessor bails to avoid name collisions.
 */
const has_name_collision = (ast: AST.Root, compiled_component_import: string): boolean => {
	for (const script of [ast.instance, ast.module]) {
		if (!script) continue;
		for (const node of script.content.body) {
			if (node.type !== 'ImportDeclaration') continue;
			const source_path = node.source.value as string;
			for (const spec of node.specifiers) {
				if (spec.local.name === PRECOMPILED_NAME && source_path !== compiled_component_import) {
					return true;
				}
			}
		}
	}
	return false;
};

/**
 * Collects identifiers from an expression that resolved through bindings.
 * Only collects top-level Identifier nodes that appear in the bindings map.
 *
 * TODO: support transitive dead const removal — currently only directly-consumed
 * bindings (identifiers in the expression AST) are tracked. Transitive dependencies
 * (e.g., `const a = 'x'; const b = a; content={b}` — `a` is not removed) are not
 * traced. After removing a dead const, re-check whether identifiers in its
 * initializer became dead too.
 */
const collect_consumed_bindings = (
	value: AST.Attribute['value'],
	bindings: ReadonlyMap<string, string>,
): Set<string> => {
	const consumed: Set<string> = new Set();
	if (value === true || Array.isArray(value)) return consumed;
	const collect_from_expr = (expr: {type: string; [key: string]: any}): void => {
		if (expr.type === 'Identifier' && bindings.has(expr.name)) {
			consumed.add(expr.name);
		} else if (expr.type === 'BinaryExpression' && expr.operator === '+') {
			collect_from_expr(expr.left);
			collect_from_expr(expr.right);
		} else if (expr.type === 'TemplateLiteral') {
			for (const e of expr.expressions) {
				collect_from_expr(e);
			}
		} else if (expr.type === 'ConditionalExpression') {
			collect_from_expr(expr.consequent);
			collect_from_expr(expr.alternate);
		}
	};
	collect_from_expr(value.expression);
	return consumed;
};

/**
 * Parse a static mdz string and render it to Svelte markup. Returns `null` to
 * leave the usage for the runtime — either the content raised a parse error
 * (reported via `on_error`) or it contains unconfigured tags (which the
 * precompiler emits nothing for; the runtime renders the fallback chrome).
 */
const render_static_mdz = (
	content: string,
	base: string | undefined,
	context: FindMdzUsagesContext,
): MdzToSvelteResult | null => {
	let result: MdzToSvelteResult;
	try {
		result = mdz_to_svelte(mdz_parse(content), {
			components: context.components,
			elements: context.elements,
			base,
			code_component_import: context.code_component_import,
			codeblock_component_import: context.codeblock_component_import,
		});
	} catch (error) {
		handle_preprocess_error(error, '[fuz-mdz]', context.filename, context.on_error);
		return null;
	}
	return result.has_unconfigured_tags ? null : result;
};

/**
 * Walks the AST to find `Mdz` component usages with static `content` props
 * and generates transformations to replace them with `MdzPrecompiled` children.
 */
const find_mdz_usages = (
	ast: AST.Root,
	mdz_names: Map<string, ResolvedComponentImport>,
	context: FindMdzUsagesContext,
): FindMdzUsagesResult => {
	const transformations: Array<MdzTransformation> = [];
	const total_usages: Map<string, number> = new Map();
	const transformed_usages: Map<string, number> = new Map();

	// zimmerframe types visitors against {type: string}, requiring explicit annotations
	// on the callback parameters for Svelte-specific AST types like AST.Component
	walk(ast.fragment as any, null, {
		Component(node: AST.Component, ctx: {next: () => void}) {
			// Always recurse into children so nested Mdz components are found
			ctx.next();

			if (!mdz_names.has(node.name)) return;

			// Track total usages per name
			total_usages.set(node.name, (total_usages.get(node.name) ?? 0) + 1);

			// Skip if spread attributes present — can't determine content statically
			if (node.attributes.some((attr) => attr.type === 'SpreadAttribute')) return;

			const content_attr = find_attribute(node, 'content');
			if (!content_attr) return;

			// Extract optional static base prop for relative path resolution.
			// If base is present but dynamic, skip precompilation entirely —
			// MdzPrecompiled doesn't resolve relative paths at runtime,
			// so precompiling with unresolved relative links would be wrong.
			const base_attr = find_attribute(node, 'base');
			let base: string | undefined;
			if (base_attr) {
				const base_value = extract_static_string(base_attr.value, context.bindings);
				if (base_value === null) return; // dynamic base — fall back to runtime
				base = base_value;
			}

			// Collect attributes to exclude from precompiled output
			const exclude_attrs: Set<AST.Attribute> = new Set([content_attr]);
			if (base_attr) exclude_attrs.add(base_attr);

			// Extract static string value
			const content_value = extract_static_string(content_attr.value, context.bindings);
			if (content_value !== null) {
				const result = render_static_mdz(content_value, base, context);
				if (result === null) return; // parse error or unconfigured tags — leave for runtime

				const consumed = collect_consumed_bindings(content_attr.value, context.bindings);
				const replacement = build_replacement(node, exclude_attrs, result.markup, context.source);
				transformed_usages.set(node.name, (transformed_usages.get(node.name) ?? 0) + 1);
				transformations.push({
					start: node.start,
					end: node.end,
					replacement,
					required_imports: result.imports,
					consumed_bindings: consumed,
					component_node: node,
				});
				return;
			}

			// Try conditional chain (handles both simple and nested ternaries)
			const chain = try_extract_conditional_chain(
				content_attr.value,
				context.source,
				context.bindings,
			);
			if (chain === null) return;

			// Parse and render each branch
			const branch_results: Array<{markup: string; imports: Map<string, PreprocessImportInfo>}> =
				[];
			for (const branch of chain) {
				const result = render_static_mdz(branch.value, base, context);
				if (result === null) return; // parse error or unconfigured tags — leave for runtime
				branch_results.push({markup: result.markup, imports: result.imports});
			}

			// Build {#if}/{:else if}/{:else} markup
			let children_markup = '';
			for (let i = 0; i < chain.length; i++) {
				const branch = chain[i]!;
				const result = branch_results[i]!;
				if (i === 0) {
					children_markup += `{#if ${branch.test_source}}${result.markup}`;
				} else if (branch.test_source !== null) {
					children_markup += `{:else if ${branch.test_source}}${result.markup}`;
				} else {
					children_markup += `{:else}${result.markup}`;
				}
			}
			children_markup += '{/if}';

			const replacement = build_replacement(node, exclude_attrs, children_markup, context.source);

			// Merge imports from all branches
			const merged_imports: Map<string, PreprocessImportInfo> = new Map();
			for (const result of branch_results) {
				for (const [name, info] of result.imports) {
					merged_imports.set(name, info);
				}
			}

			const consumed = collect_consumed_bindings(content_attr.value, context.bindings);
			transformed_usages.set(node.name, (transformed_usages.get(node.name) ?? 0) + 1);
			transformations.push({
				start: node.start,
				end: node.end,
				replacement,
				required_imports: merged_imports,
				consumed_bindings: consumed,
				component_node: node,
			});
		},
	});

	return {transformations, total_usages, transformed_usages};
};

/**
 * Removes dead `const` bindings from the instance script that were consumed
 * by transformations and are no longer referenced anywhere else in the file.
 *
 * Only handles single-declarator `const` statements. Skips `const a = 'x', b = 'y'`
 * and module script variables (which could be exported/imported by other files).
 */
const remove_dead_const_bindings = (
	s: MagicString,
	ast: AST.Root,
	transformations: Array<MdzTransformation>,
	source: string,
): void => {
	// Collect all consumed binding names across transformations
	const all_consumed: Set<string> = new Set();
	for (const t of transformations) {
		for (const name of t.consumed_bindings) {
			all_consumed.add(name);
		}
	}
	if (all_consumed.size === 0) return;

	// Only remove from instance script (module script variables could be exported)
	const instance = ast.instance;
	if (!instance) return;

	// Build a skip set of transformed component nodes so their attribute
	// expressions (which still contain the old identifiers) don't false-match
	const skip: Set<unknown> = new Set();
	for (const t of transformations) {
		skip.add(t.component_node);
	}

	for (const name of all_consumed) {
		// Find the VariableDeclaration containing this binding in instance script
		let declaration_node: (VariableDeclaration & {start: number; end: number}) | null = null;
		for (const node of instance.content.body) {
			if (node.type !== 'VariableDeclaration' || node.kind !== 'const') continue;
			for (const decl of node.declarations) {
				if (decl.id.type === 'Identifier' && decl.id.name === name) {
					declaration_node = node as VariableDeclaration & {start: number; end: number};
					break;
				}
			}
			if (declaration_node) break;
		}

		if (!declaration_node) continue;

		// Only handle single-declarator statements
		if (declaration_node.declarations.length !== 1) continue;

		// Check if the identifier is referenced anywhere else
		const id_skip = new Set([...skip, declaration_node]);

		// Check instance script (excluding the declaration itself)
		if (has_identifier_in_tree(instance.content, name, id_skip)) continue;

		// Check module script
		if (ast.module?.content && has_identifier_in_tree(ast.module.content, name)) continue;

		// Check template — skip transformed component nodes whose attribute expressions
		// still contain the old identifier references in the AST
		if (has_identifier_in_tree(ast.fragment, name, id_skip)) continue;

		remove_variable_declaration(s, declaration_node, source);
		// Add to skip set so chained dead const checks don't find references to this removed node
		skip.add(declaration_node);
	}
};

/**
 * Builds the replacement string for a transformed `Mdz` component.
 *
 * Reconstructs the opening tag as `<MdzPrecompiled` with all attributes except `content`,
 * using source text slicing to preserve exact formatting and dynamic expressions.
 */
const build_replacement = (
	node: AST.Component,
	exclude_attrs: ReadonlySet<AST.Attribute>,
	children_markup: string,
	source: string,
): string => {
	// Collect source ranges of all attributes except excluded ones (content, base when resolved)
	const other_attr_ranges: Array<{start: number; end: number}> = [];
	for (const attr of node.attributes) {
		if (exclude_attrs.has(attr as AST.Attribute)) continue;
		other_attr_ranges.push({start: attr.start, end: attr.end});
	}

	// Build opening tag with MdzPrecompiled name
	let opening = `<${PRECOMPILED_NAME}`;
	for (const range of other_attr_ranges) {
		opening += ' ' + source.slice(range.start, range.end);
	}
	opening += '>';

	return `${opening}${children_markup}</${PRECOMPILED_NAME}>`;
};

/** Result of import removability analysis for a single `Mdz` name. */
interface ImportRemovalAction {
	/** The import declaration node. */
	node: PositionedImportDeclaration;
	/** 'full' removes the entire declaration; 'partial' removes only the `Mdz` specifier. */
	kind: 'full' | 'partial';
	/** For partial removal: the specifier to remove. */
	specifier_to_remove?: ImportDeclaration['specifiers'][number];
}

/**
 * Determines which `Mdz` import declarations can be safely removed or trimmed.
 *
 * An import is removable when:
 * 1. All template usages of that name were successfully transformed.
 * 2. The identifier is not referenced elsewhere in script or template expressions.
 *
 * For multi-specifier imports, only the `Mdz` specifier is removed (partial removal).
 * For single-specifier imports, the entire declaration is removed.
 */
const find_removable_mdz_imports = (
	ast: AST.Root,
	mdz_names: Map<string, ResolvedComponentImport>,
	total_usages: Map<string, number>,
	transformed_usages: Map<string, number>,
): Map<string, ImportRemovalAction> => {
	const removable: Map<string, ImportRemovalAction> = new Map();

	for (const [name, {import_node, specifier}] of mdz_names) {
		const total = total_usages.get(name) ?? 0;
		const transformed = transformed_usages.get(name) ?? 0;

		// Only remove if ALL template usages were transformed
		if (total === 0 || transformed < total) continue;

		// Check if identifier is referenced elsewhere in the AST
		const skip: Set<unknown> = new Set([import_node]);

		// Check instance script body (excluding the import itself)
		if (ast.instance?.content && has_identifier_in_tree(ast.instance.content, name, skip)) {
			continue;
		}

		// Check module script body (excluding the import itself)
		if (ast.module?.content && has_identifier_in_tree(ast.module.content, name, skip)) {
			continue;
		}

		// Check template for expression references (Component.name is a string, not Identifier)
		if (has_identifier_in_tree(ast.fragment, name)) {
			continue;
		}

		const positioned_node = import_node as PositionedImportDeclaration;
		if (import_node.specifiers.length === 1) {
			removable.set(name, {node: positioned_node, kind: 'full'});
		} else {
			removable.set(name, {
				node: positioned_node,
				kind: 'partial',
				specifier_to_remove: specifier,
			});
		}
	}

	return removable;
};

/**
 * Manages import additions and removals.
 *
 * Adds the `MdzPrecompiled` import and other required imports (injected code/codeblock
 * components, resolve).
 * Removes `Mdz` import declarations that are no longer referenced.
 *
 * Handles both full removal (single-specifier imports) and partial removal
 * (multi-specifier imports where only the `Mdz` specifier is removed).
 *
 * To avoid MagicString boundary conflicts when the insertion position falls inside
 * a removal range, one removable `Mdz` import is overwritten with the `MdzPrecompiled`
 * import line instead of using separate remove + appendLeft.
 */
const manage_imports = (
	s: MagicString,
	ast: AST.Root,
	transformations: Array<MdzTransformation>,
	removable_imports: Map<string, ImportRemovalAction>,
	compiled_component_import: string,
	source: string,
): void => {
	// Collect all required imports across transformations
	const required: Map<string, PreprocessImportInfo> = new Map();
	for (const t of transformations) {
		for (const [name, info] of t.required_imports) {
			required.set(name, info);
		}
	}

	// Always need MdzPrecompiled when transformations occur
	required.set(PRECOMPILED_NAME, {path: compiled_component_import, kind: 'default'});

	const script = ast.instance;

	// Separate full removals from partial removals
	const full_removals: Set<PositionedImportDeclaration> = new Set();
	const partial_removals: Array<ImportRemovalAction> = [];
	for (const [, action] of removable_imports) {
		if (action.kind === 'full') {
			full_removals.add(action.node);
		} else {
			partial_removals.push(action);
		}
	}

	if (!script) {
		// No instance script — removable_imports won't apply (imports are in module script if any)
		// Just add all required imports
		const lines = generate_import_lines(required);
		if (ast.module) {
			s.appendLeft(ast.module.end, `\n\n<script lang="ts">\n${lines}\n</script>`);
		} else {
			s.prepend(`<script lang="ts">\n${lines}\n</script>\n\n`);
		}
		// Remove Mdz imports from module script if removable
		for (const node of full_removals) {
			remove_import_declaration(s, node, source);
		}
		// Apply partial removals
		for (const action of partial_removals) {
			remove_import_specifier(s, action.node, action.specifier_to_remove!, source);
		}
		return;
	}

	// Check existing imports to avoid duplicates — tracks both name AND source path
	const existing: Map<string, string> = new Map();
	for (const node of script.content.body) {
		if (node.type === 'ImportDeclaration') {
			const source_path = node.source.value as string;
			for (const spec of node.specifiers) {
				existing.set(spec.local.name, source_path);
			}
		}
	}

	const to_add: Map<string, PreprocessImportInfo> = new Map();
	for (const [name, info] of required) {
		const existing_path = existing.get(name);
		if (existing_path === undefined) {
			to_add.set(name, info);
		}
	}

	// Strategy: if we're both adding MdzPrecompiled and removing an Mdz import,
	// overwrite one full-removable import with the MdzPrecompiled line to avoid
	// MagicString boundary conflicts. Other imports use normal appendLeft.
	let overwrite_target: PositionedImportDeclaration | null = null;
	if (to_add.has(PRECOMPILED_NAME) && full_removals.size > 0) {
		// Pick the first removable import to overwrite
		overwrite_target = full_removals.values().next().value ?? null;
	}

	// Generate the MdzPrecompiled import line separately if using overwrite
	if (overwrite_target) {
		const node_start = overwrite_target.start;
		const node_end = overwrite_target.end;

		// Find the start of the line (consume leading whitespace)
		let line_start = node_start;
		while (line_start > 0 && (source[line_start - 1] === '\t' || source[line_start - 1] === ' ')) {
			line_start--;
		}

		// Extract indentation from the original import line rather than hardcoding a tab.
		// The import node's start is after any leading whitespace, so the indentation is
		// the characters between the line start and the node start.
		const original_indent = source.slice(line_start, node_start);
		const precompiled_line = `${original_indent}import ${PRECOMPILED_NAME} from '${compiled_component_import}';`;

		s.overwrite(line_start, node_end, precompiled_line);
		to_add.delete(PRECOMPILED_NAME);
	}

	// When there are partial removals but no full-removal overwrite target,
	// the appendLeft at find_import_insert_position can conflict with the
	// partial removal's overwrite (they share the same node.end boundary).
	// Bundle the new imports into the first partial removal's overwrite instead.
	const insert_pos = find_import_insert_position(script);
	let partial_carrier: ImportRemovalAction | null = null;
	if (to_add.size > 0 && partial_removals.length > 0) {
		for (const action of partial_removals) {
			if (action.node.end === insert_pos) {
				partial_carrier = action;
				break;
			}
		}
	}

	// Add remaining imports — either bundled with a partial removal or via appendLeft
	let carrier_lines = '';
	if (partial_carrier && to_add.size > 0) {
		carrier_lines = '\n' + generate_import_lines(to_add);
		to_add.clear();
	}
	if (to_add.size > 0) {
		const lines = generate_import_lines(to_add);
		s.appendLeft(insert_pos, '\n' + lines);
	}

	// Remove remaining full Mdz imports (skip the overwrite target)
	for (const node of full_removals) {
		if (node === overwrite_target) continue;
		remove_import_declaration(s, node, source);
	}

	// Apply partial import removals
	for (const action of partial_removals) {
		remove_import_specifier(
			s,
			action.node,
			action.specifier_to_remove!,
			source,
			action === partial_carrier ? carrier_lines : '',
		);
	}
};
