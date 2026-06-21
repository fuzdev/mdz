/**
 * Table handlers for the streaming mdz parser.
 *
 * A table is recognized at a column-0 pipe row whose next line is a valid
 * delimiter row with a matching column count — a bounded one-line lookahead:
 * the header row holds (`need_more`) until its delimiter line arrives, then the
 * whole header emits at once. Body rows then stream one per line. Because a row
 * is always fully buffered before it emits (no within-row streaming), each
 * cell's inline content is parsed with the sync reference (`MdzTableCellParser`,
 * one `MdzLexer`/`MdzTokenParser` shared across the row's cells) and replayed
 * as opcodes — guaranteeing sync↔stream parity by construction.
 *
 * @module
 */

import {DEV} from 'esm-env';

import {NEWLINE, PIPE, mdz_split_table_row, mdz_parse_table_delimiter} from './mdz_helpers.ts';
import {MdzTableCellParser, type MdzNode} from './mdz.ts';
import {
	type MdzStreamParserState,
	type TryResult,
	alloc_id,
	close_paragraph,
	emit,
	flush_text,
	offset,
	pop_stack_entry,
	push_stack_entry,
} from './mdz_stream_parser_state.ts';

/**
 * Try to open a table at a column-0 pipe row. Returns `need_more` until both
 * the header line and its delimiter line are buffered (or, in forced mode,
 * resolvable), `not_match` when the two lines aren't a valid header+delimiter
 * pair, and `consumed` once the table opens (closing any open paragraph first,
 * emitting the header row, and leaving `state.pos` at the first body line).
 *
 * @nodocs
 */
export const try_table_start = (state: MdzStreamParserState, forced: boolean): TryResult => {
	const start = state.pos;
	const header_end = state.buffer.indexOf('\n', start);
	// a table needs a header line plus a delimiter line — without the header's
	// newline there's no room for a delimiter (at EOF it can never be a table)
	if (header_end === -1) return forced ? 'not_match' : 'need_more';

	const header_cells = mdz_split_table_row(state.buffer, start, header_end);
	if (header_cells === null) return 'not_match';

	const delim_start = header_end + 1;
	let delim_end = state.buffer.indexOf('\n', delim_start);
	if (delim_end === -1) {
		if (!forced) return 'need_more'; // delimiter line not complete yet
		delim_end = state.buffer.length;
	}

	const align = mdz_parse_table_delimiter(state.buffer, delim_start, delim_end);
	if (align === null || align.length !== header_cells.length) return 'not_match';

	// committed — the delimiter row is structural, never emitted
	flush_text(state);
	close_paragraph(state);

	const table_id = alloc_id(state);
	const table_start = offset(state, start);
	emit(state, {type: 'open', id: table_id, node_type: 'Table', start: table_start, align});
	push_stack_entry(state, table_id, 'Table', table_start);
	state.table = {id: table_id};

	emit_table_row(state, header_cells, true, start, header_end);

	// skip past the delimiter row to the first potential body line
	state.pos = delim_end === state.buffer.length ? delim_end : delim_end + 1;
	state.column = 0;
	state.prev_char = NEWLINE;
	return 'consumed';
};

/**
 * Process the line at `state.pos` while a table is open: emit it as a body row,
 * or close the table when it isn't a valid pipe row. Returns false (need more
 * input) only when a pipe-row line is started but not yet complete. A non-pipe
 * line (including a blank line) ends the table and is left for normal
 * processing.
 *
 * @nodocs
 */
export const process_table_line = (state: MdzStreamParserState, forced: boolean): boolean => {
	if (state.pos >= state.buffer.length) {
		// the table may continue with more rows in a later chunk
		if (forced) {
			close_table(state);
			return true;
		}
		return false;
	}

	const row_start = state.pos;
	// a body row must start with `|` at column 0; anything else ends the table
	// (decided without waiting for the line's newline)
	if (state.buffer.charCodeAt(row_start) !== PIPE) {
		close_table(state);
		return true;
	}

	let row_end = state.buffer.indexOf('\n', row_start);
	if (row_end === -1) {
		if (!forced) return false; // pipe-row line not complete — hold
		row_end = state.buffer.length;
	}

	const cells = mdz_split_table_row(state.buffer, row_start, row_end);
	if (cells === null) {
		// starts with `|` but isn't a valid row (e.g. no trailing pipe) — table ends
		close_table(state);
		return true;
	}

	emit_table_row(state, cells, false, row_start, row_end);
	state.pos = row_end === state.buffer.length ? row_end : row_end + 1;
	state.column = 0;
	state.prev_char = NEWLINE;
	return true;
};

