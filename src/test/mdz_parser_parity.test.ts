/**
 * Parity tests: streaming parser path (`MdzStreamParser` + `mdz_opcodes_to_nodes`)
 * must produce the same `MdzNode[]` tree as the one-shot `mdz_parse`.
 *
 * `mdz_parse` is the canonical reference; divergences are bugs. The known
 * residual divergence classes are backtick-adjacent adversarial chunking (an
 * inline-code candidate held across chunks decides text-vs-code bounded by a
 * wrongly-optimistic italic the one-shot parse greedy-rejects — locked by the
 * expected-divergence battery below), optimistic inline code left unclosed at
 * EOF (its tail was consumed as raw code text), link/tag opens skipped at
 * EOF, and block elements interrupting optimistic inlines at column 0 — see
 * the `MdzStreamParser` class TSDoc.
 */

import {test, assert, describe, beforeAll} from 'vitest';

import {mdz_parse, type MdzNode} from '$lib/mdz.js';
import {MdzStreamParser} from '$lib/mdz_stream_parser.js';
import {mdz_opcodes_to_nodes} from '$lib/mdz_opcodes_to_nodes.js';
import {MdzStreamState, type MdzStreamNode} from '$lib/mdz_stream_state.svelte.js';
import {load_fixtures, type MdzFixture} from './fixtures/mdz/mdz_test_helpers.js';

const stream_parse_text = (text: string) => {
	const p = new MdzStreamParser();
	p.feed(text);
	p.finish();
	return mdz_opcodes_to_nodes(p.take_opcodes());
};

const stream_parse_chunked = (text: string, chunk_size: number) => {
	const p = new MdzStreamParser();
	for (let i = 0; i < text.length; i += chunk_size) {
		p.feed(text.slice(i, i + chunk_size));
	}
	p.finish();
	return mdz_opcodes_to_nodes(p.take_opcodes());
};

/**
 * Render via `MdzStreamState`, then walk the reactive tree and reproduce a
 * plain-object shape compatible with `MdzNode[]`. This lets us assert that
 * the two consumers (`mdz_opcodes_to_nodes` and `MdzStreamState`) build the
 * same structure from the same opcodes — modulo per-node fields that
 * `MdzStreamState` doesn't track (`start`, `end`, `heading_id`).
 */
const stream_state_render = (input: string): Array<unknown> => {
	const parser = new MdzStreamParser();
	parser.feed(input);
	parser.finish();
	const state = new MdzStreamState();
	state.apply_batch(parser.take_opcodes());
	return state.root.map(to_plain);
};

// node types that carry text via `content` rather than a `children` array
const LEAF_TYPES = new Set(['Text', 'Code', 'Codeblock', 'Hr']);

interface PlainNode {
	type: string;
	content?: string;
	children?: Array<PlainNode>;
	level?: number;
	name?: string;
	lang?: string | null;
	reference?: string;
	link_type?: string;
	ordered?: boolean;
	start_number?: number;
	number?: number;
}

const merge_adjacent_text = (nodes: Array<PlainNode>): Array<PlainNode> => {
	const out: Array<PlainNode> = [];
	for (const c of nodes) {
		const last = out[out.length - 1];
		if (c.type === 'Text' && last?.type === 'Text') {
			last.content = (last.content ?? '') + (c.content ?? '');
		} else {
			out.push(c);
		}
	}
	return out;
};

/**
 * Apply the same tidies `mdz_opcodes_to_nodes` does in `build_node`:
 * - merge adjacent Text children inside every container (Paragraph, Heading,
 *   Bold, Italic, Strikethrough, Link, Element, Component)
 * - unwrap a Paragraph whose only meaningful child is a single
 *   Component/Element (MDX convention)
 */
const tidy = (nodes: Array<PlainNode>): Array<PlainNode> => {
	const out: Array<PlainNode> = [];
	for (const n of nodes) {
		const tidied: PlainNode = {...n};
		if (n.children) {
			tidied.children = merge_adjacent_text(tidy(n.children));
		}
		if (tidied.type === 'Paragraph' && tidied.children) {
			let single: PlainNode | null = null;
			let bail = false;
			for (const c of tidied.children) {
				if (c.type === 'Component' || c.type === 'Element') {
					if (single) {
						bail = true;
						break;
					}
					single = c;
				} else if (c.type === 'Text') {
					if ((c.content ?? '').trim() !== '') {
						bail = true;
						break;
					}
				} else {
					bail = true;
					break;
				}
			}
			if (!bail && single) {
				out.push(single);
				continue;
			}
		}
		out.push(tidied);
	}
	return out;
};

const to_plain = (node: MdzStreamNode): unknown => {
	const base: Record<string, unknown> = {type: node.type};
	if (node.type === 'Text' || node.type === 'Code' || node.type === 'Codeblock') {
		base.content = node.content;
	}
	if (!LEAF_TYPES.has(node.type)) {
		base.children = node.children.map(to_plain);
	}
	if (node.level !== undefined) base.level = node.level;
	if (node.name !== undefined) base.name = node.name;
	if (node.lang !== undefined) base.lang = node.lang;
	if (node.reference !== undefined) base.reference = node.reference;
	if (node.link_type !== undefined) base.link_type = node.link_type;
	if (node.ordered !== undefined) base.ordered = node.ordered;
	if (node.start_number !== undefined) base.start_number = node.start_number;
	if (node.number !== undefined) base.number = node.number;
	return base;
};

