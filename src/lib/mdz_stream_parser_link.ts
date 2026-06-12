/**
 * Markdown link `[text](url)` handlers and HTML-style tag handlers
 * (`<tag>`, `<Tag />`, `</tag>`) for the streaming mdz parser.
 *
 * @module
 */

import type {MdzNodeTypeContainer} from './mdz_opcodes.js';
import {
	A_UPPER,
	LEFT_BRACKET,
	LEFT_PAREN,
	NEWLINE,
	RIGHT_ANGLE,
	RIGHT_BRACKET,
	RIGHT_PAREN,
	SLASH,
	SPACE,
	Z_UPPER,
	is_letter,
	is_tag_name_char,
	is_valid_path_char,
	mdz_is_safe_reference,
	mdz_is_url,
} from './mdz_helpers.js';
import {
	type MdzStreamParserState,
	type TryResult,
	accumulate_text,
	alloc_id,
	emit,
	ensure_paragraph,
	flush_text,
	is_run_boundary,
	offset,
	pop_stack_entry,
	push_stack_entry,
	revert_above,
} from './mdz_stream_parser_state.js';

// -- Links --

/** @nodocs */
export const try_link_open = (state: MdzStreamParserState): boolean => {
	flush_text(state);
	ensure_paragraph(state);

	const id = alloc_id(state);
	const link_start = offset(state);
	emit(state, {type: 'open', id, node_type: 'Link', start: link_start});
	push_stack_entry(state, id, 'Link', link_start, '[');
	state.active_text_id = null;
	state.pos++;
	state.column++;
	state.prev_char = LEFT_BRACKET;
	return true;
};

/**
 * Revert an optimistic Link container to its literal `[` and consume the
 * `]` at `bracket_pos` as text. Used whenever a `]` doesn't form a valid
 * `[text](url)` — missing `(`, empty url, invalid url char, etc.
 *
 * @nodocs
 */
export const abort_link_to_text = (
	state: MdzStreamParserState,
	link_stack_idx: number,
	bracket_pos: number,
): void => {
	flush_text(state);
	revert_above(state, link_stack_idx);
	const entry = pop_stack_entry(state);
	emit(state, {type: 'revert', id: entry.id, replacement_text: '[', start: entry.start});
	state.active_text_id = null;
	accumulate_text(state, ']', offset(state, bracket_pos));
	state.pos = bracket_pos + 1;
	state.column++;
	state.prev_char = RIGHT_BRACKET;
};

/**
 * Try to complete a link after seeing `]`.
 * Returns false if more input is needed (leaves pos at `]`).
 *
 * @nodocs
 */
export const try_complete_link = (state: MdzStreamParserState, link_stack_idx: number): boolean => {
	const bracket_pos = state.pos;

	// need at least one char after ]
	if (bracket_pos + 1 >= state.buffer.length) return false;

	const after_bracket = state.buffer.charCodeAt(bracket_pos + 1);
	if (after_bracket !== LEFT_PAREN) {
		abort_link_to_text(state, link_stack_idx, bracket_pos);
		return true;
	}

	// found ]( — scan for )
	let i = bracket_pos + 2; // past ](
	while (i < state.buffer.length) {
		const c = state.buffer.charCodeAt(i);
		if (c === RIGHT_PAREN) {
			const reference = state.buffer.slice(bracket_pos + 2, i);
			// validate reference: non-empty and only valid path chars
			if (!reference.trim()) {
				abort_link_to_text(state, link_stack_idx, bracket_pos);
				return true;
			}
			let valid = true;
			for (let j = 0; j < reference.length; j++) {
				if (!is_valid_path_char(reference.charCodeAt(j))) {
					valid = false;
					break;
				}
			}
			if (!valid) {
				abort_link_to_text(state, link_stack_idx, bracket_pos);
				return true;
			}
			// Reject unsafe protocols (javascript:, data:, etc.) at parse time.
			// `is_valid_path_char` permits `:` so we have to filter explicitly.
			if (!mdz_is_safe_reference(reference)) {
				abort_link_to_text(state, link_stack_idx, bracket_pos);
				return true;
			}

			// success — close the link with reference
			flush_text(state);
			revert_above(state, link_stack_idx);
			const entry = pop_stack_entry(state);
			const link_type = mdz_is_url(reference) ? 'external' : 'internal';
			emit(state, {
				type: 'close',
				id: entry.id,
				end: offset(state, i + 1),
				reference,
				link_type,
			});
			state.active_text_id = null;
			state.pos = i + 1;
			state.column += i + 1 - bracket_pos;
			state.prev_char = RIGHT_PAREN;
			return true;
		}
		if (c === NEWLINE || c === SPACE) {
			// invalid character in URL (simplified check)
			break;
		}
		i++;
	}

	// didn't find ) — need more input or invalid
	if (i >= state.buffer.length) return false; // need more input

	// found invalid char before ) — revert
	abort_link_to_text(state, link_stack_idx, bracket_pos);
	return true;
};