/**
 * Close the open table.
 *
 * @nodocs
 */
export const close_table = (state: MdzStreamParserState): void => {
	if (!state.table) return;
	const entry = pop_stack_entry(state);
	emit(state, {type: 'close', id: entry.id, end: offset(state)});
	state.table = null;
	state.active_text_id = null;
	// trailing newline + blank lines absorb at the process-loop top
	state.skip_blank_lines = true;
};

/** Emit one table row: open, each cell, close. */
const emit_table_row = (
	state: MdzStreamParserState,
	cells: Array<{start: number; end: number}>,
	header: boolean,
	row_start: number,
	row_end: number,
): void => {
	const row_id = alloc_id(state);
	const row_off = offset(state, row_start);
	emit(state, {type: 'open', id: row_id, node_type: 'TableRow', start: row_off, header});
	push_stack_entry(state, row_id, 'TableRow', row_off);
	// one lexer/parser shared across the row's cells (all index into the same
	// buffer) rather than allocated per cell
	const cell_parser = new MdzTableCellParser(state.buffer);
	for (const cell of cells) {
		emit_table_cell(state, cell_parser, cell.start, cell.end);
	}
	pop_stack_entry(state);
	emit(state, {type: 'close', id: row_id, end: offset(state, row_end)});
	state.active_text_id = null;
};

/**
 * Emit one cell: open, its inline content (parsed with the sync reference over
 * the fully-buffered span via the row's shared `cell_parser`), close.
 */
const emit_table_cell = (
	state: MdzStreamParserState,
	cell_parser: MdzTableCellParser,
	cell_start: number,
	cell_end: number,
): void => {
	const cell_id = alloc_id(state);
	const cell_off = offset(state, cell_start);
	emit(state, {type: 'open', id: cell_id, node_type: 'TableCell', start: cell_off});
	push_stack_entry(state, cell_id, 'TableCell', cell_off);
	emit_inline_nodes(state, cell_parser.parse(cell_start, cell_end));
	pop_stack_entry(state);
	emit(state, {type: 'close', id: cell_id, end: offset(state, cell_end)});
	state.active_text_id = null;
};

/**
 * Replay sync-parsed inline nodes as opcodes. Cell content is inline-only;
 * positions are local to `state.buffer` and lifted to global via `offset`.
 */
const emit_inline_nodes = (state: MdzStreamParserState, nodes: Array<MdzNode>): void => {
	for (const node of nodes) {
		switch (node.type) {
			case 'Text':
				emit(state, {
					type: 'text',
					id: alloc_id(state),
					content: node.content,
					text_type: 'Text',
					start: offset(state, node.start),
					end: offset(state, node.end),
				});
				break;
			case 'Code':
				emit(state, {
					type: 'text',
					id: alloc_id(state),
					content: node.content,
					text_type: 'Code',
					start: offset(state, node.start),
					end: offset(state, node.end),
				});
				break;
			case 'Bold':
			case 'Italic':
			case 'Strikethrough': {
				const id = alloc_id(state);
				const s = offset(state, node.start);
				emit(state, {type: 'open', id, node_type: node.type, start: s});
				push_stack_entry(state, id, node.type, s);
				emit_inline_nodes(state, node.children);
				pop_stack_entry(state);
				emit(state, {type: 'close', id, end: offset(state, node.end)});
				break;
			}
			case 'Link': {
				const id = alloc_id(state);
				const s = offset(state, node.start);
				emit(state, {type: 'open', id, node_type: 'Link', start: s});
				push_stack_entry(state, id, 'Link', s);
				emit_inline_nodes(state, node.children);
				pop_stack_entry(state);
				emit(state, {
					type: 'close',
					id,
					end: offset(state, node.end),
					reference: node.reference,
					link_type: node.link_type,
				});
				break;
			}
			case 'Element':
			case 'Component': {
				const id = alloc_id(state);
				const s = offset(state, node.start);
				emit(state, {type: 'open', id, node_type: node.type, start: s, name: node.name});
				push_stack_entry(state, id, node.type, s, '', node.name);
				emit_inline_nodes(state, node.children);
				pop_stack_entry(state);
				emit(state, {type: 'close', id, end: offset(state, node.end)});
				break;
			}
			// cells are inline-only (lexed via `lex_table_cell`); a block node here
			// would mean a sync/stream grammar drift — fail loud in dev
			default:
				if (DEV) {
					throw new Error(`mdz table cell: unexpected inline node type '${node.type}'`);
				}
		}
	}
};
