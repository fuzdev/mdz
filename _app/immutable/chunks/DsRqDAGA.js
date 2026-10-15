import{B as e,D as t,I as n,P as r,R as i,T as a,W as o,X as s,ct as c,d as ee,et as l,f as te,it as u,j as d,lt as f,mt as p,nt as ne,o as re,ot as m,p as h,pt as g,rt as _,tt as v,u as ie,ut as ae,vt as y,yt as b,z as x}from"./CJ9vRaly.js";import{n as S}from"./DMpQj_xD.js";import{t as C}from"./DWZkmyes.js";import{t as w}from"./DK19hXqn.js";import{t as T}from"./CwVrC62K.js";import{n as E,t as D}from"./Cvhm3YiU.js";import{t as O}from"./x5mrGpEB.js";import{t as k}from"./Al_EB3lg.js";import{t as A}from"./BE5y2bHK.js";import{t as oe}from"./8WQdhB7W.js";import{t as j}from"./uLbomaXW.js";import{t as se}from"./Ddg_7vzy.js";import{n as M,r as ce,t as N}from"./DT872J5S.js";var P=`mdz ships three ways to turn \`.mdz\` text into a rendered tree. Pick based on whether content is static, available all-at-once, or streaming.

### Path 1: \`Mdz\` component (default)

For inline use in a Svelte template, with content known up front:

\`\`\`svelte
<Mdz content="**bold** text" />
\`\`\`

Internally calls \`mdz_parse\` and renders via \`MdzNodeView\`. Best for: documentation pages, alerts, tooltips — anything where you have the full string before render. With /docs/svelte_preprocess_mdz this also compiles away at build time for static strings. To skip the parse, pass a pre-parsed tree instead of a string — \`<Mdz nodes={tree} />\` — for content parsed ahead of render (e.g. a docs site pre-parsing its markdown at build time).

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
`,le="A streaming parser can't backtrack — it must emit something coherent for every byte it consumes. mdz handles this with **optimistic** opens and explicit reverts.\n\nWhen the parser sees `**` it doesn't know yet whether it'll form bold or end up as literal `**`. It emits `open Bold` immediately. If a closing `**` arrives, it emits `close Bold` and the speculation succeeded. If a paragraph break or EOF interrupts first, it emits `revert Bold` — the consumer drops the wrapper, re-parents the children to the grandparent, and prepends the literal `**` delimiter as text.\n\nThe opcode types are:\n\n- `open` — open a container (Paragraph, Bold, Italic, Link, Heading, List, ListItem, Codeblock, etc.)\n- `close` — close the previously opened container, with deferred metadata resolved at close time (heading id, link reference). May carry `discard: true` for whitespace-only paragraphs the consumer should drop.\n- `text` — create a leaf Text or Code node\n- `append_text` — extend the last text node (avoids one node per character during plain runs)\n- `trim_text` — drop trailing characters from a text node (used for trailing-newline trim at block close)\n- `void` — create a self-contained leaf (Hr)\n- `revert` — undo an optimistic inline open (block structure is never speculative)\n- `wrap` — retroactively wrap an existing text node in a Link (auto-links only — may also split trailing punctuation; see below)\n\nThe full type definition is in `mdz_opcodes.ts`.\n",ue="Auto-detected URLs (`https://...`, `/path`, `./relative`) are the one case where neither optimistic-open nor hold-until-terminator gives a good streaming feel.\n\nIf the parser opens a Link optimistically on every leading `h`, every word starting with h flashes blue before reverting. If it instead holds all bytes until a terminator, a 40-character URL creates a 40-character pause in the rendered output — readers see a stutter.\n\nThe `wrap` opcode resolves both problems. The URL streams as ordinary visible text. When the terminator finally arrives, `wrap` retroactively re-parents that text node inside a Link. The text content never changes — only its parent changes. Readers see prose flowing naturally, then a single moment where the URL upgrades from prose to clickable link. No flash, no pause.\n\n`wrap` also handles trailing punctuation trim. For `https://fuz.dev.`, the `.` is not part of the URL. `wrap` carries `trim_end` and `trim_id` fields that split the text node — the URL portion goes inside the Link, the trailing punctuation becomes a sibling Text node after it.\n",de="The opcode sequence is **not** deterministic across different chunk sizes. The same input fed as one chunk versus many produces different intermediate `text`/`append_text` splits and different optimistic/revert sequences along the way.\n\nThe final rendered tree **is** deterministic. Bold, italic, and strikethrough open optimistically when no closer is visible yet, and four mechanisms keep the chunked result identical to the one-shot parse:\n\n- **Greedy rejection carries over.** One-shot parsing rejects an italic opener whose first closer candidate fails its word boundary. When that candidate only arrives in a later chunk, the streaming parser reverts the already-open container (`revert_failed_close`) — so `the _user_id field` never stays italic, no matter how it's chunked. (Bold and strikethrough have no boundary checks to fail — their doubled delimiters pair anywhere.)\n- **A one-character hold at the delimiter.** A `*` or `~` that is the last buffered character waits for the next character to learn whether it doubles into a delimiter; a potential italic closer at the buffer end waits because its word boundary depends on what follows.\n- **Failed closers can re-open.** After a failed-closer revert, the same delimiter is re-tried as a fresh opener, matching where the one-shot parse continues.\n- **EOF gating.** At `finish()` the buffer is complete, so open decisions stop speculating: bold, italic, and strikethrough open only when their confirmed closer is already in the final buffer, and an inline-code candidate without one degrades to literal text. Content held back during streaming (e.g. behind an undecided backtick) still parses like the one-shot parse when the stream ends.\n\nFour residual divergence classes remain:\n\n- **Italic-bounded code spans.** An inline-code candidate held across chunks can decide text-vs-code bounded by a wrongly-optimistic italic — one that opened before its failed closer was visible, where the one-shot parse greedy-rejects it and scans unbounded. This needs an `_`-bearing code span chunked so the italic opens before the span's closing backtick arrives; italic is the only wedge, since it's the only delimiter whose one-shot form rejects on a failed first closer.\n- **Unclosed optimistic code spans.** An inline-code candidate that opened optimistically and never closes consumes its tail as raw code text, so formatting inside it never forms once EOF flattens it back to text — the parser never re-parses.\n- **EOF-flat links and tags.** `finish()` doesn't open links or tags, so link/tag syntax held into EOF parses flat.\n- **Block interrupts across optimistic inlines.** A column-0 block line (heading, HR, fence, list marker, quote prefix) interrupts the paragraph even when an optimistic inline spans it — the one-shot parse, knowing the closer exists, swallows the line as inline text instead; streaming can't know, and interrupting matches the one-shot parse whenever no closer ever arrives.\n\nChunked-equals-one-shot is asserted across chunk sizes in `src/test/mdz_parser_parity.test.ts`, including failed-closer and delimiter-run inputs.\n",I=`Once emitted, opcodes are never mutated or removed. This means:

- A consumer can persist the opcode stream and replay it later.
- A network protocol can carry opcodes from parser to renderer.
- The renderer never re-parses.

The \`revert\` and \`trim_text\` opcodes look retroactive but aren't — they're new opcodes the consumer interprets as "drop these nodes" or "shorten this string". The stream itself only grows.

Stated precisely, the invariant is **no implicit retroactivity**. Corrections to already-emitted output are allowed — but they must be bounded, local, and expressed in the stream itself (\`revert\`, \`wrap\`, \`trim_text\`), so the set of things that can ever visually change is enumerable and testable. Re-parsing is the unbounded, implicit form of correction — "anything in this region may now differ, go figure out what" — which pushes diffing onto every consumer and excludes write-once targets. That is what mdz bans, and it's why the dialect is restricted: every construct must be decidable within a bounded hold or correctable with a local opcode.

This is the core of [pngwn's opcode insight](https://bsky.app/profile/pngwn.at/post/3mi527zntb22n): because no opcode is ever mutated or removed, the stream itself is the incremental interface — no tree to produce, no diffing to minimize work, and any target (a Svelte tree, HTML, native views) can consume it.
`,L="mdz ships two opcode consumers:\n\n- `mdz_opcodes_to_nodes(opcodes)` — replays an opcode array into the same `MdzNode[]` tree that `mdz_parse` produces. Used by tests to assert parity. Useful when you want the static tree shape but already have opcodes (e.g. cached from an earlier stream).\n\n- `MdzStreamState` — applies opcodes to a reactive Svelte 5 tree of `MdzStreamNode` instances. Each node's `content`, `children`, and metadata fields are `$state`, so Svelte updates only what changed. `MdzStream` renders the tree.\n\nThe two consumers' outputs are structurally equivalent (parity tests assert this). `MdzStreamState` is built for fine-grained reactivity and keeps per-id node identity for granular updates, so it skips a couple of tidies (adjacent-Text merging, single-tag paragraph unwrap) that `mdz_opcodes_to_nodes` applies at tree-build time.\n",fe="- **Residual divergences under adversarial input**, as documented above — italic-bounded and unclosed code spans under adversarial chunking, link/tag syntax held into EOF, and column-0 block lines interrupting paragraphs spanned by an optimistic inline.\n- **Opcode stream order varies with chunking**, but the final tree does not.\n- **No partial-revert** — once a container closes, it's committed. Mid-render edits aren't supported.\n- **Single-pass** — backtracking would defeat the streaming guarantee. Ambiguous syntax (e.g. unclosed `[`) renders as visible text via revert rather than re-parsing.\n- **A table's header holds one line** — a pipe row (`| a | b |`) renders only once its delimiter row (`| - | - |`) arrives, the bounded lookahead that tells a table from a paragraph of literal pipes; body rows then stream one per line. This is intentional, not a stall: there's no useful partial render of a header before it's known to be a table.\n",pe="- `MdzStreamParser` — the parser class\n- `MdzStreamState` — reactive consumer\n- `mdz_opcodes_to_nodes` — tree consumer\n- `MdzOpcode` — opcode type union\n- /docs/usage/grammar — formal grammar for the dialect\n",me=n(`<p class="color_d_50">(press <button type="button" class="inline palette_d sized_sm">stream</button> to begin)</p>`),he=n(`<p>Each character fed to <!> <code>open</code>, <code>text</code>, <code>close</code> sequences form, and <code>revert</code> when an
					optimistic assumption (e.g. unclosed <code>~~</code>) is abandoned.</p> <!>`,1),ge=n(`<!> <p>Click the stream button below — each character is fed one at a time to show how constructs
				build incrementally:</p> <!> <div class="row gap_md mb_md flex-wrap:wrap"><button type="button"> </button> <button type="button">reset</button> <button type="button" aria-label="back one character">◀</button> <button type="button" aria-label="forward one character">▶</button> <label class="row gap_xs"><input type="range" min="10" max="200" step="10"/> </label></div> <label class="row gap_md mb_md"><small>scrub<br/> </small> <input type="range" min="0" step="1" aria-label="scrub stream position"/></label> <div class="panel shade_05 mb_lg p_md"><!></div> <!> <!> <!>`,1),R=n(`<!> <!>`,1),_e=n(`Why <code>wrap</code> exists`,1),ve=n(`<section><p>Use the <code>Mdz</code> component (see <!>) when you have complete
				content upfront. For content that arrives incrementally (e.g. from an LLM), use <!> with <!> and <!>. The parser emits opcodes as rendering instructions
				— never re-parsing — and the state applies them as fine-grained Svelte mutations. The
				streaming design is derived from <a href="https://github.com/pngwn">@pngwn</a>'s ideas in
				this <a href="https://bsky.app/profile/pngwn.at/post/3mi527zntb22n">Bluesky thread</a> (<a href="https://pngwn.at/">pngwn.at</a>), which originated the approach mdz implements:
				restrict the dialect so streaming is tractable, render optimistically and correct when
				wrong, minimize work by never re-parsing, and emit serializable target-agnostic opcodes
				instead of a tree.</p></section> <!> <!> <!> <!> <!> <!> <!> <!> <!> <!>`,1);function z(n,x){p(x,!0);let z=S(`streaming`),B=c(`Streaming renders **bold text** as bold **immediately**, same with _italic_ and ~~strikethrough~~.

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

(stream done)`),V=c(u(new M)),H=c(u(new N)),U=c(0),W=c(!1),G=c(!1),K=c(100),q=c(u([])),J,Y=()=>{let e=o(V).take_opcodes();e.length!==0&&(o(H).apply_batch(e),m(q,[...o(q),...e.map(e=>JSON.stringify(e))].slice(-20),!0))},ye=()=>{o(U)>=o(B).length?(o(V).finish(),Y(),m(W,!1),m(G,!0),J!==void 0&&(clearInterval(J),J=void 0)):(o(V).feed(o(B)[o(U)]),Y(),f(U))},X=()=>{o(G)&&Q(),m(W,!0),J=setInterval(ye,o(K))},Z=()=>{m(W,!1),J!==void 0&&(clearInterval(J),J=void 0)},Q=()=>{Z(),m(V,new M,!0),m(H,new N,!0),m(U,0),m(G,!1),m(q,[],!0)},$=e=>{for(Z(),e<o(U)&&(m(V,new M,!0),m(H,new N,!0),m(U,0),m(G,!1),m(q,[],!0));o(U)<e&&o(U)<o(B).length;)o(V).feed(o(B)[o(U)]),f(U);Y(),o(U)>=o(B).length&&!o(G)&&(o(V).finish(),Y(),m(G,!0))};t(()=>()=>{J!==void 0&&clearInterval(J)}),j(n,{get code(){return A},get codeblock(){return O},children:(t,n)=>{T(t,{get tome(){return z},children:(t,n)=>{var c=ve(),u=v(c),f=l(u),p=_(l(f),3);C(p,{slug:`usage`});var g=_(p,2);w(g,{name:`MdzStreamParser`});var x=_(g,2);w(x,{name:`MdzStreamState`});var S=_(x,2);w(S,{name:`MdzStream`}),y(7),b(f),b(u);var T=_(u,2);E(T,{children:(t,n)=>{var c=ge(),u=v(c);D(u,{text:`Demo`});var f=_(u,4);oe(f,{lang:`md`,style:`height: 300px`,oninput:Q,"aria-label":`streaming mdz source`,get value(){return o(B)},set value(e){m(B,e,!0)}});var p=_(f,2),g=l(p);h(g,``,{},{width:`85px`});var x=ne(g,!0),S=_(g,2),C=_(S,2),T=_(C,2),E=_(T,2),k=l(E);ie(k);var A=_(k);b(E),b(p);var j=_(p,2),M=l(j);h(M,``,{},{width:`50px`,"text-align":`right`});var N=_(l(M),2);b(M);var P=_(M,2);ie(P),h(P,``,{},{flex:`1`}),b(j);var F=_(j,2);h(F,``,{},{"min-height":`300px`});var le=l(F),ue=t=>{var n=me(),i=_(l(n));y(),b(n),e(`click`,i,()=>o(W)?Z():X()),r(t,n)},de=e=>{ce(e,{get stream(){return o(H)}})};a(le,e=>{o(U)===0?e(ue):e(de,-1)}),b(F);var I=_(F,2);se(I,{summary:e=>{y();var t=i();s(()=>d(t,`opcodes
					(${(o(q).length===20?`last 20`:o(q).length)??``})`)),r(e,t)},children:(e,t)=>{var n=he(),i=v(n),a=_(l(i));w(a,{name:`MdzStreamParser`});var s=_(a);s.nodeValue=` can emit zero or more
					opcodes. This shows the most recent 20: watch `,y(10),b(i);var c=_(i,2);{let e=ae(()=>o(q).length===0?`(no opcodes yet)`:[...o(q)].reverse().join(`
`));O(c,{lang:`json`,get content(){return o(e)}})}r(e,n)},$$slots:{summary:!0,default:!0}});var L=_(I,2);O(L,{lang:`ts`,dangerous_raw_html:`<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span><span class="token_capitalized_identifier token_class_name">MdzStreamParser</span><span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'@fuzdev/mdz/mdz_stream_parser.js'</span><span class="token_punctuation">;</span>
<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span><span class="token_capitalized_identifier token_class_name">MdzStreamState</span><span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'@fuzdev/mdz/mdz_stream_state.svelte.js'</span><span class="token_punctuation">;</span>

<span class="token_keyword">const</span> parser <span class="token_operator">=</span> <span class="token_keyword">new</span> <span class="token_class_name">MdzStreamParser</span><span class="token_punctuation">();</span>
<span class="token_keyword">const</span> stream <span class="token_operator">=</span> <span class="token_keyword">new</span> <span class="token_class_name">MdzStreamState</span><span class="token_punctuation">();</span>

<span class="token_comment">// feed chunks as they arrive</span>
parser<span class="token_punctuation">.</span><span class="token_function">feed</span><span class="token_punctuation">(</span>chunk<span class="token_punctuation">);</span>
stream<span class="token_punctuation">.</span><span class="token_function">apply_batch</span><span class="token_punctuation">(</span>parser<span class="token_punctuation">.</span><span class="token_function">take_opcodes</span><span class="token_punctuation">());</span>

<span class="token_comment">// when done</span>
parser<span class="token_punctuation">.</span><span class="token_function">finish</span><span class="token_punctuation">();</span>
stream<span class="token_punctuation">.</span><span class="token_function">apply_batch</span><span class="token_punctuation">(</span>parser<span class="token_punctuation">.</span><span class="token_function">take_opcodes</span><span class="token_punctuation">());</span>`});var fe=_(L,2);O(fe,{dangerous_raw_html:`<span class="token_tag"><span class="token_tag"><span class="token_punctuation token_tag_punctuation">&lt;</span>MdzStream</span> <span class="token_svelte_expression"><span class="token_punctuation">{</span><span class="token_lang_ts">stream</span><span class="token_punctuation">}</span></span> <span class="token_punctuation token_tag_punctuation">/></span></span>`}),s(()=>{d(x,o(W)?`pause`:o(G)?`restart`:`stream`),S.disabled=o(U)===0,C.disabled=o(U)===0,T.disabled=o(G),d(A,` ${o(K)??``}ms`),d(N,` ${o(U)??``}/${o(B).length??``}`),ee(P,`max`,o(B).length),te(P,o(U))}),e(`click`,g,()=>o(W)?Z():X()),e(`click`,S,Q),e(`click`,C,()=>$(o(U)-1)),e(`click`,T,()=>$(o(U)+1)),e(`input`,k,()=>{o(W)&&(Z(),X())}),re(k,()=>o(K),e=>m(K,e)),e(`input`,P,e=>$(+e.currentTarget.value)),r(t,c)},$$slots:{default:!0}});var A=_(T,2);E(A,{children:(e,t)=>{var n=R(),i=v(n);D(i,{text:`Three rendering paths`});var a=_(i,2);k(a,{get content(){return P}}),r(e,n)},$$slots:{default:!0}});var j=_(A,2);E(j,{children:(e,t)=>{var n=R(),i=v(n);D(i,{text:`Picking a path`});var a=_(i,2);k(a,{get content(){return F}}),r(e,n)},$$slots:{default:!0}});var M=_(j,2);E(M,{children:(e,t)=>{var n=R(),i=v(n);D(i,{text:`Opcode design`});var a=_(i,2);k(a,{get content(){return le}}),r(e,n)},$$slots:{default:!0}});var N=_(M,2);E(N,{children:(e,t)=>{var n=R(),i=v(n);D(i,{text:`Why wrap exists`,children:(e,t)=>{y();var n=_e();y(2),r(e,n)},$$slots:{default:!0}});var a=_(i,2);k(a,{get content(){return ue}}),r(e,n)},$$slots:{default:!0}});var z=_(N,2);E(z,{children:(e,t)=>{var n=R(),i=v(n);D(i,{text:`Determinism and chunk boundaries`});var a=_(i,2);k(a,{get content(){return de}}),r(e,n)},$$slots:{default:!0}});var V=_(z,2);E(V,{children:(e,t)=>{var n=R(),i=v(n);D(i,{text:`Append-only invariant`});var a=_(i,2);k(a,{get content(){return I}}),r(e,n)},$$slots:{default:!0}});var J=_(V,2);E(J,{children:(e,t)=>{var n=R(),i=v(n);D(i,{text:`Consumers`});var a=_(i,2);k(a,{get content(){return L}}),r(e,n)},$$slots:{default:!0}});var Y=_(J,2);E(Y,{children:(e,t)=>{var n=R(),i=v(n);D(i,{text:`Limitations`});var a=_(i,2);k(a,{get content(){return fe}}),r(e,n)},$$slots:{default:!0}});var ye=_(Y,2);E(ye,{children:(e,t)=>{var n=R(),i=v(n);D(i,{text:`See also`});var a=_(i,2);k(a,{get content(){return pe}}),r(e,n)},$$slots:{default:!0}}),r(t,c)},$$slots:{default:!0}})},$$slots:{default:!0}}),g()}x([`click`,`input`]);export{z as t};