import"../chunks/DsnmJJEf.js";import{o as He,s as q}from"../chunks/DaTEp9bf.js";import{p as Ge,ai as z,aq as ne,b as Je,f as p,s as t,d as l,q as e,a as c,u as Xe,t as $e,ar as x,D as Ke,c as L,aj as i,at as Se,an as P,r as u,bE as Qe,as as Ye}from"../chunks/Du85iFdT.js";import{i as Ze}from"../chunks/DWERStIh.js";import{d as j,r as Me,s as et,e as tt}from"../chunks/clDczNMi.js";import{b as Te}from"../chunks/BgDvjuzc.js";import{C as B}from"../chunks/DFuQBK4k.js";import{c as nt}from"../chunks/bZDkO85-.js";import{T as at}from"../chunks/DU43LYFZ.js";import{T as m,a as h}from"../chunks/CfnxhSWl.js";import{D as V}from"../chunks/Bjw_vp0s.js";import{T as st}from"../chunks/B4WkpB_6.js";import{D as rt}from"../chunks/B5hh5bgj.js";import{D as ot}from"../chunks/Bb_mRBe3.js";import{M as g}from"../chunks/Cmsc6GFE.js";import{b as ae,a as se,M as it}from"../chunks/DyLSW3DI.js";import{M as ct}from"../chunks/D68Fw7q2.js";const dt=`mdz ships three ways to turn \`.mdz\` text into a rendered tree. Pick based on whether content is static, available all-at-once, or streaming.

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
`,pt=`The split is by input regime. The sync parser (paths 1–2) owns random-access input — content you already have as a complete string. The streaming parser (path 3) owns append-only input — content that arrives over time. They implement one grammar; parity tests bind them, with the sync parser as the normative reference.

Use **path 1** when the content is fixed at write time or arrives from a synchronous source. The svelte_preprocess_mdz preprocessor can collapse the call to a static render.

Use **path 2** when you need custom wrapping markup but still parse all-at-once.

Use **path 3** when chunks arrive over time. The output tree is identical to path 1/2 for the same final input, outside the documented adversarial cases (see below).
`,lt="A streaming parser can't backtrack — it must emit something coherent for every byte it consumes. mdz handles this with **optimistic** opens and explicit reverts.\n\nWhen the parser sees `**` it doesn't know yet whether it'll form bold or end up as literal `**`. It emits `open Bold` immediately. If a closing `**` arrives, it emits `close Bold` and the speculation succeeded. If a paragraph break or EOF interrupts first, it emits `revert Bold` — the consumer drops the wrapper, re-parents the children to the grandparent, and prepends the literal `**` delimiter as text.\n\nThe opcode types are:\n\n- `open` — open a container (Paragraph, Bold, Italic, Link, Heading, List, ListItem, Codeblock, etc.)\n- `close` — close the previously opened container, with deferred metadata resolved at close time (heading id, link reference). May carry `discard: true` for whitespace-only paragraphs the consumer should drop.\n- `text` — create a leaf Text or Code node\n- `append_text` — extend the last text node (avoids one node per character during plain runs)\n- `trim_text` — drop trailing characters from a text node (used for trailing-newline trim at block close)\n- `void` — create a self-contained leaf (Hr)\n- `revert` — undo an optimistic inline open (block structure is never speculative)\n- `wrap` — retroactively wrap an existing text node in a Link (auto-links only — may also split trailing punctuation; see below)\n\nThe full type definition is in `mdz_opcodes.ts`.\n",ut="Auto-detected URLs (`https://...`, `/path`, `./relative`) are the one case where neither optimistic-open nor hold-until-terminator gives a good streaming feel.\n\nIf the parser opens a Link optimistically on every leading `h`, every word starting with h flashes blue before reverting. If it instead holds all bytes until a terminator, a 40-character URL creates a 40-character pause in the rendered output — readers see a stutter.\n\nThe `wrap` opcode resolves both problems. The URL streams as ordinary visible text. When the terminator finally arrives, `wrap` retroactively re-parents that text node inside a Link. The text content never changes — only its parent changes. Readers see prose flowing naturally, then a single moment where the URL upgrades from prose to clickable link. No flash, no pause.\n\n`wrap` also handles trailing punctuation trim. For `https://fuz.dev.`, the `.` is not part of the URL. `wrap` carries `trim_end` and `trim_id` fields that split the text node — the URL portion goes inside the Link, the trailing punctuation becomes a sibling Text node after it.\n",mt="The opcode sequence is **not** deterministic across different chunk sizes. The same input fed as one chunk versus many produces different intermediate `text`/`append_text` splits and different optimistic/revert sequences along the way.\n\nThe final rendered tree **is** deterministic. Bold, italic, and strikethrough open optimistically when no closer is visible yet, and four mechanisms keep the chunked result identical to the one-shot parse:\n\n- **Greedy rejection carries over.** One-shot parsing rejects an italic opener whose first closer candidate fails its word boundary. When that candidate only arrives in a later chunk, the streaming parser reverts the already-open container (`revert_failed_close`) — so `the _user_id field` never stays italic, no matter how it's chunked. (Bold and strikethrough have no boundary checks to fail — their doubled delimiters pair anywhere.)\n- **A one-character hold at the delimiter.** A `*` or `~` that is the last buffered character waits for the next character to learn whether it doubles into a delimiter; a potential italic closer at the buffer end waits because its word boundary depends on what follows.\n- **Failed closers can re-open.** After a failed-closer revert, the same delimiter is re-tried as a fresh opener, matching where the one-shot parse continues.\n- **EOF gating.** At `finish()` the buffer is complete, so open decisions stop speculating: bold, italic, and strikethrough open only when their confirmed closer is already in the final buffer, and an inline-code candidate without one degrades to literal text. Content held back during streaming (e.g. behind an undecided backtick) still parses like the one-shot parse when the stream ends.\n\nFour residual divergence classes remain:\n\n- **Italic-bounded code spans.** An inline-code candidate held across chunks can decide text-vs-code bounded by a wrongly-optimistic italic — one that opened before its failed closer was visible, where the one-shot parse greedy-rejects it and scans unbounded. This needs an `_`-bearing code span chunked so the italic opens before the span's closing backtick arrives; italic is the only wedge, since it's the only delimiter whose one-shot form rejects on a failed first closer.\n- **Unclosed optimistic code spans.** An inline-code candidate that opened optimistically and never closes consumes its tail as raw code text, so formatting inside it never forms once EOF flattens it back to text — the parser never re-parses.\n- **EOF-flat links and tags.** `finish()` doesn't open links or tags, so link/tag syntax held into EOF parses flat.\n- **Block interrupts across optimistic inlines.** A column-0 block line (heading, HR, fence, list marker, quote prefix) interrupts the paragraph even when an optimistic inline spans it — the one-shot parse, knowing the closer exists, swallows the line as inline text instead; streaming can't know, and interrupting matches the one-shot parse whenever no closer ever arrives.\n\nChunked-equals-one-shot is asserted across chunk sizes in `src/test/mdz_parser_parity.test.ts`, including failed-closer and delimiter-run inputs.\n",ht=`Once emitted, opcodes are never mutated or removed. This means:

- A consumer can persist the opcode stream and replay it later.
- A network protocol can carry opcodes from parser to renderer.
- The renderer never re-parses.

The \`revert\` and \`trim_text\` opcodes look retroactive but aren't — they're new opcodes the consumer interprets as "drop these nodes" or "shorten this string". The stream itself only grows.

Stated precisely, the invariant is **no implicit retroactivity**. Corrections to already-emitted output are allowed — but they must be bounded, local, and expressed in the stream itself (\`revert\`, \`wrap\`, \`trim_text\`), so the set of things that can ever visually change is enumerable and testable. Re-parsing is the unbounded, implicit form of correction — "anything in this region may now differ, go figure out what" — which pushes diffing onto every consumer and excludes write-once targets. That is what mdz bans, and it's why the dialect is restricted: every construct must be decidable within a bounded hold or correctable with a local opcode.

This is the core of [pngwn's opcode insight](https://bsky.app/profile/pngwn.at/post/3mi527zntb22n): because no opcode is ever mutated or removed, the stream itself is the incremental interface — no tree to produce, no diffing to minimize work, and any target (a Svelte tree, HTML, native views) can consume it.
`,_t="mdz ships two opcode consumers:\n\n- `mdz_opcodes_to_nodes(opcodes)` — replays an opcode array into the same `MdzNode[]` tree that `mdz_parse` produces. Used by tests to assert parity. Useful when you want the static tree shape but already have opcodes (e.g. cached from an earlier stream).\n\n- `MdzStreamState` — applies opcodes to a reactive Svelte 5 tree of `MdzStreamNode` instances. Each node's `content`, `children`, and metadata fields are `$state`, so Svelte updates only what changed. `MdzStream` renders the tree.\n\nThe two consumers' outputs are structurally equivalent (parity tests assert this). `MdzStreamState` is built for fine-grained reactivity and keeps per-id node identity for granular updates, so it skips a couple of tidies (adjacent-Text merging, single-tag paragraph unwrap) that `mdz_opcodes_to_nodes` applies at tree-build time.\n",ft=`- **Residual divergences under adversarial input**, as documented above — italic-bounded and unclosed code spans under adversarial chunking, link/tag syntax held into EOF, and column-0 block lines interrupting paragraphs spanned by an optimistic inline.
- **Opcode stream order varies with chunking**, but the final tree does not.
- **No partial-revert** — once a container closes, it's committed. Mid-render edits aren't supported.
- **Single-pass** — backtracking would defeat the streaming guarantee. Ambiguous syntax (e.g. unclosed \`[\`) renders as visible text via revert rather than re-parsing.
`,vt="- `MdzStreamParser` — the parser class\n- `MdzStreamState` — reactive consumer\n- `mdz_opcodes_to_nodes` — tree consumer\n- `MdzOpcode` — opcode type union\n- /docs/usage/grammar — formal grammar for the dialect\n";var gt=L('<p class="color_d_50">(press <button type="button" class="inline color_d sm">stream</button> to begin)</p>'),kt=L(`<p>Each character fed to <!> <code>open</code>, <code>text</code>, <code>close</code> sequences form, and <code>revert</code> when an
					optimistic assumption (e.g. unclosed <code>~~</code>) is abandoned.</p> <!>`,1),bt=L(`<!> <p>Click the stream button below — each character is fed one at a time to show how constructs
				build incrementally:</p> <textarea aria-label="streaming mdz source"></textarea> <div class="row gap_md mb_md flex-wrap:wrap"><button type="button"> </button> <button type="button">reset</button> <button type="button" aria-label="back one character">◀</button> <button type="button" aria-label="forward one character">▶</button> <label class="row gap_xs"><input type="range" min="10" max="200" step="10"/> </label></div> <label class="row gap_md mb_md"><small>scrub<br/> </small> <input type="range" min="0" step="1" aria-label="scrub stream position"/></label> <div class="panel shade_05 mb_lg p_md"><!></div> <!> <!> <!>`,1),k=L("<!> <!>",1),wt=L("Why <code>wrap</code> exists",1),yt=L(`<section><p>Use the <code>Mdz</code> component (see <!>) when you have complete
				content upfront. For content that arrives incrementally (e.g. from an LLM), use <!> with <!> and <!>. The
				parser emits opcodes as rendering instructions — never re-parsing — and the state applies
				them as fine-grained Svelte mutations. The streaming design is derived from <a href="https://github.com/pngwn">@pngwn</a>'s ideas in this <a href="https://bsky.app/profile/pngwn.at/post/3mi527zntb22n">Bluesky thread</a> (<a href="https://pngwn.at/">pngwn.at</a>), which originated the approach mdz implements:
				restrict the dialect so streaming is tractable, render optimistically and correct when
				wrong, minimize work by never re-parsing, and emit serializable target-agnostic opcodes
				instead of a tree.</p></section> <!> <!> <!> <!> <!> <!> <!> <!> <!> <!>`,1);function qt(Pe,Le){Ge(Le,!0);const Ae=nt("streaming"),Oe=`Streaming renders **bold text** as bold **immediately**, same with _italic_ and ~~strikethrough~~.

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

(stream done)`,W=20;let _=z(Oe),$=z(ne(new ae)),F=z(ne(new se)),o=z(0),S=z(!1),b=z(!1),I=z(100),w=z(ne([])),f;const C=()=>{const y=e($).take_opcodes();y.length!==0&&(e(F).apply_batch(y),i(w,[...e(w),...y.map(re=>JSON.stringify(re))].slice(-W),!0))},Ue=()=>{if(e(o)>=e(_).length){e($).finish(),C(),i(S,!1),i(b,!0),f!==void 0&&(clearInterval(f),f=void 0);return}e($).feed(e(_)[e(o)]),C(),Se(o)},H=()=>{e(b)&&G(),i(S,!0),f=setInterval(Ue,e(I))},A=()=>{i(S,!1),f!==void 0&&(clearInterval(f),f=void 0)},G=()=>{A(),i($,new ae,!0),i(F,new se,!0),i(o,0),i(b,!1),i(w,[],!0)},J=y=>{for(A(),y<e(o)&&(i($,new ae,!0),i(F,new se,!0),i(o,0),i(b,!1),i(w,[],!0));e(o)<y&&e(o)<e(_).length;)e($).feed(e(_)[e(o)]),Se(o);C(),e(o)>=e(_).length&&!e(b)&&(e($).finish(),C(),i(b,!0))};He(()=>()=>{f!==void 0&&clearInterval(f)}),ct(Pe,{get code(){return ot},get codeblock(){return B},children:(y,re)=>{at(y,{get tome(){return Ae},children:(Ee,xt)=>{var oe=yt(),X=p(oe),ie=l(X),ce=t(l(ie),3);st(ce,{slug:"usage"});var de=t(ce,2);V(de,{name:"MdzStreamParser"});var pe=t(de,2);V(pe,{name:"MdzStreamState"});var je=t(pe,2);V(je,{name:"MdzStream"}),P(7),u(ie),u(X);var le=t(X,2);m(le,{children:(r,v)=>{var n=bt(),a=p(n);h(a,{text:"Demo"});var s=t(a,4);Qe(s),j(s,"",{},{height:"300px"});var O=t(s,2),T=l(O);j(T,"",{},{width:"85px"});var K=l(T,!0);u(T);var Q=t(T,2),Y=t(Q,2),Z=t(Y,2),be=t(Z,2),R=l(be);Me(R);var Ie=t(R);u(be),u(O);var ee=t(O,2),D=l(ee);j(D,"",{},{width:"50px","text-align":"right"});var Ce=t(l(D),2);u(D);var U=t(D,2);Me(U),j(U,"",{},{flex:"1"}),u(ee);var N=t(ee,2);j(N,"",{},{"min-height":"300px"});var Re=l(N);{var De=d=>{var M=gt(),E=t(l(M));P(),u(M),x("click",E,()=>e(S)?A():H()),c(d,M)},Ne=d=>{it(d,{get stream(){return e(F)}})};Ze(Re,d=>{e(o)===0?d(De):d(Ne,-1)})}u(N);var we=t(N,2);rt(we,{summary:M=>{P();var E=Ke();$e(()=>q(E,`opcodes (${(e(w).length===W?`last ${W}`:e(w).length)??""})`)),c(M,E)},children:(M,E)=>{var ze=kt(),te=p(ze),xe=t(l(te));V(xe,{name:"MdzStreamParser"});var Be=t(xe);Be.nodeValue=` can emit zero or more opcodes.
					This shows the most recent 20: watch `,P(10),u(te);var Ve=t(te,2);{let We=Xe(()=>e(w).length===0?"(no opcodes yet)":[...e(w)].reverse().join(`
`));B(Ve,{lang:"json",get content(){return e(We)}})}c(M,ze)},$$slots:{summary:!0,default:!0}});var ye=t(we,2);B(ye,{lang:"ts",dangerous_raw_html:`<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span><span class="token_capitalized_identifier token_class_name">MdzStreamParser</span><span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'@fuzdev/mdz/mdz_stream_parser.js'</span><span class="token_punctuation">;</span>
<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span><span class="token_capitalized_identifier token_class_name">MdzStreamState</span><span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'@fuzdev/mdz/mdz_stream_state.svelte.js'</span><span class="token_punctuation">;</span>

<span class="token_keyword">const</span> parser <span class="token_operator">=</span> <span class="token_keyword">new</span> <span class="token_class_name"><span class="token_capitalized_identifier token_class_name">MdzStreamParser</span></span><span class="token_punctuation">(</span><span class="token_punctuation">)</span><span class="token_punctuation">;</span>
<span class="token_keyword">const</span> stream <span class="token_operator">=</span> <span class="token_keyword">new</span> <span class="token_class_name"><span class="token_capitalized_identifier token_class_name">MdzStreamState</span></span><span class="token_punctuation">(</span><span class="token_punctuation">)</span><span class="token_punctuation">;</span>

<span class="token_comment">// feed chunks as they arrive</span>
parser<span class="token_punctuation">.</span><span class="token_function">feed</span><span class="token_punctuation">(</span>chunk<span class="token_punctuation">)</span><span class="token_punctuation">;</span>
stream<span class="token_punctuation">.</span><span class="token_function">apply_batch</span><span class="token_punctuation">(</span>parser<span class="token_punctuation">.</span><span class="token_function">take_opcodes</span><span class="token_punctuation">(</span><span class="token_punctuation">)</span><span class="token_punctuation">)</span><span class="token_punctuation">;</span>

<span class="token_comment">// when done</span>
parser<span class="token_punctuation">.</span><span class="token_function">finish</span><span class="token_punctuation">(</span><span class="token_punctuation">)</span><span class="token_punctuation">;</span>
stream<span class="token_punctuation">.</span><span class="token_function">apply_batch</span><span class="token_punctuation">(</span>parser<span class="token_punctuation">.</span><span class="token_function">take_opcodes</span><span class="token_punctuation">(</span><span class="token_punctuation">)</span><span class="token_punctuation">)</span><span class="token_punctuation">;</span>`});var qe=t(ye,2);B(qe,{dangerous_raw_html:'<span class="token_tag"><span class="token_tag"><span class="token_punctuation token_tag_punctuation">&lt;</span>MdzStream</span> <span class="token_svelte_expression"><span class="token_punctuation">{</span><span class="token_lang_ts">stream</span><span class="token_punctuation">}</span></span> <span class="token_punctuation token_tag_punctuation">/></span></span>'}),$e(()=>{q(K,e(S)?"pause":e(b)?"restart":"stream"),Q.disabled=e(o)===0,Y.disabled=e(o)===0,Z.disabled=e(b),q(Ie,` ${e(I)??""}ms`),q(Ce,` ${e(o)??""}/${e(_).length??""}`),et(U,"max",e(_).length),tt(U,e(o))}),x("input",s,G),Te(s,()=>e(_),d=>i(_,d)),x("click",T,()=>e(S)?A():H()),x("click",Q,G),x("click",Y,()=>J(e(o)-1)),x("click",Z,()=>J(e(o)+1)),x("input",R,()=>{e(S)&&(A(),H())}),Te(R,()=>e(I),d=>i(I,d)),x("input",U,d=>J(+d.currentTarget.value)),c(r,n)},$$slots:{default:!0}});var ue=t(le,2);m(ue,{children:(r,v)=>{var n=k(),a=p(n);h(a,{text:"Three rendering paths"});var s=t(a,2);g(s,{get content(){return dt}}),c(r,n)},$$slots:{default:!0}});var me=t(ue,2);m(me,{children:(r,v)=>{var n=k(),a=p(n);h(a,{text:"Picking a path"});var s=t(a,2);g(s,{get content(){return pt}}),c(r,n)},$$slots:{default:!0}});var he=t(me,2);m(he,{children:(r,v)=>{var n=k(),a=p(n);h(a,{text:"Opcode design"});var s=t(a,2);g(s,{get content(){return lt}}),c(r,n)},$$slots:{default:!0}});var _e=t(he,2);m(_e,{children:(r,v)=>{var n=k(),a=p(n);h(a,{text:"Why wrap exists",children:(O,T)=>{P();var K=wt();P(2),c(O,K)},$$slots:{default:!0}});var s=t(a,2);g(s,{get content(){return ut}}),c(r,n)},$$slots:{default:!0}});var fe=t(_e,2);m(fe,{children:(r,v)=>{var n=k(),a=p(n);h(a,{text:"Determinism and chunk boundaries"});var s=t(a,2);g(s,{get content(){return mt}}),c(r,n)},$$slots:{default:!0}});var ve=t(fe,2);m(ve,{children:(r,v)=>{var n=k(),a=p(n);h(a,{text:"Append-only invariant"});var s=t(a,2);g(s,{get content(){return ht}}),c(r,n)},$$slots:{default:!0}});var ge=t(ve,2);m(ge,{children:(r,v)=>{var n=k(),a=p(n);h(a,{text:"Consumers"});var s=t(a,2);g(s,{get content(){return _t}}),c(r,n)},$$slots:{default:!0}});var ke=t(ge,2);m(ke,{children:(r,v)=>{var n=k(),a=p(n);h(a,{text:"Limitations"});var s=t(a,2);g(s,{get content(){return ft}}),c(r,n)},$$slots:{default:!0}});var Fe=t(ke,2);m(Fe,{children:(r,v)=>{var n=k(),a=p(n);h(a,{text:"See also"});var s=t(a,2);g(s,{get content(){return vt}}),c(r,n)},$$slots:{default:!0}}),c(Ee,oe)},$$slots:{default:!0}})},$$slots:{default:!0}}),Je()}Ye(["input","click"]);export{qt as component};
