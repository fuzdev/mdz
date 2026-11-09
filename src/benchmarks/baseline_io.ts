/**
 * File I/O for the benchmark suites' local baselines, shared by
 * `mdz.benchmark.ts` and `render.benchmark.test.ts`.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
	benchmark_baseline_create,
	benchmark_baseline_parse,
	benchmark_baseline_serialize,
	type BenchmarkBaseline
} from '@fuzdev/fuz_util/benchmark_baseline.ts';
import type { BenchmarkResult } from '@fuzdev/fuz_util/benchmark_types.ts';
import { format_file } from '@fuzdev/gro/format_file.ts';
import {
	GIT_LOCAL_PASS_ENV,
	git_current_branch_name,
	git_current_commit_hash,
	to_git_program
} from '@fuzdev/gro/git.ts';
import { spawn } from '@fuzdev/gro/spawn.ts';

/**
 * Reads the baseline at `file`. A missing file is no baseline, and so is one
 * that can't be used (invalid, or written by another baseline version), with a
 * warning. The file is left in place for `baseline_save` to replace.
 */
export const baseline_load = async (file: string): Promise<BenchmarkBaseline | null> => {
	const stored = await readFile(file, 'utf-8').catch(() => null);
	if (stored === null) return null;
	const parsed = benchmark_baseline_parse(stored);
	if (!parsed.ok) {
		process.stderr.write(`Ignoring baseline ${file}: ${parsed.message}\n`);
		return null;
	}
	return parsed.baseline;
};

/**
 * Writes `results` as the baseline at `file`, creating its directory.
 * The git commit and branch are best-effort labels, null when git can't say
 * (no repo, or an unborn branch).
 */
export const baseline_save = async (
	file: string,
	results: Array<BenchmarkResult>
): Promise<void> => {
	const git = to_git_program(spawn, { pass_env: GIT_LOCAL_PASS_ENV });
	const baseline = benchmark_baseline_create(results, {
		git_commit: await git_current_commit_hash(git).catch(() => null),
		git_branch: await git_current_branch_name(git).catch(() => null),
		runtime_version: process.version
	});
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, format_file(benchmark_baseline_serialize(baseline), { filepath: file }));
};
