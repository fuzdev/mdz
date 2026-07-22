/**
 * Complexity regression guards for the parser's anti-quadratic / anti-
 * exponential work — the one measurement class that's machine-state
 * independent enough to gate CI: complexity is a property of the algorithm,
 * so it holds across machines, while throughput is not.
 * These are deliberately NOT wall-clock-threshold assertions
 * (the dev machine swings ~2×); each input is sized so the fixed parser
 * finishes in well under a millisecond while a reverted (super-linear) parser
 * would blow past the vitest timeout by orders of magnitude. The timeout is
 * the guard, so the huge margin makes them effectively unflakeable.
 *
 * Pair with the wall-clock scaling probe (`src/benchmarks/feed_scaling.local.ts`)
 * and the benchmark suites for magnitude/ratio measurement; this file only
 * answers linear-vs-not.
 */

import {describe, test, assert} from 'vitest';

import {mdz_parse} from '$lib/mdz.ts';
import {MdzStreamParser} from '$lib/mdz_stream_parser.ts';

const GUARD_TIMEOUT = 2000;

/** Feed `content` in fixed-size chunks (exercises the streaming hold/compaction paths). */
const feed_chunked = (content: string, chunk = 64): number => {
	const parser = new MdzStreamParser();
	let count = 0;
	for (let i = 0; i < content.length; i += chunk) {
		parser.feed(content.slice(i, i + chunk));
		count += parser.take_opcodes().length;
	}
	parser.finish();
	count += parser.take_opcodes().length;
	return count;
};

const feed_once = (content: string): number => {
	const parser = new MdzStreamParser();
	parser.feed(content);
	parser.finish();
	return parser.take_opcodes().length;
};

// Bug 5 — nested unclosed `[` / same-name `<tag>` in the sync lexer. The
// failure memo killed the 2ⁿ blowup; the `MAX_INLINE_NESTING_DEPTH` cap then
// made the sync path linear AND stack-safe (deeper opens render literal instead
// of recursing, bounding both the recursion depth and the number of reverting
// re-scans). At n=50_000 the fixed lexer runs in well under a second; any
// regression fails fast: dropping the cap stack-overflows (a thrown RangeError,
// not a hang), and dropping the memo re-descends exponentially — both overflow
// long before n=50_000. So this now guards time-complexity AND recursion depth,
// matching the streaming guards below (also n=50_000). The generous timeout is
// the linear-case ceiling, not the regression trigger.
const SYNC_DEEP_TIMEOUT = 8000;
describe('nested inline constructs are linear and stack-safe (Bug 5)', () => {
	test('sync: nested unclosed [', {timeout: SYNC_DEEP_TIMEOUT}, () => {
		assert.isArray(mdz_parse('['.repeat(50_000) + 'text'));
	});
	test('sync: nested same-name <tag>', {timeout: SYNC_DEEP_TIMEOUT}, () => {
		assert.isArray(mdz_parse('<a>'.repeat(50_000) + 'X</a>'));
	});
	test('sync: nested closed links to the cap and beyond', {timeout: SYNC_DEEP_TIMEOUT}, () => {
		const n = 50_000;
		assert.isArray(mdz_parse('['.repeat(n) + 'x' + ']'.repeat(n) + '(/u)'));
	});
	test('streaming table cell (delegates to the sync lexer)', {timeout: SYNC_DEEP_TIMEOUT}, () => {
		const table = `| ${'['.repeat(50_000)}X | b |\n| --- | --- |\n| c | d |\n`;
		assert.isAbove(feed_once(table), 0);
	});
});

// Streaming held-candidate scans must stay linear under chunked feeds — the
// `buffer_index_of` / `open_tag_counts` memos. Inputs are large enough
// (128KB, fed 64B at a time) that a reverted (quadratic) scan would time out
// while the memoized scan stays in the low ms.
describe('streaming held-candidate scans stay linear', () => {
	const BIG = 128_000;
	test('hold line code (unclosed ` under open **)', {timeout: GUARD_TIMEOUT}, () => {
		assert.isAbove(feed_chunked('**a `' + 'x'.repeat(BIG)), 0);
	});
	test('hold line link (unterminated [text](url…)', {timeout: GUARD_TIMEOUT}, () => {
		assert.isAbove(feed_chunked('[text](https://example.com/' + 'x'.repeat(BIG)), 0);
	});
	test('mismatched tags (unclosed <aN> + never-matching closer)', {timeout: GUARD_TIMEOUT}, () => {
		const input = Array.from({length: 4000}, (_, i) => `<a${i}>x</nomatch>`).join('');
		assert.isAbove(feed_once(input), 0);
	});
	test('deep nesting stays linear (iterative streaming path)', {timeout: GUARD_TIMEOUT}, () => {
		assert.isAbove(feed_once('['.repeat(50_000) + 'x'), 0);
	});
});

// A single tag with a huge number of distinct attributes. The `Set`-based
// duplicate-name check is O(1) per attribute, so the sync parse stays linear in
// the attribute count; a reverted O(n) rescan of the collected list would be
// O(n²) and blow past the timeout. The guard uses the sync parser: there the
// dedup is the only super-linear risk, whereas the streaming-chunked path also
// re-scans the held open-tag prefix per feed (the acknowledged residual term for
// a long single line in small chunks, unrelated to the dedup).
describe('tag attributes stay linear', () => {
	const many_attributes = (n: number): string =>
		'<Callout ' + Array.from({length: n}, (_, i) => `a${i}="${i}"`).join(' ') + '>x</Callout>';

	test('sync: many distinct attributes on one tag', {timeout: GUARD_TIMEOUT}, () => {
		assert.isArray(mdz_parse(many_attributes(50_000)));
	});
});
