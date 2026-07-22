<script lang="ts">
	// the CSS Custom Highlight API rules for the editable source live in theme_highlight.css
	import '@fuzdev/fuz_code/theme_highlight.css';

	import {onMount} from 'svelte';
	import Code from '@fuzdev/fuz_code/Code.svelte';
	import CodeTextarea from '@fuzdev/fuz_code/CodeTextarea.svelte';
	import DocsLink from '@fuzdev/fuz_ui/DocsLink.svelte';
	import DocsFooter from '@fuzdev/fuz_ui/DocsFooter.svelte';
	import Card from '@fuzdev/fuz_ui/Card.svelte';
	import {site_context} from '@fuzdev/fuz_ui/site.svelte.ts';
	import {FUZ_DEV_URL, MAIN_HEADER_MARGIN_TOP} from '@fuzdev/fuz_ui/constants.ts';
	import {DOCS_PATH} from '@fuzdev/fuz_ui/docs_helpers.svelte.ts';
	import {Library, library_context} from '@fuzdev/fuz_ui/library.svelte.ts';

	import {library_json} from './library.ts';
	import Mdz from '$lib/Mdz.svelte';
	import MdzRoot from '$lib/MdzRoot.svelte';
	import MdzStream from '$lib/MdzStream.svelte';
	import {MdzStreamParser} from '$lib/mdz_stream_parser.ts';
	import {MdzStreamState} from '$lib/mdz_stream_state.svelte.ts';

	const site = site_context.get();

	// the injected `DocsLink` resolves backticked refs against this library and falls
	// back to plain `<code>` otherwise — mirrors how the docs layout sets the context
	const library = new Library(library_json);
	library_context.set(() => library);

	const DEMO_CONTENT_DEFAULT = `**mdz** is a strict markdown dialect built for streaming, [Svelte](https://svelte.dev/) authoring, docs websites, and untrusted content. This text is rendering through \`MdzStreamParser\` right now, character by character.

It supports markdown basics like **bold**, _italic_, ~~strikethrough~~, \`inline code\`, headings, and auto-detected links like https://www.fuz.dev. <Mdz content="**Svelte components**" inline /> too!

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

	let demo_content = $state(DEMO_CONTENT_DEFAULT);

	// enables the reset control once the source diverges from the shipped sample
	const demo_modified = $derived(demo_content !== DEMO_CONTENT_DEFAULT);

	const DEMO_INTERVAL_MS = 15;

	const demo_elements = new Map([['br', true]]);
	const demo_components = new Map([['Mdz', Mdz]]);

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

	// resume streaming from wherever the scrubber left off — playing is the resting state,
	// so releasing the scrubber (or committing a keyboard step) picks back up. no-op if
	// already playing or the stream has already reached the end.
	const demo_resume = (): void => {
		if (demo_timer !== undefined || demo_pos >= demo_content.length) return;
		demo_timer = setInterval(demo_step, DEMO_INTERVAL_MS);
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

	// editing the source stops the animation and renders the full new content at once
	// (a fresh append-only parser fed the whole string); `replay` re-streams it char by char.
	const demo_apply_source = (source: string): void => {
		demo_content = source;
		demo_pause();
		demo_parser = new MdzStreamParser();
		demo_state = new MdzStreamState();
		demo_parser.feed(source);
		demo_parser.finish();
		demo_state.apply_batch(demo_parser.take_opcodes());
		demo_pos = source.length;
		demo_finished = true;
	};

	// restore the shipped sample and re-stream it from the start
	const demo_reset = (): void => {
		demo_content = DEMO_CONTENT_DEFAULT;
		demo_play();
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
			<div class="panel shade_05 p_md width:100%" style:min-height="514px">
				<MdzRoot
					elements={demo_elements}
					components={demo_components}
					code={DocsLink}
					codeblock={Code}
				>
					<MdzStream stream={demo_state} />
				</MdzRoot>
			</div>
			<div class="my_lg row gap_md width:100%">
				<button type="button" class="plain" onclick={demo_play}> replay </button>
				<button type="button" class="plain" onclick={demo_reset} disabled={!demo_modified}>
					reset
				</button>
				<input
					type="range"
					class="plain"
					min="0"
					max={demo_content.length}
					step="1"
					value={demo_pos}
					onpointerdown={demo_pause}
					oninput={(e) => demo_seek(+e.currentTarget.value)}
					onpointerup={demo_resume}
					onpointercancel={demo_resume}
					onchange={demo_resume}
					aria-label="scrub demo position"
					style:flex="1"
				/>
			</div>
			<div class="demo-source width:100%">
				<p class="mb_xs">
					<small>Edit the source — the preview re-renders live; replay to stream it.</small>
				</p>
				<CodeTextarea
					value={demo_content}
					lang="md"
					oninput={(e) => demo_apply_source(e.currentTarget.value)}
					aria-label="editable mdz source"
				/>
			</div>
		</section>
		<section>
			<Card href={DOCS_PATH} icon="">docs</Card>
		</section>
		<section>
			<DocsFooter repo_url={site.repo_url} root_url={FUZ_DEV_URL} />
		</section>
	</div>
</main>

<style>
	/* the editor mirrors the preview panel's height; fuz_css's default textarea is too short */
	.demo-source :global(.code_textarea textarea) {
		height: 500px;
		resize: vertical;
	}
</style>
