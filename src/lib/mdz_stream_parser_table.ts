/**
 * Table handlers for the streaming mdz parser.
 *
 * A table is recognized at a column-0 pipe row whose next line is a valid
 * delimiter row with a matching column count — a bounded one-line lookahead:
 * the header row holds (`need_more`) until its delimiter line arrives, then the
 * whole header emits at once. Body rows then stream one per line. Because a row
 * is always fully buffered before it emits (no within-row streaming), each
 * cell's inline content is parsed with the sync reference (`MdzTableCellParser`,
 * one `MdzLexer`/`MdzTokenParser` shared across the whole table's cells,
 * rebound per row) and replayed as opcodes — guaranteeing sync↔stream parity
 * by construction.
 *
 * @module
 */

import {DEV} from 'esm-env';

import {
	NEWLINE,
	PIPE,
	is_line_whitespace,
	mdz_split_table_row,
	mdz_parse_table_delimiter,
} from './mdz_helpers.ts';
import {MdzTableCellParser, type MdzNode, type MdzTableAlign} from './mdz.ts';
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
	state.table = {
		id: table_id,
		item_indent: null,
		cell_parser: new MdzTableCellParser(state.buffer),
	};

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
	const item_indent = state.table!.item_indent;
	if (item_indent !== null) {
		return process_table_line_in_item(state, forced, item_indent);
	}

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
 * Process body rows of an in-item table. Unlike the top-level path this keeps
 * `state.pos` on the newline that ends each row — a row boundary the buffer
 * never compacts past, since it's the active cursor. So when a dedent (to the
 * item's `marker_indent` or shallower), a blank line, or a non-pipe line ends
 * the table, `close_table` leaves the cursor on that newline and the list's
 * newline handler re-classifies the following line — the same control-return
 * shape as the in-item codeblock, robust across chunk boundaries.
 */
const process_table_line_in_item = (
	state: MdzStreamParserState,
	forced: boolean,
	item_indent: number,
): boolean => {
	if (state.pos >= state.buffer.length) {
		if (forced) {
			close_table(state);
			return true;
		}
		return false;
	}
	// `state.pos` sits on the newline ending the previous row (or the delimiter);
	// the candidate next row is the line after it
	const line_start = state.pos + 1;
	let j = line_start;
	while (j < state.buffer.length && is_line_whitespace(state.buffer.charCodeAt(j))) {
		j++;
	}
	if (j >= state.buffer.length) {
		if (forced) {
			close_table(state);
			return true;
		}
		return false; // indent-only / incomplete line — hold
	}
	if (j - line_start <= item_indent || state.buffer.charCodeAt(j) !== PIPE) {
		// a dedent to the marker (or shallower), a blank line, or a non-pipe line
		// ends the table; the cursor stays on the row-boundary newline so the
		// list resumes via its newline handler
		close_table(state);
		return true;
	}
	let row_end = state.buffer.indexOf('\n', j);
	if (row_end === -1) {
		if (!forced) return false; // pipe-row line not complete — hold
		row_end = state.buffer.length;
	}
	const cells = mdz_split_table_row(state.buffer, j, row_end);
	if (cells === null) {
		close_table(state);
		return true;
	}
	emit_table_row(state, cells, false, j, row_end);
	state.pos = row_end; // stay on this row's terminating newline (or EOF)
	return true;
};

/**
 * Close the open table.
 *
 * @nodocs
 */
export const close_table = (state: MdzStreamParserState): void => {
	if (!state.table) return;
	const {item_indent} = state.table;
	const entry = pop_stack_entry(state);
	emit(state, {type: 'close', id: entry.id, end: offset(state)});
	state.table = null;
	state.active_text_id = null;
	if (item_indent === null) {
		// top-level: the trailing newline + any blank lines absorb at the loop top
		state.skip_blank_lines = true;
	}
	// in-item: the cursor is left on a row-boundary newline (or EOF). The list's
	// newline handler re-classifies the following line; at EOF, `finish` closes
	// the list. No skip_blank_lines — the list owns blank-line containment.
};

/** A recognized in-item table head: the header row's cells + the delimiter alignment. */
export interface TableInItemHead {
	header_cells: Array<{start: number; end: number}>;
	header_end: number;
	align: Array<MdzTableAlign>;
	delim_end: number;
}

/**
 * Recognize a table opening as a block child of a list item: a pipe row at
 * `header_first` (the line's indent already skipped) whose next line is a
 * delimiter row, both indented past `marker_indent` (so both stay inside the
 * item). Returns the parsed head, `'pending'` when the two-line lookahead isn't
 * fully buffered, or `null` when it isn't a table.
 *
 * @nodocs
 */
export const match_table_in_item_head = (
	state: MdzStreamParserState,
	header_first: number,
	marker_indent: number,
	forced: boolean,
): TableInItemHead | 'pending' | null => {
	const {buffer} = state;
	const header_end = buffer.indexOf('\n', header_first);
	if (header_end === -1) return forced ? null : 'pending'; // header needs its newline + a delimiter beneath
	const header_cells = mdz_split_table_row(buffer, header_first, header_end);
	if (header_cells === null) return null;
	const delim_line_start = header_end + 1;
	let dj = delim_line_start;
	while (dj < buffer.length && is_line_whitespace(buffer.charCodeAt(dj))) dj++;
	if (dj >= buffer.length) return forced ? null : 'pending'; // delimiter line not buffered yet
	if (dj - delim_line_start <= marker_indent) return null; // delimiter dedented out of the item
	let delim_end = buffer.indexOf('\n', dj);
	if (delim_end === -1) {
		if (!forced) return 'pending'; // delimiter line incomplete
		delim_end = buffer.length;
	}
	const align = mdz_parse_table_delimiter(buffer, dj, delim_end);
	if (align === null || align.length !== header_cells.length) return null;
	return {header_cells, header_end, align, delim_end};
};

/**
 * Open a table as a block child of a list item at `marker_indent`, given a
 * `head` from `match_table_in_item_head`. Emits the `Table` open + header row
 * and enters table mode (with `item_indent`), leaving `state.pos` at the first
 * body line. The caller closes the item's run and pops to the attach level first.
 *
 * @nodocs
 */
export const open_table_in_item = (
	state: MdzStreamParserState,
	header_first: number,
	marker_indent: number,
	head: TableInItemHead,
): void => {
	const table_id = alloc_id(state);
	const table_start = offset(state, header_first);
	emit(state, {
		type: 'open',
		id: table_id,
		node_type: 'Table',
		start: table_start,
		align: head.align,
	});
	push_stack_entry(state, table_id, 'Table', table_start);
	state.table = {
		id: table_id,
		item_indent: marker_indent,
		cell_parser: new MdzTableCellParser(state.buffer),
	};
	emit_table_row(state, head.header_cells, true, header_first, head.header_end);
	// leave the cursor on the delimiter's newline (or EOF) — the in-item body-row
	// handler reads from the line after it and hands back on this same convention
	state.pos = head.delim_end;
	state.column = 0;
	state.prev_char = NEWLINE;
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
	// one lexer/parser shared across the whole table rather than allocated per
	// row (or per cell) — rebound per row because the buffer string changes
	// across feeds; the lexer's search memo survives when it doesn't
	const cell_parser = state.table!.cell_parser;
	cell_parser.rebind(state.buffer);
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
				emit(state, {
					type: 'open',
					id,
					node_type: node.type,
					start: s,
					name: node.name,
					attributes: node.attributes,
				});
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
