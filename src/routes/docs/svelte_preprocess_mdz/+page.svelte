<script lang="ts">
	import Code from '@fuzdev/fuz_code/Code.svelte';

	import {tome_get_by_slug} from '@fuzdev/fuz_ui/tome.ts';
	import TomeContent from '@fuzdev/fuz_ui/TomeContent.svelte';
	import TomeSection from '@fuzdev/fuz_ui/TomeSection.svelte';
	import TomeSectionHeader from '@fuzdev/fuz_ui/TomeSectionHeader.svelte';
	import DeclarationLink from '@fuzdev/fuz_ui/DeclarationLink.svelte';
	import ModuleLink from '@fuzdev/fuz_ui/ModuleLink.svelte';
	import TomeLink from '@fuzdev/fuz_ui/TomeLink.svelte';

	const TOME_SLUG = 'svelte_preprocess_mdz';
	const tome = tome_get_by_slug(TOME_SLUG);
</script>

<TomeContent {tome}>
	<section>
		<p>
			<DeclarationLink name="svelte_preprocess_mdz" /> is a Svelte preprocessor that compiles static <TomeLink
				slug="usage">mdz</TomeLink
			> content to Svelte markup at build time. Instead of parsing mdz at runtime and rendering dynamically,
			the preprocessor replaces the <DeclarationLink name="Mdz" /> component with
			<DeclarationLink name="MdzPrecompiled" /> containing pre-rendered children.
		</p>
	</section>

	<TomeSection>
		<TomeSectionHeader text="Setup" />
		<p>
			Add the preprocessor, <ModuleLink module_path="svelte_preprocess_mdz.ts" />, to
			<code>svelte.config.js</code>:
		</p>
		<Code
			lang="js"
			content={`import {svelte_preprocess_mdz} from '@fuzdev/mdz/svelte_preprocess_mdz.js';

export default {
  preprocess: [
    svelte_preprocess_mdz({
      components: {Alert: '$lib/Alert.svelte'},
      elements: {aside: true, details: true},
    }),
    // ...other preprocessors
  ],
};`}
		/>
		<p>
			The preprocessor should run before other preprocessors like
			<code>vitePreprocess()</code> so it can parse the original Svelte source. The input to <DeclarationLink
				name="svelte_preprocess_mdz"
			/> is <DeclarationLink name="SveltePreprocessMdzOptions" />.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Code and codeblock components" />
		<p>
			The preprocessor mirrors the runtime rendering seam (see <TomeLink slug="introduction" />):
			<code>code_component_import</code> sets the component for inline code (receives
			<code>reference</code>) and <code>codeblock_component_import</code> the component for code
			blocks (receives <code>lang</code> and <code>content</code>). When unset, output is plain
			<code>&lt;code&gt;</code> and <code>&lt;pre&gt;&lt;code&gt;</code>, matching the runtime
			default. Set them to the same components you inject at runtime and precompiled output stays
			identical:
		</p>
		<Code
			lang="js"
			content={`svelte_preprocess_mdz({
  code_component_import: '@fuzdev/fuz_ui/DocsLink.svelte',
  codeblock_component_import: '@fuzdev/fuz_code/Code.svelte',
})`}
		/>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="How it works" />
		<p>The preprocessor transforms static content at build time:</p>
		<Code
			content={`<!-- Before -->
<Mdz content="**bold** and \`some_fn\`" />

<!-- After -->
<MdzPrecompiled><p><strong>bold</strong> and <DocsLink reference={'some_fn'} /></p></MdzPrecompiled>`}
		/>
		<p>For ternary expressions with static branches, it generates Svelte control flow:</p>
		<Code
			content={`<!-- Before -->
<Mdz content={show ? '**a**' : '**b**'} />

<!-- After -->
<MdzPrecompiled>{#if show}<p><strong>a</strong></p>{:else}<p><strong>b</strong></p>{/if}</MdzPrecompiled>`}
		/>
		<p>The preprocessor also manages imports automatically:</p>
		<ul>
			<li>
				adds imports required by the rendered content (e.g., <DeclarationLink name="DocsLink" />,
				<code>Code</code>, <code>resolve</code>, configured components)
			</li>
			<li>
				removes the <DeclarationLink name="Mdz" /> import when all usages are transformed
			</li>
			<li>removes dead <code>const</code> bindings consumed only by transformed content</li>
		</ul>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="What gets transformed" />
		<p>The preprocessor handles these static content patterns:</p>
		<ul>
			<li>string attributes: <Code inline content="content=&quot;**bold**&quot;" /></li>
			<li>JS string expressions: <Code inline content={`content={'**bold**'}`} /></li>
			<li>
				template literals without interpolation: <Code inline content={'content={`**bold**`}'} />
			</li>
			<li>
				const variable references: <Code inline lang="ts" content="const msg = '**bold**';" />
				<Code inline content={`content={msg}`} />
			</li>
			<li>ternary chains: <Code inline content={`content={show ? '**a**' : '**b**'}`} /></li>
			<li>nested ternaries: <Code inline content={`content={a ? 'x' : b ? 'y' : 'z'}`} /></li>
		</ul>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Relative paths and the base attribute" />
		<p>
			Content with relative auto-links (<code>./grammar</code>, <code>../streaming</code>) needs to
			know its base path to resolve those at compile time. Add a static <code>base</code> attribute
			to the <DeclarationLink name="Mdz" /> tag:
		</p>
		<!-- eslint-disable svelte/no-useless-mustaches -->
		<Code content={`<Mdz base="/docs/usage/" content="see ./grammar and ../streaming" />`} />
		<p>
			The preprocessor reads <code>base</code>, resolves relative paths to absolute via
			<code>mdz_resolve_relative_path()</code>, and emits the resolved <code>href</code> values.
			<code>base</code> must be a static string literal — dynamic expressions cause the call to fall back
			to runtime rendering.
		</p>
		<p>
			Without <code>base</code>, relative paths are kept as raw hrefs and the browser resolves them
			against the current URL at click time. This is a preprocessor-only attribute; at runtime <DeclarationLink
				name="Mdz"
			/> accepts a <code>base</code> prop with the same meaning.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Skip conditions" />
		<p>The preprocessor falls back to runtime rendering when:</p>
		<ul>
			<li>the file is excluded via <code>exclude</code></li>
			<li>no matching import source is found for Mdz</li>
			<li>the import is <code>import type</code> (not a runtime import)</li>
			<li><DeclarationLink name="MdzPrecompiled" /> is already imported from a different source</li>
			<li>
				the <code>content</code> prop is dynamic (variable, function call, <code>$state</code>,
				<code>$derived</code>)
			</li>
			<li>spread attributes are present (<code>{'{'}...props}</code>)</li>
			<li>content references unconfigured components or elements</li>
			<li>a ternary branch has dynamic content or unconfigured tags</li>
		</ul>
	</TomeSection>
	<aside>
		See also the <TomeLink slug="usage" /> docs for the mdz dialect,
		<ModuleLink module_path="svelte_preprocess_mdz.ts" /> and
		<ModuleLink module_path="mdz_to_svelte.ts" /> for full API docs.
	</aside>
</TomeContent>
