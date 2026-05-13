/**
 * Shared types for the workato_lookup_* tool family — Workato Lookup Table
 * CRUD operations driven from the active Workato tab.
 *
 * All HTTP traffic is page-side (fetch from the logged-in tab origin), using
 * the same cookie + CSRF auth pattern as workato_ui_create_recipe.
 *
 * Lookup tables in Workato have a fixed 10-column schema (col1..col10);
 * each column carries a user-facing label. These tools accept and return
 * the label-keyed shape externally and translate to/from col1..col10
 * internally.
 */

export interface TabTargetArgs {
  tabId?: number;
  windowId?: number;
}

export type LookupTablesListArgs = TabTargetArgs;

export interface LookupTableGetArgs extends TabTargetArgs {
  table_id: number;
  page?: number;
  per_page?: number;
  qterm?: string;
}

export interface LookupTableCreateArgs extends TabTargetArgs {
  name?: string;
  columns?: string[];
}

export interface LookupTableRenameArgs extends TabTargetArgs {
  table_id: number;
  name: string;
}

export interface LookupTableSetColumnsArgs extends TabTargetArgs {
  table_id: number;
  columns: string[];
}

export interface LookupTableDeleteArgs extends TabTargetArgs {
  table_id: number;
}

export interface LookupTableRowCreateArgs extends TabTargetArgs {
  table_id: number;
  row: Record<string, unknown>;
}

export interface LookupTableRowUpdateArgs extends TabTargetArgs {
  table_id: number;
  row_id: number;
  row: Record<string, unknown>;
}

export interface LookupTableRowDeleteArgs extends TabTargetArgs {
  table_id: number;
  row_id: number;
}

export interface LookupTableRowSearchArgs extends TabTargetArgs {
  table_id: number;
  qterm: string;
  page?: number;
  per_page?: number;
}
