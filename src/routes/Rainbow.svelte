<script lang="ts">
	import type { Snippet } from 'svelte';

	const {
		children
	}: {
		children?: Snippet;
	} = $props();
</script>

<span class="rainbow">{@render children?.()}</span>

<style>
	/* CSS has no per-letter selector, so a gradient clipped to the text colors bands about
	 * 2 characters wide. The palette slots minus brown, orange, and yellow are ordered to
	 * keep similar hues apart, and each holds solid with a short blend to the next. */
	.rainbow {
		color: transparent;
		background-clip: text;
		background-image: repeating-linear-gradient(
			90deg,
			var(--palette_c_50) 0 1.5ch,
			var(--palette_i_50) 2ch 3.5ch,
			var(--palette_g_50) 4ch 5.5ch,
			var(--palette_a_50) 6ch 7.5ch,
			var(--palette_b_50) 8ch 9.5ch,
			var(--palette_d_50) 10ch 11.5ch,
			var(--palette_j_50) 12ch 13.5ch,
			var(--palette_c_50) 14ch
		);
	}
</style>
