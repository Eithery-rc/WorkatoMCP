/**
 * Shared types for the workato_data_table_* tool family — Workato Data Tables
 * (the newer relational store at /web_api/workato_db/, distinct from the older
 * lookup tables at /lookup_tables/).
 *
 * All HTTP traffic is page-side (fetch from the logged-in tab origin), using
 * the same cookie + XSRF-TOKEN-V2 CSRF pattern as the workato_lookup_* tools.
 *
 * Data tables have a flexible relational schema:
 *   - 3 system columns are auto-seeded on creation:
 *       "Record ID" (short-text, read-only, hidden) — value IS the row UUID
 *       "Created time" (date-time, read-only, hidden)
 *       "Last modified time" (date-time, read-only, hidden)
 *   - User columns are added via full-schema PUT. There are no granular
 *     column endpoints — to add/rename/delete a column, GET the table, mutate
 *     the schema array, PUT it back (the 3 system columns MUST be kept).
 *   - Records are keyed by column UUID (not title), so each tool caches a
 *     title<->uuid map per call. Callers see the label-keyed shape externally.
 */

export interface TabTargetArgs {
  tabId?: number;
  windowId?: number;
}

export type DataTableColumnType =
  | 'short-text'
  | 'long-text'
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'date-time'
  | 'file'
  | 'multi-value'
  | 'link-to-table';

export interface DataTableColumnInput {
  name: string;
  type?: DataTableColumnType | string;
}

export interface DataTablesListArgs extends TabTargetArgs {
  folder_id?: number;
  page?: number;
}

export interface DataTableGetArgs extends TabTargetArgs {
  table_id: string;
  include_system?: boolean;
}

export interface DataTableCreateArgs extends TabTargetArgs {
  name: string;
  folder_id: number;
  columns?: DataTableColumnInput[];
}

export interface DataTableRenameArgs extends TabTargetArgs {
  table_id: string;
  name: string;
}

export interface DataTableDeleteArgs extends TabTargetArgs {
  table_id: string;
}

export interface DataTableAddColumnArgs extends TabTargetArgs {
  table_id: string;
  name: string;
  type?: DataTableColumnType | string;
}

export interface DataTableUpdateColumnArgs extends TabTargetArgs {
  table_id: string;
  column_name?: string;
  column_id?: string;
  name?: string;
  type?: DataTableColumnType | string;
}

export interface DataTableDeleteColumnArgs extends TabTargetArgs {
  table_id: string;
  column_name?: string;
  column_id?: string;
}

export interface DataTableRowListArgs extends TabTargetArgs {
  table_id: string;
  order_by_column?: string;
  direction?: 'asc' | 'desc';
  limit?: number;
  continuation_token?: string;
}

export interface DataTableRowCreateArgs extends TabTargetArgs {
  table_id: string;
  row: Record<string, unknown>;
}

export interface DataTableRowUpdateArgs extends TabTargetArgs {
  table_id: string;
  record_id: string;
  row: Record<string, unknown>;
}

export interface DataTableRowDeleteArgs extends TabTargetArgs {
  table_id: string;
  record_ids: string | string[];
}
