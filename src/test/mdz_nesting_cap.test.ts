/**
 * Guards for the inline link/tag nesting-depth cap and the adversarial
 * backtracking cases it sits alongside (Bug 5's follow-up).
 *
 * Two concerns:
 *
 * 1. **Differential battery** — the sync lexer's link/tag failure paths still
 *    rewind and re-tokenize (the `#max_search_index` re-tokenization the memo
 *    kept), and its output on nested/mismatched `[`/`<` is load-bearing (it is
 *    the normative reference the streaming parser is checked against, and it
 *    diverges from the streaming parser on exactly these adversarial inputs).
 *    These summaries pin that output so a lexer refactor can't silently move it.
 *    None of these reach the depth cap.
 *
 * 2. **Nesting-depth cap** — beyond `MAX_INLINE_NESTING_DEPTH` open
 *    `Link`/`Element`/`Component` containers, a further `[`/`<tag>` renders
 *    literal in both parsers. This keeps the sync lexer linear and stack-safe
 *    on pathological nesting (see `mdz_scaling.test.ts`) and is mirrored in the
 *    streaming parser so the two agree on where deep nesting stops nesting.
 */

import {test, assert, describe} from 'vitest';

import {mdz_parse, type MdzNode} from '$lib/mdz.ts';
import {MAX_INLINE_NESTING_DEPTH} from '$lib/mdz_helpers.ts';
import {MdzStreamParser} from '$lib/mdz_stream_parser.ts';
import {mdz_opcodes_to_nodes} from '$lib/mdz_opcodes_to_nodes.ts';

/** Compact structural summary of a node tree — text/code inline, containers as `Type:tag(children)`. */
const summarize = (nodes: Array<MdzNode>): string =>
	nodes
		.map((n): string => {
			if (n.type === 'Text') return JSON.stringify(n.content);
			if (n.type === 'Code') return '`' + n.content + '`';
			if (n.type === 'Codeblock') return 'CB[' + JSON.stringify(n.content) + ']';
			const children = 'children' in n ? '(' + summarize(n.children) + ')' : '';
			const tag = 'name' in n ? n.name : 'reference' in n ? n.reference : undefined;
			return n.type + (tag !== undefined ? ':' + tag : '') + children;
		})
		.join(' ');

const stream_parse = (text: string): Array<MdzNode> => {
	const p = new MdzStreamParser();
	p.feed(text);
	p.finish();
	return mdz_opcodes_to_nodes(p.take_opcodes());
};

/** Deepest `Element`/`Component`/`Link` nesting in a tree (0 for none). */
const max_container_depth = (nodes: Array<MdzNode>): number => {
	let max = 0;
	for (const n of nodes) {
		if (!('children' in n)) continue;
		const inner = max_container_depth(n.children);
		const here = n.type === 'Element' || n.type === 'Component' || n.type === 'Link' ? 1 : 0;
		max = Math.max(max, here + inner);
	}
	return max;
};

// The sync parser is the normative reference; these lock its output on the
// adversarial cases where its rewind-and-retokenize backtracking is
// observable. Regenerate the right-hand strings only with a deliberate,
// reviewed semantics change (never to make a refactor "pass").
const BATTERY: Array<[string, string]> = [
	// tags-with-delimiters — the `#max_search_index` re-tokenization: a failed
	// outer tag re-tokenizes its children under the restored wider bound
	['<a>_x<a>y</a>_z', 'Paragraph("<a>_x" Element:a("y") "_z")'],
	['<a>_x<a>y</a>_ z', 'Paragraph("<a>" Italic("x" Element:a("y")) " z")'],
	['<b>`a</b>x`', 'Paragraph(Element:b("`a") "x`")'],
	['<b>x<b>y</b></b>', 'Element:b("x" Element:b("y"))'],
	['<a>**bold<a>inner</a>more**</a>', 'Element:a("**bold" Element:a("inner") "more**")'],
	['<a>_x</a>_', 'Paragraph(Element:a("_x") "_")'],
	['<a>[x</a>](/u)', 'Paragraph("<a>" Link:/u("x</a>"))'],
	['<a><b>x</a></b>', 'Paragraph(Element:a("<b>x") "</b>")'],
	['**a<a>b**c</a>d', 'Paragraph(Bold("a<a>b") "c</a>d")'],
	// links with delimiters / nesting
	['[a `b ] c`](/u)', 'Paragraph(Link:/u("a " `b ] c`))'],
	['[a[b](/u)', 'Paragraph("[a" Link:/u("b"))'],
	['[<a>x</a>](/u)', 'Paragraph(Link:/u(Element:a("x")))'],
	['[[[nested]]](/u)', 'Paragraph("[[[nested]]](/u)")'],
	// mixed link/tag precedence (sync's depth-first, the accepted stream divergence)
	['<a>[b</a>](/u)', 'Paragraph("<a>" Link:/u("b</a>"))'],
	['[<a>b](/u)</a>', 'Paragraph("[" Element:a("b](/u)"))'],
	['`<a>`x</a>', 'Paragraph(`<a>` "x</a>")'],
	// table cell delegates to the same sync lexer
	[
		'| <a>_x<a>y</a>_z | b |\n| --- | --- |\n| c | d |\n',
		'Table(TableRow(TableCell("<a>_x" Element:a("y") "_z") TableCell("b")) TableRow(TableCell("c") TableCell("d")))',
	],
];

describe('adversarial nesting output is stable (Bug 5 differential battery)', () => {
	for (const [input, expected] of BATTERY) {
		test(JSON.stringify(input), () => {
			assert.strictEqual(summarize(mdz_parse(input)), expected);
		});
	}
});

describe('inline nesting-depth cap', () => {
	const CAP = MAX_INLINE_NESTING_DEPTH;

	test('opens right up to the cap', () => {
		// exactly CAP balanced tags nest fully — the cap is not yet reached
		const input = '<a>'.repeat(CAP) + 'X' + '</a>'.repeat(CAP);
		assert.strictEqual(max_container_depth(mdz_parse(input)), CAP);
	});

	test('the container one past the cap renders literal', () => {
		// CAP+1 balanced tags: the deepest open would be at depth CAP, so it is
		// suppressed and its `<a>` becomes literal text — nesting stops at CAP
		const input = '<a>'.repeat(CAP + 1) + 'X' + '</a>'.repeat(CAP + 1);
		assert.strictEqual(max_container_depth(mdz_parse(input)), CAP);
	});

	test('deep unclosed [ stays literal, no throw', () => {
		// far past the cap and past the old recursion ceiling — must not overflow
		const nodes = mdz_parse('['.repeat(CAP * 5) + 'text');
		assert.isArray(nodes);
		assert.strictEqual(max_container_depth(nodes), 0); // all literal
	});

	test('sync and streaming agree at and beyond the cap (pure nesting)', () => {
		for (const n of [CAP - 1, CAP, CAP + 1, CAP + 2, CAP * 2]) {
			for (const input of [
				'['.repeat(n) + 'text',
				'<a>'.repeat(n) + 'X' + '</a>'.repeat(n),
				'<a>'.repeat(n) + 'X',
			]) {
				assert.strictEqual(
					JSON.stringify(mdz_parse(input)),
					JSON.stringify(stream_parse(input)),
					`parity at n=${n}: ${JSON.stringify(input.slice(0, 12))}…`,
				);
			}
		}
	});
});
