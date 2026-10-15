# @fuzdev/mdz

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
