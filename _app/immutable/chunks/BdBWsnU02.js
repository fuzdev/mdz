import{A as e,F as t,I as n,J as r,L as i,N as a,V as o,Z as s,at as c,ct as l,et as u,g as d,h as ee,j as f,k as te,l as ne,lt as re,m as ie,mt as p,n as m,nt as h,p as ae,pt as g,rt as _,st as v,tt as y,vt as b,yt as x}from"./B8r-4TbV.js";import"./xihTtKlq.js";import{n as S}from"./BSJug3ju.js";import{t as oe}from"./BpcPEzjr.js";import{t as C}from"./D2wXB4ps.js";import{t as w}from"./B-E94u7Z.js";import{t as T}from"./60Qc_S8h.js";import{n as E,t as D}from"./D3FXuKgy.js";import{t as O}from"./Drq72xWj.js";import{t as k}from"./DlnQyQB52.js";import{t as A}from"./p6dH2hv-2.js";import{t as j}from"./3BKuWsia2.js";import{n as M,r as se,t as N}from"./C0mACOz32.js";var P=`mdz ships three ways to turn \`.mdz\` text into a rendered tree. Pick based on whether content is static, available all-at-once, or streaming.

### Path 1: \`Mdz\` component (default)

For inline use in a Svelte template, with content known up front:

\`\`\`svelte
<Mdz content="**bold** text" />
\`\`\`

Internally calls \`mdz_parse\` and renders via \`MdzNodeView\`. Best for: documentation pages, alerts, tooltips — anything where you have the full string before render. With /docs/svelte_preprocess_mdz this also compiles away at build time for static strings.

### Path 2: \`mdz_parse\` + \`MdzNodeView\` (one-shot, manual)

For control over wrapper markup, custom whitespace handling, or non-default CSS:

\`\`\`ts
import {mdz_parse} from '@fuzdev/mdz/mdz.js';
import MdzNodeView from '@fuzdev/mdz/MdzNodeView.svelte';

const nodes = mdz_parse(content);
\`\`\`

\`\`\`svelte
<div class="custom white-space:pre">
	{#each nodes as node}
		<MdzNodeView {node} />
	{/each}
</div>
\`\`\`

Same input, same tree as path 1, but you own the surrounding container. \`mdz_parse\` is the canonical reference parser — fixture tests pin its output as the source of truth.

### Path 3: \`MdzStreamParser\` + \`MdzStreamState\` + \`MdzStream\`

For content that arrives in chunks:

\`\`\`ts
import {MdzStreamParser} from '@fuzdev/mdz/mdz_stream_parser.js';
import {MdzStreamState} from '@fuzdev/mdz/mdz_stream_state.svelte.js';

const parser = new MdzStreamParser();
const stream = new MdzStreamState();

// feed chunks as they arrive
parser.feed(chunk);
stream.apply_batch(parser.take_opcodes());

// when done
parser.finish();
stream.apply_batch(parser.take_opcodes());
\`\`\`

\`\`\`svelte
<MdzStream {stream} />
\`\`\`

\`MdzStreamParser\` emits opcodes — small, serializable rendering instructions — as bytes arrive. \`MdzStreamState\` applies them to a reactive Svelte 5 tree. \`MdzStream\` walks that tree and produces DOM. Each layer is replaceable; opcodes are target-agnostic.
`,F=`The split is by input regime. The sync parser (paths 1–2) owns random-access input — content you already have as a complete string. The streaming parser (path 3) owns append-only input — content that arrives over time. They implement one grammar; parity tests bind them, with the sync parser as the normative reference.

Use **path 1** when the content is fixed at write time or arrives from a synchronous source. The svelte_preprocess_mdz preprocessor can collapse the call to a static render.

Use **path 2** when you need custom wrapping markup but still parse all-at-once.

Use **path 3** when chunks arrive over time. The output tree is identical to path 1/2 for the same final input, outside the documented adversarial cases (see below).
`,ce="A streaming parser can't backtrack — it must emit something coherent for every byte it consumes. mdz handles this with **optimistic** opens and explicit reverts.\n\nWhen the parser sees `**` it doesn't know yet whether it'll form bold or end up as literal `**`. It emits `open Bold` immediately. If a closing `**` arrives, it emits `close Bold` and the speculation succeeded. If a paragraph break or EOF interrupts first, it emits `revert Bold` — the consumer drops the wrapper, re-parents the children to the grandparent, and prepends the literal `**` delimiter as text.\n\nThe opcode types are:\n\n- `open` — open a container (Paragraph, Bold, Italic, Link, Heading, List, ListItem, Codeblock, etc.)\n- `close` — close the previously opened container, with deferred metadata resolved at close time (heading id, link reference). May carry `discard: true` for whitespace-only paragraphs the consumer should drop.\n- `text` — create a leaf Text or Code node\n- `append_text` — extend the last text node (avoids one node per character during plain runs)\n- `trim_text` — drop trailing characters from a text node (used for trailing-newline trim at block close)\n- `void` — create a self-contained leaf (Hr)\n- `revert` — undo an optimistic inline open (block structure is never speculative)\n- `wrap` — retroactively wrap an existing text node in a Link (auto-links only — may also split trailing punctuation; see below)\n\nThe full type definition is in `mdz_opcodes.ts`.\n",le="Auto-detected URLs (`https://...`, `/path`, `./relative`) are the one case where neither optimistic-open nor hold-until-terminator gives a good streaming feel.\n\nIf the parser opens a Link optimistically on every leading `h`, every word starting with h flashes blue before reverting. If it instead holds all bytes until a terminator, a 40-character URL creates a 40-character pause in the rendered output — readers see a stutter.\n\nThe `wrap` opcode resolves both problems. The URL streams as ordinary visible text. When the terminator finally arrives, `wrap` retroactively re-parents that text node inside a Link. The text content never changes — only its parent changes. Readers see prose flowing naturally, then a single moment where the URL upgrades from prose to clickable link. No flash, no pause.\n\n`wrap` also handles trailing punctuation trim. For `https://fuz.dev.`, the `.` is not part of the URL. `wrap` carries `trim_end` and `trim_id` fields that split the text node — the URL portion goes inside the Link, the trailing punctuation becomes a sibling Text node after it.\n",ue="The opcode sequence is **not** deterministic across different chunk sizes. The same input fed as one chunk versus many produces different intermediate `text`/`append_text` splits and different optimistic/revert sequences along the way.\n\nThe final rendered tree **is** deterministic. Bold, italic, and strikethrough open optimistically when no closer is visible yet, and four mechanisms keep the chunked result identical to the one-shot parse:\n\n- **Greedy rejection carries over.** One-shot parsing rejects an italic opener whose first closer candidate fails its word boundary. When that candidate only arrives in a later chunk, the streaming parser reverts the already-open container (`revert_failed_close`) — so `the _user_id field` never stays italic, no matter how it's chunked. (Bold and strikethrough have no boundary checks to fail — their doubled delimiters pair anywhere.)\n- **A one-character hold at the delimiter.** A `*` or `~` that is the last buffered character waits for the next character to learn whether it doubles into a delimiter; a potential italic closer at the buffer end waits because its word boundary depends on what follows.\n- **Failed closers can re-open.** After a failed-closer revert, the same delimiter is re-tried as a fresh opener, matching where the one-shot parse continues.\n- **EOF gating.** At `finish()` the buffer is complete, so open decisions stop speculating: bold, italic, and strikethrough open only when their confirmed closer is already in the final buffer, and an inline-code candidate without one degrades to literal text. Content held back during streaming (e.g. behind an undecided backtick) still parses like the one-shot parse when the stream ends.\n\nFour residual divergence classes remain:\n\n- **Italic-bounded code spans.** An inline-code candidate held across chunks can decide text-vs-code bounded by a wrongly-optimistic italic — one that opened before its failed closer was visible, where the one-shot parse greedy-rejects it and scans unbounded. This needs an `_`-bearing code span chunked so the italic opens before the span's closing backtick arrives; italic is the only wedge, since it's the only delimiter whose one-shot form rejects on a failed first closer.\n- **Unclosed optimistic code spans.** An inline-code candidate that opened optimistically and never closes consumes its tail as raw code text, so formatting inside it never forms once EOF flattens it back to text — the parser never re-parses.\n- **EOF-flat links and tags.** `finish()` doesn't open links or tags, so link/tag syntax held into EOF parses flat.\n- **Block interrupts across optimistic inlines.** A column-0 block line (heading, HR, fence, list marker, quote prefix) interrupts the paragraph even when an optimistic inline spans it — the one-shot parse, knowing the closer exists, swallows the line as inline text instead; streaming can't know, and interrupting matches the one-shot parse whenever no closer ever arrives.\n\nChunked-equals-one-shot is asserted across chunk sizes in `src/test/mdz_parser_parity.test.ts`, including failed-closer and delimiter-run inputs.\n",I=`Once emitted, opcodes are never mutated or removed. This means:

- A consumer can persist the opcode stream and replay it later.
- A network protocol can carry opcodes from parser to renderer.
- The renderer never re-parses.

The \`revert\` and \`trim_text\` opcodes look retroactive but aren't — they're new opcodes the consumer interprets as "drop these nodes" or "shorten this string". The stream itself only grows.

Stated precisely, the invariant is **no implicit retroactivity**. Corrections to already-emitted output are allowed — but they must be bounded, local, and expressed in the stream itself (\`revert\`, \`wrap\`, \`trim_text\`), so the set of things that can ever visually change is enumerable and testable. Re-parsing is the unbounded, implicit form of correction — "anything in this region may now differ, go figure out what" — which pushes diffing onto every consumer and excludes write-once targets. That is what mdz bans, and it's why the dialect is restricted: every construct must be decidable within a bounded hold or correctable with a local opcode.

This is the core of [pngwn's opcode insight](https://bsky.app/profile/pngwn.at/post/3mi527zntb22n): because no opcode is ever mutated or removed, the stream itself is the incremental interface — no tree to produce, no diffing to minimize work, and any target (a Svelte tree, HTML, native views) can consume it.
`,L="mdz ships two opcode consumers:\n\n- `mdz_opcodes_to_nodes(opcodes)` — replays an opcode array into the same `MdzNode[]` tree that `mdz_parse` produces. Used by tests to assert parity. Useful when you want the static tree shape but already have opcodes (e.g. cached from an earlier stream).\n\n- `MdzStreamState` — applies opcodes to a reactive Svelte 5 tree of `MdzStreamNode` instances. Each node's `content`, `children`, and metadata fields are `$state`, so Svelte updates only what changed. `MdzStream` renders the tree.\n\nThe two consumers' outputs are structurally equivalent (parity tests assert this). `MdzStreamState` is built for fine-grained reactivity and keeps per-id node identity for granular updates, so it skips a couple of tidies (adjacent-Text merging, single-tag paragraph unwrap) that `mdz_opcodes_to_nodes` applies at tree-build time.\n",de="- **Residual divergences under adversarial input**, as documented above — italic-bounded and unclosed code spans under adversarial chunking, link/tag syntax held into EOF, and column-0 block lines interrupting paragraphs spanned by an optimistic inline.\n- **Opcode stream order varies with chunking**, but the final tree does not.\n- **No partial-revert** — once a container closes, it's committed. Mid-render edits aren't supported.\n- **Single-pass** — backtracking would defeat the streaming guarantee. Ambiguous syntax (e.g. unclosed `[`) renders as visible text via revert rather than re-parsing.\n- **A table's header holds one line** — a pipe row (`| a | b |`) renders only once its delimiter row (`| - | - |`) arrives, the bounded lookahead that tells a table from a paragraph of literal pipes; body rows then stream one per line. This is intentional, not a stall: there's no useful partial render of a header before it's known to be a table.\n",fe="- `MdzStreamParser` — the parser class\n- `MdzStreamState` — reactive consumer\n- `mdz_opcodes_to_nodes` — tree consumer\n- `MdzOpcode` — opcode type union\n- /docs/usage/grammar — formal grammar for the dialect\n",pe=a(`<p class="color_d_50">(press <button type="button" class="inline color_d sm">stream</button> to begin)</p>`),me=a(`<p>Each character fed to <!> <code>open</code>, <code>text</code>, <code>close</code> sequences form, and <code>revert</code> when an
					optimistic assumption (e.g. unclosed <code>~~</code>) is abandoned.</p> <!>`,1),he=a(`<!> <p>Click the stream button below — each character is fed one at a time to show how constructs
				build incrementally:</p> <textarea aria-label="streaming mdz source"></textarea> <div class="row gap_md mb_md flex-wrap:wrap"><button type="button"> </button> <button type="button">reset</button> <button type="button" aria-label="back one character">◀</button> <button type="button" aria-label="forward one character">▶</button> <label class="row gap_xs"><input type="range" min="10" max="200" step="10"/> </label></div> <label class="row gap_md mb_md"><small>scrub<br/> </small> <input type="range" min="0" step="1" aria-label="scrub stream position"/></label> <div class="panel shade_05 mb_lg p_md"><!></div> <!> <!> <!>`,1),R=a(`<!> <!>`,1),ge=a(`Why <code>wrap</code> exists`,1),_e=a(`<section><p>Use the <code>Mdz</code> component (see <!>) when you have complete
				content upfront. For content that arrives incrementally (e.g. from an LLM), use <!> with <!> and <!>. The
				parser emits opcodes as rendering instructions — never re-parsing — and the state applies
				them as fine-grained Svelte mutations. The streaming design is derived from <a href="https://github.com/pngwn">@pngwn</a>'s ideas in this <a href="https://bsky.app/profile/pngwn.at/post/3mi527zntb22n">Bluesky thread</a> (<a href="https://pngwn.at/">pngwn.at</a>), which originated the approach mdz implements:
				restrict the dialect so streaming is tractable, render optimistically and correct when
				wrong, minimize work by never re-parsing, and emit serializable target-agnostic opcodes
				instead of a tree.</p></section> <!> <!> <!> <!> <!> <!> <!> <!> <!> <!>`,1);function z(n,a){p(a,!0);let z=S(`streaming`),B=v(`Streaming renders **bold text** as bold **immediately**, same with _italic_ and ~~strikethrough~~.

#### A heading

A paragraph with a link: https://fuz.dev, which linkifies once fully onscreen (lazily, not optimistically).

- list items confirm as soon as their marker classifies
  - nested ones included

> a blockquote's content is a mini-document
> spanning prefixed lines, with paragraph breaks on bare \`>\` lines
>
> - and the full grammar inside

\`\`\`ts
const y = 1336;
\`\`\`

---

(stream done)`),V=v(_(new M)),H=v(_(new N)),U=v(0),W=v(!1),G=v(!1),K=v(100),q=v(_([])),J,Y=()=>{let e=o(V).take_opcodes();e.length!==0&&(o(H).apply_batch(e),c(q,[...o(q),...e.map(e=>JSON.stringify(e))].slice(-20),!0))},ve=()=>{if(o(U)>=o(B).length){o(V).finish(),Y(),c(W,!1),c(G,!0),J!==void 0&&(clearInterval(J),J=void 0);return}o(V).feed(o(B)[o(U)]),Y(),l(U)},X=()=>{o(G)&&Q(),c(W,!0),J=setInterval(ve,o(K))},Z=()=>{c(W,!1),J!==void 0&&(clearInterval(J),J=void 0)},Q=()=>{Z(),c(V,new M,!0),c(H,new N,!0),c(U,0),c(G,!1),c(q,[],!0)},$=e=>{for(Z(),e<o(U)&&(c(V,new M,!0),c(H,new N,!0),c(U,0),c(G,!1),c(q,[],!0));o(U)<e&&o(U)<o(B).length;)o(V).feed(o(B)[o(U)]),l(U);Y(),o(U)>=o(B).length&&!o(G)&&(o(V).finish(),Y(),c(G,!0))};m(()=>()=>{J!==void 0&&clearInterval(J)}),j(n,{get code(){return A},get codeblock(){return O},children:(n,a)=>{T(n,{get tome(){return z},children:(n,a)=>{var l=_e(),p=y(l),m=u(p),g=h(u(m),3);C(g,{slug:`usage`});var _=h(g,2);w(_,{name:`MdzStreamParser`});var v=h(_,2);w(v,{name:`MdzStreamState`}),w(h(v,2),{name:`MdzStream`}),b(7),x(m),x(p);var S=h(p,2);E(S,{children:(n,a)=>{var l=he(),p=y(l);D(p,{text:`Demo`});var m=h(p,4);s(m),d(m,``,{},{height:`300px`});var g=h(m,2),_=u(g);d(_,``,{},{width:`85px`});var v=u(_,!0);x(_);var S=h(_,2),C=h(S,2),T=h(C,2),E=h(T,2),k=u(E);ae(k);var A=h(k);x(E),x(g);var j=h(g,2),M=u(j);d(M,``,{},{width:`50px`,"text-align":`right`});var N=h(u(M),2);x(M);var P=h(M,2);ae(P),d(P,``,{},{flex:`1`}),x(j);var F=h(j,2);d(F,``,{},{"min-height":`300px`});var ce=u(F),le=e=>{var t=pe(),n=h(u(t));b(),x(t),i(`click`,n,()=>o(W)?Z():X()),f(e,t)},ue=e=>{se(e,{get stream(){return o(H)}})};te(ce,e=>{o(U)===0?e(le):e(ue,-1)}),x(F);var I=h(F,2);oe(I,{summary:n=>{b();var i=t();r(()=>e(i,`opcodes (${(o(q).length===20?`last 20`:o(q).length)??``})`)),f(n,i)},children:(e,t)=>{var n=me(),r=y(n),i=h(u(r));w(i,{name:`MdzStreamParser`});var a=h(i);a.nodeValue=` can emit zero or more opcodes.
					This shows the most recent 20: watch `,b(10),x(r);var s=h(r,2);{let e=re(()=>o(q).length===0?`(no opcodes yet)`:[...o(q)].reverse().join(`
`));O(s,{lang:`json`,get content(){return o(e)}})}f(e,n)},$$slots:{summary:!0,default:!0}});var L=h(I,2);O(L,{lang:`ts`,dangerous_raw_html:`<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span><span class="token_capitalized_identifier token_class_name">MdzStreamParser</span><span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'@fuzdev/mdz/mdz_stream_parser.js'</span><span class="token_punctuation">;</span>
<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span><span class="token_capitalized_identifier token_class_name">MdzStreamState</span><span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'@fuzdev/mdz/mdz_stream_state.svelte.js'</span><span class="token_punctuation">;</span>

<span class="token_keyword">const</span> parser <span class="token_operator">=</span> <span class="token_keyword">new</span> <span class="token_class_name"><span class="token_capitalized_identifier token_class_name">MdzStreamParser</span></span><span class="token_punctuation">(</span><span class="token_punctuation">)</span><span class="token_punctuation">;</span>
<span class="token_keyword">const</span> stream <span class="token_operator">=</span> <span class="token_keyword">new</span> <span class="token_class_name"><span class="token_capitalized_identifier token_class_name">MdzStreamState</span></span><span class="token_punctuation">(</span><span class="token_punctuation">)</span><span class="token_punctuation">;</span>

<span class="token_comment">// feed chunks as they arrive</span>
parser<span class="token_punctuation">.</span><span class="token_function">feed</span><span class="token_punctuation">(</span>chunk<span class="token_punctuation">)</span><span class="token_punctuation">;</span>
stream<span class="token_punctuation">.</span><span class="token_function">apply_batch</span><span class="token_punctuation">(</span>parser<span class="token_punctuation">.</span><span class="token_function">take_opcodes</span><span class="token_punctuation">(</span><span class="token_punctuation">)</span><span class="token_punctuation">)</span><span class="token_punctuation">;</span>

<span class="token_comment">// when done</span>
parser<span class="token_punctuation">.</span><span class="token_function">finish</span><span class="token_punctuation">(</span><span class="token_punctuation">)</span><span class="token_punctuation">;</span>
stream<span class="token_punctuation">.</span><span class="token_function">apply_batch</span><span class="token_punctuation">(</span>parser<span class="token_punctuation">.</span><span class="token_function">take_opcodes</span><span class="token_punctuation">(</span><span class="token_punctuation">)</span><span class="token_punctuation">)</span><span class="token_punctuation">;</span>`}),O(h(L,2),{dangerous_raw_html:`<span class="token_tag"><span class="token_tag"><span class="token_punctuation token_tag_punctuation">&lt;</span>MdzStream</span> <span class="token_svelte_expression"><span class="token_punctuation">{</span><span class="token_lang_ts">stream</span><span class="token_punctuation">}</span></span> <span class="token_punctuation token_tag_punctuation">/></span></span>`}),r(()=>{e(v,o(W)?`pause`:o(G)?`restart`:`stream`),S.disabled=o(U)===0,C.disabled=o(U)===0,T.disabled=o(G),e(A,` ${o(K)??``}ms`),e(N,` ${o(U)??``}/${o(B).length??``}`),ie(P,`max`,o(B).length),ee(P,o(U))}),i(`input`,m,Q),ne(m,()=>o(B),e=>c(B,e)),i(`click`,_,()=>o(W)?Z():X()),i(`click`,S,Q),i(`click`,C,()=>$(o(U)-1)),i(`click`,T,()=>$(o(U)+1)),i(`input`,k,()=>{o(W)&&(Z(),X())}),ne(k,()=>o(K),e=>c(K,e)),i(`input`,P,e=>$(+e.currentTarget.value)),f(n,l)},$$slots:{default:!0}});var T=h(S,2);E(T,{children:(e,t)=>{var n=R(),r=y(n);D(r,{text:`Three rendering paths`}),k(h(r,2),{get content(){return P}}),f(e,n)},$$slots:{default:!0}});var A=h(T,2);E(A,{children:(e,t)=>{var n=R(),r=y(n);D(r,{text:`Picking a path`}),k(h(r,2),{get content(){return F}}),f(e,n)},$$slots:{default:!0}});var j=h(A,2);E(j,{children:(e,t)=>{var n=R(),r=y(n);D(r,{text:`Opcode design`}),k(h(r,2),{get content(){return ce}}),f(e,n)},$$slots:{default:!0}});var M=h(j,2);E(M,{children:(e,t)=>{var n=R(),r=y(n);D(r,{text:`Why wrap exists`,children:(e,t)=>{b();var n=ge();b(2),f(e,n)},$$slots:{default:!0}}),k(h(r,2),{get content(){return le}}),f(e,n)},$$slots:{default:!0}});var N=h(M,2);E(N,{children:(e,t)=>{var n=R(),r=y(n);D(r,{text:`Determinism and chunk boundaries`}),k(h(r,2),{get content(){return ue}}),f(e,n)},$$slots:{default:!0}});var z=h(N,2);E(z,{children:(e,t)=>{var n=R(),r=y(n);D(r,{text:`Append-only invariant`}),k(h(r,2),{get content(){return I}}),f(e,n)},$$slots:{default:!0}});var V=h(z,2);E(V,{children:(e,t)=>{var n=R(),r=y(n);D(r,{text:`Consumers`}),k(h(r,2),{get content(){return L}}),f(e,n)},$$slots:{default:!0}});var J=h(V,2);E(J,{children:(e,t)=>{var n=R(),r=y(n);D(r,{text:`Limitations`}),k(h(r,2),{get content(){return de}}),f(e,n)},$$slots:{default:!0}}),E(h(J,2),{children:(e,t)=>{var n=R(),r=y(n);D(r,{text:`See also`}),k(h(r,2),{get content(){return fe}}),f(e,n)},$$slots:{default:!0}}),f(n,l)},$$slots:{default:!0}})},$$slots:{default:!0}}),g()}n([`input`,`click`]);export{z as t};