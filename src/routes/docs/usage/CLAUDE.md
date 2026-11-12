# mdz usage docs

The usage docs routes (`/docs/usage`) — the guided tour of the mdz dialect.

## Pages

- `+page.svelte` - the usage guide with interactive examples; its
  compatibility section is a short highlights table linking to the full
  divergence table on the grammar page
- `grammar/mdz_grammar.mdz` - formal grammar, the normative syntax reference,
  verified against the parser source (rendered via Mdz); the full
  CommonMark/GFM divergence table lives in `grammar/+page.svelte` as HTML
  after the rendered grammar (it stays HTML for its rich, multi-line cells,
  not for lack of table syntax — mdz now has tables)

The test-fixtures gallery is its own `fixtures` tome at `../fixtures/` (a
top-level docs page, not nested here); it still authors its example links
against `/docs/usage/` via an explicit `MdzRoot base`.

Streaming has its own docs at ../streaming/ (live demo + a deep-dive split
into per-section `mdz_streaming_*.mdz` files, one per `TomeSection` so each
heading registers in the docs nav); it sets up its own `MdzRoot` since it
sits outside this directory's layout.

The grammar and streaming docs are `.mdz` files imported with `?raw` and
rendered by the `Mdz` component — mdz documenting itself, with their bullets
parsing as real lists and pipe tables as real tables (the
`whitespace="pre-line"` stopgap was dropped when lists landed; grammar
example snippets still sit inside code fences, so they render literally). The
`fixtures` tome uses `whitespace="pre-wrap"` so whitespace fixtures display
faithfully.

## Auto-linking

mdz auto-links four path patterns:

- `https://` and `http://` - external URLs (`link_type: 'external'`)
- `/path` - absolute internal paths, rendered verbatim under the base via
  SvelteKit `resolve()`'s pathname form (never a route id, so `(group)`
  segments, interior `//`, and `[...]` stay as written; a leading `/` or `\`
  run collapses to one `/`)
- `./path` - relative internal paths (same directory)
- `../path` - relative internal paths (parent directory)

URLs must be preceded by a non-word character (anything but an ASCII letter
or digit) or start of string (`xhttps://...` stays plain text). Paths must be
preceded by whitespace, start of string, or a `(` that is itself preceded by
neither an ASCII letter or digit nor `]` — `(./foo)` links, `foo(./bar)` and a
failed link's `[a](./b c)` stay literal, as do paths after other openers (`[`,
`{`, quotes). The rule lives in `is_path_boundary`, shared by both parsers.

A path opened by `(` ends before the `)` matching that `(` (paren depth
tracked, so `(./Foo_(bar))` keeps its inner parens); other URLs and paths scan
to the first non-URI char. The scanned reference then trims, repeated to a
fixpoint, trailing punctuation (`.,;:!?`) and an unbalanced trailing `)`. A
reference left with nothing after its prefix (`/`, `./`, `../`, `https://`)
doesn't link. A span whose first closer candidate falls inside an auto-link
stays literal in both parsers, along with the spans inside it — unless the
candidate is an intraword `_`, which rejects only that italic opener; the
streaming parser resolves these when the link completes.

`javascript:`, `data:`, and other non-`http(s)` URI schemes are stripped at
render time by `mdz_is_safe_reference` — the link's display text renders as
plain children, no `href` is emitted. Applies to both explicit markdown
links (`[text](javascript:...)`) and auto-linked URIs.

## Context and MdzRoot

`mdz_base_context`, `mdz_components_context`, and `mdz_elements_context` use
the getter pattern (`() => value | undefined`) so changes flow through without
an extra effect. All three support nesting with ancestor fallback.

```svelte
<MdzRoot base="/docs/usage/" components={mdz_components} elements={mdz_elements}>
  <Mdz content={...} />
</MdzRoot>
```

`MdzRoot` is the typical context provider — it sets all three contexts.
`Mdz` and `MdzStream` also accept a `base` prop and set `mdz_base_context`
themselves (with ancestor fallback), so single-file usage works without
wrapping in `MdzRoot`. Components and elements must come from `MdzRoot` or
a manually set context.

When `base` is set, relative paths (`./`, `../`) are resolved to absolute
paths using `mdz_resolve_relative_path()`, then render like any absolute path
through SvelteKit's `resolve()`.
Without `base`, relative paths use raw hrefs (browser resolves them).

The fallback pattern is encapsulated in `mdz_set_context_with_fallback()` —
prefer it over calling `.set(() => value ?? ancestor?.())` by hand.

## Preprocessor

Static `<Mdz content="...">` usages are compiled at build time by
`svelte_preprocess_mdz` into `MdzPrecompiled` with pre-rendered children,
eliminating runtime parsing. The preprocessor recognizes a `base` attribute
on `<Mdz>` for build-time relative path resolution (this is a
preprocessor-only attribute, not a runtime prop). Without `base`, relative
paths use raw hrefs.
