/**
 * Complexity regression guards for the parser's anti-quadratic / anti-
 * exponential work — the one measurement class that's machine-state
 * independent enough to gate CI (see the "Measurement robustness" note in the
 * mdz perf lore). These are deliberately NOT wall-clock-threshold assertions
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

// Bug 5 — nested unclosed `[` / same-name `<tag>` must not blow up
// exponentially in the sync lexer (a ~30-byte input hung it for seconds
// before the failure memo). At n=28 the fixed lexer is instant; a reverted
// (2ⁿ) lexer would need ~2^28 tokenizer calls and time out. n stays well
// below the recursion-depth ceiling so this tests time-complexity, not stack.
describe('nested inline constructs are not exponential (Bug 5)', () => {
	test('sync: nested unclosed [', {timeout: GUARD_TIMEOUT}, () => {
		assert.isArray(mdz_parse('['.repeat(28) + 'text'));
	});
	test('sync: nested same-name <tag>', {timeout: GUARD_TIMEOUT}, () => {
		assert.isArray(mdz_parse('<a>'.repeat(28) + 'X</a>'));
	});
	test('streaming table cell (delegates to the sync lexer)', {timeout: GUARD_TIMEOUT}, () => {
		const table = `| ${'['.repeat(28)}X | b |\n| --- | --- |\n| c | d |\n`;
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
