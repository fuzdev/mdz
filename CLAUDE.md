# mdz

> a strict markdown dialect built for streaming, Svelte authoring, docs websites, and untrusted content

mdz (`@fuzdev/mdz`) is a strict markdown dialect built to stream, aimed at
devs and AI agents rather than nontechnical end-users. Its two primary
motivating use cases: authoring content with Svelte components, and
rendering TSDoc/JSDoc comments on docs websites with domain-specific
parsing and behavior (like backticked identifiers linkifying to API docs);
the streaming parser extends the same grammar to LLM output. It provides
an incremental streaming parser, a synchronous token parser, a Svelte 5
renderer, and a build-time preprocessor that compiles static mdz content
to plain Svelte markup.

For coding conventions, see Skill(fuz-stack).

## Committing

`git add` and `git commit` are denied by `.claude/settings.local.json` in this
repo — make the edits and stop, the user commits.

IMPORTANT: never bump the package version or publish — that's the user's
responsibility.

## Gro commands

```bash
gro check     # typecheck, test, lint, format check
gro typecheck # typecheck only (faster iteration)
gro test      # run tests with vitest
gro build     # build for production (library + static docs site)
gro deploy    # build, commit, and push to deploy branch
gro sync      # regenerate files and run svelte-kit sync
```

IMPORTANT for AI agents: Do NOT run `gro dev` — the developer manages the dev
server.

## Benchmarks

```bash
npm run benchmark              # run parser benchmarks, compare against baseline
npm run benchmark:save         # save current results as the new baseline
npm run benchmark:clean        # remove the local baseline (forces a fresh seed)
npm run benchmark:render       # run render benchmarks (SSR + MdzStreamState)
npm run benchmark:render:save  # save render results as the new baseline
npm run benchmark:render:clean # remove the local render baseline
```

The baselines live at `src/benchmarks/baseline.json` and
`src/benchmarks/render/baseline.json` and are **gitignored** — local-only.
Inputs are shared between the two suites via `benchmark_inputs.ts`.

