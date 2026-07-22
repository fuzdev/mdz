import { getContext, setContext } from 'svelte';

// This uses a function instead of a class because of the overloaded type signatures.
// It could be implemented internally with a class like `SvelteContext`
// but this is less code and seems a bit simpler.
// The memory gains of a class appear minimal given the expected usage patterns.

// TODO maybe remove `error_message`?

/**
 * Wraps Svelte's `setContext` and `getContext` for better ergonomics.
 * When no value is set in the context,
 * `get` throws an error and `get_maybe` returns `undefined`.
 * If a `fallback` is provided, the `value` argument to `set` is optional
 * and `get_maybe` is omitted from the type.
 *
 * Vendored from `@fuzdev/fuz_ui/context_helpers.ts` — fuz_ui sits above mdz
 * in the dependency graph, so mdz keeps its own copy for `mdz_contexts.ts`.
 * Consumers should import fuz_ui's.
 *
 * @nodocs
 */
export function create_context<T>(fallback: () => T): {
	get: () => T;
	set: (value?: T) => T;
};
export function create_context<T>(): {
	get: (error_message?: string) => T;
	get_maybe: () => T | undefined;
	set: (value: T) => T;
};
export function create_context<T>(fallback?: () => T): {
	get: (error_message?: string) => T;
	get_maybe: () => T | undefined;
	set: (value?: T) => T;
} {
	const key = Symbol();
	const get_maybe = () => {
		const value: T | undefined = getContext(key); // treat `null` as a valid value - the `typescript-eslint` rule below is bugged because `??` would clobber nulls, see issue https://github.com/typescript-eslint/typescript-eslint/issues/7842
		return value === undefined ? fallback?.() : value;
	};
	return {
		get: (error_message?: string) => {
			const value = get_maybe();
			if (value === undefined) throw Error(error_message ?? 'context value is not set');
			return value;
		},
		get_maybe,
		// this is typesafe, so no runtime check:
		set: (value: T | undefined = fallback?.()) => setContext(key, value)!
	};
}
