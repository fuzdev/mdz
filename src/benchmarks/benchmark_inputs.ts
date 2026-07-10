/**
 * Shared inputs for the mdz benchmark suites — the parser suite
 * (`mdz.benchmark.ts`, run via `gro run`) and the render suite
 * (`render.benchmark.test.ts`, run via vitest for the Svelte pipeline).
 */

export interface BenchmarkInput {
	name: string;
	content: string;
}

/** Mixed-structure document: headings, inline formatting, links, fences. */
export const generate_large_input = (): string => {
	const sections: Array<string> = [];
	for (let i = 0; i < 50; i++) {
		sections.push(`## Section ${i + 1}

This is paragraph ${i + 1} with **bold** and _italic_ text.
Here's a \`code snippet\` and a [link](https://fuz.dev/${i}).

\`\`\`
code block ${i + 1}
const value = ${i};
\`\`\`

Some more text with https://auto.link/${i} and ~~strikethrough~~ content.`);
	}
	return `# Large Document\n\n${sections.join('\n\n')}`;
};

// Blockquote-dense input: nesting depth changes, in-quote blanks, lists and
// fences inside quotes, quotes inside items, and delimiter-dense quoted
// paragraphs. Guards the nested-parser pipeline — per-line prefix matching,
// one-level stripping, and (streaming) opcode forwarding with offset
// remapping must all stay linear.
export const generate_blockquote_heavy_input = (): string => {
	const sections: Array<string> = [];
	for (let i = 0; i < 40; i++) {
		sections.push(`## Quote group ${i + 1}

> **Reviewer ${i}** wrote about snake_case_idents and ~/dev/path_${i}:
>
> The earlier draft of section_${i} said something _different_ here,
> with more_snake_case and x_${i} markers throughout the paragraph.
>
> - first point about \`api_call_${i}\`
> - second point with **bold** content
>   - a nested bullet under it
>
> > and a nested quote quoting reply_${i}
> > across two lines
>
> \`\`\`ts
> const value_${i} = compute(${i});
> \`\`\`

1. step with a quoted note
   > attached to item ${i}
   > continuing the quote
2. follow-up step ${i}`);
	}
	return `# Blockquote Heavy\n\n${sections.join('\n\n')}`;
};

// List-heavy input: deep nesting, blank-line containment, in-item fences, and
// delimiter-dense item content (snake_case `_` failed candidates; the `~/dev/`
// path tildes take the single-`~` literal fast path). Locks in two costs:
// per-line classification inside open lists must stay invisible, and the
// inline closer scans' run-boundary probe must stay amortized-linear on
// delimiter-dense items.
export const generate_list_heavy_input = (): string => {
	const sections: Array<string> = [];
	for (let i = 0; i < 40; i++) {
		sections.push(`## Step group ${i + 1}

1. **Setup ${i}**

   Install the dependency_name_${i} package and set the env_var_${i} value
   for the ~/dev/repo_${i} checkout before continuing.

   \`\`\`bash
   npm install pkg_${i}
   \`\`\`

2. **Run ${i}**
   - nested bullet with snake_case_idents and ~/dev/path_${i} refs
   - another _nested_ bullet with more_snake_case here
     - deeper level with x_${i} and y_${i} markers
   - back out to the sibling level

3. Final step ${i} with trailing prose
   continuing on an indented line`);
	}
	return `# List Heavy\n\n${sections.join('\n\n')}`;
};

// Table-heavy input: many pipe tables with inline-dense cells (bold, code,
// links, strikethrough), code-span and `\|` literal pipes, and per-column
// alignment. Locks in two costs: per-row cell splitting + cell inline parsing
// must stay linear across hundreds of cells (the streaming path shares one
// lexer/parser per table via `MdzTableCellParser`), and the streaming header
// hold (a `|` row held until its delimiter line arrives) must not rescan
// quadratically — the 64B feed strategy splits rows mid-line.
export const generate_table_heavy_input = (): string => {
	const sections: Array<string> = [];
	for (let i = 0; i < 40; i++) {
		sections.push(`## Table group ${i + 1}

| Name | \`Type\` | Default | Notes |
| :--- | :----: | ------: | :---- |
| field_${i}_a | \`string\` | \`""\` | a **bold** note with ./path_${i} |
| field_${i}_b | \`number\` | \`0\` | union \`A_${i} | B_${i}\` protected |
| field_${i}_c | \`boolean\` | \`false\` | escaped a \\| b literal |
| field_${i}_d | \`Array<x>\` | \`[]\` | see [docs](/docs/${i}) and ~~old~~ |
| field_${i}_e | \`Map\` | \`null\` | trailing _italic_ ${i} |`);
	}
	return `# Table Heavy\n\n${sections.join('\n\n')}`;
};

