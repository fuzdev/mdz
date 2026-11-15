# @fuzdev/mdz

## 0.10.0

### Minor Changes

- feat: auto-detected paths (`./foo`, `../foo`, `/foo`) link directly after an opening `(` not preceded by an ASCII letter, digit, or `]`, and a path opened by `(` ends at its matching `)`, so `(./foo.md)` and `**(./foo.md)**` link the path with the parens as text while `foo(./bar)` and a failed link's `[a](./b c)` stay literal; the auto-link trailing trim of punctuation and unbalanced `)` repeats to a fixpoint (`(see ./a.md.)` links `./a.md`); a reference with nothing after its prefix or scheme (`(/)`, `a ./) b`, `see http://)`) no longer links; and the streaming parser now matches `mdz_parse` when an auto-link swallows an open span's first closer (`**see /a**b and c**`, `_(./my_file.md)_`), leaving the opener literal ([ac09204](https://github.com/fuzdev/mdz/commit/ac09204))
- feat: `Mdz` and `MdzNodeView` take an opt-in `source_offsets` prop that puts each node's `start` and `end` on the elements rendered for it as `data-mdz-start` and `data-mdz-end` — blocks, inline formatting, every rendered link, and registered elements — and passes them as props to injected `code` and `codeblock` components (typed `MdzSourceOffsetProps` on `MdzCodeComponent` and `MdzCodeblockComponent`), so a consumer can map rendered output back to its source and match anchors to link nodes by offset; off by default with unchanged output, not inherited by a nested `Mdz`, absent from `MdzStream`, and `svelte_preprocess_mdz` leaves a usage that sets it to the runtime ([c786b94](https://github.com/fuzdev/mdz/commit/c786b94))

### Patch Changes

- fix: declaration maps resolve to the shipped source, so go-to-definition lands in `src/lib` ([52f97c3](https://github.com/fuzdev/mdz/commit/52f97c3))
- fix: `mdz_from_tsdoc` returns `@see` content that opens with a backtick as written, so `` @see `foo` for bar `` renders `foo` as code instead of wrapping it in a second pair of backticks, which left both spans literal ([1a67f71](https://github.com/fuzdev/mdz/commit/1a67f71))

## 0.9.0

### Minor Changes

- Update dependencies (BREAKING CHANGES) ([c084223](https://github.com/fuzdev/mdz/commit/c084223))
  
  Breaking dependency changes:
  - @fuzdev/fuz_util: 0.80.0 → 0.81.0 (minor)

## 0.8.1

### Patch Changes

- fix `Mdz` `inline` rendering a block `<p>` inside its `<span>` by unwrapping a lone paragraph, at runtime and in the preprocessor; a dynamic `inline` now falls back to runtime rendering ([98b3a73](https://github.com/fuzdev/mdz/commit/98b3a73))
- fix precompiled text losing whitespace at element edges, matching the runtime renderer ([98b3a73](https://github.com/fuzdev/mdz/commit/98b3a73))
- fix `MdzPrecompiled` throwing during render when static `Mdz` content is empty or only whitespace ([98b3a73](https://github.com/fuzdev/mdz/commit/98b3a73))

## 0.8.0

### Minor Changes

- Update dependencies (BREAKING CHANGES) ([fb9b667](https://github.com/fuzdev/mdz/commit/fb9b667))
  
  Breaking dependency changes:
  - @fuzdev/fuz_util: 0.79.0 → 0.80.0 (minor)

## 0.7.0

### Minor Changes

- Update dependencies (BREAKING CHANGES) ([811fc98](https://github.com/fuzdev/mdz/commit/811fc98))

  Breaking dependency changes:

  - @fuzdev/fuz_util: 0.78.0 → 0.79.0 (minor)

- chore: upgrade fuz_util 0.78.0 ([9e50a45](https://github.com/fuzdev/mdz/commit/9e50a45))

### Patch Changes

- new logo: a pen nib hovering over an inkwell ([3bb193a](https://github.com/fuzdev/mdz/commit/3bb193a))

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
