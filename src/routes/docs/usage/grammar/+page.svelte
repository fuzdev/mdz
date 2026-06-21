<script lang="ts">
	import Mdz from '$lib/Mdz.svelte';
	import mdz_grammar from './mdz_grammar.mdz?raw';
</script>

<div class="mt_xl5">
	<Mdz content={mdz_grammar} />
</div>

<!-- The divergence table stays HTML here (rather than as an mdz table in
	`mdz_grammar.mdz`) because its cells carry rich, multi-line phrasing that
	mdz's inline-only cells don't express — not for any lack of table syntax,
	which mdz now has. The heading id matches the mdz heading-slug convention so
	fragment links work the same way. -->
<section>
	<h2 id="commonmark-and-gfm-divergences">CommonMark and GFM Divergences</h2>
	<p>
		mdz takes after CommonMark and GFM — their behavior is the baseline wherever it fits streaming.
		But mdz is a dialect, not a subset: it deliberately supports one syntax per feature and drops
		constructs whose ambiguity costs more than they're worth:
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
				<td>horizontal rule</td>
				<td><code>---</code>, <code>***</code>, <code>___</code>, any length</td>
				<td>exactly <code>---</code></td>
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
				<td>block indentation</td>
				<td>up to 3 leading spaces</td>
				<td>column 0 required for all block starts (list nesting indents within an open list)</td>
			</tr>
			<tr>
				<td>list markers</td>
				<td><code>-</code> <code>*</code> <code>+</code>, <code>N.</code> <code>N)</code></td>
				<td><code>- </code> and <code>N. </code> only, exactly one space</td>
			</tr>
			<tr>
				<td>spaces after list marker</td>
				<td>1–4, moves the content column</td>
				<td>fixed — extras are trimmed content</td>
			</tr>
			<tr>
				<td>empty list items</td>
				<td>allowed anywhere (trailing-space sensitive)</td>
				<td>mid-list bare <code>-</code>/<code>N.</code> only; never starts a list</td>
			</tr>
			<tr>
				<td>list nesting</td>
				<td>content-column arithmetic, 4-column tab stops</td>
				<td
					>indent past the deepest level nests, dedent snaps to the nearest level; tab = 1 column</td
				>
			</tr>
			<tr>
				<td>lazy continuation</td>
				<td>yes — a dedented line continues the item</td>
				<td>none — continuation must be indented past the marker</td>
			</tr>
			<tr>
				<td>list end</td>
				<td>blank-line + indent arithmetic</td>
				<td>column-0 non-marker line, non-list-shaped blank, or EOF</td>
			</tr>
			<tr>
				<td>loose/tight lists</td>
				<td>per-list, retroactive — one blank wraps every item in <code>&lt;p&gt;</code></td>
				<td>always tight, per item — blank-separated block children render as blocks</td>
			</tr>
			<tr>
				<td>block constructs on a marker line</td>
				<td><code>- - a</code> nests; a fence can open mid-marker-line</td>
				<td>marker-line remainder is always inline content</td>
			</tr>
			<tr>
				<td>dedent inside a list item's fence</td>
				<td>force-closes the fence and list</td>
				<td>raw mode absolute — content until the closer or EOF</td>
			</tr>
			<tr>
				<td>task lists</td>
				<td><code>- [ ]</code> checkboxes (GFM)</td>
				<td>literal <code>[ ]</code> for now (matches CommonMark core)</td>
			</tr>
			<tr>
				<td>blockquote marker</td>
				<td><code>&gt;</code>, space optional, tab ok, 0–3 indent slop</td>
				<td
					>a <code>&gt;</code> run (<code>&gt;&gt;</code> or <code>&gt; &gt;</code>) + exactly one
					space or end of line; <code>&gt;a</code> and an indented <code>&gt;</code> stay literal</td
				>
			</tr>
			<tr>
				<td>empty blockquotes</td>
				<td><code>&gt;</code> alone is an empty blockquote; leading bare lines absorbed</td>
				<td>never starts — a bare <code>&gt;</code> outside a quote is literal text</td>
			</tr>
			<tr>
				<td>blockquote lazy continuation</td>
				<td>yes — unprefixed lines continue paragraphs at any depth</td>
				<td>none — every quote line carries its prefix</td>
			</tr>
			<tr>
				<td>blank line after a quote</td>
				<td>ends the quote (two quotes); bare <code>&gt;</code> lines separate paragraphs</td>
				<td>same</td>
			</tr>
			<tr>
				<td>unclosed fence in a quote</td>
				<td>closes at the quote's end</td>
				<td>same — a fence binds to the innermost marker-delimited container</td>
			</tr>
			<tr>
				<td>blockquote on a list marker line</td>
				<td><code>- &gt; q</code> nests a quote in the item</td>
				<td>inline content, like every marker-line remainder</td>
			</tr>
			<tr>
				<td>tables</td>
				<td>pipe tables; outer <code>|</code> optional (<code>a | b</code>)</td>
				<td
					>leading <strong>and</strong> trailing <code>|</code> required (<code>| a | b |</code
					>)</td
				>
			</tr>
			<tr>
				<td>literal pipe in a table cell</td>
				<td
					><code>\|</code> escape; a <code>|</code> inside <code>`code`</code> still splits the cell</td
				>
				<td><code>`code`</code> protects its pipes; <code>\|</code> also escapes one</td>
			</tr>
			<tr>
				<td>tag scoping</td>
				<td>a code span can contain raw-HTML closers — backtick scans ignore tags</td>
				<td
					>inline delimiters never pair across the enclosing tag's closer, so
					<code>&lt;b&gt;`a&lt;/b&gt;x`</code> keeps the tag; nested same-name tags consume the nearest
					closer first</td
				>
			</tr>
			<tr>
				<td>reference links</td>
				<td><code>[text][ref]</code></td>
				<td>none — inline <code>[text](url)</code> only</td>
			</tr>
			<tr>
				<td>link text</td>
				<td>balanced <code>[ ]</code> nest</td>
				<td
					>the first bare <code>]</code> between children ends it (inside a code span it's content); parens
					are plain text, balanced or not</td
				>
			</tr>
			<tr>
				<td>link destinations</td>
				<td>balanced parens, <code>&lt;url&gt;</code> form, optional <code>"title"</code></td>
				<td
					>the first <code>)</code> after <code>](</code> ends the reference — no nesting, no titles;
					any whitespace invalidates the link</td
				>
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
</section>
