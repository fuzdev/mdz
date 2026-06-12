/**
 * mdz parser benchmarks with baseline comparison.
 *
 * Usage:
 *   gro run src/benchmarks/mdz.benchmark.ts          # run and compare against baseline
 *   gro run src/benchmarks/mdz.benchmark.ts --save   # run and save as new baseline
 */

import {readFile, writeFile} from 'node:fs/promises';
import {Benchmark} from '@fuzdev/fuz_util/benchmark.js';
import {
	benchmark_baseline_save,
	benchmark_baseline_compare,
	benchmark_baseline_format,
} from '@fuzdev/fuz_util/benchmark_baseline.js';
import {format_file} from '@fuzdev/gro/format_file.js';

import {mdz_parse} from '../lib/mdz.js';
import {MdzStreamParser} from '../lib/mdz_stream_parser.js';
import {mdz_opcodes_to_nodes} from '../lib/mdz_opcodes_to_nodes.js';
import type {MdzOpcode} from '../lib/mdz_opcodes.js';

const save_baseline = process.argv.includes('--save');
const BASELINE_PATH = 'src/benchmarks';
const BASELINE_FILE = `${BASELINE_PATH}/baseline.json`;

// -- Benchmark inputs --

// Generate a large synthetic input
const generate_large_input = (): string => {
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
const generate_blockquote_heavy_input = (): string => {
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
const generate_list_heavy_input = (): string => {
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

const inputs = [
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
];

/** Parse via streaming parser (one-shot feed) + tree bridge. */
const mdz_parse_stream = (content: string): unknown => {
	const parser = new MdzStreamParser();
	parser.feed(content);
	parser.finish();
	return mdz_opcodes_to_nodes(parser.take_opcodes());
};

/** Streaming parser opcode generation only (no tree bridge). */
const mdz_parse_opcodes_only = (content: string): unknown => {
	const parser = new MdzStreamParser();
	parser.feed(content);
	parser.finish();
	return parser.take_opcodes();
};

/**
 * Parse via streaming parser fed in fixed-size chunks + tree bridge,
 * draining opcodes per feed like a real streaming consumer. Exercises the
 * cross-chunk paths that one-shot feeds skip: buffer append/compaction and
 * the search memo's append invalidation.
 */
const mdz_parse_stream_chunked = (content: string, chunk_size: number): unknown => {
	const parser = new MdzStreamParser();
	const opcodes: Array<MdzOpcode> = [];
	for (let i = 0; i < content.length; i += chunk_size) {
		parser.feed(content.slice(i, i + chunk_size));
		for (const op of parser.take_opcodes()) opcodes.push(op);
	}
	parser.finish();
	for (const op of parser.take_opcodes()) opcodes.push(op);
	return mdz_opcodes_to_nodes(opcodes);
};

interface BenchmarkParser {
	name: string;
	parse: (content: string) => unknown;
	/** Skip inputs longer than this — for feed strategies with known O(n²) pathologies. */
	max_input_length?: number;
}

const parsers: Array<BenchmarkParser> = [
	// `mdz_parse` is the lexer-based pipeline — named to match the baseline entries
	{name: 'lexer-based', parse: mdz_parse},
	{name: 'streaming', parse: mdz_parse_stream},
	{name: 'opcodes-only', parse: mdz_parse_opcodes_only},
	{name: 'streaming 64B', parse: (content) => mdz_parse_stream_chunked(content, 64)},
	// char-by-char is the hardening-#14 worst case (O(n²) buffer string copies
	// in feed) — restrict to small inputs so the benchmark stays fast until a
	// buffer abstraction lands
	{
		name: 'char-by-char',
		parse: (content) => mdz_parse_stream_chunked(content, 1),
		max_input_length: 1000,
	},
];

// -- Benchmark --

const bench = new Benchmark({
	duration_ms: 3000,
	warmup_iterations: 20,
	min_iterations: 50,
});

for (const input of inputs) {
	for (const parser of parsers) {
		if (parser.max_input_length !== undefined && input.content.length > parser.max_input_length) {
			continue;
		}
		bench.add(`${parser.name}: ${input.name}`, () => {
			parser.parse(input.content);
		});
	}
}

await bench.run();

console.log('\n mdz Parser Benchmark Results\n');
console.log(bench.table());

// Throughput table — normalizes across input sizes to spot pathologies at a glance.
// A significantly lower MB/s for one input signals non-linear scaling.
console.log('\n Throughput (MB/s)\n');

const results_by_name = bench.results_by_name();
const parser_names = parsers.map((p) => p.name);

// Header
const col_w = 12;
const name_w = 16;
console.log(
	'  ' +
		''.padEnd(name_w) +
		parser_names.map((p) => p.padStart(col_w)).join('') +
		'    chars'.padStart(col_w),
);
console.log('  ' + '-'.repeat(name_w + parser_names.length * col_w + col_w));

for (const input of inputs) {
	const cols = parser_names.map((parser_name) => {
		const result = results_by_name.get(`${parser_name}: ${input.name}`);
		if (!result) return '—'.padStart(col_w);
		const mb_per_sec = (result.stats.ops_per_second * input.content.length) / 1_000_000;
		return mb_per_sec.toFixed(1).padStart(col_w);
	});
	console.log(
		'  ' + input.name.padEnd(name_w) + cols.join('') + String(input.content.length).padStart(col_w),
	);
}

console.log('\n Summary\n');
console.log(bench.summary());

// -- Baseline comparison --

const comparison = await benchmark_baseline_compare(bench.results(), {
	path: BASELINE_PATH,
	regression_threshold: 1.1, // 10% threshold — system-level variance (thermal, scheduler) easily causes 5-8% swings
	staleness_warning_days: 30,
});

console.log('\n Baseline Comparison\n');
console.log(benchmark_baseline_format(comparison));

if (save_baseline) {
	await benchmark_baseline_save(bench.results(), {path: BASELINE_PATH});
	const content = await readFile(BASELINE_FILE, 'utf-8');
	const formatted = await format_file(content, {filepath: BASELINE_FILE});
	await writeFile(BASELINE_FILE, formatted);
	console.log(`\n✓ Baseline saved to ${BASELINE_FILE}`);
} else if (comparison.baseline_found) {
	if (comparison.regressions.length > 0) {
		console.log('\n⚠️  Regressions detected. Run with --save to update baseline if intentional.');
	}
	if (comparison.methodology_changed.length > 0) {
		console.log(
			'\n⚠️  Methodology changed on some tasks. Re-run with --save to update the baseline and surface any drift masked by the budget change.',
		);
	}
	// Tally noise warnings across the three Welch-eligible buckets — a
	// methodology_changed row gets its own banner above, so don't double-count.
	const noise_count =
		comparison.regressions.filter((r) => r.noise_warning).length +
		comparison.improvements.filter((r) => r.noise_warning).length +
		comparison.unchanged.filter((r) => r.noise_warning).length;
	if (noise_count > 0) {
		console.log(
			`\n⚠️  ${noise_count} task(s) flagged with high measurement noise. Treat their significance calls with skepticism; consider rerunning on quieter hardware.`,
		);
	}
}
