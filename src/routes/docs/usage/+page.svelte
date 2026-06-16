<script lang="ts">
	import Code from '@fuzdev/fuz_code/Code.svelte';
	import {resolve} from '$app/paths';
	import {tome_get_by_slug} from '@fuzdev/fuz_ui/tome.ts';
	import TomeContent from '@fuzdev/fuz_ui/TomeContent.svelte';
	import TomeSection from '@fuzdev/fuz_ui/TomeSection.svelte';
	import TomeSectionHeader from '@fuzdev/fuz_ui/TomeSectionHeader.svelte';
	import DeclarationLink from '@fuzdev/fuz_ui/DeclarationLink.svelte';
	import TomeLink from '@fuzdev/fuz_ui/TomeLink.svelte';
	import Alert from '@fuzdev/fuz_ui/Alert.svelte';
	import DocsLink from '@fuzdev/fuz_ui/DocsLink.svelte';

	import Mdz from '$lib/Mdz.svelte';
	import MdzRoot from '$lib/MdzRoot.svelte';

	const TOME_SLUG = 'usage';
	const tome = tome_get_by_slug(TOME_SLUG);

	const mdz_components = new Map([['Alert', Alert]]);

	const mdz_elements = new Map<string, boolean>([
		['code', true],
		['aside', true],
		['marquee', true],
		['br', true],
	]);

	const playground_initial = `**Bold** and _italic_ and ~~strikethrough~~ text.

Inline links to identifiers using backticks: \`mdz_parse\`, \`Mdz\`

#### A heading

A paragraph with links: [fuz homepage](https://fuz.dev), ./grammar

\`\`\`ts
const y = 1336;
\`\`\``;

	let playground_content = $state(playground_initial);

	const usage_example = 'Some **bold** and `code` and a [link](/docs).';
	const basic_example = '**Bold** and _italic_ and ~~strikethrough~~ text.';
	const nesting_example = '**~~_All_ three~~ combi**_ned_';
	const whitespace_example = ' see \n  how       \n   whitespace    \nrenders ';
	const code_example = 'To parse markdown directly, use `mdz_parse` from module `mdz.ts`.';
	const code_plain_example = 'This `identifier` does not exist.';
	const link_external_example =
		'[Fuz API docs](https://fuz.dev/docs/api) and https://fuz.dev/docs/api and /docs/api';
	const link_relative_example = 'See ./grammar and ../streaming and ../usage for relative paths.';
	const linebreak_example = 'First line.\nSecond line.\nThird line.';
	const hard_break_example = 'First line.<br />Second line.';
	const paragraph_example =
		'First paragraph.\n\nSecond paragraph.\nSoft break in second paragraph.';
	const triple_linebreak_example =
		'First paragraph.\n\n\nSecond paragraph separated by an extra newline.';
	const hr_example = 'Section one.\n\n---\n\nSection two.';
	const heading_example = '#### h4 ~~with~~ _italic_';
	const code_block_example = '```ts\nconst z: number = 43;\n```';
	const list_example = '- first item\n- second **item**\n  - nested item\n- third item';
	const list_ordered_example =
		'3. starts at three\n1. authored numbers are preserved\n2. but render in order';
	const blockquote_example =
		'> A quote with **formatting** and `code`.\n> Same paragraph, soft break.\n>\n> New paragraph via bare `>`.\n>> Nested quote.';
	const element_aside_example =
		'<aside>This is _italicized <code>code</code>_ inside an `aside`.</aside>';
	const element_marquee_example = '<marquee>use it or lose it</marquee>';
	const component_example =
		'<Alert>This is an `Alert` with _italicized <code>code</code>_ inside.</Alert>';
</script>

<MdzRoot
	base="/docs/usage/"
	components={mdz_components}
	elements={mdz_elements}
	code={DocsLink}
	codeblock={Code}
