/**
 * Rendering benchmarks with baseline comparison — SSR through the runtime
 * renderers plus the reactive stream consumer (`MdzStreamState.apply_batch`).
 *
 * Lives in the vitest pipeline (unlike `mdz.benchmark.ts`, which runs under
 * `gro run`) because Svelte components and `$state` runes need the Svelte
 * compiler; `render()` from `svelte/server` needs no DOM. Gated behind
 * `BENCHMARK_RENDER` so ordinary `gro test` runs skip it instantly.
 *
 * Usage:
 *   npm run benchmark:render         # run and compare against baseline
 *   npm run benchmark:render:save    # run and save as new baseline
 *
 * The baseline lives at `src/benchmarks/render/baseline.json` — gitignored,
 * local-only, like the parser suite's.
 */

import { describe, test } from 'vitest';
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import { Benchmark } from '@fuzdev/fuz_util/benchmark.ts';
import {
	benchmark_baseline_save,
	benchmark_baseline_compare,
	benchmark_baseline_format
} from '@fuzdev/fuz_util/benchmark_baseline.ts';

import Mdz from '$lib/Mdz.svelte';
import MdzStream from '$lib/MdzStream.svelte';
import { MdzStreamParser } from '$lib/mdz_stream_parser.ts';
import { MdzStreamState } from '$lib/mdz_stream_state.svelte.ts';
import type { MdzOpcode } from '$lib/mdz_opcodes.ts';
import { benchmark_inputs } from './benchmark_inputs.ts';

// vitest's reporter intercepts `console.log`; write to stdout directly so the
// tables actually print under `gro test`
const print = (line: string): void => {
	process.stdout.write(`${line}\n`);
};

const BASELINE_PATH = 'src/benchmarks/render';

const mode = process.env.BENCHMARK_RENDER; // undefined | '1' | 'save'

// the render-relevant subset: block variety (medium/large), the table
// renderer's cell normalization (table heavy), and list/blockquote nesting
const INPUT_NAMES = ['medium', 'large', 'table heavy', 'list heavy', 'blockquote heavy'];
const inputs = benchmark_inputs.filter((i) => INPUT_NAMES.includes(i.name));
// `name` is a plain string, so a rename/typo in either list silently shrinks
// (or empties) `inputs` with no error — assert the filter matched every name
if (inputs.length !== INPUT_NAMES.length) {
	throw new Error(
		`render benchmark: INPUT_NAMES matched ${inputs.length}/${INPUT_NAMES.length} inputs — a name drifted`
	);
}

const parse_opcodes = (content: string): Array<MdzOpcode> => {
	const parser = new MdzStreamParser();
	parser.feed(content);
	parser.finish();
	return parser.take_opcodes();
};

// narrowed component types — the wrappers' `SvelteHTMLElements` rest-prop
// union is too complex for `render()`'s generic inference
const MdzNarrow = Mdz as unknown as Component<{ content: string }>;
const MdzStreamNarrow = MdzStream as unknown as Component<{ stream: MdzStreamState }>;

describe.skipIf(!mode)('render benchmarks', () => {
	test('run', { timeout: 600_000 }, async () => {
		const bench = new Benchmark({
			duration_ms: 1500,
			warmup_iterations: 10,
			min_iterations: 30
		});

		for (const input of inputs) {
			// static SSR: parse + render through `Mdz` → `MdzNodeView`
			bench.add(
				`ssr: ${input.name}`,
				() => render(MdzNarrow, { props: { content: input.content } }).body
			);

			// reactive consumer: opcodes → `MdzStreamState` tree (opcodes
			// precomputed — this isolates `apply_batch` from parsing)
			const opcodes = parse_opcodes(input.content);
			bench.add(`apply: ${input.name}`, () => {
				const state = new MdzStreamState();
				state.apply_batch(opcodes);
				return state.root.length;
			});

			// streaming SSR: the full pipeline a streaming page pays per render
			bench.add(`ssr stream: ${input.name}`, () => {
				const state = new MdzStreamState();
				state.apply_batch(parse_opcodes(input.content));
				return render(MdzStreamNarrow, { props: { stream: state } }).body;
			});
		}

		await bench.run();

		print('\n mdz Render Benchmark Results\n');
		print(bench.table());
		print('\n Summary\n');
		print(bench.summary());

		if (mode === 'save') {
			await benchmark_baseline_save(bench.results(), { path: BASELINE_PATH });
			print(`\n✓ Baseline saved to ${BASELINE_PATH}/baseline.json`);
			return;
		}

		const comparison = await benchmark_baseline_compare(bench.results(), {
			path: BASELINE_PATH,
			// Informational only (nothing gates CI on it). Cross-run absolute
			// compare can't resolve sub-~2× effects on this hardware — a zero-change
			// re-run has flagged most tasks as "regressions". The real signal is
			// within-run scaling / same-run ratios (see perf.md "Measurement
			// robustness"); this threshold just filters the noisiest local rows.
			regression_threshold: 1.1,
			staleness_warning_days: 30
		});
		print('\n Baseline Comparison\n');
		print(benchmark_baseline_format(comparison));
		if (comparison.baseline_found && comparison.regressions.length > 0) {
			print(
				'\n⚠️  Regressions detected. Run `npm run benchmark:render:save` to update the baseline if intentional.'
			);
		}
	});
});