/** Project an `MdzNode` to the same plain shape (drop `start`/`end`/`heading_id`). */
const project_mdz_node = (node: MdzNode): unknown => {
	const base: Record<string, unknown> = {type: node.type};
	if (node.type === 'Text' || node.type === 'Code' || node.type === 'Codeblock') {
		base.content = node.content;
	}
	if (!LEAF_TYPES.has(node.type) && 'children' in node) {
		base.children = node.children.map(project_mdz_node);
	}
	if ('level' in node) base.level = node.level;
	if ('name' in node) base.name = node.name;
	if ('lang' in node) base.lang = node.lang;
	if ('reference' in node) base.reference = node.reference;
	if ('link_type' in node) base.link_type = node.link_type;
	if ('ordered' in node) base.ordered = node.ordered;
	if ('start_number' in node && node.start_number !== undefined) {
		base.start_number = node.start_number;
	}
	if ('number' in node && node.number !== undefined) base.number = node.number;
	return base;
};

describe('mdz parser parity', () => {
	describe('leading whitespace', () => {
		for (const input of ['\nhello', '\n\nhello', '\n\n\nhello', 'hello', 'hello\n', 'hello\n\n']) {
			test(`one-shot matches mdz_parse for ${JSON.stringify(input)}`, () => {
				assert.deepEqual(stream_parse_text(input), mdz_parse(input));
			});
		}
	});

	describe('whitespace-only blank lines', () => {
		// a line of only spaces/tabs/\r is blank: it breaks paragraphs, is
		// skipped at document edges, and bounds inline delimiter pairing.
		// The definition is ASCII-only — a Unicode-whitespace line (NBSP,
		// U+3000) is content, so a paragraph of it is kept, not dropped
		// (`has_non_whitespace`; the sync drop once used Unicode `.trim()`)
		for (const input of [
			' ',
			'a\n\n \n\nb',
			'　',
			'   ',
			'a\n \nb',
			'a\n\t\nb',
			'a\r\n\r\nb',
			'a\n \n \nb',
			' \nhello',
			' \t\nhello',
			'hello\n \n',
			'hello\n ',
			'**a\n \nb**',
			'a\n \n# h1\n \nb',
			'a\n \n---\t\nb',
			'a\n \n```\nx\n```',
			' ',
			'\n \n\t\n',
		]) {
			test(`one-shot matches mdz_parse for ${JSON.stringify(input)}`, () => {
				assert.deepEqual(stream_parse_text(input), mdz_parse(input));
			});
			for (const chunk_size of [1, 2, 3]) {
				test(`chunk_size=${chunk_size} matches mdz_parse for ${JSON.stringify(input)}`, () => {
					assert.deepEqual(stream_parse_chunked(input, chunk_size), mdz_parse(input));
				});
			}
		}
	});

	describe('fence tolerance', () => {
		// closing fences match on >= the opener's backtick count, and empty
		// fenced blocks are valid; a fence-prefixed line with trailing content
		// is content, and a closer is always its own line
		for (const input of [
			// empty blocks, newline- and EOF-terminated, with and without lang
			'```\n```',
			'```\n```\n',
			'```ts\n```\n',
			'a\n\n```\n```\n\nb',
			// longer closers
			'```\ncode\n````\n',
			'```\ncode\n``````\n',
			'````\ncode\n`````\n',
			'```\ncode\n```` \t\n', // trailing whitespace on a longer closer
			'```\n````', // empty block, longer closer at EOF
			// shorter runs never close — the fence consumes to EOF (raw mode is absolute)
			'````\ncode\n```\n',
			'````\n````\n', // exact still works
			// fence-prefixed lines with trailing content are content
			'```\ncode\n```x\nmore\n```\n',
			'```\ncode\n``` x\nmore\n```\n',
			'```\n````x\n```\n',
			// in-paragraph lookahead path (fence interrupts a paragraph)
			'para\n```\n```\nafter',
			'para\n```\ncode\n````\nafter',
			'para\n```\ncode\n```x\nmore\n```',
			'para\n````\ncode\n```', // no valid closer — the fence consumes to EOF
		]) {
			test(`one-shot matches mdz_parse for ${JSON.stringify(input)}`, () => {
				assert.deepEqual(stream_parse_text(input), mdz_parse(input));
			});
			for (const chunk_size of [1, 2, 3]) {
				test(`chunk_size=${chunk_size} matches mdz_parse for ${JSON.stringify(input)}`, () => {
					assert.deepEqual(stream_parse_chunked(input, chunk_size), mdz_parse(input));
				});
			}
		}
	});

	describe('lists', () => {
		// the design matrix from TODO_MDZ_LISTS_QUOTES: flat lists, nesting and
		// dedent snap, the uniform ordered interrupt guard, blank-line
		// containment, empty items, in-item fences (closed and unclosed —
		// raw mode is absolute), marker-line inline-only content, tab indents,
		// number edges, CRLF, list ends, and inline scoping across items
		for (const input of [
			// flat + continuation
			'- a',
			'- a\n- b\n',
			'- item two\n  continues\n  more\n',
			'- a\nplain prose\n', // no lazy continuation — list ends
			// nesting + dedent snap
			'- a\n  - b\n  - c\n- d\n',
			'- a\n   - b\n - c\n   - d\n',
			'- a\n\t- b\n',
			'- a\n  1. b\n  2. c\n- d',
			// ordered: numbering, guard, interrupts
			'1. a\n2. b\n',
			'0. zero\n',
			'007. seven\n',
			'1234567890. ten digits\n', // over the 9-digit cap — literal text
			'2024. The year\n',
			'para\n2024. not a list\n',
			'para\n1. interrupts\n',
			'- The year\n  2024. was wild\n', // guard inside an item run
			'1. a\n  2. b\n', // sequential deeper ordered — continuation, one item
			'1. a\n2024. b\n', // sibling takes any number
			'- a\n1. b\n', // marker-type switch
			// blank-line containment
			'- a\n\n- b\n',
			'- a\n\n  para two\n\n- b',
			'1. **Setup**\n\n   Install.\n\n   ```sh\n   npm install\n   ```\n\n2. **Run**\n\n   go\n',
			'- a\n\nplain\n- c\n', // blank then non-list closes, then a fresh list
			// empty items
			'- a\n-\n- b\n',
			'- a\n- \n- b',
			'1. a\n-\n2. b\n', // type mismatch — list ends at the bare `-`
			'- a\n -\n', // empty marker at unmatched indent
			'- a\n  -\n', // deeper empty marker — continuation text
			// in-item fences
			'- a\n  ```\n  code\n  ```\n- b',
			'- a\n  ```ts\n    indented\n  ```\n',
			'- a\n  ```\n  not closed', // raw mode is absolute — consumes to EOF
			'- a\n  ```\ndedented content\n  ```\n- b',
			'- a\n```\nx\n```', // column-0 fence ends the list
			// marker-line content is inline-only
			'- - -\n',
			'- - a\n',
			'- ```ts\n',
			// interrupts and ends
			'para\n- a\n- b\nafter',
			'---\n- a\n---',
			'- a\n# z',
			'- a\n\n# z',
			// CRLF + whitespace tolerance
			'- a\r\n- b\r\n',
			'-   spaced content\n',
			// inline scoping: pairs never cross item boundaries
			'- **bold** _it_ `c`\n- x_y z_w\n',
			'- _a\n- b_ c\n',
			'- **a\n- b**\n',
		]) {
			test(`one-shot matches mdz_parse for ${JSON.stringify(input)}`, () => {
				assert.deepEqual(stream_parse_text(input), mdz_parse(input));
			});
			for (const chunk_size of [1, 2, 3]) {
				test(`chunk_size=${chunk_size} matches mdz_parse for ${JSON.stringify(input)}`, () => {
					assert.deepEqual(stream_parse_chunked(input, chunk_size), mdz_parse(input));
				});
			}
		}
	});

	describe('blockquotes', () => {
		// the design matrix from TODO_MDZ_LISTS_QUOTES's blockquotes section:
		// prefix forms (tight/spaced runs, required space, the `> >x` backtrack,
		// bare prefixes), blank-ends-quote vs in-quote blank lines, no lazy
		// continuation at any depth, nesting deepen/dedent, the mini-document
		// content rules (lists, fences bound by the quote, headings, HRs, the
		// ordered guard), quotes in items, inline scoping, CRLF, and EOF holds
		for (const input of [
			// prefix forms
			'> a',
			'> a\n',
			'> a\n> b\n',
			'>> a\n',
			'> > a\n',
			'>> a\n> > b\n',
			'>a b\n',
			'>\ta\n',
			'> >x\n',
			'>>x\n',
			'>',
			'>\n',
			'> ',
			'>\n> a\n',
			'>  slop\n',
			'> a\n> >\n', // deeper bare prefix — continuation text, not an empty level
			// blank-line behavior
			'> a\n\n> b\n',
			'> a\n>\n> b\n',
			'> a\n> \t\n> b\n',
			'> a\n>\n>\n> b\n',
			'> > a\n>\n> b\n', // partial-prefix blank closes one level
			'> > a\n\n> b\n',
			// no lazy continuation
			'> a\nb\n',
			'> > a\n> b\n', // the dedented line opens a new paragraph, not lazy
			'> a\nb\n> c\n',
			'> a\n  > b\n', // indented prefix line ends the quote
			// interrupts
			'text\n> q\n',
			'- if x\n  > 5 then\n',
			'**a\n> q\n', // quote interrupts the optimistic bold (no closer side)
			// mini-document content
			'> # h\n',
			'> a\n> # h\n> b\n',
			'> a\n> ---\n> b\n',
			'> - x\n> - y\n',
			'> - x\n>   - y\n> - z\n',
			'> - a\n>   cont\n',
			'> - a\n>\n> - b\n', // in-quote blank drives list containment
			'> The year\n> 2024. was wild\n',
			'> foo\n> 1. bar\n',
			'> ```js\n> code\n> ```\nafter\n',
			'> ```\n> code\n\nafter\n', // unclosed fence ends at the quote boundary
			'> ```\ncode\n', // no lazy continuation into fences — empty fence
			'> ```\n> code', // unclosed fence, quote ends at EOF
			'> a\n> > > b\n', // deepen two levels at once
			'>>> a\n> b\n',
			// quotes inside items
			'- a\n  > q\n  > r\n',
			'- a\n  > q\n\n  > r\n', // blank splits into two quote children
			'- a\n  > q\n  back\n', // no lazy — new paragraph child of the item
			'- a\n> q\n', // column-0 prefix ends the list, opens a top-level quote
			'- > q\n', // marker-line content is inline-only
			'- a\n  > - x\n  > - y\n',
			'- a\n  > q\n    > r\n', // pre-prefix indent is structural slop
			'- a\n  - b\n  > q\n', // attaches to item a (pops level b)
			'- a\n  >\n', // deeper bare prefix — continuation text
			'- a\n  > q', // EOF inside an in-item quote
			// inline scoping
			'> **a\n> b**\n',
			'> **a\n>\n> b**\n', // the in-quote blank bounds the pair
			'> _a\n> b_ c\n',
			// CRLF + whitespace tolerance
			'> a\r\n> b\r\n',
			'> a\n>\r\n> b\n',
		]) {
			test(`one-shot matches mdz_parse for ${JSON.stringify(input)}`, () => {
				assert.deepEqual(stream_parse_text(input), mdz_parse(input));
			});
			for (const chunk_size of [1, 2, 3]) {
				test(`chunk_size=${chunk_size} matches mdz_parse for ${JSON.stringify(input)}`, () => {
					assert.deepEqual(stream_parse_chunked(input, chunk_size), mdz_parse(input));
				});
			}
		}
	});

	describe('intraword URL', () => {
		for (const input of [
			'xhttps://fuz.dev',
			'1https://fuz.dev',
			'.https://fuz.dev',
			'(https://fuz.dev)',
			'"https://fuz.dev"',
			'see https://fuz.dev',
			'\nhttps://fuz.dev',
			'https://fuz.dev',
		]) {
			test(`one-shot matches mdz_parse for ${JSON.stringify(input)}`, () => {
				assert.deepEqual(stream_parse_text(input), mdz_parse(input));
			});
		}
	});

	describe('case-insensitive URL scheme', () => {
		for (const input of [
			'HTTPS://fuz.dev',
			'Https://fuz.dev',
			'HtTpS://fuz.dev',
			'HTTP://fuz.dev',
			'Http://fuz.dev',
			'see HTTPS://fuz.dev here',
			'xHTTPS://fuz.dev',
		]) {
			test(`one-shot matches mdz_parse for ${JSON.stringify(input)}`, () => {
				assert.deepEqual(stream_parse_text(input), mdz_parse(input));
			});
			for (const chunk_size of [1, 2, 3]) {
				test(`chunk_size=${chunk_size} matches mdz_parse for ${JSON.stringify(input)}`, () => {
					assert.deepEqual(stream_parse_chunked(input, chunk_size), mdz_parse(input));
				});
			}
		}
	});

	describe('intraword path', () => {
		for (const input of [
			'x/path/to/thing',
			'x./relative',
			' /path/to/thing',
			' ./relative',
			'/path/to/thing',
			'./relative',
			'(./relative)',
		]) {
			test(`one-shot matches mdz_parse for ${JSON.stringify(input)}`, () => {
				assert.deepEqual(stream_parse_text(input), mdz_parse(input));
			});
		}
	});

	describe('strikethrough (GFM ~~)', () => {
		// `~~` is a doubled delimiter like `**` — no word-boundary checks,
		// first closer wins; a single `~` is literal everywhere (so `~/dev/…`
		// home paths never open a span). Chunk size 1 splits `~~` across
		// feeds, exercising the doubled-delimiter hold.
		for (const input of [
			'~~struck~~',
			'a ~~b~~ c',
			'a~~b~~c',
			'~~ x ~~',
			'~~~x~~~',
			'~~x~~~',
			'~~~x~~',
			'~~~~',
			'~one~ and ~~two~~',
			'see ~/dev/a/x.md and ~/dev/b/y.md here',
			'~~a **b** c~~',
			'**a ~~b~~ c**',
			'~~a `code` b~~',
			'~~a\nb~~',
			'~~a\n\nb~~',
			'~~_i_~~',
			'~~x~~_y_',
		]) {
			test(`one-shot matches mdz_parse for ${JSON.stringify(input)}`, () => {
				assert.deepEqual(stream_parse_text(input), mdz_parse(input));
			});
			for (const chunk_size of [1, 2, 3]) {
				test(`chunk_size=${chunk_size} matches mdz_parse for ${JSON.stringify(input)}`, () => {
					assert.deepEqual(stream_parse_chunked(input, chunk_size), mdz_parse(input));
				});
			}
		}
	});

	describe('unconfirmed URL prefix at EOF', () => {
		// speculative `https://`/`http://` prefix matching cut off by EOF —
		// the tail must stay plain text, never wrap in a Link (Bug 4)
		for (const input of [
			'# h',
			'a\n\n# h',
			'text h',
			'ht',
			'http',
			'https:',
			'see ht',
			'# https:',
			'text http',
		]) {
			test(`one-shot matches mdz_parse for ${JSON.stringify(input)}`, () => {
				assert.deepEqual(stream_parse_text(input), mdz_parse(input));
			});
			for (const chunk_size of [1, 2, 3]) {
				test(`chunk_size=${chunk_size} matches mdz_parse for ${JSON.stringify(input)}`, () => {
					assert.deepEqual(stream_parse_chunked(input, chunk_size), mdz_parse(input));
				});
			}
		}
	});

	describe('unclosed at EOF', () => {
		for (const input of [
			'**unclosed',
			'_unclosed',
			'~~unclosed',
			'~unclosed',
			'`unclosed',
			'[unclosed](',
			'[unclosed]',
			'<Alert>unclosed',
			'```ts\nunclosed',
			'**bold _italic',
			'**bold `code',
			// backtick-held tails resolved at finish(): forced-mode opens are
			// gated on a closer scan of the complete buffer, so bold/italic/
			// strike inside a held tail still form like the one-shot parse
			'~~a `x **b** z',
			'~~a `x **b**',
			'~~a `x **b** _i_ z',
			'**a `~~x~~',
			'~~a `x **b z',
		]) {
			test(`one-shot matches mdz_parse for ${JSON.stringify(input)}`, () => {
				assert.deepEqual(stream_parse_text(input), mdz_parse(input));
			});
		}
	});

	describe('tag closer crossing', () => {
		// an inline delimiter scan must never cross the enclosing tag's
		// closer: the sync lexer narrows `#max_search_index` per children-loop
		// iteration and the streaming `code_search_limit` stops at the closing
		// form (the lexer previously left the loop unbounded — a crossing scan
		// swallowed the closer and the dangling `tag_open` fallback discarded
		// all consumed content).
		for (const input of [
			'<b>`a</b>x`', // code scan crossing the closer
			'<b>**a</b>x**', // bold scan crossing the closer
			'<b>_a</b>x_', // italic scan crossing the closer
			'<b>~~a</b>x~~', // strikethrough scan crossing the closer
			'<b>x<b>y</b></b>', // nested same-name handoff
			'<b>a<b>b<b>c</b></b></b>', // triple nesting
			'<b>x<b>y</b>', // nested same-name stealing the only closer
			'<b><i>a</b>b</i>', // interleaved different-name
			'<b>`</b>` x</b>', // closer string inside a would-be code span
			'**bold <b>tag</b> more**', // tag bounded inside bold
			'# h <b>`a</b>x`', // crossing scan inside a heading
			'- <b>`a</b>x`', // crossing scan inside a list item
			'<b>`a</b>x` and trailing text', // content after the crossing point survives
		]) {
			test(`one-shot matches mdz_parse for ${JSON.stringify(input)}`, () => {
				assert.deepEqual(stream_parse_text(input), mdz_parse(input));
			});
			for (const chunk_size of [1, 2, 3]) {
				test(`chunk_size=${chunk_size} matches mdz_parse for ${JSON.stringify(input)}`, () => {
					assert.deepEqual(stream_parse_chunked(input, chunk_size), mdz_parse(input));
				});
			}
		}
	});

	describe('link bracket scope', () => {
		// neither parser bounds inline scans at a link's `]`: the sync link
		// children loop checks `]` only between children, so a code span may
		// swallow `]` (or a literal `[`) and the link still completes on a
		// later closer. `code_search_limit` must not let an open Link frame
		// contribute a bound — its stored `[` delimiter once did, making any
		// literal `[` inside the code span degrade the whole link to text.
		for (const input of [
			'[a `b ] c`](/u)', // code span swallows the link closer
			'[a `b [ c`](/u)', // literal `[` inside the code span
			'[a `b [ c` d](/u)', // same, with trailing link text
			'[x `y [ z` w](/path) tail', // same, with content after the link
			'[a `b` c](/u)', // plain code span inside link text
			'[a [ b](/u)', // literal `[` in link text outside code
			'[`a]b`', // code swallows `]` and no link ever completes
		]) {
			test(`one-shot matches mdz_parse for ${JSON.stringify(input)}`, () => {
				assert.deepEqual(stream_parse_text(input), mdz_parse(input));
			});
			for (const chunk_size of [1, 2, 3]) {
				test(`chunk_size=${chunk_size} matches mdz_parse for ${JSON.stringify(input)}`, () => {
					assert.deepEqual(stream_parse_chunked(input, chunk_size), mdz_parse(input));
				});
			}
		}
	});

	describe('link paren scope', () => {
		// only `]` delimits link text — a bare `)` between children is ordinary
		// content (the sync children loop once broke on `)`, aborting the link
		// where streaming completed it). The reference scan finds its own `)`
		// after `](` — always the first one, so parens never nest in references.
		for (const input of [
			'[a ) b](/u)', // bare `)` in link text
			'[a)b](/u)', // tight bare `)`
			'[see (note)](/u)', // balanced parens in link text
			'[a (b (c) d) e](/u)', // nested balanced parens
			'[a `)` b](/u)', // `)` inside a code span child
			'[a `(x)` b](/u)', // balanced parens inside a code span child
			'[a](x(y)z)', // `(` in reference — first `)` ends it
			'[a](/u(1))', // paren-bearing reference, leftover `)` is text
			'[a)b]', // no reference — stays literal text
			'[)](/u)', // link text is just `)`
			'[**b)old**](/u)', // bare `)` inside a formatting child
		]) {
			test(`one-shot matches mdz_parse for ${JSON.stringify(input)}`, () => {
				assert.deepEqual(stream_parse_text(input), mdz_parse(input));
			});
			for (const chunk_size of [1, 2, 3]) {
				test(`chunk_size=${chunk_size} matches mdz_parse for ${JSON.stringify(input)}`, () => {
					assert.deepEqual(stream_parse_chunked(input, chunk_size), mdz_parse(input));
				});
			}
		}
	});

	describe('tag boundary chunking', () => {
		// a `<` (or a mid-tag `/`) at the end of the buffer holds instead of
		// degrading to text: consuming it would eat a closing tag whose `</`
		// dispatch needs the next char, stranding the open element until the
		// EOF revert flattened it. Underscore-bearing tag names double as the
		// italic-closer probe: a `_` inside `</my_tag>` is a closer candidate
		// to `scan_closer_boundary` (no tag awareness), but any wrongly
		// optimistic open is corrected by the tag close's revert.
		for (const input of [
			'<my_tag>_a_ b</my_tag>', // real italic before the underscore tag closer
			'<my_tag>_a b</my_tag>', // unclosed italic candidate, `_` only in the closer
			'<a_>x</a_>', // trailing-underscore tag name
			'<a_>_x_ y</a_>', // trailing-underscore tag with italic
			'<a_>_x y</a_>', // optimistic italic corrected at tag close
			'<my_tag>_a b c</my_tag> _z_', // italic after the tag stays independent
			'<b>_a</b>_', // closer candidate after the tag close
			'_a <x_y>b</x_y>', // italic candidate before a tag open
			'<Foo />', // self-closing split at the `/`
			'a < b', // literal `<` resolved by the next chunk
		]) {
			test(`one-shot matches mdz_parse for ${JSON.stringify(input)}`, () => {
				assert.deepEqual(stream_parse_text(input), mdz_parse(input));
			});
			for (const chunk_size of [1, 2, 3]) {
				test(`chunk_size=${chunk_size} matches mdz_parse for ${JSON.stringify(input)}`, () => {
					assert.deepEqual(stream_parse_chunked(input, chunk_size), mdz_parse(input));
				});
			}
		}
	});

	describe('mid-stack revert ordering', () => {
		// a failed-closer revert dissolves a mid-stack frame while optimistic
		// containers above it stay open — the replacement delimiter text must
		// land *before* those containers' content. `insert_replacement`'s
		// append path once skipped the children_start shift for childless
		// frames above, scrambling `_**_a` chunked into `**__a`.
		const inputs = [
			'_**_a',
			'_**__',
			'_**__**',
			'_**_a**',
			'_**_a_',
			'**_~~__',
			'_~~_a~~',
			'_**~~_a',
		];
		for (const input of inputs) {
			for (const chunk_size of [1, 2, 3]) {
				test(`chunk_size=${chunk_size} matches mdz_parse for ${JSON.stringify(input)}`, () => {
					assert.deepEqual(stream_parse_chunked(input, chunk_size), mdz_parse(input));
				});
			}
			test(`chunked MdzStreamState tree matches for ${JSON.stringify(input)}`, () => {
				// the reactive consumer's own mid-stack revert path (pop + append)
				// only runs on chunked streams — one-shot rejects the italic
				// before it ever opens
				for (const chunk_size of [1, 2, 3]) {
					const parser = new MdzStreamParser();
					for (let i = 0; i < input.length; i += chunk_size) {
						parser.feed(input.slice(i, i + chunk_size));
					}
					parser.finish();
					const state = new MdzStreamState();
					state.apply_batch(parser.take_opcodes());
					const path3 = state.root.map(to_plain) as Array<PlainNode>;
					const path2 = mdz_parse(input).map(project_mdz_node) as Array<PlainNode>;
					assert.deepEqual(tidy(path3), path2);
				}
			});
		}
	});

	describe('backtick-adjacent divergence class (documented, expected)', () => {
		// the residual backtick-adjacent class, locked so the claim stays honest:
		// an italic that opened optimistically (no closer in buffer — `'pending'`)
		// bounds a later inline-code candidate via `code_search_limit`, so the
		// backtick decides text-vs-code against a wrongly-open frame the one-shot
		// parse never has — one-shot greedy-rejects that italic at its first
		// failed closer candidate, leaving the code scan unbounded. The text
		// decision is irrevocable (corrections are reified opcodes, never a
		// re-parse), so the later italic revert can't resurrect the code span.
		// Italic is the only wedge: it's the only delimiter whose one-shot form
		// rejects on a failed first closer (`_` is self-opaque), so bold/strike
		// optimism always reconverges. Requires an `_`-bearing code span chunked
		// so the italic opens before the span's closing backtick is visible.
		const cases: Array<{input: string; chunked: Array<MdzNode>}> = [
			{
				input: '_`__`',
				chunked: [
					{
						type: 'Paragraph',
						children: [{type: 'Text', content: '_`__`', start: 0, end: 5}],
						start: 0,
						end: 5,
					},
				],
			},
			{
				input: '_`_a`',
				chunked: [
					{
						type: 'Paragraph',
						children: [{type: 'Text', content: '_`_a`', start: 0, end: 5}],
						start: 0,
						end: 5,
					},
				],
			},
		];
		for (const {input, chunked} of cases) {
			test(`one-shot still matches mdz_parse for ${JSON.stringify(input)}`, () => {
				assert.deepEqual(stream_parse_text(input), mdz_parse(input));
			});
			test(`chunked diverges as documented for ${JSON.stringify(input)}`, () => {
				// the adversarial boundary: the italic and the backtick arrive
				// before the code span's interior — chunk size 2 and char-by-char
				// both place it there
				for (const chunk_size of [1, 2]) {
					assert.deepEqual(stream_parse_chunked(input, chunk_size), chunked);
				}
				// the divergence is real: the locked tree differs from one-shot
				assert.notDeepEqual(chunked, mdz_parse(input));
			});
		}
	});

	describe('buffer-end holds', () => {
		// every streaming decision point that reads chars near the buffer end
		// must hold (`need_more`/`'pending'`) rather than misclassify — the
		// `<`-at-buffer-end family: try_tag_open once consumed a chunk-final `<`
		// as text, eating a closing tag's `<` and stranding the element. Feeding
		// each input split into two chunks at every position puts every decision
		// point at a buffer end exactly once.
		const split_inputs = [
			// tag classification: `<`, mid-name, pre-`>` space, self-closing `/`
			'a < b',
			'<a/>',
			'<Foo />',
			'<b >x</b>',
			'<a_>x</a_>',
			'a</b',
			'</x> a',
			// doubled-delimiter and italic-closer holds
			'a~x~~y~~z',
			'_a_x',
			'_a __b__ c_',
			// link completion: `]` then `](` then the reference scan
			'[a](/u)x',
			'[a]x',
			'[a](/u )',
			// block openers: hashes, hyphens, fence backticks + lang line
			'#a',
			'####### a',
			'---x',
			'--x',
			'```ts arg\nx',
			// list markers: digits, `.`-or-growth, empty-marker lines
			'1. a\n12. b',
			'- a\n-\n- b',
			'007. x',
			'- a\n  2. b',
			// blockquote prefixes: separators, backtrack, tab form
			'> >x',
			'>\ta',
			'- a\n  > q',
			// URL/path prefixes cut at every length
			'see https://x.io y',
			'see https://',
			'https:// x',
			'see https:/z',
			'../a',
			'..x',
			'. x',
			'/ a',
		];
		for (const input of split_inputs) {
			test(`every split point matches mdz_parse for ${JSON.stringify(input)}`, () => {
				const expected = mdz_parse(input);
				for (let i = 1; i < input.length; i++) {
					const p = new MdzStreamParser();
					p.feed(input.slice(0, i));
					p.feed(input.slice(i));
					p.finish();
					assert.deepEqual(
						mdz_opcodes_to_nodes(p.take_opcodes()),
						expected,
						`split at ${i}: ${JSON.stringify(input.slice(0, i))} + ${JSON.stringify(input.slice(i))}`,
					);
				}
			});
		}
	});

	describe('mixed edge cases', () => {
		for (const input of [
			'',
			'\n',
			'\n\n',
			' ',
			'   \n   ',
			'  hello',
			'hello  \n',
			// space before block
			' # not a heading',
			'\n# heading',
			// boundary slipups
			'word*not_emph*word',
			'a\nhttps://fuz.dev',
			'a https://fuz.dev b',
		]) {
			test(`one-shot matches mdz_parse for ${JSON.stringify(input)}`, () => {
				assert.deepEqual(stream_parse_text(input), mdz_parse(input));
			});
		}
	});

	describe('fixtures one-shot', () => {
		let fixtures: Array<MdzFixture> = [];
		beforeAll(async () => {
			fixtures = await load_fixtures();
		});

		test('every fixture parses identically', () => {
			let diff_count = 0;
			const diffs: Array<string> = [];
			for (const fx of fixtures) {
				const a = mdz_parse(fx.input);
				const b = stream_parse_text(fx.input);
				try {
					assert.deepEqual(b, a);
				} catch {
					diff_count++;
					if (diffs.length < 5) {
						diffs.push(
							`${fx.name}: input=${JSON.stringify(fx.input)}\nstream=${JSON.stringify(b)}\nmdz_parse=${JSON.stringify(a)}`,
						);
					}
				}
			}
			if (diff_count > 0) {
				throw new Error(
					`${diff_count} fixture(s) diverge between mdz_parse and streaming parser:\n${diffs.join('\n')}`,
				);
			}
		});
	});

	describe('chunked input parity', () => {
		// inputs whose chunked tree must match the one-shot tree
		const inputs = [
			'hello',
			'\nhello',
			'see https://fuz.dev here',
			'`code`',
			'a\n\nb',
			'# Heading\n\ntext',
			'```ts\ncode\n```',
			'[text](https://fuz.dev)',
		];
		for (const input of inputs) {
			for (const chunk_size of [1, 2, 3]) {
				test(`chunk_size=${chunk_size} matches one-shot for ${JSON.stringify(input)}`, () => {
					assert.deepEqual(stream_parse_chunked(input, chunk_size), stream_parse_text(input));
				});
			}
		}
	});

	describe('MdzStreamState parity', () => {
		// path 2 (mdz_opcodes_to_nodes) tidies its output: adjacent text nodes
		// merge, and a paragraph whose only meaningful child is a single
		// Component/Element is unwrapped (MDX convention). Path 3
		// (MdzStreamState) builds a live reactive tree from the same opcodes
		// and does NOT apply those tidies — it keeps per-id node identity so
		// Svelte can update granularly. So full deep-equal is too strict.
		//
		// For inputs that have neither adjacent text runs nor single-tag
		// paragraphs, the two trees should match exactly (after normalizing
		// `start`/`end`/`heading_id`).
		const strict_inputs = [
			'hello',
			'\nhello',
			'\n\nhello',
			' ',
			'   \n   ',
			'**bold** done',
			'xhttps://fuz.dev',
			'xHTTPS://fuz.dev',
			'# Heading\n\nbody',
			'---\nafter',
			'```ts\ncode\n```',
			'a\n\nb',
			'`code`',
		];
		for (const input of strict_inputs) {
			test(`tree matches for ${JSON.stringify(input)}`, () => {
				const path2 = mdz_parse(input).map(project_mdz_node);
				const path3 = stream_state_render(input);
				assert.deepEqual(path3, path2);
			});
		}

		// For inputs where path 2 tidies (text-merge or single-tag unwrap),
		// apply the same tidy to path 3's output and assert structural equality.
		// Stronger than mere rendered-text equivalence.
		const tidy_inputs = [
			'see https://fuz.dev here',
			'see HTTPS://fuz.dev here',
			'HTTPS://fuz.dev',
			'a https://x.io b',
			'<Alert>hi</Alert>',
			'<div>x</div>',
			'**a** **b**',
			'see /docs here',
			'a **b** c **d** e',
		];
		for (const input of tidy_inputs) {
			test(`tidied tree matches for ${JSON.stringify(input)}`, () => {
				const path2 = mdz_parse(input).map(project_mdz_node) as Array<PlainNode>;
				const path3 = stream_state_render(input) as Array<PlainNode>;
				assert.deepEqual(tidy(path3), path2);
			});
		}

		// Run every fixture through path 3 (MdzStreamState), tidy, and compare
		// to path 2 (mdz_opcodes_to_nodes / mdz_parse). This is the strongest
		// per-consumer parity assertion in the suite.
		let fixtures: Array<MdzFixture> = [];
		beforeAll(async () => {
			fixtures = await load_fixtures();
		});

		test('every fixture round-trips through MdzStreamState', () => {
			const failures: Array<{name: string; diff: string}> = [];
			for (const fx of fixtures) {
				const path2 = mdz_parse(fx.input).map(project_mdz_node) as Array<PlainNode>;
				const path3 = stream_state_render(fx.input) as Array<PlainNode>;
				try {
					assert.deepEqual(tidy(path3), path2);
				} catch {
					failures.push({
						name: fx.name,
						diff: `input=${JSON.stringify(fx.input)}\npath3(tidied)=${JSON.stringify(tidy(path3))}\npath2=${JSON.stringify(path2)}`,
					});
				}
			}
			if (failures.length > 0) {
				throw new Error(
					`${failures.length} fixture(s) diverge between path 2 and path 3 (after tidy):\n` +
						failures
							.slice(0, 3)
							.map((f) => `--- ${f.name} ---\n${f.diff}`)
							.join('\n\n'),
				);
			}
		});
	});

	describe('chunked vs mdz_parse', () => {
		const inputs = [
			'\nhello',
			'xhttps://fuz.dev',
			'see https://fuz.dev\n',
			'**bold**\n',
			// italic is optimistic: it forms across chunk boundaries...
			'_italic_',
			'**bold** _italic_',
			'a _b_ c',
			// ...and reverts to match the one-shot parse when it never closes
			'see _word here',
			'word_',
			// failed closer: greedy first-candidate rejection must hold when chunked
			'_x_z',
			'_private_var',
			'the _user_id field and _name fields_',
			// a failed closer can itself be a fresh opener
			'_a -_b- c_',
			// the `_` delimiter is self-opaque — runs stay literal in both parsers
			'__init__',
			'_a __b__ c_',
			// single tildes are literal everywhere — only `~~` delimits
			'~a~b c~',
			'~~struck~~',
			// forced-mode EOF gating: bold/inline-code decisions in a
			// backtick-held tail match the one-shot parse at any chunking
			'~~a `x **b** z',
			'~~a `x **b**',
			'~~a `x **b** _i_ z',
			'~~a `x **b z',
			'a **',
			'****',
			'a ~~',
			'~~~~',
		];
		for (const input of inputs) {
			for (const chunk_size of [1, 2, 3]) {
				test(`chunk_size=${chunk_size} matches mdz_parse for ${JSON.stringify(input)}`, () => {
					assert.deepEqual(stream_parse_chunked(input, chunk_size), mdz_parse(input));
				});
			}
		}
	});
});
