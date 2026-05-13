/**
 * workato_lookup_* — Workato Lookup Table CRUD tools.
 *
 * Each tool drives the Workato lookup-table REST endpoints from the page
 * context of the active Workato tab. Auth: session cookie + CSRF read from
 * the XSRF-TOKEN-V2 cookie (URL-decoded), with a fallback to the
 * <meta name="csrf-token"> tag. Same pattern as workato_ui_create_recipe.
 *
 * Lookup tables have a fixed 10-column schema (col1..col10). Each tool
 * exposes a friendly, label-keyed interface and handles the mapping
 * internally so callers never see the col1..col10 detail.
 *
 * Spec source: prompt — Workato lookup-table tool family v1.
 */

import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { ERROR_MESSAGES } from '@/common/constants';
import { TOOL_NAMES } from 'workatomcp-shared';
import { BaseBrowserToolExecutor } from '../base-browser';
import { ensureAttached } from '../browser/snapshot/debugger-session';
import { evaluateInPage, getTabUrl, resolveTabId } from '../workato-ui/dom-helpers';
import type {
  LookupTableCreateArgs,
  LookupTableDeleteArgs,
  LookupTableGetArgs,
  LookupTableRenameArgs,
  LookupTableRowCreateArgs,
  LookupTableRowDeleteArgs,
  LookupTableRowSearchArgs,
  LookupTableRowUpdateArgs,
  LookupTableSetColumnsArgs,
  LookupTablesListArgs,
} from './types';

// ---------------------------------------------------------------------------
// Shared page-side fragments. Embedded as a template-literal block in every
// IIFE so each tool's page-side script is self-contained — no extra eval
// round-trips, and no module-scope references that the bundler could mangle.
// ---------------------------------------------------------------------------

const PAGE_HELPERS = `
function readCookie(n) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + n.replace(/[-.+*]/g, '\\\\$&') + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function getCsrf() {
  let csrf = readCookie('XSRF-TOKEN-V2') || readCookie('XSRF-TOKEN') || readCookie('csrf-token');
  if (!csrf) {
    const csrfMeta = document.querySelector('meta[name="csrf-token"]');
    csrf = csrfMeta && csrfMeta.getAttribute('content');
  }
  return csrf;
}
function jsonHeaders(csrf) {
  return {
    'content-type': 'application/json; charset=utf-8',
    'x-csrf-token': csrf,
    'x-requested-with': 'XMLHttpRequest',
    'accept': 'application/json',
  };
}
function plainHeaders(csrf) {
  return {
    'x-csrf-token': csrf,
    'x-requested-with': 'XMLHttpRequest',
    'accept': 'application/json',
  };
}
function buildSchema(columns) {
  // columns: array of up to 10 user-facing labels. Pad to exactly 10 entries
  // with placeholders. sticky=true for user-named slots.
  const out = [];
  for (let i = 0; i < 10; i++) {
    const idx = i + 1;
    const label = (columns && columns[i] != null && String(columns[i]).length > 0) ? String(columns[i]) : null;
    if (label !== null) {
      out.push({
        control_type: 'text',
        label: label,
        name: 'col' + idx,
        type: 'string',
        sticky: true,
      });
    } else {
      out.push({
        control_type: 'text',
        label: 'Untitled column ' + idx,
        name: 'col' + idx,
        type: 'string',
        sticky: false,
      });
    }
  }
  return out;
}
function labelMapFromSchema(schema) {
  // Returns { byLabel: {label -> 'colN'}, byCol: {'colN' -> label}, columns: [{name, position}] }
  const byLabel = {};
  const byCol = {};
  const columns = [];
  if (Array.isArray(schema)) {
    for (let i = 0; i < schema.length; i++) {
      const col = schema[i];
      if (!col || typeof col !== 'object') continue;
      const name = typeof col.name === 'string' ? col.name : 'col' + (i + 1);
      const label = typeof col.label === 'string' ? col.label : name;
      byLabel[label] = name;
      byCol[name] = label;
      const m = name.match(/^col(\\d+)$/);
      const position = m ? parseInt(m[1], 10) : (i + 1);
      columns.push({ name: label, position: position });
    }
  }
  return { byLabel: byLabel, byCol: byCol, columns: columns };
}
function rowToLabeled(rowData, byCol) {
  // rowData: {col1: ..., col2: ..., ...}. byCol: {colN -> label}.
  const out = {};
  if (rowData && typeof rowData === 'object') {
    for (const k of Object.keys(rowData)) {
      const label = byCol[k] || k;
      out[label] = rowData[k];
    }
  }
  return out;
}
function rowFromLabeled(rowLabeled, byLabel) {
  // Build a {col1..col10} object. Missing/empty keys -> null. Always all 10 keys.
  const out = {};
  for (let i = 1; i <= 10; i++) out['col' + i] = null;
  if (rowLabeled && typeof rowLabeled === 'object') {
    for (const key of Object.keys(rowLabeled)) {
      const col = byLabel[key];
      if (col) out[col] = rowLabeled[key];
    }
  }
  return out;
}
async function fetchTable(tableId, query) {
  const csrf = getCsrf();
  if (!csrf) {
    return { ok: false, stage: 'csrf', error: 'could not find CSRF token; ensure the active tab is a logged-in Workato page' };
  }
  let url = '/lookup_tables/' + tableId + '.json';
  if (query) {
    const parts = [];
    if (typeof query.page === 'number' && Number.isFinite(query.page)) parts.push('page=' + encodeURIComponent(String(query.page)));
    if (typeof query.per_page === 'number' && Number.isFinite(query.per_page)) parts.push('per_page=' + encodeURIComponent(String(query.per_page)));
    if (typeof query.qterm === 'string' && query.qterm.length > 0) parts.push('qterm=' + encodeURIComponent(query.qterm));
    if (parts.length > 0) url += '?' + parts.join('&');
  }
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: plainHeaders(csrf),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return { ok: false, stage: 'http', error: 'GET ' + url + ' failed: HTTP ' + res.status + ' ' + t.slice(0, 400) };
  }
  const json = await res.json().catch(() => null);
  const result = json && json.result;
  if (!result || typeof result !== 'object') {
    return { ok: false, stage: 'parse', error: 'GET ' + url + ' response missing result object' };
  }
  return { ok: true, result: result };
}
`;

