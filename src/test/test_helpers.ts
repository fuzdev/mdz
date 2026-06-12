/**
 * Shared test utilities for vitest tests.
 * Provides helpers for component mounting, DOM event creation, test data normalization,
 * and generic fixture loading/updating patterns.
 */

import {mount, unmount, type Component} from 'svelte';
import {readdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

/**
 * Mount a Svelte component for testing.
 * Creates a container div, appends it to document.body, and mounts the component.
 */
export const mount_component = <TProps extends Record<string, any>>(
	Component: Component<TProps>,
	props: TProps,
): {instance: any; container: HTMLElement} => {
	const container = document.createElement('div');
	document.body.appendChild(container);

	const instance = mount(Component, {
		target: container,
		props,
	});

	return {instance, container};
};

/**
 * Unmount a component and remove its container from the DOM.
 */
export const unmount_component = async (instance: any, container: HTMLElement): Promise<void> => {
	await unmount(instance);
	container.remove();
};

/**
 * Create a contextmenu (rightclick) mouse event.
 */
export const create_contextmenu_event = (
	x: number,
	y: number,
	options: MouseEventInit = {},
): MouseEvent => {
	return new MouseEvent('contextmenu', {
		bubbles: true,
		cancelable: true,
		clientX: x,
		clientY: y,
		...options,
	});
};

/**
 * Create a keyboard event.
 */
export const create_keyboard_event = (
	key: string,
	options: KeyboardEventInit = {},
): KeyboardEvent => {
	return new KeyboardEvent('keydown', {
		bubbles: true,
		cancelable: true,
		key,
		...options,
	});
};

/**
 * Create a generic mouse event.
 */
export const create_mouse_event = (type: string, options: MouseEventInit = {}): MouseEvent => {
	return new MouseEvent(type, {
		bubbles: true,
		cancelable: true,
		...options,
	});
};

/**
 * Set the target property on an event (for testing).
 * The target property is readonly, so we need to use Object.defineProperty.
 */
export const set_event_target = (event: Event, target: EventTarget): void => {
	Object.defineProperty(event, 'target', {
		value: target,
		enumerable: true,
		configurable: true,
	});
};

/**
 * Create a touch event with one or more touches.
 */
export const create_touch_event = (
	type: string,
	touches: Array<{clientX: number; clientY: number; target?: EventTarget}>,
	options: TouchEventInit = {},
): TouchEvent => {
	// Create Touch objects (mocked for testing)
	const touch_objects: Array<Touch> = touches.map((touch, index) => ({
		identifier: index,
		clientX: touch.clientX,
		clientY: touch.clientY,
		screenX: touch.clientX,
		screenY: touch.clientY,
		pageX: touch.clientX,
		pageY: touch.clientY,
		radiusX: 0,
		radiusY: 0,
		rotationAngle: 0,
		force: 1,
		target: touch.target ?? document.body,
	}));

	return new TouchEvent(type, {
		bubbles: true,
		cancelable: true,
		touches: touch_objects,
		targetTouches: touch_objects,
		changedTouches: touch_objects,
		...options,
	});
};

/**
 * Normalize an object by removing all undefined values.
 * This matches JSON serialization behavior where undefined values are omitted.
 *
 * Used to compare test results with expected.json files, since JSON.stringify
 * automatically removes undefined values when serializing.
 *
 * Note: Treats both null and undefined as null for comparison consistency.
 *
 * @param obj - the object to normalize
 * @returns the normalized object without undefined values
 */
export const normalize_json = (obj: any): any => {
	// Treat both null and undefined as null for comparison consistency
	if (obj === null || obj === undefined) return null;
	if (Array.isArray(obj)) {
		return obj.map(normalize_json);
	}
	if (typeof obj === 'object') {
		const normalized: any = {};
		for (const [key, value] of Object.entries(obj)) {
			if (value !== undefined) {
				normalized[key] = normalize_json(value);
			}
		}
		return normalized;
	}
	return obj;
};

//
// Generic Fixture Loading and Update Task Patterns
//

/**
 * Generic fixture data structure.
 */
export interface GenericFixture<T> {
	name: string;
	input: string;
	expected: T;
}

/**
 * Generic fixture loader configuration.
 */
export interface FixtureLoaderConfig<T> {
	/** Directory containing fixture subdirectories */
	fixtures_dir: string;
	/** Input file extension (e.g., '.mdz', '.ts', '.svelte') */
	input_extension: string;
	/**
	 * Transform the parsed expected.json data.
	 * Use this for conversions like Object -> Map.
	 */
	transform_expected?: (parsed: any) => T;
}

/**
 * Load all fixtures from a directory with the specified configuration.
 * Each fixture is a subdirectory containing an input file and expected.json.
 *
 * This generic pattern is used across mdz, tsdoc, ts, and svelte fixture loaders
 * to reduce duplication (~60 LOC saved).
 *
 * @example
 * ```ts
 * const fixtures = await load_fixtures_generic<Array<MdzNode>>({
 *   fixtures_dir: import.meta.dirname,
 *   input_extension: '.mdz',
 * });
 * ```
 */
export const load_fixtures_generic = async <T>(
	config: FixtureLoaderConfig<T>,
): Promise<Array<GenericFixture<T>>> => {
	const {fixtures_dir, input_extension, transform_expected} = config;
	const entries = await readdir(fixtures_dir, {withFileTypes: true});
	const fixture_names = entries
		.filter((dirent) => dirent.isDirectory())
		.map((dirent) => dirent.name)
		.sort();

	return await Promise.all(
		fixture_names.map(async (name) => {
			const fixture_dir = join(fixtures_dir, name);
			const input = await readFile(join(fixture_dir, `input${input_extension}`), 'utf-8');
			const expected_text = await readFile(join(fixture_dir, 'expected.json'), 'utf-8');
			const expected_json = JSON.parse(expected_text);
			const expected = transform_expected ? transform_expected(expected_json) : expected_json;
			return {name, input, expected};
		}),
	);
};

/**
 * Configuration for the generic update task.
 */
export interface UpdateTaskConfig<TInput, TOutput> {
	/** Directory containing fixture subdirectories */
	fixtures_dir: string;
	/** Input file extension */
	input_extension: string;
	/**
	 * Process the input to generate output.
	 * This is where the fixture-specific logic goes.
	 */
	process: (input: TInput, name: string) => Promise<TOutput> | TOutput;
	/**
	 * Custom JSON replacer for serialization.
	 * Use this for handling Maps, Sets, etc.
	 */
	json_replacer?: (key: string, value: any) => any;
}

/**
 * Generic update task runner for fixtures.
 * Handles the common pattern of reading fixtures, generating outputs,
 * comparing with existing files, and writing only changed files.
 *
 * This generic pattern is used across mdz, tsdoc, ts, and svelte update tasks
 * to reduce duplication (~240 LOC saved).
 *
 * @example
 * ```ts
 * export const task: Task = {
 *   summary: 'generate expected.json files',
 *   run: async ({log}) => {
 *     await run_update_task({
 *       fixtures_dir: join(import.meta.dirname),
 *       input_extension: '.mdz',
 *       process: (input) => mdz_parse(input),
 *     }, log);
 *   },
 * };
 * ```
 */
export const run_update_task = async <TInput = string, TOutput = any>(
	config: UpdateTaskConfig<TInput, TOutput>,
	log: {info: (msg: string) => void},
): Promise<{generated_count: number; skipped_count: number}> => {
	const {fixtures_dir, input_extension, process, json_replacer} = config;

	const fixture_names = (await readdir(fixtures_dir, {withFileTypes: true}))
		.filter((dirent) => dirent.isDirectory())
		.map((dirent) => dirent.name)
		.sort();

	log.info(`found ${fixture_names.length} fixtures`);

	let generated_count = 0;
	let skipped_count = 0;

	await Promise.all(
		fixture_names.map(async (name) => {
			const fixture_dir = join(fixtures_dir, name);
			const input_path = join(fixture_dir, `input${input_extension}`);
			const expected_path = join(fixture_dir, 'expected.json');

			const input = (await readFile(input_path, 'utf-8')) as TInput;
			const result = await process(input, name);
			const output = JSON.stringify(result, json_replacer, '\t') + '\n';

			let existing: string | null = null;
			try {
				existing = await readFile(expected_path, 'utf-8');
			} catch (_error) {
				// File doesn't exist yet, proceed with write
			}

			if (existing === output) {
				skipped_count++;
				log.info(`skipped ${name}/expected.json`);
			} else {
				generated_count++;
				await writeFile(expected_path, output);
				log.info(`generated ${name}/expected.json`);
			}
		}),
	);

	log.info(`done! generated: ${generated_count}, skipped: ${skipped_count}`);
	return {generated_count, skipped_count};
};
