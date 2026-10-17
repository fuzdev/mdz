# @fuzdev/mdz

## 0.6.0

### Minor Changes

- chore: upgrade fuz_util 0.77.0 ([f658a44](https://github.com/fuzdev/mdz/commit/f658a44))

## 0.5.0

### Minor Changes

- **breaking** feat: tag attributes — quoted string (`"`/`'`) and bare boolean attributes on components and elements (`<Alert status="error">`, `<aside class="box">`); element attributes filter to a closed inert allowlist (`class`, `title`, `lang`, `dir`, `role`, `aria-label`/`-hidden`/`-describedby`/`-labelledby`, others dropped with a DEV warning), components receive only the attributes named at registration (`MdzComponents` entries are a bare component, which gets none, or `{component, props}` with a name list or `'all'`; the preprocessor's `components` option mirrors it as `{path, props}`), and a rendered component that throws falls back to its literal placeholder via a per-component `<svelte:boundary>`; malformed forms stay literal text; `MdzNodeElement`/`MdzNodeComponent` gain a required `attributes: Array<MdzAttribute>` and the `open` opcode an optional `attributes`; an element registered as `false` now renders as an unregistered placeholder ([#7](https://github.com/fuzdev/mdz/pull/7))
- **breaking** fix: internal links render verbatim under the base path via `resolve()`'s pathname form instead of as route ids, so `(group)` segments, interior `//`, `[...]` segments, and `?query`/`#fragment` contents are no longer rewritten (and `[param]` segments no longer throw); a leading `/` followed by any `/` or `\` run collapses to one `/`; precompiled output emits `resolve('docs/foo')` without the leading slash; `MdzLinkRender`'s `resolve` variant carries `path` (no leading slash) instead of `href` ([1561458](https://github.com/fuzdev/mdz/commit/1561458))

## 0.4.0

### Minor Changes

- **breaking** feat: support SvelteKit 3 (`@sveltejs/kit` peer `^3`); TSDoc examples for `SveltePreprocessMdzOptions.components` and `MdzToSvelteOptions.components` use `#lib/` import paths, and `svelte_preprocess_mdz`'s `@returns` points at `sveltekit({preprocess})` in `vite.config.ts` ([f5e37c7](https://github.com/fuzdev/mdz/commit/f5e37c7))

## 0.3.0

### Minor Changes

- perf: add an optional `nodes` prop to `Mdz` for rendering a pre-parsed `MdzNode` tree, skips `mdz_parse` ([#6](https://github.com/fuzdev/mdz/pull/6))

## 0.2.0

### Minor Changes

- feat: tables ([#3](https://github.com/fuzdev/mdz/pull/3))
- feat: tables nested in list items ([#5](https://github.com/fuzdev/mdz/pull/5))

## 0.1.0

### Minor Changes

- extract from fuz_ui ([#1](https://github.com/fuzdev/mdz/pull/1))