// ---------------------------------------------------------------------------
// workato_lookup_tables_list
// ---------------------------------------------------------------------------

const LIST_TABLES_PAGE_FN = `
(async () => {
  try {
    ${PAGE_HELPERS}
    const csrf = getCsrf();
    if (!csrf) {
      return { ok: false, stage: 'csrf', error: 'could not find CSRF token; ensure the active tab is a logged-in Workato page' };
    }
    const res = await fetch('/lookup_tables.json', {
      method: 'GET',
      credentials: 'include',
      headers: plainHeaders(csrf),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, stage: 'http', error: 'GET /lookup_tables.json failed: HTTP ' + res.status + ' ' + t.slice(0, 400) };
    }
    const json = await res.json().catch(() => null);
    const list = json && Array.isArray(json.result) ? json.result : null;
    if (!list) {
      return { ok: false, stage: 'parse', error: 'GET /lookup_tables.json response missing result array' };
    }
    const tables = list.map((t) => ({
      id: t && t.id,
      name: t && t.name,
      entry_count: (t && typeof t.entry_count === 'number') ? t.entry_count : null,
      updated_at: t && t.updated_at,
    }));
    return { ok: true, tables: tables };
  } catch (e) {
    return { ok: false, stage: 'exception', error: String(e && e.message || e) };
  }
})()
`;

class WorkatoLookupTablesListImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_LOOKUP.TABLES_LIST;

  async execute(args: LookupTablesListArgs): Promise<ToolResult> {
    console.log('[workato-lookup] tables_list requested:', args);
    try {
      const tabId = await resolveTabId(args);
      await ensureAttached(tabId);

      const url = await getTabUrl(tabId);
      if (!/workato\.(com|is)/.test(url)) {
        return createErrorResponse(
          `workato_lookup_tables_list: active tab is not a Workato page (url=${url}).`,
        );
      }

      const result = await evaluateInPage<{
        ok: boolean;
        stage?: string;
        error?: string;
        tables?: Array<{
          id: number;
          name: string;
          entry_count: number | null;
          updated_at: string;
        }>;
      }>(tabId, LIST_TABLES_PAGE_FN, { awaitPromise: true });

      if (!result?.ok) {
        return createErrorResponse(
          `workato_lookup_tables_list: ${result?.error ?? 'unknown error'}` +
            (result?.stage ? ` (stage=${result.stage})` : ''),
        );
      }
      const tables = result.tables ?? [];
      return {
        content: [
          {
            type: 'text',
            text: `found ${tables.length} lookup table${tables.length === 1 ? '' : 's'}\n${JSON.stringify(tables)}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-lookup] tables_list failed:', error);
      return createErrorResponse(
        `workato_lookup_tables_list failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_lookup_table_get
// ---------------------------------------------------------------------------

const GET_TABLE_PAGE_FN = `
(async (tableId, page, perPage, qterm) => {
  try {
    ${PAGE_HELPERS}
    const query = {};
    if (typeof page === 'number' && Number.isFinite(page)) query.page = page;
    if (typeof perPage === 'number' && Number.isFinite(perPage)) query.per_page = perPage;
    if (typeof qterm === 'string' && qterm.length > 0) query.qterm = qterm;
    const r = await fetchTable(tableId, query);
    if (!r.ok) return r;
    const t = r.result;
    const schema = Array.isArray(t.entry_schema) ? t.entry_schema : [];
    const map = labelMapFromSchema(schema);
    const entries = t.lookup_table_entries || {};
    const entryList = Array.isArray(entries.result) ? entries.result : [];
    const rows = entryList.map((row) => {
      const data = (row && row.data) || {};
      const labeled = rowToLabeled(data, map.byCol);
      labeled.id = row && row.id;
      return labeled;
    });
    return {
      ok: true,
      id: t.id,
      name: t.name,
      columns: map.columns,
      rows: rows,
      total_count: typeof entries.total_count === 'number' ? entries.total_count : (typeof t.entry_count === 'number' ? t.entry_count : null),
      page: typeof entries.page === 'number' ? entries.page : null,
      per_page: typeof entries.per_page === 'number' ? entries.per_page : null,
    };
  } catch (e) {
    return { ok: false, stage: 'exception', error: String(e && e.message || e) };
  }
})
`;

class WorkatoLookupTableGetImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_LOOKUP.TABLE_GET;

  async execute(args: LookupTableGetArgs): Promise<ToolResult> {
    console.log('[workato-lookup] table_get requested:', args);
    try {
      if (typeof args?.table_id !== 'number' || !Number.isFinite(args.table_id)) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': table_id (number) is required',
        );
      }

      const tabId = await resolveTabId(args);
      await ensureAttached(tabId);

      const url = await getTabUrl(tabId);
      if (!/workato\.(com|is)/.test(url)) {
        return createErrorResponse(
          `workato_lookup_table_get: active tab is not a Workato page (url=${url}).`,
        );
      }

      const expr = `(${GET_TABLE_PAGE_FN})(${JSON.stringify(args.table_id)}, ${JSON.stringify(
        typeof args.page === 'number' ? args.page : null,
      )}, ${JSON.stringify(typeof args.per_page === 'number' ? args.per_page : null)}, ${JSON.stringify(
        typeof args.qterm === 'string' ? args.qterm : null,
      )})`;

      const result = await evaluateInPage<{
        ok: boolean;
        stage?: string;
        error?: string;
        id?: number;
        name?: string;
        columns?: Array<{ name: string; position: number }>;
        rows?: Array<Record<string, unknown>>;
        total_count?: number | null;
        page?: number | null;
        per_page?: number | null;
      }>(tabId, expr, { awaitPromise: true });

      if (!result?.ok) {
        return createErrorResponse(
          `workato_lookup_table_get: ${result?.error ?? 'unknown error'}` +
            (result?.stage ? ` (stage=${result.stage})` : ''),
        );
      }
      const payload = {
        id: result.id,
        name: result.name,
        columns: result.columns,
        rows: result.rows,
        total_count: result.total_count,
        page: result.page,
        per_page: result.per_page,
      };
      const rowCount = Array.isArray(result.rows) ? result.rows.length : 0;
      return {
        content: [
          {
            type: 'text',
            text: `lookup table ${result.id} "${result.name}" — ${rowCount} row${rowCount === 1 ? '' : 's'}\n${JSON.stringify(payload)}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-lookup] table_get failed:', error);
      return createErrorResponse(
        `workato_lookup_table_get failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_lookup_table_create
// ---------------------------------------------------------------------------

const CREATE_TABLE_PAGE_FN = `
(async (name, columns) => {
  try {
    ${PAGE_HELPERS}
    const csrf = getCsrf();
    if (!csrf) {
      return { ok: false, stage: 'csrf', error: 'could not find CSRF token; ensure the active tab is a logged-in Workato page' };
    }

    // Step 1: POST /lookup_tables.json (empty body) -> {result: <id>}
    const createRes = await fetch('/lookup_tables.json', {
      method: 'POST',
      credentials: 'include',
      headers: jsonHeaders(csrf),
      body: '',
    });
    if (!createRes.ok) {
      const t = await createRes.text().catch(() => '');
      return { ok: false, stage: 'create', error: 'POST /lookup_tables.json failed: HTTP ' + createRes.status + ' ' + t.slice(0, 400) };
    }
    const createJson = await createRes.json().catch(() => null);
    const newId = createJson && createJson.result;
    if (typeof newId !== 'number' || !Number.isFinite(newId)) {
      return { ok: false, stage: 'create', error: 'create response missing numeric result: ' + JSON.stringify(createJson).slice(0, 400) };
    }

    // Step 2 (optional): rename via PUT /lookup_tables/:id.json
    let finalName = null;
    if (typeof name === 'string' && name.length > 0) {
      const renameRes = await fetch('/lookup_tables/' + newId + '.json', {
        method: 'PUT',
        credentials: 'include',
        headers: jsonHeaders(csrf),
        body: JSON.stringify({ name: name }),
      });
      if (!renameRes.ok) {
        const t = await renameRes.text().catch(() => '');
        return { ok: false, stage: 'rename', error: 'PUT /lookup_tables/' + newId + '.json failed: HTTP ' + renameRes.status + ' ' + t.slice(0, 400) };
      }
      const renameJson = await renameRes.json().catch(() => null);
      const updated = renameJson && renameJson.result;
      finalName = (updated && typeof updated.name === 'string') ? updated.name : name;
    }

    // Step 3 (optional): set schema via PUT /lookup_tables/:id/update_schema.json
    let finalColumns = null;
    if (Array.isArray(columns) && columns.length > 0) {
      if (columns.length > 10) {
        return { ok: false, stage: 'schema', error: 'columns array has more than 10 entries (max 10)' };
      }
      const schema = buildSchema(columns);
      const schemaRes = await fetch('/lookup_tables/' + newId + '/update_schema.json', {
        method: 'PUT',
        credentials: 'include',
        headers: jsonHeaders(csrf),
        body: JSON.stringify({ schema: JSON.stringify(schema) }),
      });
      if (!schemaRes.ok) {
        const t = await schemaRes.text().catch(() => '');
        return { ok: false, stage: 'schema', error: 'PUT /lookup_tables/' + newId + '/update_schema.json failed: HTTP ' + schemaRes.status + ' ' + t.slice(0, 400) };
      }
      finalColumns = schema
        .filter((c) => c.sticky === true)
        .map((c) => c.label);
    }

    return {
      ok: true,
      table_id: newId,
      name: finalName,
      columns: finalColumns,
    };
  } catch (e) {
    return { ok: false, stage: 'exception', error: String(e && e.message || e) };
  }
})
`;

class WorkatoLookupTableCreateImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_LOOKUP.TABLE_CREATE;

  async execute(args: LookupTableCreateArgs): Promise<ToolResult> {
    console.log('[workato-lookup] table_create requested:', args);
    try {
      const tabId = await resolveTabId(args);
      await ensureAttached(tabId);

      const url = await getTabUrl(tabId);
      if (!/workato\.(com|is)/.test(url)) {
        return createErrorResponse(
          `workato_lookup_table_create: active tab is not a Workato page (url=${url}).`,
        );
      }

      const desiredName =
        typeof args?.name === 'string' && args.name.length > 0
          ? args.name
          : 'Untitled lookup table';
      const cols =
        Array.isArray(args?.columns) && args.columns.length > 0
          ? args.columns.slice(0, 10).map((c) => String(c ?? ''))
          : null;
      if (Array.isArray(args?.columns) && args.columns.length > 10) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS +
            ': columns array exceeds 10 entries (lookup tables have at most 10 columns)',
        );
      }

      const expr = `(${CREATE_TABLE_PAGE_FN})(${JSON.stringify(desiredName)}, ${JSON.stringify(cols)})`;

      const result = await evaluateInPage<{
        ok: boolean;
        stage?: string;
        error?: string;
        table_id?: number;
        name?: string | null;
        columns?: string[] | null;
      }>(tabId, expr, { awaitPromise: true });

      if (!result?.ok) {
        return createErrorResponse(
          `workato_lookup_table_create: ${result?.error ?? 'unknown error'}` +
            (result?.stage ? ` (stage=${result.stage})` : ''),
        );
      }
      const payload = {
        table_id: result.table_id,
        name: result.name ?? desiredName,
        columns: result.columns ?? cols ?? [],
      };
      return {
        content: [
          {
            type: 'text',
            text: `created lookup table ${result.table_id} "${payload.name}"\n${JSON.stringify(payload)}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-lookup] table_create failed:', error);
      return createErrorResponse(
        `workato_lookup_table_create failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_lookup_table_rename
// ---------------------------------------------------------------------------

const RENAME_TABLE_PAGE_FN = `
(async (tableId, name) => {
  try {
    ${PAGE_HELPERS}
    const csrf = getCsrf();
    if (!csrf) {
      return { ok: false, stage: 'csrf', error: 'could not find CSRF token; ensure the active tab is a logged-in Workato page' };
    }
    const res = await fetch('/lookup_tables/' + tableId + '.json', {
      method: 'PUT',
      credentials: 'include',
      headers: jsonHeaders(csrf),
      body: JSON.stringify({ name: name }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, stage: 'http', error: 'PUT /lookup_tables/' + tableId + '.json failed: HTTP ' + res.status + ' ' + t.slice(0, 400) };
    }
    const json = await res.json().catch(() => null);
    const updated = json && json.result;
    if (!updated || typeof updated !== 'object') {
      return { ok: false, stage: 'parse', error: 'rename response missing result object' };
    }
    return { ok: true, id: updated.id, name: updated.name };
  } catch (e) {
    return { ok: false, stage: 'exception', error: String(e && e.message || e) };
  }
})
`;

class WorkatoLookupTableRenameImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_LOOKUP.TABLE_RENAME;

  async execute(args: LookupTableRenameArgs): Promise<ToolResult> {
    console.log('[workato-lookup] table_rename requested:', args);
    try {
      if (typeof args?.table_id !== 'number' || !Number.isFinite(args.table_id)) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': table_id (number) is required',
        );
      }
      if (typeof args?.name !== 'string' || args.name.length === 0) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': name (non-empty string) is required',
        );
      }
      const tabId = await resolveTabId(args);
      await ensureAttached(tabId);

      const url = await getTabUrl(tabId);
      if (!/workato\.(com|is)/.test(url)) {
        return createErrorResponse(
          `workato_lookup_table_rename: active tab is not a Workato page (url=${url}).`,
        );
      }

      const expr = `(${RENAME_TABLE_PAGE_FN})(${JSON.stringify(args.table_id)}, ${JSON.stringify(args.name)})`;
      const result = await evaluateInPage<{
        ok: boolean;
        stage?: string;
        error?: string;
        id?: number;
        name?: string;
      }>(tabId, expr, { awaitPromise: true });

      if (!result?.ok) {
        return createErrorResponse(
          `workato_lookup_table_rename: ${result?.error ?? 'unknown error'}` +
            (result?.stage ? ` (stage=${result.stage})` : ''),
        );
      }
      const payload = { id: result.id, name: result.name };
      return {
        content: [
          {
            type: 'text',
            text: `renamed lookup table ${result.id} to "${result.name}"\n${JSON.stringify(payload)}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-lookup] table_rename failed:', error);
      return createErrorResponse(
        `workato_lookup_table_rename failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_lookup_table_set_columns
// ---------------------------------------------------------------------------

const SET_COLUMNS_PAGE_FN = `
(async (tableId, columns) => {
  try {
    ${PAGE_HELPERS}
    const csrf = getCsrf();
    if (!csrf) {
      return { ok: false, stage: 'csrf', error: 'could not find CSRF token; ensure the active tab is a logged-in Workato page' };
    }
    const schema = buildSchema(columns);
    const res = await fetch('/lookup_tables/' + tableId + '/update_schema.json', {
      method: 'PUT',
      credentials: 'include',
      headers: jsonHeaders(csrf),
      body: JSON.stringify({ schema: JSON.stringify(schema) }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, stage: 'http', error: 'PUT /lookup_tables/' + tableId + '/update_schema.json failed: HTTP ' + res.status + ' ' + t.slice(0, 400) };
    }
    const labels = schema.filter((c) => c.sticky === true).map((c) => c.label);
    return { ok: true, table_id: tableId, columns: labels };
  } catch (e) {
    return { ok: false, stage: 'exception', error: String(e && e.message || e) };
  }
})
`;

class WorkatoLookupTableSetColumnsImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_LOOKUP.TABLE_SET_COLUMNS;

  async execute(args: LookupTableSetColumnsArgs): Promise<ToolResult> {
    console.log('[workato-lookup] table_set_columns requested:', args);
    try {
      if (typeof args?.table_id !== 'number' || !Number.isFinite(args.table_id)) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': table_id (number) is required',
        );
      }
      if (!Array.isArray(args?.columns) || args.columns.length === 0) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': columns (string[] of 1-10 entries) is required',
        );
      }
      if (args.columns.length > 10) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS +
            ': columns array exceeds 10 entries (lookup tables have at most 10 columns)',
        );
      }

      const tabId = await resolveTabId(args);
      await ensureAttached(tabId);

      const url = await getTabUrl(tabId);
      if (!/workato\.(com|is)/.test(url)) {
        return createErrorResponse(
          `workato_lookup_table_set_columns: active tab is not a Workato page (url=${url}).`,
        );
      }

      const cols = args.columns.slice(0, 10).map((c) => String(c ?? ''));
      const expr = `(${SET_COLUMNS_PAGE_FN})(${JSON.stringify(args.table_id)}, ${JSON.stringify(cols)})`;

      const result = await evaluateInPage<{
        ok: boolean;
        stage?: string;
        error?: string;
        table_id?: number;
        columns?: string[];
      }>(tabId, expr, { awaitPromise: true });

      if (!result?.ok) {
        return createErrorResponse(
          `workato_lookup_table_set_columns: ${result?.error ?? 'unknown error'}` +
            (result?.stage ? ` (stage=${result.stage})` : ''),
        );
      }
      const payload = { table_id: result.table_id, columns: result.columns ?? [] };
      return {
        content: [
          {
            type: 'text',
            text: `set ${payload.columns.length} column${payload.columns.length === 1 ? '' : 's'} on lookup table ${result.table_id}\n${JSON.stringify(payload)}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-lookup] table_set_columns failed:', error);
      return createErrorResponse(
        `workato_lookup_table_set_columns failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_lookup_table_delete
// ---------------------------------------------------------------------------

const DELETE_TABLE_PAGE_FN = `
(async (tableId) => {
  try {
    ${PAGE_HELPERS}
    const csrf = getCsrf();
    if (!csrf) {
      return { ok: false, stage: 'csrf', error: 'could not find CSRF token; ensure the active tab is a logged-in Workato page' };
    }
    const res = await fetch('/lookup_tables/' + tableId + '.json', {
      method: 'DELETE',
      credentials: 'include',
      headers: plainHeaders(csrf),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, stage: 'http', error: 'DELETE /lookup_tables/' + tableId + '.json failed: HTTP ' + res.status + ' ' + t.slice(0, 400) };
    }
    return { ok: true, table_id: tableId };
  } catch (e) {
    return { ok: false, stage: 'exception', error: String(e && e.message || e) };
  }
})
`;

class WorkatoLookupTableDeleteImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_LOOKUP.TABLE_DELETE;

  async execute(args: LookupTableDeleteArgs): Promise<ToolResult> {
    console.log('[workato-lookup] table_delete requested:', args);
    try {
      if (typeof args?.table_id !== 'number' || !Number.isFinite(args.table_id)) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': table_id (number) is required',
        );
      }
      const tabId = await resolveTabId(args);
      await ensureAttached(tabId);

      const url = await getTabUrl(tabId);
      if (!/workato\.(com|is)/.test(url)) {
        return createErrorResponse(
          `workato_lookup_table_delete: active tab is not a Workato page (url=${url}).`,
        );
      }

      const expr = `(${DELETE_TABLE_PAGE_FN})(${JSON.stringify(args.table_id)})`;
      const result = await evaluateInPage<{
        ok: boolean;
        stage?: string;
        error?: string;
        table_id?: number;
      }>(tabId, expr, { awaitPromise: true });

      if (!result?.ok) {
        return createErrorResponse(
          `workato_lookup_table_delete: ${result?.error ?? 'unknown error'}` +
            (result?.stage ? ` (stage=${result.stage})` : ''),
        );
      }
      const payload = { table_id: result.table_id, deleted: true };
      return {
        content: [
          {
            type: 'text',
            text: `deleted lookup table ${result.table_id}\n${JSON.stringify(payload)}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-lookup] table_delete failed:', error);
      return createErrorResponse(
        `workato_lookup_table_delete failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_lookup_table_row_create
// ---------------------------------------------------------------------------

const ROW_CREATE_PAGE_FN = `
(async (tableId, rowLabeled) => {
  try {
    ${PAGE_HELPERS}
    const csrf = getCsrf();
    if (!csrf) {
      return { ok: false, stage: 'csrf', error: 'could not find CSRF token; ensure the active tab is a logged-in Workato page' };
    }
    // Fetch the table to learn the label->colN mapping.
    const tableRes = await fetchTable(tableId, null);
    if (!tableRes.ok) return tableRes;
    const t = tableRes.result;
    const schema = Array.isArray(t.entry_schema) ? t.entry_schema : [];
    const map = labelMapFromSchema(schema);

    const data = rowFromLabeled(rowLabeled, map.byLabel);

    const res = await fetch('/lookup_tables/' + tableId + '/add_row.json', {
      method: 'POST',
      credentials: 'include',
      headers: jsonHeaders(csrf),
      body: JSON.stringify({ data: data }),
    });
    if (!res.ok) {
      const errTxt = await res.text().catch(() => '');
      return { ok: false, stage: 'http', error: 'POST /lookup_tables/' + tableId + '/add_row.json failed: HTTP ' + res.status + ' ' + errTxt.slice(0, 400) };
    }
    const json = await res.json().catch(() => null);
    const row = json && json.result;
    if (!row || typeof row !== 'object' || typeof row.id !== 'number') {
      return { ok: false, stage: 'parse', error: 'create-row response missing result.id: ' + JSON.stringify(json).slice(0, 400) };
    }
    return {
      ok: true,
      table_id: tableId,
      row_id: row.id,
      row: rowToLabeled(row.data || {}, map.byCol),
    };
  } catch (e) {
    return { ok: false, stage: 'exception', error: String(e && e.message || e) };
  }
})
`;

class WorkatoLookupTableRowCreateImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_LOOKUP.ROW_CREATE;

  async execute(args: LookupTableRowCreateArgs): Promise<ToolResult> {
    console.log('[workato-lookup] row_create requested:', args);
    try {
      if (typeof args?.table_id !== 'number' || !Number.isFinite(args.table_id)) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': table_id (number) is required',
        );
      }
      if (!args?.row || typeof args.row !== 'object') {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': row (object keyed by column label) is required',
        );
      }
      const tabId = await resolveTabId(args);
      await ensureAttached(tabId);

      const url = await getTabUrl(tabId);
      if (!/workato\.(com|is)/.test(url)) {
        return createErrorResponse(
          `workato_lookup_table_row_create: active tab is not a Workato page (url=${url}).`,
        );
      }

      const expr = `(${ROW_CREATE_PAGE_FN})(${JSON.stringify(args.table_id)}, ${JSON.stringify(args.row)})`;
      const result = await evaluateInPage<{
        ok: boolean;
        stage?: string;
        error?: string;
        table_id?: number;
        row_id?: number;
        row?: Record<string, unknown>;
      }>(tabId, expr, { awaitPromise: true });

      if (!result?.ok) {
        return createErrorResponse(
          `workato_lookup_table_row_create: ${result?.error ?? 'unknown error'}` +
            (result?.stage ? ` (stage=${result.stage})` : ''),
        );
      }
      const payload = { table_id: result.table_id, row_id: result.row_id, row: result.row };
      return {
        content: [
          {
            type: 'text',
            text: `created row ${result.row_id} in lookup table ${result.table_id}\n${JSON.stringify(payload)}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-lookup] row_create failed:', error);
      return createErrorResponse(
        `workato_lookup_table_row_create failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_lookup_table_row_update
// ---------------------------------------------------------------------------

const ROW_UPDATE_PAGE_FN = `
(async (tableId, rowId, rowLabeled) => {
  try {
    ${PAGE_HELPERS}
    const csrf = getCsrf();
    if (!csrf) {
      return { ok: false, stage: 'csrf', error: 'could not find CSRF token; ensure the active tab is a logged-in Workato page' };
    }
    // Fetch the table so we have label<->colN mapping AND existing row values
    // (we need to send all 10 keys in data; merge user-provided fields into existing).
    const tableRes = await fetchTable(tableId, null);
    if (!tableRes.ok) return tableRes;
    const t = tableRes.result;
    const schema = Array.isArray(t.entry_schema) ? t.entry_schema : [];
    const map = labelMapFromSchema(schema);

    // Try to find the existing row to seed unchanged columns. Use a large per_page
    // single-page fetch so we can find by id without paging logic in here.
    let existingData = null;
    const entries = t.lookup_table_entries || {};
    const entryList = Array.isArray(entries.result) ? entries.result : [];
    for (const r of entryList) {
      if (r && r.id === rowId) { existingData = r.data || {}; break; }
    }
    if (!existingData) {
      // The first page didn't have it — fall back to fetching with high per_page.
      const wideRes = await fetchTable(tableId, { page: 1, per_page: 500 });
      if (wideRes.ok && wideRes.result && wideRes.result.lookup_table_entries) {
        const list = Array.isArray(wideRes.result.lookup_table_entries.result) ? wideRes.result.lookup_table_entries.result : [];
        for (const r of list) {
          if (r && r.id === rowId) { existingData = r.data || {}; break; }
        }
      }
    }
    if (!existingData) existingData = {};

    // Build a label-keyed view of the existing row, overlay the caller's fields,
    // then convert back to col1..col10.
    const existingLabeled = rowToLabeled(existingData, map.byCol);
    const merged = Object.assign({}, existingLabeled, rowLabeled || {});
    delete merged.id;
    const data = rowFromLabeled(merged, map.byLabel);

    const res = await fetch('/lookup_tables/' + tableId + '/update_row.json', {
      method: 'PUT',
      credentials: 'include',
      headers: jsonHeaders(csrf),
      body: JSON.stringify({ row_id: rowId, data: data }),
    });
    if (!res.ok) {
      const errTxt = await res.text().catch(() => '');
      return { ok: false, stage: 'http', error: 'PUT /lookup_tables/' + tableId + '/update_row.json failed: HTTP ' + res.status + ' ' + errTxt.slice(0, 400) };
    }
    const json = await res.json().catch(() => null);
    const row = json && json.result;
    if (!row || typeof row !== 'object') {
      return { ok: false, stage: 'parse', error: 'update-row response missing result: ' + JSON.stringify(json).slice(0, 400) };
    }
    return {
      ok: true,
      table_id: tableId,
      row_id: rowId,
      row: rowToLabeled(row.data || {}, map.byCol),
    };
  } catch (e) {
    return { ok: false, stage: 'exception', error: String(e && e.message || e) };
  }
})
`;

class WorkatoLookupTableRowUpdateImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_LOOKUP.ROW_UPDATE;

  async execute(args: LookupTableRowUpdateArgs): Promise<ToolResult> {
    console.log('[workato-lookup] row_update requested:', args);
    try {
      if (typeof args?.table_id !== 'number' || !Number.isFinite(args.table_id)) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': table_id (number) is required',
        );
      }
      if (typeof args?.row_id !== 'number' || !Number.isFinite(args.row_id)) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': row_id (number) is required',
        );
      }
      if (!args?.row || typeof args.row !== 'object') {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': row (object keyed by column label) is required',
        );
      }
      const tabId = await resolveTabId(args);
      await ensureAttached(tabId);

      const url = await getTabUrl(tabId);
      if (!/workato\.(com|is)/.test(url)) {
        return createErrorResponse(
          `workato_lookup_table_row_update: active tab is not a Workato page (url=${url}).`,
        );
      }

      const expr = `(${ROW_UPDATE_PAGE_FN})(${JSON.stringify(args.table_id)}, ${JSON.stringify(args.row_id)}, ${JSON.stringify(args.row)})`;
      const result = await evaluateInPage<{
        ok: boolean;
        stage?: string;
        error?: string;
        table_id?: number;
        row_id?: number;
        row?: Record<string, unknown>;
      }>(tabId, expr, { awaitPromise: true });

      if (!result?.ok) {
        return createErrorResponse(
          `workato_lookup_table_row_update: ${result?.error ?? 'unknown error'}` +
            (result?.stage ? ` (stage=${result.stage})` : ''),
        );
      }
      const payload = { table_id: result.table_id, row_id: result.row_id, row: result.row };
      return {
        content: [
          {
            type: 'text',
            text: `updated row ${result.row_id} in lookup table ${result.table_id}\n${JSON.stringify(payload)}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-lookup] row_update failed:', error);
      return createErrorResponse(
        `workato_lookup_table_row_update failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_lookup_table_row_delete
// ---------------------------------------------------------------------------

const ROW_DELETE_PAGE_FN = `
(async (tableId, rowId) => {
  try {
    ${PAGE_HELPERS}
    const csrf = getCsrf();
    if (!csrf) {
      return { ok: false, stage: 'csrf', error: 'could not find CSRF token; ensure the active tab is a logged-in Workato page' };
    }
    const url = '/lookup_tables/' + tableId + '/delete_row.json?row_id=' + encodeURIComponent(String(rowId));
    const res = await fetch(url, {
      method: 'DELETE',
      credentials: 'include',
      headers: plainHeaders(csrf),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, stage: 'http', error: 'DELETE ' + url + ' failed: HTTP ' + res.status + ' ' + t.slice(0, 400) };
    }
    return { ok: true, table_id: tableId, row_id: rowId };
  } catch (e) {
    return { ok: false, stage: 'exception', error: String(e && e.message || e) };
  }
})
`;

class WorkatoLookupTableRowDeleteImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_LOOKUP.ROW_DELETE;

  async execute(args: LookupTableRowDeleteArgs): Promise<ToolResult> {
    console.log('[workato-lookup] row_delete requested:', args);
    try {
      if (typeof args?.table_id !== 'number' || !Number.isFinite(args.table_id)) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': table_id (number) is required',
        );
      }
      if (typeof args?.row_id !== 'number' || !Number.isFinite(args.row_id)) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': row_id (number) is required',
        );
      }
      const tabId = await resolveTabId(args);
      await ensureAttached(tabId);

      const url = await getTabUrl(tabId);
      if (!/workato\.(com|is)/.test(url)) {
        return createErrorResponse(
          `workato_lookup_table_row_delete: active tab is not a Workato page (url=${url}).`,
        );
      }

      const expr = `(${ROW_DELETE_PAGE_FN})(${JSON.stringify(args.table_id)}, ${JSON.stringify(args.row_id)})`;
      const result = await evaluateInPage<{
        ok: boolean;
        stage?: string;
        error?: string;
        table_id?: number;
        row_id?: number;
      }>(tabId, expr, { awaitPromise: true });

      if (!result?.ok) {
        return createErrorResponse(
          `workato_lookup_table_row_delete: ${result?.error ?? 'unknown error'}` +
            (result?.stage ? ` (stage=${result.stage})` : ''),
        );
      }
      const payload = { table_id: result.table_id, row_id: result.row_id, deleted: true };
      return {
        content: [
          {
            type: 'text',
            text: `deleted row ${result.row_id} from lookup table ${result.table_id}\n${JSON.stringify(payload)}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-lookup] row_delete failed:', error);
      return createErrorResponse(
        `workato_lookup_table_row_delete failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_lookup_table_row_search — same endpoint as TABLE_GET with qterm.
// ---------------------------------------------------------------------------

class WorkatoLookupTableRowSearchImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_LOOKUP.ROW_SEARCH;

  async execute(args: LookupTableRowSearchArgs): Promise<ToolResult> {
    console.log('[workato-lookup] row_search requested:', args);
    try {
      if (typeof args?.table_id !== 'number' || !Number.isFinite(args.table_id)) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': table_id (number) is required',
        );
      }
      if (typeof args?.qterm !== 'string' || args.qterm.length === 0) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': qterm (non-empty string) is required',
        );
      }
      const tabId = await resolveTabId(args);
      await ensureAttached(tabId);

      const url = await getTabUrl(tabId);
      if (!/workato\.(com|is)/.test(url)) {
        return createErrorResponse(
          `workato_lookup_table_row_search: active tab is not a Workato page (url=${url}).`,
        );
      }

      const expr = `(${GET_TABLE_PAGE_FN})(${JSON.stringify(args.table_id)}, ${JSON.stringify(
        typeof args.page === 'number' ? args.page : null,
      )}, ${JSON.stringify(typeof args.per_page === 'number' ? args.per_page : null)}, ${JSON.stringify(
        args.qterm,
      )})`;

      const result = await evaluateInPage<{
        ok: boolean;
        stage?: string;
        error?: string;
        id?: number;
        name?: string;
        columns?: Array<{ name: string; position: number }>;
        rows?: Array<Record<string, unknown>>;
        total_count?: number | null;
        page?: number | null;
        per_page?: number | null;
      }>(tabId, expr, { awaitPromise: true });

      if (!result?.ok) {
        return createErrorResponse(
          `workato_lookup_table_row_search: ${result?.error ?? 'unknown error'}` +
            (result?.stage ? ` (stage=${result.stage})` : ''),
        );
      }
      const rowCount = Array.isArray(result.rows) ? result.rows.length : 0;
      const payload = {
        id: result.id,
        name: result.name,
        columns: result.columns,
        rows: result.rows,
        total_count: result.total_count,
        page: result.page,
        per_page: result.per_page,
      };
      return {
        content: [
          {
            type: 'text',
            text: `searched lookup table ${result.id} for "${args.qterm}" — ${rowCount} row${rowCount === 1 ? '' : 's'}\n${JSON.stringify(payload)}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-lookup] row_search failed:', error);
      return createErrorResponse(
        `workato_lookup_table_row_search failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Exports — runtime instances (tools/index.ts reads `.name`).
// ---------------------------------------------------------------------------

export const WorkatoLookupTablesListTool = new WorkatoLookupTablesListImpl();
export const WorkatoLookupTableGetTool = new WorkatoLookupTableGetImpl();
export const WorkatoLookupTableCreateTool = new WorkatoLookupTableCreateImpl();
export const WorkatoLookupTableRenameTool = new WorkatoLookupTableRenameImpl();
export const WorkatoLookupTableSetColumnsTool = new WorkatoLookupTableSetColumnsImpl();
export const WorkatoLookupTableDeleteTool = new WorkatoLookupTableDeleteImpl();
export const WorkatoLookupTableRowCreateTool = new WorkatoLookupTableRowCreateImpl();
export const WorkatoLookupTableRowUpdateTool = new WorkatoLookupTableRowUpdateImpl();
export const WorkatoLookupTableRowDeleteTool = new WorkatoLookupTableRowDeleteImpl();
export const WorkatoLookupTableRowSearchTool = new WorkatoLookupTableRowSearchImpl();
