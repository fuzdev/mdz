/**
 * mdz parser benchmarks with baseline comparison.
 *
 * Usage:
 *   gro run src/benchmarks/mdz.benchmark.ts          # run and compare against baseline
 *   gro run src/benchmarks/mdz.benchmark.ts --save   # run and save as new baseline
 */

import { readFile, writeFile } from 'node:fs/promises';
import { Benchmark } from '@fuzdev/fuz_util/benchmark.ts';
import {
	benchmark_baseline_save,
	benchmark_baseline_compare,
	benchmark_baseline_format
} from '@fuzdev/fuz_util/benchmark_baseline.ts';
import { format_file } from '@fuzdev/gro/format_file.ts';

import { mdz_parse } from '../lib/mdz.ts';
import { MdzStreamParser } from '../lib/mdz_stream_parser.ts';
import { mdz_opcodes_to_nodes } from '../lib/mdz_opcodes_to_nodes.ts';
import type { MdzOpcode } from '../lib/mdz_opcodes.ts';
import { benchmark_inputs } from './benchmark_inputs.ts';

const save_baseline = process.argv.includes('--save');
const BASELINE_PATH = 'src/benchmarks';
const BASELINE_FILE = `${BASELINE_PATH}/baseline.json`;

// inputs live in `benchmark_inputs.ts`, shared with the render suite
// (`render.benchmark.test.ts`)
const inputs = benchmark_inputs;

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
	{ name: 'lexer-based', parse: mdz_parse },
	{ name: 'streaming', parse: mdz_parse_stream },
	{ name: 'opcodes-only', parse: mdz_parse_opcodes_only },
	{ name: 'streaming 64B', parse: (content) => mdz_parse_stream_chunked(content, 64) },
	// char-by-char is linear on line-bounded input (measured ~4 MB/s — per-feed
	// overhead dominates) but still slow in absolute terms; the cap keeps the
	// suite's wall clock reasonable while covering every input up to `large`
	// and the adversarial hold lines. The residual super-linear term is V8
	// rope flattening while a hold pins the buffer (no compaction), which only
	// a chunked buffer abstraction would remove.
	{
		name: 'char-by-char',
		parse: (content) => mdz_parse_stream_chunked(content, 1),
		max_input_length: 30_000
	}
];

// -- Benchmark --

const bench = new Benchmark({
	duration_ms: 3000,
	warmup_iterations: 20,
	min_iterations: 50
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
		'    chars'.padStart(col_w)
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
		'  ' + input.name.padEnd(name_w) + cols.join('') + String(input.content.length).padStart(col_w)
	);
}

console.log('\n Summary\n');
console.log(bench.summary());

// -- Baseline comparison --

const comparison = await benchmark_baseline_compare(bench.results(), {
	path: BASELINE_PATH,
	// Informational only (nothing gates CI on it). Cross-run absolute compare
	// can't resolve sub-~2× effects on this hardware — a zero-change re-run has
	// flagged most tasks as "regressions" (thermal/scheduler drift, invisible to
	// the within-run `noise_warning`). The real signal is within-run scaling /
	// same-run ratios (see perf.md "Measurement robustness"); this threshold
	// just filters the noisiest local rows.
	regression_threshold: 1.1,
	staleness_warning_days: 30
});

console.log('\n Baseline Comparison\n');
console.log(benchmark_baseline_format(comparison));

if (save_baseline) {
	await benchmark_baseline_save(bench.results(), { path: BASELINE_PATH });
	const content = await readFile(BASELINE_FILE, 'utf-8');
	const formatted = await format_file(content, { filepath: BASELINE_FILE });
	await writeFile(BASELINE_FILE, formatted);
	console.log(`\n✓ Baseline saved to ${BASELINE_FILE}`);
} else if (comparison.baseline_found) {
	if (comparison.regressions.length > 0) {
		console.log('\n⚠️  Regressions detected. Run with --save to update baseline if intentional.');
	}
	if (comparison.methodology_changed.length > 0) {
		console.log(
			'\n⚠️  Methodology changed on some tasks. Re-run with --save to update the baseline and surface any drift masked by the budget change.'
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
			`\n⚠️  ${noise_count} task(s) flagged with high measurement noise. Treat their significance calls with skepticism; consider rerunning on quieter hardware.`
		);
	}
}
