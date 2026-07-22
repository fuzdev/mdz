/**
 * Deterministic complexity-ratio guards for the parser hot paths.
 *
 * Unlike `mdz_scaling.test.ts` (wall-clock timeouts — machine-dependent, so the
 * margins have to be huge), these assert on the `mdz_debug_work` scan-work
 * counter: a pure function of input + algorithm, identical across machines/runs.
 * For each pathology we parse at doubling input sizes and assert the work grows
 * ~linearly with input length — a super-linear regression (a lost memo, a
 * re-introduced rescan, a removed O(1) bail) makes the normalized ratio jump
 * from ~1 (linear) toward ~2 (quadratic) for a 2× step, well clear of the
 * threshold.
 */

import { describe, test, assert } from 'vitest';

import { mdz_parse } from '$lib/mdz.ts';
import { MdzStreamParser } from '$lib/mdz_stream_parser.ts';
import { mdz_debug_work, mdz_debug_work_reset } from '$lib/mdz_debug_work.ts';

/** Scan work for a full sync parse. */
const sync_work = (content: string): number => {
	mdz_debug_work_reset();
	mdz_parse(content);
	const total = mdz_debug_work.total;
	mdz_debug_work_reset(false);
	return total;
};

/** Scan work for a streaming parse, fed in `chunk`-byte slices (draining per feed). */
const stream_work = (content: string, chunk: number): number => {
	mdz_debug_work_reset();
	const p = new MdzStreamParser();
	if (chunk >= content.length) {
		p.feed(content);
		p.take_opcodes();
	} else {
		for (let i = 0; i < content.length; i += chunk) {
			p.feed(content.slice(i, i + chunk));
			p.take_opcodes();
		}
	}
	p.finish();
	p.take_opcodes();
	const total = mdz_debug_work.total;
	mdz_debug_work_reset(false);
	return total;
};

/**
 * Assert scan work grows sub-quadratically across increasing input sizes.
 * `normalized = work_ratio / size_ratio` is ~1 for linear, ~size_ratio (~2 for a
 * doubling) for quadratic; `MAX_NORMALIZED` sits between with margin for the
 * fixed-constant slop a linear algorithm carries at small sizes.
 */
const MAX_NORMALIZED = 1.5;
const assert_subquadratic = (
	label: string,
	inputs: Array<string>,
	work_fn: (input: string) => number
): void => {
	const points = inputs.map((input) => ({ len: input.length, work: work_fn(input) }));
	for (const p of points) assert.isAbove(p.work, 0, `${label}: nonzero work (counter wired)`);
	for (let i = 1; i < points.length; i++) {
		const size_ratio = points[i]!.len / points[i - 1]!.len;
		const work_ratio = points[i]!.work / points[i - 1]!.work;
		const normalized = work_ratio / size_ratio;
		assert.isBelow(
			normalized,
			MAX_NORMALIZED,
			`${label}: step ${i} normalized=${normalized.toFixed(3)} ` +
				`(work ${points[i - 1]!.work}→${points[i]!.work}, len ${points[i - 1]!.len}→${points[i]!.len})`
		);
	}
};

describe('parser scan work is sub-quadratic (deterministic)', () => {
	test('sync: nested unclosed `[` (Bug 5 revert re-tokenization)', () => {
		assert_subquadratic(
			'nested [',
			[2000, 4000, 8000].map((n) => '['.repeat(n) + 'text'),
			sync_work
		);
	});

	test('sync: nested same-name `<a>` (Bug 5 revert re-tokenization)', () => {
		assert_subquadratic(
			'nested <a>',
			[1000, 2000, 4000].map((n) => '<a>'.repeat(n) + 'X</a>'),
			sync_work
		);
	});

	test('sync: plain prose text scan', () => {
		assert_subquadratic(
			'prose',
			[2000, 4000, 8000].map((n) => 'the quick brown fox jumps over the lazy dog. '.repeat(n / 45)),
			sync_work
		);
	});

	test('streaming: hold-line code (buffer_index_of memo)', () => {
		assert_subquadratic(
			'hold code',
			[4000, 8000, 16000].map((chars) => '**a `' + 'x'.repeat(chars)),
			(input) => stream_work(input, 64)
		);
	});

	test('streaming: hold-line link (buffer_index_of memo)', () => {
		assert_subquadratic(
			'hold link',
			[4000, 8000, 16000].map((chars) => '[text](https://example.com/' + 'x'.repeat(chars)),
			(input) => stream_work(input, 64)
		);
	});

	test('streaming: mismatched tags (open_tag_counts O(1) bail)', () => {
		assert_subquadratic(
			'mismatched tags',
			[1000, 2000, 4000].map((n) =>
				Array.from({ length: n }, (_, i) => `<a${i}>x</nomatch>`).join('')
			),
			(input) => stream_work(input, input.length + 1)
		);
	});
});
