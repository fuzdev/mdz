<script lang="ts">
	import {onMount} from 'svelte';
	import Code from '@fuzdev/fuz_code/Code.svelte';
	import {tome_get_by_slug} from '@fuzdev/fuz_ui/tome.ts';
	import TomeContent from '@fuzdev/fuz_ui/TomeContent.svelte';
	import TomeSection from '@fuzdev/fuz_ui/TomeSection.svelte';
	import TomeSectionHeader from '@fuzdev/fuz_ui/TomeSectionHeader.svelte';
	import DeclarationLink from '@fuzdev/fuz_ui/DeclarationLink.svelte';
	import TomeLink from '@fuzdev/fuz_ui/TomeLink.svelte';
	import Details from '@fuzdev/fuz_ui/Details.svelte';
	import DocsLink from '@fuzdev/fuz_ui/DocsLink.svelte';

	import Mdz from '$lib/Mdz.svelte';
	import MdzStream from '$lib/MdzStream.svelte';
	import {MdzStreamParser} from '$lib/mdz_stream_parser.ts';
	import {MdzStreamState} from '$lib/mdz_stream_state.svelte.ts';
	import MdzRoot from '$lib/MdzRoot.svelte';
	import mdz_paths from './mdz_streaming_paths.mdz?raw';
	import mdz_picking from './mdz_streaming_picking.mdz?raw';
	import mdz_opcodes from './mdz_streaming_opcodes.mdz?raw';
	import mdz_wrap from './mdz_streaming_wrap.mdz?raw';
	import mdz_determinism from './mdz_streaming_determinism.mdz?raw';
	import mdz_invariant from './mdz_streaming_invariant.mdz?raw';
	import mdz_consumers from './mdz_streaming_consumers.mdz?raw';
	import mdz_limitations from './mdz_streaming_limitations.mdz?raw';
	import mdz_see_also from './mdz_streaming_see_also.mdz?raw';

	const TOME_SLUG = 'streaming';
	const tome = tome_get_by_slug(TOME_SLUG);

	const stream_initial = `Streaming renders **bold text** as bold **immediately**, same with _italic_ and ~~strikethrough~~.

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

(stream done)`;

	const STREAM_OPCODES_MAX = 20;

	let stream_content = $state(stream_initial);
	let stream_parser = $state(new MdzStreamParser());
	let stream_state = $state(new MdzStreamState());
	let stream_pos = $state(0);
	let stream_running = $state(false);
	let stream_finished = $state(false);
	let stream_interval_ms = $state(100);
	let stream_recent_opcodes = $state<Array<string>>([]);
	let stream_timer: ReturnType<typeof setInterval> | undefined;

	const stream_drain = (): void => {
		const ops = stream_parser.take_opcodes();
		if (ops.length === 0) return;
		stream_state.apply_batch(ops);
		stream_recent_opcodes = [
			...stream_recent_opcodes,
			...ops.map((op) => JSON.stringify(op)),
		].slice(-STREAM_OPCODES_MAX);
	};

	const stream_step = (): void => {
		if (stream_pos >= stream_content.length) {
			stream_parser.finish();
			stream_drain();
			stream_running = false;
			stream_finished = true;
			if (stream_timer !== undefined) {
				clearInterval(stream_timer);
				stream_timer = undefined;
			}
			return;
		}
		stream_parser.feed(stream_content[stream_pos]!);
		stream_drain();
		stream_pos++;
	};

	const stream_start = (): void => {
		if (stream_finished) stream_reset();
		stream_running = true;
		stream_timer = setInterval(stream_step, stream_interval_ms);
	};

	const stream_pause = (): void => {
		stream_running = false;
		if (stream_timer !== undefined) {
			clearInterval(stream_timer);
			stream_timer = undefined;
		}
	};

	const stream_reset = (): void => {
		stream_pause();
		stream_parser = new MdzStreamParser();
		stream_state = new MdzStreamState();
		stream_pos = 0;
		stream_finished = false;
		stream_recent_opcodes = [];
	};

	// the parser/state are append-only — seeking backwards requires replay from 0.
	const stream_seek = (target_pos: number): void => {
		stream_pause();
		if (target_pos < stream_pos) {
			stream_parser = new MdzStreamParser();
			stream_state = new MdzStreamState();
			stream_pos = 0;
			stream_finished = false;
			stream_recent_opcodes = [];
		}
		while (stream_pos < target_pos && stream_pos < stream_content.length) {
			stream_parser.feed(stream_content[stream_pos]!);
			stream_pos++;
		}
		stream_drain();
		if (stream_pos >= stream_content.length && !stream_finished) {
			stream_parser.finish();
			stream_drain();
			stream_finished = true;
		}
	};

	onMount(() => {
		return () => {
			if (stream_timer !== undefined) clearInterval(stream_timer);
		};
	});
</script>

