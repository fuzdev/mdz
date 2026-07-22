import type {Component} from 'svelte';

import {create_context} from './context_helpers.ts';

/**
 * Component registry for custom Svelte components that can be used in mdz content.
 *
 * For example, registering 'Alert' allows using `<Alert status="error">...</Alert>`
 * in mdz content; parsed attributes pass through as props.
 *
 * The Map values are Svelte components.
 */
// props pass through untyped (`string | true`); a typed registry is a separate concern
export type MdzComponents = Map<string, Component<any, any>>;

/**
 * Element registry for HTML elements that can be used in mdz content.
 *
 * Register an element by mapping its name to `true` (e.g. `['aside', true]`),
 * which allows `<aside>...</aside>` in mdz content. Only `true` enables an
 * element — the renderers treat any other value (including `false`) as
 * unregistered, so the tag falls back to literal text.
 */
export type MdzElements = Map<string, boolean>;

/**
 * CSS `white-space` values for the `whitespace` prop on `Mdz`, `MdzStream`,
 * and `MdzPrecompiled`. By default no style is applied, so whitespace
 * collapses like standard markdown — single newlines are soft breaks.
 * `pre-line` renders every newline as a line break (chat-style input);
 * `pre-wrap` additionally preserves spaces and tabs.
 */
export type MdzWhitespace = 'normal' | 'nowrap' | 'pre' | 'pre-wrap' | 'pre-line' | 'break-spaces';

/**
 * Context for providing custom mdz components via a getter function.
 * Set to a getter (e.g., `() => components`) so changes are reflected reactively.
 */
export const mdz_components_context = create_context<() => MdzComponents | undefined>();

/**
 * Context for providing allowed HTML elements via a getter function.
 * Set to a getter (e.g., `() => elements`) so changes are reflected reactively.
 * By default, no HTML elements are allowed.
 */
export const mdz_elements_context = create_context<() => MdzElements | undefined>();

/**
 * Context for providing a base path getter for resolving relative links in mdz content.
 * Set to a getter (e.g., `() => base`) so changes to the base prop are reflected
 * without needing an effect. When the getter returns a path like `'/docs/usage/'`,
 * relative paths like `./grammar` resolve to `/docs/usage/grammar` before rendering.
 * When not set, relative paths use raw hrefs (browser resolves them).
 */
export const mdz_base_context = create_context<() => string | undefined>();

/**
 * Component that renders an inline `` `code` `` span. Receives the raw span
 * content as `reference` — the prop name matches `fuz_ui`'s `DocsLink`, so it
 * can be injected directly to auto-link backticked API identifiers.
 */
export type MdzCodeComponent = Component<{reference: string}>;

/**
 * Context for overriding how inline `` `code` `` spans render, via a getter
 * function. When not set, inline code renders as a plain `<code>` element.
 */
export const mdz_code_context = create_context<() => MdzCodeComponent | undefined>();

/**
 * Component that renders a fenced code block. Receives `lang` and `content`,
 * matching `@fuzdev/fuz_code`'s `Code`, so it can be injected directly for
 * syntax highlighting.
 */
export type MdzCodeblockComponent = Component<{lang: string | null; content: string}>;

/**
 * Context for overriding how fenced code blocks render, via a getter function.
 * When not set, code blocks render as a plain `<pre><code>` element.
 */
export const mdz_codeblock_context = create_context<() => MdzCodeblockComponent | undefined>();

interface MdzGetterContext<T> {
	get_maybe(): (() => T | undefined) | undefined;
	set(value: () => T | undefined): unknown;
}

/**
 * Set an mdz context to a getter that prefers the local `value_fn` and falls
 * back to the ancestor's value when `value_fn()` returns `undefined`.
 *
 * Pass `value_fn` as a getter (not a snapshot) so prop changes remain reactive.
 * The ancestor lookup happens once at component init — that's intentional, it
 * captures the surrounding scope's context at mount time.
 */
export const mdz_set_context_with_fallback = <T>(
	context: MdzGetterContext<T>,
	value_fn: () => T | undefined,
): void => {
	const ancestor = context.get_maybe();
	context.set(() => value_fn() ?? ancestor?.());
};
