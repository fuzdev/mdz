<script lang="ts">
	import { page } from '$app/state';
	import Code from '@fuzdev/fuz_code/Code.svelte';
	import DocsLink from '@fuzdev/fuz_ui/DocsLink.svelte';
	import { DOCS_PATH } from '@fuzdev/fuz_ui/docs_helpers.svelte.ts';
	import { tome_get_by_slug } from '@fuzdev/fuz_ui/tome.ts';
	import TomeContent from '@fuzdev/fuz_ui/TomeContent.svelte';
	import TomeLink from '@fuzdev/fuz_ui/TomeLink.svelte';
	import TomeSection from '@fuzdev/fuz_ui/TomeSection.svelte';
	import TomeSectionHeader from '@fuzdev/fuz_ui/TomeSectionHeader.svelte';
	import Details from '@fuzdev/fuz_ui/Details.svelte';

	import Mdz from '$lib/Mdz.svelte';
	import MdzRoot from '$lib/MdzRoot.svelte';
	import { load_mdz_fixtures } from './fixtures.ts';

	const TOME_SLUG = 'fixtures';
	const tome = tome_get_by_slug(TOME_SLUG);

	// `DocsContent` mounts every docs page's component inline on the `/docs`
	// index; render a stub there (like `ApiIndex`) so the full corpus only
	// renders on this page's own route.
	const at_root = $derived(page.url.pathname === DOCS_PATH);

	const fixtures = load_mdz_fixtures();

	const format_json = (obj: unknown): string => JSON.stringify(obj, null, '\t');
</script>

<TomeContent {tome}>
	{#if at_root}
		<section>
			<p>
				Browse the {fixtures.length} test <TomeLink slug="fixtures" />.
			</p>
		</section>
	{:else}
		<section>
			<p>
				Every parser test fixture rendered live alongside its parsed <code>MdzNode</code> tree — the
				same corpus the <TomeLink slug="usage" /> docs and the parser tests are checked against.
			</p>
			<h2>{fixtures.length} fixtures</h2>
		</section>

		<!--
			Fixtures author their relative links (`./grammar`, `../usage`) against
			`/docs/usage/`, not this page's `/docs/fixtures` URL — override the base
			so example links resolve as intended. `code`/`codeblock` are passed
			explicitly because this page sits outside the `/docs/usage` layout that
			otherwise supplies them.
		-->
		<MdzRoot base="/docs/usage/" code={DocsLink} codeblock={Code}>
			{#each fixtures as fixture (fixture.name)}
				<TomeSection class="mb_xl">
					<TomeSectionHeader text={fixture.name} />

					<div class="mb_xl2">
						<Code lang="md" content={fixture.input} />
					</div>

					<!-- pre-wrap deliberately: whitespace fixtures are only legible when rendered faithfully -->
					<Mdz content={fixture.input} whitespace="pre-wrap" />

					<Details summary="JSON" open={false}>
						<Code lang="json" content={format_json(fixture.expected)} />
					</Details>
				</TomeSection>
			{/each}
		</MdzRoot>
	{/if}
</TomeContent>