<MdzRoot code={DocsLink} codeblock={Code}>
	<TomeContent {tome}>
		<section>
			<p>
				Use the <code>Mdz</code> component (see <TomeLink slug="usage" />) when you have complete
				content upfront. For content that arrives incrementally (e.g. from an LLM), use <DeclarationLink
					name="MdzStreamParser"
				/> with
				<DeclarationLink name="MdzStreamState" /> and <DeclarationLink name="MdzStream" />. The
				parser emits opcodes as rendering instructions — never re-parsing — and the state applies
				them as fine-grained Svelte mutations. The streaming design is derived from
				<a href="https://github.com/pngwn">@pngwn</a>'s ideas in this
				<a href="https://bsky.app/profile/pngwn.at/post/3mi527zntb22n">Bluesky thread</a>
				(<a href="https://pngwn.at/">pngwn.at</a>), which originated the approach mdz implements:
				restrict the dialect so streaming is tractable, render optimistically and correct when
				wrong, minimize work by never re-parsing, and emit serializable target-agnostic opcodes
				instead of a tree.
			</p>
		</section>

		<TomeSection>
			<TomeSectionHeader text="Demo" />
			<p>
				Click the stream button below — each character is fed one at a time to show how constructs
				build incrementally:
			</p>
			<textarea
				style:height="300px"
				bind:value={stream_content}
				oninput={stream_reset}
				aria-label="streaming mdz source"
			></textarea>
			<div class="row gap_md mb_md flex-wrap:wrap">
				<button
					style:width="85px"
					type="button"
					onclick={() => (stream_running ? stream_pause() : stream_start())}
				>
					{stream_running ? 'pause' : stream_finished ? 'restart' : 'stream'}
				</button>
				<button type="button" onclick={stream_reset} disabled={stream_pos === 0}>reset</button>
				<button
					type="button"
					onclick={() => stream_seek(stream_pos - 1)}
					disabled={stream_pos === 0}
					aria-label="back one character"
				>
					◀
				</button>
				<button
					type="button"
					onclick={() => stream_seek(stream_pos + 1)}
					disabled={stream_finished}
					aria-label="forward one character"
				>
					▶
				</button>
				<label class="row gap_xs">
					<input
						type="range"
						min="10"
						max="200"
						step="10"
						bind:value={stream_interval_ms}
						oninput={() => {
							if (stream_running) {
								stream_pause();
								stream_start();
							}
						}}
					/>
					{stream_interval_ms}ms
				</label>
			</div>
			<label class="row gap_md mb_md">
				<small style:width="50px" style:text-align="right">
					scrub<br />
					{stream_pos}/{stream_content.length}
				</small>
				<input
					type="range"
					min="0"
					max={stream_content.length}
					step="1"
					value={stream_pos}
					oninput={(e) => stream_seek(+e.currentTarget.value)}
					aria-label="scrub stream position"
					style:flex="1"
				/>
			</label>
			<div class="panel shade_05 mb_lg p_md" style:min-height="300px">
				{#if stream_pos === 0}
					<p class="color_d_50">
						(press <button
							type="button"
							class="inline color_d sm"
							onclick={() => (stream_running ? stream_pause() : stream_start())}>stream</button
						> to begin)
					</p>
				{:else}
					<MdzStream stream={stream_state} />
				{/if}
			</div>
			<Details>
				{#snippet summary()}
					opcodes ({stream_recent_opcodes.length === STREAM_OPCODES_MAX
						? `last ${STREAM_OPCODES_MAX}`
						: stream_recent_opcodes.length})
				{/snippet}
				<p>
					Each character fed to <DeclarationLink name="MdzStreamParser" /> can emit zero or more opcodes.
					This shows the most recent {STREAM_OPCODES_MAX}: watch <code>open</code>,
					<code>text</code>, <code>close</code> sequences form, and <code>revert</code> when an
					optimistic assumption (e.g. unclosed <code>~~</code>) is abandoned.
				</p>
				<Code
					lang="json"
					content={stream_recent_opcodes.length === 0
						? '(no opcodes yet)'
						: [...stream_recent_opcodes].reverse().join('\n')}
				/>
			</Details>
			<Code
				lang="ts"
				content={`import {MdzStreamParser} from '@fuzdev/mdz/mdz_stream_parser.js';
import {MdzStreamState} from '@fuzdev/mdz/mdz_stream_state.svelte.js';

const parser = new MdzStreamParser();
const stream = new MdzStreamState();

// feed chunks as they arrive
parser.feed(chunk);
stream.apply_batch(parser.take_opcodes());

// when done
parser.finish();
stream.apply_batch(parser.take_opcodes());`}
			/>
			<Code content={`<MdzStream {stream} />`} />
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Three rendering paths" />
			<Mdz content={mdz_paths} />
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Picking a path" />
			<Mdz content={mdz_picking} />
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Opcode design" />
			<Mdz content={mdz_opcodes} />
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Why wrap exists">Why <code>wrap</code> exists</TomeSectionHeader>
			<Mdz content={mdz_wrap} />
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Determinism and chunk boundaries" />
			<Mdz content={mdz_determinism} />
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Append-only invariant" />
			<Mdz content={mdz_invariant} />
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Consumers" />
			<Mdz content={mdz_consumers} />
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Limitations" />
			<Mdz content={mdz_limitations} />
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="See also" />
			<Mdz content={mdz_see_also} />
		</TomeSection>
	</TomeContent>
</MdzRoot>