The parser suite (`mdz.benchmark.ts`, run via `gro run`) compares the sync
parser (`lexer-based`) against the streaming pipeline under several feed
strategies: `streaming` / `opcodes-only` (one-shot feed, with and without the
tree bridge), `streaming 64B` (64-byte chunks — exercises cross-chunk buffer
compaction and search-memo invalidation), and `char-by-char` (inputs up to
30KB — linear on line-bounded input at ~4 MB/s, per-feed overhead dominates;
the cap just keeps the suite's wall clock reasonable). Adversarial inputs
guard specific non-linear failure modes: "large dense inline" (failed
delimiter/closing-tag searches must not rescan — the sync `#index_of` memo),
"mismatched tags" (`try_close_tag`'s `open_tag_counts` O(1) bail), and "hold
line code" / "hold line link" (held candidates re-entered every feed must
resume their terminator scans via the `buffer_index_of` memo, not rescan the
growing line). A residual super-linear term remains when a hold pins the
buffer against compaction (V8 rope flattening per feed) — only a chunked
buffer abstraction would remove it, and it needs a multi-KB single line fed
in small chunks to matter.

The render suite (`render.benchmark.test.ts`) runs under vitest because the
Svelte pipeline needs the compiler — it measures SSR through `Mdz` and
`MdzStream` (via `svelte/server`'s `render`, no DOM needed) and the reactive
consumer's `MdzStreamState.apply_batch` in isolation. It's gated behind the
`BENCHMARK_RENDER` env var, so plain `gro test` skips it.

## Key dependencies

The published package depends on:

- Svelte 5 — component framework (peer)
- SvelteKit — the renderer components resolve links via `$app/paths` (peer)
- fuz_util (`@fuzdev/fuz_util`) — string/path/escape helpers used only by the
  build-time preprocessor (a required peer; the core parser/renderer imports no
  `@fuzdev` package at runtime — fuz_util is reached only through the
  preprocessor)
- `esm-env` — `DEV` flag (optional peer; the required `svelte`/`@sveltejs/kit`
  peers both depend on it, so it's always present)
- `magic-string`, `zimmerframe` — used only by the preprocessor
  (`dependencies`; neither is a singleton, so mdz ships its own copy rather
  than leaning on Svelte's transitive resolution)
- `@types/estree` — preprocessor types only (optional peer; erased at build,
  and Svelte provides it transitively)

The docs site additionally uses fuz_css, fuz_ui, fuz_code, and Gro as dev
dependencies; the published package depends on none of them. In particular,
fuz_code and fuz_ui are **not** runtime dependencies — code blocks and inline
code render through an injection seam (see below).

## Scope

mdz is a **markdown dialect and renderer**:

- a deliberately small, unambiguous grammar (no setext headings, no reference
  links, intraword underscores stay literal, etc.)
- an incremental streaming parser (`MdzStreamParser`) producing opcodes, for
  rendering partial/streaming input
- a synchronous parser (`mdz_parse`) producing an `MdzNode` tree
- Svelte 5 components that render either form
- a Svelte preprocessor that precompiles static content

### What mdz does NOT include

- CommonMark/GFM compatibility (it is a dialect, not a superset)
- syntax highlighting (inject a highlighter — see the rendering seam)
- a CSS framework or themed components (use fuz_css / fuz_ui)
- sanitization of arbitrary HTML (only registered components/elements render)

## Syntax

| Feature                | Syntax                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inline code            | `` `code` ``                                                                                                                                                        |
| Bold / italic / strike | `**bold**`, `_italic_`, `~~strike~~` (single `~` is literal)                                                                                                        |
| Links                  | auto-detected URLs, `/internal/path`, `./relative`, `[text](url)`                                                                                                   |
| Headings               | `# Heading` (column 0; gets a slugified `id` for fragment links)                                                                                                    |
| Lists                  | `- item` / `1. item` (column 0 starts; indent nests, blank lines contained, items hold paragraphs/lists/code blocks/blockquotes/tables on their own indented lines; marker-line remainder is inline-only)            |
| Blockquotes            | `> ` per line (no lazy continuation); nesting via `>>` or `> > `; bare `>` is the in-quote paragraph break; a blank line ends the quote; content is a mini-document |
| Code blocks            | fenced with optional language hints; an unclosed fence consumes to EOF (or to the end of its enclosing blockquote)                                                  |
| Horizontal rule        | `---` on its own line                                                                                                                                               |
| Tables                 | `\| a \| b \|` rows + a `\| --- \| :-: \|` delimiter row (colons set per-column alignment); leading **and** trailing `\|` required; inline-only cells (`` `code` `` protects pipes, `\|` is a literal pipe); a header/delimiter column-count mismatch stays a paragraph; body rows pad/truncate at render |
| Components / elements  | `<Alert>…</Alert>` / `<aside>…</aside>` (must be registered)                                                                                                        |
| Paragraphs / breaks    | blank line between paragraphs; single newlines are soft breaks; `<br />` (registered) for hard breaks                                                               |

Whitespace follows standard markdown semantics: the parser preserves
whitespace in text nodes (literal `\n`, no `<br>` nodes), but the default
rendering applies no `white-space` style, so single newlines collapse to
spaces. The `whitespace` prop on `Mdz` / `MdzStream` / `MdzPrecompiled`
opts into `pre-line` (every newline is a line break, for chat-style input)
or `pre-wrap` (spaces and tabs preserved too).

## Architecture

The two parsers are two input regimes over one grammar: the sync pipeline
owns random-access input (static content, the preprocessor — anything you
have as a complete string), the streaming pipeline owns append-only input
(content arriving in chunks). Parity tests bind them; the sync parser is
the normative reference. The streaming invariant, stated precisely: no
implicit retroactivity — corrections to already-emitted output are bounded,
local, and reified as opcodes (`revert`, `wrap`, `trim_text`); re-parsing
is the banned implicit form.

Blockquotes are **nested parsers** in both pipelines — a quote's content is
a mini-document behind the per-line prefix, so the sync lexer sub-lexes the
stripped content (token positions remapped to source offsets) and the
streaming parser feeds an inner parser state per quote (shared id counter,
opcodes forwarded with positions remapped, line-bounded prefix holds).
Everything inside a quote — lists, fences, headings, deeper quotes —
follows from the recursion rather than from per-construct quote handling.

Tables follow GFM's pipe-table shape, tightened to the streaming grain.
Recognition is a bounded one-line lookahead: a column-0 `| … |` row holds until
its next line resolves as a delimiter row (`| --- | :-: |`) with a matching
column count — if it does, the table commits; if not, the held line flushes as
a paragraph (the false-negative-over-false-positive default). Required outer
pipes make a row self-identifying at column 0; cell splitting protects
inline-code spans and treats `\|` as a literal pipe (the only escape mdz
recognizes, scoped to cells). Body rows then stream one per line. Because a row
is always fully buffered before it emits, the streaming parser parses each
cell's inline content with the sync reference and replays it as opcodes, so the
two pipelines agree by construction. Tables open at the top level, inside
blockquotes (free via the recursive quote parser), and as list-item block
children — a deeper pipe row whose delimiter is likewise indented, recognized on
the fence/quote-in-item dispatch and ended by a dedent. They never start on a
marker line (`- | a |` is inline text, like `` - ```ts ``).

### Parsing pipeline

- `mdz.ts` — the public `mdz_parse(content)` entry; `MdzNode` types
- `mdz_lexer.ts` → `mdz_token_parser.ts` — the synchronous lexer + parser
- `mdz_helpers.ts` — shared helpers (heading-id slugify, relative-path
  resolution, safe-reference checks)

### Streaming pipeline

- `mdz_stream_parser.ts` (+ the `mdz_stream_parser_*` modules) — an
  incremental parser that emits opcodes as input arrives
- `mdz_opcodes.ts` — opcode type definitions
- `mdz_opcodes_to_nodes.ts` — bridges opcodes back to an `MdzNode` tree
- `mdz_stream_state.svelte.ts` — reactive Svelte 5 state (`MdzStreamState`)

### Rendering

- `Mdz.svelte` — render static content: `<Mdz content="**hi**" />`
- `MdzStream.svelte` — render streaming content from an `MdzStreamState`
- `MdzNodeView.svelte` / `MdzStreamNodeView.svelte` — recursive node
  renderers; the recursion is **snippet-based** (a `render_node` snippet
  calling itself), so a tree costs one component instance and one set of
  context reads at its root rather than per node — contexts are therefore
  resolved once per tree, not per subtree
- `MdzRoot.svelte` — context provider for `base`, `components`, `elements`,
  `code`, and `codeblock`
- `MdzPrecompiled.svelte` — wrapper for preprocessor output

### Build-time

- `mdz_to_svelte.ts` — converts an `MdzNode` array to a Svelte markup string,
  matching `MdzNodeView.svelte`'s runtime output per configuration
- `svelte_preprocess_mdz.ts` — compiles static `<Mdz content="…">` usages to
  pre-rendered `<MdzPrecompiled>` markup at build time
- `tsdoc_mdz.ts` — bridges TSDoc `@see` text into mdz

## Rendering seam

mdz core renders inline code and code blocks as **plain elements** by default
(`<code>` and `<pre><code>`). Consumers inject richer renderers — there are two
matching surfaces:

**Runtime** — via contexts (set through `MdzRoot` props or directly):

- `mdz_components_context` — custom components usable in content (`<Alert>`)
- `mdz_elements_context` — allowed HTML elements (`<aside>`)
- `mdz_base_context` — base path for resolving relative links
- `mdz_code_context` — component for inline `` `code` `` (receives `reference`)
- `mdz_codeblock_context` — component for code blocks (receives `lang`,
  `content`)

The `code`/`codeblock` prop contracts match fuz_ui's `DocsLink` (auto-links API
identifiers) and fuz_code's `Code` (syntax highlighting), so they drop in
directly. This repo's own docs site wires both — that's why fuz_ui/fuz_code are
dev dependencies.

**Build-time** — `svelte_preprocess_mdz` mirrors the runtime via the
`code_component_import` and `codeblock_component_import` options. When unset,
precompiled output is plain, identical to the runtime default; when set to the
same components used at runtime, precompiled and runtime output stay identical.

## Documentation system

The docs site reuses fuz_ui's tome + auto-generated API docs system. Library
metadata arrives at runtime from the `svelte-docinfo` Vite plugin
(`virtual:svelte-docinfo`); `src/routes/library.ts` combines it with
`package.json`. CSS utility classes come from the `vite_plugin_fuz_css` Vite
plugin (`virtual:fuz.css`). No generated files are committed.

Internal-but-exported plumbing is excluded from the API docs with
per-declaration `@nodocs` tags: everything in the `mdz_stream_parser_*`
support modules, `context_helpers.ts`'s vendored `create_context`, and
`mdz_helpers.ts`'s char-code/grammar constants, character predicates, path
probes, and blockquote prefix machinery (the no-barrels convention forces
these exports). New plumbing exports should get `@nodocs` too; the
documented surface is the parse/stream/render/preprocess API plus the
`mdz_*` helper cluster.

## Testing

Tests live in `src/test/` (not co-located). The runtime renderers are covered
by SSR tests (`mdz_render.test.ts` — `svelte/server`'s `render`, no DOM
environment), and `mdz_to_svelte.render_parity.test.ts` binds `mdz_to_svelte`'s
generated markup to the runtime renderer's actual SSR output across the whole
fixture corpus (normalized), so the build-time and runtime render
implementations can't drift silently. `mdz_scaling.test.ts` guards the
parser's complexity invariants (nested-construct and streaming-hold inputs
must stay sub-exponential/linear) with generous timeouts rather than
wall-clock thresholds — the machine-state-independent way to gate CI.
Fixture-based tests drive both the parser and the preprocessor:

| Category                          | Input          | Tests                       |
| --------------------------------- | -------------- | --------------------------- |
| `fixtures/mdz/`                   | `input.mdz`    | the parser (`mdz_parse`)    |
| `fixtures/svelte_preprocess_mdz/` | `input.svelte` | the preprocessor transforms |

**Never manually edit `expected.json`** — change the input and regenerate:

```bash
gro src/test/fixtures/mdz/update                    # parser fixtures
gro src/test/fixtures/svelte_preprocess_mdz/update  # preprocessor fixtures
```

The preprocessor fixtures are generated with `DEFAULT_TEST_OPTIONS` (in
`src/test/fixtures/svelte_preprocess_mdz/svelte_preprocess_mdz_test_helpers.ts`),
which models a fully configured consumer; `src/test/mdz_to_svelte.test.ts`
covers the unconfigured plain defaults.

## Project standards

- TypeScript strict mode
- Svelte 5 with runes API
- Prettier with tabs, 100 char width
- Tests in `src/test/` (not co-located)
- snake_case for functions/variables, PascalCase for types/components
- explicit `.js` extensions in imports

## Related projects

- [`fuz_ui`](../fuz_ui/CLAUDE.md) — Svelte UI library; injects `DocsLink` into
  mdz for API-doc links and renders mdz throughout its docs
- [`fuz_code`](../fuz_code/CLAUDE.md) — syntax highlighting; injected for code
  blocks
- [`fuz_util`](../fuz_util/CLAUDE.md) — utility functions (peer dependency)
- [`fuz_css`](../fuz_css/CLAUDE.md) — CSS framework (dev dependency for the docs)
