/**
 * Bridge between TSDoc format and mdz for rendering.
 *
 * This module converts raw TSDoc syntax (from the analysis library) to mdz format
 * (Fuz's documentation rendering dialect). It lives here in `@fuzdev/mdz`, not the
 * `svelte-docinfo` analysis library, to keep that library format-agnostic.
 *
 * @module
 */

import {mdz_is_url} from './mdz_helpers.js';

/** Format a reference as mdz: URLs pass through, identifiers get backticks. */
const format_reference = (ref: string): string => (mdz_is_url(ref) ? ref : `\`${ref}\``);

/**
 * Convert raw TSDoc `@see` content to mdz format for rendering.
 *
 * Handles TSDoc link syntax:
 * - `{@link url|text}` → `[text](url)` (markdown link, TSDoc canonical form)
 * - `{@link url text}` → `[text](url)` (TS-lenient space-separated form)
 * - `{@link https://...}` → `https://...` (bare URL, auto-linked by mdz)
 * - `{@link identifier}` → `` `identifier` `` (code formatting)
 * - Bare URLs → returned as-is
 * - Bare markdown links (`[text](url)` ...) → returned as-is
 * - Bare identifiers → wrapped in backticks
 * - `identifier description text` → `` `identifier` description text `` (first token is the reference)
 *
 * @param content - raw `@see` tag content in TSDoc format
 * @returns mdz-formatted string ready for `Mdz` component
 *
 * @example
 * ```ts
 * mdz_from_tsdoc('{@link https://fuz.dev|API Docs}')
 * // → '[API Docs](https://fuz.dev)'
 *
 * mdz_from_tsdoc('{@link SomeType}')
 * // → '`SomeType`'
 *
 * mdz_from_tsdoc('https://fuz.dev')
 * // → 'https://fuz.dev'
 *
 * mdz_from_tsdoc('[svelte-docinfo](https://github.com/ryanatkn/svelte-docinfo) for the analysis library')
 * // → '[svelte-docinfo](https://github.com/ryanatkn/svelte-docinfo) for the analysis library'
 *
 * mdz_from_tsdoc('tome.ts for the documentation system')
 * // → '`tome.ts` for the documentation system'
 * ```
 */
export const mdz_from_tsdoc = (content: string): string => {
	const trimmed = content.trim();
	if (!trimmed) return '';

	// Check for {@link ...} or {@see ...} syntax
	const link_match = /^\{@(?:link|see)\s+([^}]+)\}$/.exec(trimmed);
	if (link_match) {
		const inner = link_match[1]!.trim();

		// Pipe separator takes precedence (TSDoc canonical form)
		const pipe_index = inner.indexOf('|');
		if (pipe_index !== -1) {
			const reference = inner.slice(0, pipe_index).trim();
			const display_text = inner.slice(pipe_index + 1).trim();
			return `[${display_text}](${reference})`;
		}

		// Space-separated form: TS accepts `{@link url text}` as equivalent to `{@link url|text}`.
		// Only treat space as a separator when the first token looks like a link target (URL),
		// so identifier-style references like `module.function` aren't split.
		const space_index = inner.indexOf(' ');
		if (space_index !== -1) {
			const reference = inner.slice(0, space_index);
			if (mdz_is_url(reference)) {
				const display_text = inner.slice(space_index + 1).trim();
				return `[${display_text}](${reference})`;
			}
		}

		return format_reference(inner);
	}

	// Pass through bare markdown links (`[text](url)` optionally followed by description)
	// so authors can write `@see [text](url) for context` directly.
	if (trimmed.charCodeAt(0) === 91 /* [ */ && /^\[[^\]]+\]\([^)\s]+\)/.test(trimmed)) {
		return trimmed;
	}

	// Split at first whitespace: first token is the reference, rest is description
	const space_index = trimmed.indexOf(' ');
	if (space_index === -1) {
		return format_reference(trimmed);
	}

	const reference = trimmed.slice(0, space_index);
	const description = trimmed.slice(space_index); // preserve leading space
	return format_reference(reference) + description;
};