/** The shared benchmark corpus, ordered small to pathological. */
export const benchmark_inputs: Array<BenchmarkInput> = [
	{name: 'tiny', content: 'hello **bold** world'},
	{
		name: 'small',
		content: `# Small Document

This is a _simple_ paragraph with **bold** text and \`inline code\`.

Here's a link: [click here](https://fuz.dev) and an auto-link https://fuz.dev/path.

Some ~~strikethrough~~ text and more _italic_ words.`,
	},
	{
		name: 'medium',
		content: `# Medium Document

## Introduction

This is a **medium-sized** document that tests various mdz features.
It has multiple paragraphs with _italic_, **bold**, and \`code\` formatting.

## Code Examples

Here's some inline \`code\` and a code block:

\`\`\`typescript
const x = 42;
function hello() {
  return 'world';
}
\`\`\`

## Links and References

Visit [the docs](https://docs.fuz.dev) for more info.
Also see https://fuz.dev/api and /internal/path for details.

## Formatting

This paragraph has **bold with _nested italic_** and standalone ~~strikethrough~~ text.
Multiple **bold** words in a **single** line with \`code\` mixed in.

---

Final section after a horizontal rule.

More content with [multiple](https://a.com) links [here](https://b.com) and [there](/c).`,
	},
	{name: 'large', content: generate_large_input()},
	{
		name: 'angle brackets',
		// Angle brackets without closing tags — exercises tag bail-out paths.
		// Before the pre-check fix, unclosed tags like <GodType> caused O(n*k)
		// scanning through the rest of the document.
		content: `# TypeScript-Heavy Document

### Why object literals beat Pick<GodType>

A \`Pick<AppRuntime, 'env_get'>\` pattern forces every consumer to import the
god type. Small standalone interfaces have no such coupling.

## Generic Signatures

\`\`\`typescript
export interface GitDeps {
  checkout: (options: {branch: string}) => Promise<Result<object, {message: string}>>;
  push: (options: {cwd?: string}) => Promise<Result<object, {message: string}>>;
}

export const update = async (
  repos: Array<LocalRepo>,
  updates: Map<string, string>,
): Promise<void> => {};

export const read_json = <T>(path: string): Promise<T | null> => {};
\`\`\`

### Narrowing with \`Pick<>\`

\`Pick<>\` on small \`*Deps\` interfaces is fine:

\`\`\`typescript
password: Pick<PasswordHashDeps, 'hash_password'>;
\`\`\`

The anti-pattern is \`Pick<GodType>\` — coupling every consumer to a large type.

## More Generics

Functions with Array<string>, Promise<void>, and Map<string, number> in prose.

| Type | Example |
| --- | --- |
| \`Array<string>\` | list of names |
| \`Promise<Result<object>>\` | async result |
| \`Pick<Deps, 'key'>\` | narrowed deps |`,
	},
	{
		name: 'many angles',
		// Many unclosed angle brackets in a single paragraph — worst case for
		// repeated tag bail-outs within one parse unit
		content: Array.from(
			{length: 50},
			(_, i) => `Item ${i}: Array<string> and Map<number, Result<object>> end.`,
		).join('\n'),
	},
	{name: 'list heavy', content: generate_list_heavy_input()},
	{name: 'blockquote heavy', content: generate_blockquote_heavy_input()},
	{name: 'table heavy', content: generate_table_heavy_input()},
	{
		name: 'large dense inline',
		// Large doc dense in unclosed delimiter candidates — `<Tag>`-shaped
		// generics searching for closing tags that never exist. Each failed
		// search must not rescan to the end of the document (the `#index_of`
		// memo), or parsing goes quadratic and large real-world docs hang.
		// The `~/dev` home paths used to be the other half of the pathology
		// (single-`~` strikethrough scans); since strikethrough moved to GFM
		// `~~`, a single `~` is literal with no scan at all, and the paths now
		// exercise that fast path.
		content: Array.from(
			{length: 1600},
			(_, i) =>
				`The ~/dev/repo_${i} crate returns Vec<String> and Box<dyn Error> while ~/dev/other_${i} uses Option<Arc<Mutex<T>>> in its API surface. `,
		).join('\n'),
	},
	{
		name: 'mismatched tags',
		// Many unclosed `<aN>` opens each followed by a `</nomatch>` closer that
		// never matches — the closer walks toward the run boundary past every
		// leaked frame. Guards `try_close_tag`'s `open_tag_counts` O(1) bail
		// (and the sync lexer's memoized closing-tag search): without them this
		// input is quadratic even in a single one-shot feed.
		content: Array.from({length: 2000}, (_, i) => `<a${i}>x</nomatch>`).join(''),
	},
	{
		name: 'hold line code',
		// One giant line: an unclosed backtick under open bold. The streaming
		// parser holds at the backtick (the closer may still arrive), and every
		// feed re-enters the same candidate — the closer/newline scans must be
		// memoized (`buffer_index_of`) or chunked feeds go quadratic in the
		// line length. Sized so the char-by-char row stays affordable.
		content: '**a `' + 'x'.repeat(16_000),
	},
	{
		name: 'hold line link',
		// One giant unterminated `[text](url…` — the streaming parser holds at
		// the `]` while the reference grows, re-entering every feed; the `)`
		// terminator scan must be memoized or chunked feeds go quadratic.
		content: '[text](https://example.com/' + 'x'.repeat(16_000),
	},
	{
		name: 'dense inline code',
		// mdz's TSDoc/API-docs shipping workload: many short `` `identifier` ``
		// spans per line across many lines. The rest of the corpus has no
		// backtick-dense input, yet the streaming `try_code` memoized dual-search
		// is tuned for exactly this case (see perf.md's Shipped try_code finding).
		content: Array.from(
			{length: 400},
			(_, i) =>
				`The \`parse_${i}()\` helper takes an \`MdzNode\` and returns \`Array<Token>\`; ` +
				`see \`mdz_lexer.ts\` and \`try_code\` for the \`buffer_index_of\` memo.`,
		).join('\n'),
	},
	{
		name: 'nested components',
		// The Svelte-component authoring use case (correctly closed
		// `<Tag>…</Tag>`, nested) — the success-path counterpart to the
		// adversarial `mismatched tags` / `many angles` inputs, which only
		// exercise the never-matching failure path. This drives `try_close_tag`'s
		// matching branch and the tag stack under valid nesting.
		content: Array.from(
			{length: 300},
			(_, i) =>
				`<Callout>Section ${i} has <Badge>**${i}**</Badge> and <Link>a \`ref\`</Link> inside.</Callout>`,
		).join('\n\n'),
	},
	{
		name: 'nested inline cap',
		// The Bug 5 pathology: deeply nested `[` and same-name `<a>` past the
		// inline nesting cap (`MAX_INLINE_NESTING_DEPTH`). Uncapped, the sync
		// lexer's rewind-and-retokenize failure path is O(n²) and stack-overflows
		// here; the cap bounds it to ≤ cap opens (≤ cap reverts, each re-scanning
		// a bounded tail) and the streaming parser caps via `open_link_tag_depth`.
		// Tracks the cap path's throughput — the tag half carries a larger
		// revert-rescan constant than the bracket half (successful inner tags are
		// re-tokenized on each outer revert; see perf.md lead #13). Each unit
		// nests ~2× the cap, so every feed strategy exercises both suppression
		// and the bounded reverts (cap correctness itself is in
		// `mdz_nesting_cap.test.ts`).
		content: Array.from(
			{length: 12},
			(_, i) => '['.repeat(200) + `text ${i} ` + '<a>'.repeat(200) + `X${i}` + '</a>'.repeat(200),
		).join('\n\n'),
	},
];
