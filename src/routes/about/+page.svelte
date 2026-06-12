<script lang="ts">
	import DocsFooter from '@fuzdev/fuz_ui/DocsFooter.svelte';
	import {site_context} from '@fuzdev/fuz_ui/site.svelte.js';
	import {FUZ_DEV_URL} from '@fuzdev/fuz_ui/constants.js';
	import EcosystemLinksPanel from '@fuzdev/fuz_ui/EcosystemLinksPanel.svelte';
	import Breadcrumb from '@fuzdev/fuz_ui/Breadcrumb.svelte';
	import Svg from '@fuzdev/fuz_ui/Svg.svelte';
	import {logo_fuz} from '@fuzdev/fuz_ui/logos.js';

	const site = site_context.get();

	// TODO standardize
</script>

<main class="width_atmost_md pb_xl9">
	<section class="box">
		<header class="box pt_xl">
			<Svg data={logo_fuz} size="var(--icon_size_xl)" />
			<h1 class="mt_xl2">mdz</h1>
		</header>
		<div style:--font_size="var(--font_size_xl)">
			<Breadcrumb />
		</div>
	</section>
	<EcosystemLinksPanel />
	<section class="box">
		<DocsFooter repo_url={site.repo_url} root_url={FUZ_DEV_URL} />
	</section>
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		align-items: center;
		margin: 0 auto;
	}
	h1 {
		display: flex;
		align-items: baseline;
		text-align: center;
	}
</style>