// -- Tags --

/** @nodocs */
export const try_tag_open = (state: MdzStreamParserState): TryResult => {
	const start = state.pos;
	let i = start + 1; // past <

	// tag name must start with letter. A `<` at the end of the buffer can't
	// classify yet — it may be a tag open, or the closing tag of an open
	// element (whose `</` dispatch needs the next char); consuming it as text
	// here would eat the closer and strand the element. Hold, like the
	// mid-name case below.
	if (i >= state.buffer.length) return 'need_more';
	if (!is_letter(state.buffer.charCodeAt(i))) {
		return 'not_match';
	}

	// collect tag name
	const name_start = i;
	while (i < state.buffer.length && is_tag_name_char(state.buffer.charCodeAt(i))) {
		i++;
	}
	if (i >= state.buffer.length) return 'need_more';

	const name = state.buffer.slice(name_start, i);

	// skip whitespace
	while (i < state.buffer.length && state.buffer.charCodeAt(i) === SPACE) {
		i++;
	}
	if (i >= state.buffer.length) return 'need_more';

	// check for self-closing />
	if (state.buffer.charCodeAt(i) === SLASH && i + 1 >= state.buffer.length) {
		return 'need_more'; // `/` at the buffer end can't classify yet (`/>` or junk)
	}
	if (state.buffer.charCodeAt(i) === SLASH && state.buffer.charCodeAt(i + 1) === RIGHT_ANGLE) {
		const first_char = name.charCodeAt(0);
		const is_component = first_char >= A_UPPER && first_char <= Z_UPPER;
		const node_type: MdzNodeTypeContainer = is_component ? 'Component' : 'Element';

		flush_text(state);
		ensure_paragraph(state);
		const id = alloc_id(state);
		const tag_start = offset(state, start);
		emit(state, {type: 'open', id, node_type, start: tag_start, name});
		emit(state, {type: 'close', id, end: offset(state, i + 2)});
		state.active_text_id = null;
		state.pos = i + 2;
		state.column += i + 2 - start;
		state.prev_char = RIGHT_ANGLE;
		return 'consumed';
	}

	// check for >
	if (state.buffer.charCodeAt(i) !== RIGHT_ANGLE) {
		return 'not_match';
	}
	i++; // past >

	const first_char = name.charCodeAt(0);
	const is_component = first_char >= A_UPPER && first_char <= Z_UPPER;
	const node_type: MdzNodeTypeContainer = is_component ? 'Component' : 'Element';

	flush_text(state);
	ensure_paragraph(state);
	const id = alloc_id(state);
	const tag_start = offset(state, start);
	const delimiter = state.buffer.slice(start, i); // e.g., "<Alert>"
	emit(state, {type: 'open', id, node_type, start: tag_start, name});
	push_stack_entry(state, id, node_type, tag_start, delimiter, name);
	state.active_text_id = null;
	state.pos = i;
	state.column += i - start;
	state.prev_char = RIGHT_ANGLE;
	return 'consumed';
};

/** @nodocs */
export const try_close_tag = (state: MdzStreamParserState): TryResult => {
	// we're at </
	let i = state.pos + 2; // past </

	if (i >= state.buffer.length) return 'need_more';

	// collect tag name
	const name_start = i;
	while (i < state.buffer.length && is_tag_name_char(state.buffer.charCodeAt(i))) {
		i++;
	}
	if (i >= state.buffer.length) return 'need_more';
	if (state.buffer.charCodeAt(i) !== RIGHT_ANGLE) return 'not_match';

	const name = state.buffer.slice(name_start, i);
	i++; // past >

	// find matching open tag on stack
	let found_idx = -1;
	for (let j = state.stack.length - 1; j >= 0; j--) {
		const entry = state.stack[j]!;
		if (
			(entry.node_type === 'Element' || entry.node_type === 'Component') &&
			entry.tag_name === name
		) {
			found_idx = j;
			break;
		}
		if (is_run_boundary(entry.node_type)) break;
	}

	if (found_idx === -1) return 'not_match';

	flush_text(state);
	revert_above(state, found_idx);
	const entry = pop_stack_entry(state);
	emit(state, {type: 'close', id: entry.id, end: offset(state, i)});
	state.active_text_id = null;
	state.column += i - state.pos;
	state.pos = i;
	state.prev_char = RIGHT_ANGLE;
	return 'consumed';
};