>
	<TomeContent {tome}>
		<section>
			<p>
				This section has each feature's syntax with live rendered examples. The
				<a href={resolve('/docs/usage/grammar')}>formal grammar</a> is the normative syntax
				reference, and the <TomeLink slug="introduction" /> covers what mdz is for and the principles
				behind it.
			</p>
			<p>
				mdz was created to author content with <a href="https://svelte.dev/">Svelte</a> components
				and to render TSDoc/JSDoc comments on docs websites — hence the domain-specific behavior:
				linkified
				<code>`backtick-wrapped`</code> declarations and modules, auto-detected URLs prefixed with
				<code>https://</code>, <code>/</code>, <code>./</code>, and <code>../</code>, and registered
				Svelte components in content.
			</p>
			<Code lang="ts" content="import Mdz from '@fuzdev/mdz/Mdz.svelte';" />
			<Code content={`<Mdz content="${usage_example}" />`} />
			<Mdz content={usage_example} class="mb_lg" />
		</section>

		<TomeSection>
			<TomeSectionHeader text="Playground" />
			<textarea bind:value={playground_content} aria-label="mdz source" style:height="230px"
			></textarea>
			<div class="panel shade_05 mb_lg p_md">
				<Mdz content={playground_content} />
			</div>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Streaming" />
			<p>
				mdz renders content incrementally as it arrives (e.g. from an LLM), with no re-parsing. See
				the <TomeLink slug="streaming" /> docs for the live demo, the opcode design, and the three rendering
				paths.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Basic formatting" />
			<p>Supports <strong>bold</strong>, <em>italic</em>, and strikethrough:</p>
			<Code content={`<Mdz content="${basic_example}" />`} />
			<Mdz content={basic_example} class="mb_xl5" />
			<p>All inline formatting can nest:</p>
			<Code content={`<Mdz content="${nesting_example}" />`} />
			<Mdz content={nesting_example} class="mb_xl5" />
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Inline code auto-linking" />
			<p>Backtick code automatically links to identifiers and modules:</p>
			<Code content={code_example} />
			<Mdz content={code_example} class="mb_xl5" />
			<p>Non-identifiers become plain code elements:</p>
			<Code content={code_plain_example} />
			<Mdz content={code_plain_example} class="mb_xl5" />
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Links" />
			<p>mdz supports four kinds of links:</p>
			<ul>
				<li>standard markdown link syntax</li>
				<li>
					external URLs starting with <code>https://</code> or
					<code>http://</code>
				</li>
				<li>absolute paths starting with <code>/</code></li>
				<li>relative paths starting with <code>./</code> or <code>../</code></li>
			</ul>
			<Code content={link_external_example} />
			<Mdz content={link_external_example} class="mb_xl5" />
			<p>
				Relative paths are resolved against the <code>base</code> context (set via
				<code>MdzRoot</code>) when provided, producing correct absolute paths. Without
				<code>base</code>, they use raw hrefs (the browser resolves them against the current URL):
			</p>
			<Code content={link_relative_example} />
			<Mdz content={link_relative_example} base="/docs/usage/" class="mb_xl5" />
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Line breaks and paragraphs" />
			<p>
				Single newlines are soft breaks, like standard markdown — they render as spaces by default:
			</p>
			<Code content={linebreak_example} />
			<Mdz content={linebreak_example} class="mb_xl5" />
			<p>Double newlines create paragraph breaks:</p>
			<Code content={paragraph_example} />
			<Mdz content={paragraph_example} class="mb_xl5" />
			<p>Three or more newlines are the same as two — one paragraph break:</p>
			<Code content={triple_linebreak_example} />
			<Mdz content={triple_linebreak_example} class="mb_xl5" />
			<p>
				To force a line break within a paragraph, use an explicit <code>&lt;br /&gt;</code> (it's an
				HTML element, so it must be <TomeLink slug="usage" hash="HTML-elements">registered</TomeLink
				>):
			</p>
			<Code content={hard_break_example} />
			<Mdz content={hard_break_example} class="mb_xl5" />
			<p>
				To instead render every newline as a line break — handy for chat-style user input — see the
				<code>whitespace</code> prop in the <TomeLink slug="usage" hash="Whitespace"
					>whitespace</TomeLink
				>
				section.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Headings" />
			<p>Use 1-6 hashes followed by a space:</p>
			<Code content={heading_example} />
			<Mdz content={heading_example} class="mb_xl5" />
			<p>
				Must start at column 0 and have a space after hashes. No blank lines are required around
				headings. Headings can include inline formatting.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Lists" />
			<p>
				Unordered items use <code>-</code>, ordered items use <code>1.</code> — each followed by a space.
				A marker at column 0 starts a list; indenting nests:
			</p>
			<Code content={list_example} />
			<Mdz content={list_example} class="mb_xl5" />
			<p>
				Ordered lists render GFM-style: the first item's number sets <code>start</code> and the
				browser numbers the rest, so the <code>1.</code>/<code>1.</code>/<code>1.</code> reordering idiom
				works — but authored numbers are preserved in the AST:
			</p>
			<Code content={list_ordered_example} />
			<Mdz content={list_ordered_example} class="mb_xl5" />
			<p>
				Blank lines between items don't end the list (loose LLM-style lists keep their structure),
				items render tight, and a column-0 non-marker line always ends the list — there is no lazy
				continuation. Items can contain paragraphs, nested lists, code blocks, and blockquotes on
				their own indented lines. See the
				<a href={resolve('/docs/usage/grammar')}>formal grammar</a> for the precise rules.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Blockquotes" />
			<p>
				Prefix each line with <code>&gt;</code> and a space — a quote's content is a mini-document,
				so headings, lists, code blocks, and deeper quotes all work inside. A bare
				<code>&gt;</code> line breaks paragraphs within the quote, and a blank line ends it:
			</p>
			<Code content={blockquote_example} />
			<Mdz content={blockquote_example} class="mb_xl5" />
			<p>
				The space is required (<code>&gt;a</code> is literal text) and there is no lazy continuation —
				every quoted line carries the prefix.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Code blocks" />
			<p>
				mdz uses <a href="https://code.fuz.dev/">fuz_code</a> for syntax highlighting. Use three or more
				backticks with optional language hint:
			</p>
			<Code content={code_block_example} />
			<Mdz content={code_block_example} class="mb_xl5" />
			<p>
				Must start at column 0; the closing fence needs at least as many backticks as the opening
				fence. Empty code blocks are valid. No blank lines are required around code blocks.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Horizontal rules" />
			<p>
				Use exactly three hyphens (<code>---</code>) at the start of a line to create a horizontal
				rule. No blank lines are required around it. mdz has no setext headings, so
				<code>---</code> after a paragraph is always an HR:
			</p>
			<Code content={hr_example} />
			<Mdz content={hr_example} class="mb_xl5" />
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Whitespace" />
			<p>
				The parser preserves whitespace in text nodes exactly as authored — single newlines stay
				literal <code>\n</code> characters and no <code>&lt;br&gt;</code> nodes are created. How
				that whitespace <em>renders</em> is the consumer's choice via the <code>whitespace</code>
				prop, which sets <code>white-space</code> on the wrapper element. By default no style is applied,
				so whitespace collapses like standard markdown:
			</p>
			<Code content={`<Mdz content="${whitespace_example}" />`} />
			<div class="mb_lg">
				<Mdz content={whitespace_example} />
			</div>
			<p>
				With <code>whitespace="pre-line"</code>, every newline renders as a line break while spaces
				still collapse — useful for chat-style user input where pressing Enter should mean a new
				line:
			</p>
			<Code content={`<Mdz content="${whitespace_example}" whitespace="pre-line" />`} />
			<div class="mb_lg">
				<Mdz content={whitespace_example} whitespace="pre-line" />
			</div>
			<p>
				With <code>whitespace="pre-wrap"</code>, spaces, tabs, and newlines are all rendered
				faithfully:
			</p>
			<Code content={`<Mdz content="${whitespace_example}" whitespace="pre-wrap" />`} />
			<div class="mb_lg">
				<Mdz content={whitespace_example} whitespace="pre-wrap" />
			</div>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="HTML elements" />
			<p>mdz supports an opt-in set of HTML elements for semantic markup and styling.</p>
			<Code content={element_aside_example} />
			<Mdz content={element_aside_example} class="mb_xl5" />
			<Code content={element_marquee_example} />
			<Mdz content={element_marquee_example} class="mb_xl5" />
			<p>Elements must be registered:</p>
			<Code
				lang="svelte"
				content={`<MdzRoot elements={new Map([['code', true], ['aside', true], ['marquee', true], ['br', true]])}>
	<Mdz content="<aside>text</aside>" />
</MdzRoot>`}
			/>
			<p>
				Unregistered elements render as <Mdz content="<tag-name />" inline /> placeholders for security.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Svelte components" />
			<p>
				mdz supports a minimal subset of Svelte component syntax — tags with children, no props yet.
				Components are distinguished from HTML elements by their uppercase first letter:
			</p>
			<Code content={component_example} />
			<Mdz content={component_example} class="mb_xl5" />
			<p>Components must be registered:</p>
			<Code
				lang="svelte"
				content={`<MdzRoot components={new Map([['Alert', Alert]])}>
	<Mdz content="<Alert>warning</Alert>" />
</MdzRoot>`}
			/>
			<p>
				Unregistered components render as <Mdz content="<ComponentName />" inline />
				placeholders.
			</p>
			<aside>
				tip: You can put a <code>SvelteMap</code> in the component and element registries.
			</aside>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Advanced usage" />
			<p>
				For more control, use <DeclarationLink name="mdz_parse" /> directly with <DeclarationLink
					name="MdzNodeView"
				/>:
			</p>
			<Code
				content={`import {mdz_parse} from '@fuzdev/mdz/mdz.js';
import MdzNodeView from '@fuzdev/mdz/MdzNodeView.svelte';

const nodes = mdz_parse(content);`}
				lang="ts"
			/>
			<Code
				content={`<div class="custom">
	{#each nodes as node}
		<MdzNodeView {node} />
	{/each}
</div>`}
			/>
			<p>
				You own the container, so you control presentation — for example apply
				<code>white-space:pre-line</code> to render newlines as line breaks, or
				<code>white-space:pre</code> to avoid wrapping.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Compatibility with other markdowns" />
			<p>
				mdz takes after CommonMark and GFM — their behavior is the baseline wherever it fits
				streaming. But mdz is a dialect, not a subset: it deliberately supports one syntax per
				feature and drops constructs whose ambiguity costs more than they're worth. The highlights:
			</p>
			<table class="mb_lg">
				<thead>
					<tr><th>Feature</th><th>CommonMark/GFM</th><th>mdz</th></tr>
				</thead>
				<tbody>
					<tr>
						<td>bold</td>
						<td><code>**text**</code> or <code>__text__</code></td>
						<td><code>**text**</code> only</td>
					</tr>
					<tr>
						<td>italic</td>
						<td><code>*text*</code> or <code>_text_</code></td>
						<td><code>_text_</code> only — single <code>*</code> is literal</td>
					</tr>
					<tr>
						<td>strikethrough</td>
						<td><code>~~text~~</code>, and <code>~text~</code> on github.com</td>
						<td
							><code>~~text~~</code> only — a single <code>~</code> is always literal, so
							<code>~/dev/paths</code> never strike</td
						>
					</tr>
					<tr>
						<td>doubled delimiters</td>
						<td><code>__text__</code> bold, <code>~~text~~</code> strike</td>
						<td
							><code>~~text~~</code> strikes; <code>__text__</code> stays literal — underscore runs
							never pair, so <code>__init__</code> is safe</td
						>
					</tr>
					<tr>
						<td>setext headings</td>
						<td><code>text</code> + <code>---</code> = h2</td>
						<td>none — <code>---</code> is always an HR</td>
					</tr>
					<tr>
						<td>indented code</td>
						<td>4-space indent</td>
						<td>none — fenced only</td>
					</tr>
					<tr>
						<td>lazy continuation</td>
						<td>yes — dedented/unprefixed lines continue lists and quotes</td>
						<td
							>none — list continuation must be indented past the marker; every quote line carries
							its prefix</td
						>
					</tr>
					<tr>
						<td>reference links</td>
						<td><code>[text][ref]</code></td>
						<td>none — inline <code>[text](url)</code> only</td>
					</tr>
					<tr>
						<td>hard breaks</td>
						<td>trailing double-space or <code>\</code></td>
						<td><code>&lt;br /&gt;</code> (registered element)</td>
					</tr>
					<tr>
						<td>relative path links</td>
						<td>not auto-linked</td>
						<td><code>./path</code> and <code>../path</code> auto-link</td>
					</tr>
				</tbody>
			</table>
			<p>
				Block elements (headings, HR, codeblocks, lists, blockquotes) can interrupt paragraphs
				without blank lines, while inline formatting prefers false negatives over false positives.
				Every smaller divergence — list nesting and empty items, blockquote prefixes, tag scoping,
				link parsing — is enumerated in the
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a href={`${resolve('/docs/usage/grammar')}#commonmark-and-gfm-divergences`}
					>full divergence table</a
				>
				on the <a href={resolve('/docs/usage/grammar')}>formal grammar</a> page.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="More docs" />
			<ul>
				<li>
					<strong><TomeLink slug="streaming" /></strong>
					— live demo, rendering paths, opcode design, and the streaming model
				</li>
				<li>
					<strong><TomeLink slug="svelte_preprocess_mdz" /></strong>
					— compiles static content to plain Svelte markup at build time
				</li>
				<li>
					<strong>
						<a href={resolve('/docs/usage/grammar')}>grammar</a>
					</strong>
					— the formal grammar (the normative syntax reference) and the full CommonMark/GFM divergence
					table
				</li>
				<li>
					<strong><TomeLink slug="fixtures" /></strong>
					— renders every test fixture live with its parsed JSON
				</li>
			</ul>
		</TomeSection>
	</TomeContent>
</MdzRoot>
