<script lang="ts">
	import {onMount} from 'svelte';
	import Code from '@fuzdev/fuz_code/Code.svelte';
	import DocsLink from '@fuzdev/fuz_ui/DocsLink.svelte';
	import DocsFooter from '@fuzdev/fuz_ui/DocsFooter.svelte';
	import Card from '@fuzdev/fuz_ui/Card.svelte';
	import {site_context} from '@fuzdev/fuz_ui/site.svelte.ts';
	import {FUZ_DEV_URL, MAIN_HEADER_MARGIN_TOP} from '@fuzdev/fuz_ui/constants.ts';
	import {DOCS_PATH} from '@fuzdev/fuz_ui/docs_helpers.svelte.ts';
	import {Library, library_context} from '@fuzdev/fuz_ui/library.svelte.ts';

	import {library_json} from './library.ts';
	import MdzRoot from '$lib/MdzRoot.svelte';
	import MdzStream from '$lib/MdzStream.svelte';
	import {MdzStreamParser} from '$lib/mdz_stream_parser.ts';
	import {MdzStreamState} from '$lib/mdz_stream_state.svelte.ts';

	const site = site_context.get();

	// the injected `DocsLink` resolves backticked refs against this library and falls
	// back to plain `<code>` otherwise — mirrors how the docs layout sets the context
	const library = new Library(library_json);
	library_context.set(() => library);

	const demo_content = `**mdz** is a strict markdown dialect built for streaming, [Svelte](https://svelte.dev/) authoring, docs websites, and untrusted content. This text is rendering through \`MdzStreamParser\` right now, character by character.

It supports markdown basics like **bold**, _italic_, ~~strikethrough~~, \`inline code\`, headings, and auto-detected links like https://www.fuz.dev. Svelte components too!

- lists stream as their structure arrives
  - nesting included

> blockquotes too,<br />line by<br />line

| feature | streams |
| :-- | :-: |
| tables | yes |

And of course, [highlighted code](https://code.fuz.dev/) blocks:

\`\`\`ts
import {mdz_parse} from '@fuzdev/mdz/mdz.js';
const nodes = mdz_parse('**hello world**');
\`\`\`

For more see the /docs.`;

	const DEMO_INTERVAL_MS = 15;

	const demo_elements = new Map([['br', true]]);

	let demo_parser = $state(new MdzStreamParser());
	let demo_state = $state(new MdzStreamState());
	let demo_pos = $state(0);
	let demo_finished = $state(false);
	let demo_timer: ReturnType<typeof setInterval> | undefined;

	const demo_step = (): void => {
		if (demo_pos >= demo_content.length) {
			demo_parser.finish();
			demo_state.apply_batch(demo_parser.take_opcodes());
			demo_finished = true;
			if (demo_timer !== undefined) {
				clearInterval(demo_timer);
				demo_timer = undefined;
			}
			return;
		}
		demo_parser.feed(demo_content[demo_pos]!);
		demo_state.apply_batch(demo_parser.take_opcodes());
		demo_pos++;
	};

	const demo_play = (): void => {
		if (demo_timer !== undefined) clearInterval(demo_timer);
		demo_parser = new MdzStreamParser();
		demo_state = new MdzStreamState();
		demo_pos = 0;
		demo_finished = false;
		demo_timer = setInterval(demo_step, DEMO_INTERVAL_MS);
	};

	const demo_pause = (): void => {
		if (demo_timer !== undefined) {
			clearInterval(demo_timer);
			demo_timer = undefined;
		}
	};

	// the parser/state are append-only — seeking backwards requires replay from 0.
	const demo_seek = (target_pos: number): void => {
		demo_pause();
		if (target_pos < demo_pos) {
			demo_parser = new MdzStreamParser();
			demo_state = new MdzStreamState();
			demo_pos = 0;
			demo_finished = false;
		}
		while (demo_pos < target_pos && demo_pos < demo_content.length) {
			demo_parser.feed(demo_content[demo_pos]!);
			demo_pos++;
		}
		demo_state.apply_batch(demo_parser.take_opcodes());
		if (demo_pos >= demo_content.length && !demo_finished) {
			demo_parser.finish();
			demo_state.apply_batch(demo_parser.take_opcodes());
			demo_finished = true;
		}
	};

	onMount(() => {
		demo_play();
		return () => {
			if (demo_timer !== undefined) clearInterval(demo_timer);
		};
	});
</script>

<main class="box width:100%">
	<div class="box width_atmost_md mb_xl9">
		<section class="box">
			<h1 class="mb_0" style:margin-top={MAIN_HEADER_MARGIN_TOP}>mdz</h1>
		</section>
		<section class="box width_atmost_md">
			<div class="panel shade_05 p_md width:100%" style:min-height="500px">
				<MdzRoot elements={demo_elements} code={DocsLink} codeblock={Code}>
					<MdzStream stream={demo_state} />
				</MdzRoot>
			</div>
			<div class="my_lg row gap_md width:100%">
				<button type="button" class="plain" onclick={demo_play}> replay </button>
				<input
					type="range"
					class="plain"
					min="0"
					max={demo_content.length}
					step="1"
					value={demo_pos}
					oninput={(e) => demo_seek(+e.currentTarget.value)}
					aria-label="scrub demo position"
					style:flex="1"
				/>
			</div>
			<Code lang="md" content={demo_content} wrap />
		</section>
		<section>
			<Card href={DOCS_PATH} icon="">docs</Card>
		</section>
		<section>
			<DocsFooter repo_url={site.repo_url} root_url={FUZ_DEV_URL} />
		</section>
	</div>
</main>
