/**
 * Deterministic scan-work counter for the complexity-ratio guards
 * (`mdz_scaling_ratio.test.ts`). Off by default; when `enabled`, the parser hot
 * paths accumulate the number of characters scanned (and tag-stack frames
 * walked) into `total`. Unlike wall-clock timing this is a pure function of
 * input + algorithm — invariant across machines, runs, and thermal state — so a
 * super-linear regression shows up as a work ratio > ~linear regardless of the
 * ~2× machine variance that makes absolute timing unusable here (see
 * `../../grimoire/lore/mdz/perf.md` "Measurement robustness").
 *
 * Zero store when disabled: each instrumented site guards on `enabled` (a single
 * branch-predicted property load, the same category as the shipped `DEV`
 * checks). It is deliberately NOT the `esm-env` `DEV` flag — `DEV` is true under
 * every `gro test`/`gro dev` run, which would leave the counter live in ordinary
 * development; this flag is flipped true only by the ratio test.
 *
 * @nodocs
 */
export const mdz_debug_work: {enabled: boolean; total: number} = {enabled: false, total: 0};

/**
 * Reset the counter and set whether the hot paths accumulate into it. Tests call
 * `mdz_debug_work_reset()` immediately before a parse and read
 * `mdz_debug_work.total` immediately after; pass `false` to disable and zero it.
 *
 * @nodocs
 */
export const mdz_debug_work_reset = (enabled = true): void => {
	mdz_debug_work.enabled = enabled;
	mdz_debug_work.total = 0;
};
