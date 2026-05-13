/**
 * workato_data_table_* — Workato Data Tables CRUD tools.
 *
 * Data Tables are Workato's newer relational store (separate from Lookup
 * Tables). All endpoints live under /web_api/workato_db/. Auth is the same
 * cookie + CSRF (XSRF-TOKEN-V2) pattern used by workato_lookup_* and
 * workato_ui_create_recipe.
 *
 * Each tool resolves the active tab, attaches the debugger if needed, and
 * runs an async IIFE in the page MAIN world via Runtime.evaluate (awaitPromise
 * true). All page-side helpers are inlined as a template-literal block so
 * each script is self-contained and the bundler can't mangle module-scope
 * references.
 *
 * Schema model:
 *   - 3 system columns auto-seeded on create: "Record ID", "Created time",
 *     "Last modified time" (all hidden + read_only). These MUST be retained
 *     on every schema PUT.
 *   - User columns are added/edited/deleted by full-schema PUT. Tools cache
 *     the title<->uuid map per call and translate the records-API UUID-keyed
 *     payloads to/from the label-keyed shape callers prefer.
 *
 * Spec source: prompt — Workato Data Tables tool family v1 (endpoints
 * captured 2026-05-13).
 */

import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { ERROR_MESSAGES } from '@/common/constants';
import { TOOL_NAMES } from 'workatomcp-shared';
import { BaseBrowserToolExecutor } from '../base-browser';
import { ensureAttached } from '../browser/snapshot/debugger-session';
import { evaluateInPage, getTabUrl, resolveTabId } from '../workato-ui/dom-helpers';
import type {
  DataTableAddColumnArgs,
  DataTableCreateArgs,
  DataTableDeleteArgs,
  DataTableDeleteColumnArgs,
  DataTableGetArgs,
  DataTableRenameArgs,
  DataTableRowCreateArgs,
  DataTableRowDeleteArgs,
  DataTableRowListArgs,
  DataTableRowUpdateArgs,
  DataTableUpdateColumnArgs,
  DataTablesListArgs,
} from './types';

// ---------------------------------------------------------------------------
// Shared page-side helpers. Embedded as a template-literal block at the top of
// every IIFE so each tool's script is self-contained.
// ---------------------------------------------------------------------------

const SYSTEM_COLUMN_TITLES = ['Record ID', 'Created time', 'Last modified time'] as const;

const ALLOWED_COLUMN_TYPES = new Set([
  'short-text',
  'long-text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'date-time',
  'file',
  'multi-value',
  'link-to-table',
]);

const PAGE_HELPERS = `
const SYSTEM_TITLES = ['Record ID', 'Created time', 'Last modified time'];

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
function isSystemTitle(title) {
  return SYSTEM_TITLES.indexOf(title) !== -1;
}
function isDataTableAsset(item) {
  // mixed_assets returns heterogeneous items. Data-table entries are flagged
  // by their type marker. The exact field/value isn't documented; we accept
  // a few common shapes (defensive — surface unknowns rather than miss them).
  if (!item || typeof item !== 'object') return false;
  const t = item.type || item.asset_type || item.kind || item.entity_type || null;
  if (typeof t !== 'string') return false;
  const norm = t.toLowerCase();
  return (
    norm === 'workato_db_table' ||
    norm === 'workato_db/table' ||
    norm === 'data_table' ||
    norm === 'data-table' ||
    norm === 'workato_data_table' ||
    norm === 'table' ||
    norm.indexOf('workato_db') !== -1 ||
    norm.indexOf('data_table') !== -1
  );
}
function labelMapFromSchema(schema) {
  // Returns { byLabel: {label -> uuid}, byCol: {uuid -> label}, columns: [{name,type,id,hidden,read_only}], systemIds: Set, recordIdColumnId: string|null }
  const byLabel = {};
  const byCol = {};
  const columns = [];
  const systemIds = {};
  let recordIdColumnId = null;
  if (Array.isArray(schema)) {
    for (let i = 0; i < schema.length; i++) {
      const c = schema[i];
      if (!c || typeof c !== 'object') continue;
      const id = typeof c.id === 'string' ? c.id : null;
      const title = typeof c.title === 'string' ? c.title : (typeof c.name === 'string' ? c.name : null);
      if (!id || !title) continue;
      byLabel[title] = id;
      byCol[id] = title;
      const isSys = isSystemTitle(title);
      if (isSys) systemIds[id] = true;
      if (title === 'Record ID') recordIdColumnId = id;
      columns.push({
        name: title,
        type: c.type,
        id: id,
        hidden: c.hidden === true,
        read_only: c.read_only === true,
        required: c.required === true,
      });
    }
  }
  return { byLabel: byLabel, byCol: byCol, columns: columns, systemIds: systemIds, recordIdColumnId: recordIdColumnId };
}
function rowToLabeled(record, byCol, recordIdColumnId) {
  // record: {<uuid>:value,...}. byCol: {uuid -> label}.
  const out = {};
  if (record && typeof record === 'object') {
    for (const k of Object.keys(record)) {
      const label = byCol[k];
      if (label) out[label] = record[k];
    }
  }
  if (recordIdColumnId && record && Object.prototype.hasOwnProperty.call(record, recordIdColumnId)) {
    out['Record ID'] = record[recordIdColumnId];
  }
  return out;
}
function rowFromLabeled(rowLabeled, byLabel) {
  // Maps user-supplied label-keyed object to a UUID-keyed object. Unknown
  // labels are dropped. Caller decides whether to include unset fields.
  const out = {};
  if (rowLabeled && typeof rowLabeled === 'object') {
    for (const key of Object.keys(rowLabeled)) {
      if (key === 'Record ID') continue; // never let callers overwrite the row UUID
      const uuid = byLabel[key];
      if (uuid) out[uuid] = rowLabeled[key];
    }
  }
  return out;
}
async function getTable(tableId) {
  const csrf = getCsrf();
  if (!csrf) {
    return { ok: false, stage: 'csrf', error: 'could not find CSRF token; ensure the active tab is a logged-in Workato page' };
  }
  const url = '/web_api/workato_db/tables/' + encodeURIComponent(tableId) + '.json';
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
async function putSchema(tableId, schema, csrf) {
  const url = '/web_api/workato_db/tables/' + encodeURIComponent(tableId) + '.json';
  const res = await fetch(url, {
    method: 'PUT',
    credentials: 'include',
    headers: jsonHeaders(csrf),
    body: JSON.stringify({ schema: schema }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return { ok: false, stage: 'schema', error: 'PUT ' + url + ' failed: HTTP ' + res.status + ' ' + t.slice(0, 400) };
  }
  const json = await res.json().catch(() => null);
  const result = json && json.result;
  if (!result || typeof result !== 'object') {
    return { ok: false, stage: 'parse', error: 'PUT ' + url + ' response missing result object' };
  }
  return { ok: true, result: result };
}
`;

// Helper: regex pluck `folder_id` (or `/folders/<id>`) from a Workato URL.
function inferFolderIdFromUrl(url: string): number | null {
  try {
    const u = new URL(url);
    const q = u.searchParams.get('folder_id');
    if (q && /^\d+$/.test(q)) return parseInt(q, 10);
    const m = u.pathname.match(/\/folders\/(\d+)/);
    if (m) return parseInt(m[1], 10);
  } catch {
    /* ignore */
  }
  return null;
}

function ensureWorkato(url: string): boolean {
  return /workato\.(com|is)/.test(url);
}

// ---------------------------------------------------------------------------
// workato_data_tables_list
// ---------------------------------------------------------------------------

const LIST_TABLES_PAGE_FN = `
(async (folderId, page) => {
  try {
    ${PAGE_HELPERS}
    const csrf = getCsrf();
    if (!csrf) {
      return { ok: false, stage: 'csrf', error: 'could not find CSRF token; ensure the active tab is a logged-in Workato page' };
    }
    const parts = ['sort_term=latest_activity'];
    if (folderId !== null && folderId !== undefined) parts.push('folder_id=' + encodeURIComponent(String(folderId)));
    parts.push('page=' + encodeURIComponent(String(typeof page === 'number' && page > 0 ? page : 1)));
    const url = '/web_api/mixed_assets.json?' + parts.join('&');
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
    const items = (result && Array.isArray(result.items)) ? result.items : null;
    if (!items) {
      return { ok: false, stage: 'parse', error: 'GET ' + url + ' response missing result.items' };
    }
    const tables = items.filter(isDataTableAsset).map((it) => ({
      id: it.id || it.table_id || it.uuid || null,
      name: it.name || it.title || null,
      folder_id: it.folder_id || null,
      total_entries_count: (typeof it.total_entries_count === 'number') ? it.total_entries_count : (typeof it.entry_count === 'number' ? it.entry_count : null),
      updated_at: it.updated_at || it.last_modified || null,
      type: it.type || it.asset_type || null,
    }));
    return {
      ok: true,
      tables: tables,
      page: result.page,
      per_page: result.per_page,
      count: result.count,
      folder_id_used: folderId,
    };
  } catch (e) {
    return { ok: false, stage: 'exception', error: String(e && e.message || e) };
  }
})
`;

class WorkatoDataTablesListImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_DATA_TABLE.TABLES_LIST;

  async execute(args: DataTablesListArgs): Promise<ToolResult> {
    console.log('[workato-data-table] tables_list requested:', args);
    try {
      const tabId = await resolveTabId(args ?? {});
      await ensureAttached(tabId);

      const url = await getTabUrl(tabId);
      if (!ensureWorkato(url)) {
        return createErrorResponse(
          `workato_data_tables_list: active tab is not a Workato page (url=${url}).`,
        );
      }

      let folderId =
        typeof args?.folder_id === 'number' && Number.isFinite(args.folder_id)
          ? args.folder_id
          : null;
      if (folderId === null) {
        folderId = inferFolderIdFromUrl(url);
      }

      const page = typeof args?.page === 'number' ? args.page : null;
      const expr = `(${LIST_TABLES_PAGE_FN})(${JSON.stringify(folderId)}, ${JSON.stringify(page)})`;

      const result = await evaluateInPage<{
        ok: boolean;
        stage?: string;
        error?: string;
        tables?: Array<Record<string, unknown>>;
        page?: number;
        per_page?: number;
        count?: number;
        folder_id_used?: number | null;
      }>(tabId, expr, { awaitPromise: true });

      if (!result?.ok) {
        return createErrorResponse(
          `workato_data_tables_list: ${result?.error ?? 'unknown error'}` +
            (result?.stage ? ` (stage=${result.stage})` : ''),
        );
      }
      const tables = result.tables ?? [];
      const payload = {
        tables,
        page: result.page ?? null,
        per_page: result.per_page ?? null,
        count: result.count ?? null,
        folder_id: result.folder_id_used ?? folderId,
      };
      return {
        content: [
          {
            type: 'text',
            text: `found ${tables.length} data table${tables.length === 1 ? '' : 's'}${folderId === null ? '' : ` in folder ${folderId}`}\n${JSON.stringify(payload)}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-data-table] tables_list failed:', error);
      return createErrorResponse(
        `workato_data_tables_list failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_data_table_get
// ---------------------------------------------------------------------------

const GET_TABLE_PAGE_FN = `
(async (tableId, includeSystem) => {
  try {
    ${PAGE_HELPERS}
    const r = await getTable(tableId);
    if (!r.ok) return r;
    const t = r.result;
    const schema = Array.isArray(t.schema) ? t.schema : [];
    const map = labelMapFromSchema(schema);
    let columns = map.columns;
    if (!includeSystem) {
      columns = columns.filter((c) => !isSystemTitle(c.name));
    }
    return {
      ok: true,
      id: t.id || t.table_id || tableId,
      table_id_uuid: t.table_id || t.id || tableId,
      name: t.name,
      folder_id: t.folder_id,
      project_id: t.project_id,
      columns: columns,
      total_entries_count: (typeof t.total_entries_count === 'number') ? t.total_entries_count : null,
      updated_at: t.updated_at || null,
    };
  } catch (e) {
    return { ok: false, stage: 'exception', error: String(e && e.message || e) };
  }
})
`;

class WorkatoDataTableGetImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_DATA_TABLE.TABLE_GET;

  async execute(args: DataTableGetArgs): Promise<ToolResult> {
    console.log('[workato-data-table] table_get requested:', args);
    try {
      if (typeof args?.table_id !== 'string' || args.table_id.length === 0) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': table_id (string) is required',
        );
      }
      const tabId = await resolveTabId(args);
      await ensureAttached(tabId);

      const url = await getTabUrl(tabId);
      if (!ensureWorkato(url)) {
        return createErrorResponse(
          `workato_data_table_get: active tab is not a Workato page (url=${url}).`,
        );
      }

      const expr = `(${GET_TABLE_PAGE_FN})(${JSON.stringify(args.table_id)}, ${JSON.stringify(args.include_system === true)})`;
      const result = await evaluateInPage<{
        ok: boolean;
        stage?: string;
        error?: string;
        id?: string;
        table_id_uuid?: string;
        name?: string;
        folder_id?: number;
        project_id?: number;
        columns?: Array<Record<string, unknown>>;
        total_entries_count?: number | null;
        updated_at?: string | null;
      }>(tabId, expr, { awaitPromise: true });

      if (!result?.ok) {
        return createErrorResponse(
          `workato_data_table_get: ${result?.error ?? 'unknown error'}` +
            (result?.stage ? ` (stage=${result.stage})` : ''),
        );
      }
      const payload = {
        id: result.id,
        table_id_uuid: result.table_id_uuid,
        name: result.name,
        folder_id: result.folder_id,
        project_id: result.project_id,
        columns: result.columns,
        total_entries_count: result.total_entries_count,
        updated_at: result.updated_at,
      };
      const colCount = Array.isArray(result.columns) ? result.columns.length : 0;
      return {
        content: [
          {
            type: 'text',
            text: `data table ${result.id} "${result.name}" — ${colCount} column${colCount === 1 ? '' : 's'}\n${JSON.stringify(payload)}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-data-table] table_get failed:', error);
      return createErrorResponse(
        `workato_data_table_get failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_data_table_create
// ---------------------------------------------------------------------------

const CREATE_TABLE_PAGE_FN = `
(async (name, folderId, userColumns) => {
  try {
    ${PAGE_HELPERS}
    const csrf = getCsrf();
    if (!csrf) {
      return { ok: false, stage: 'csrf', error: 'could not find CSRF token; ensure the active tab is a logged-in Workato page' };
    }

    // Step 1: POST /web_api/workato_db/tables.json
    const createRes = await fetch('/web_api/workato_db/tables.json', {
      method: 'POST',
      credentials: 'include',
      headers: jsonHeaders(csrf),
      body: JSON.stringify({ name: name, folder_id: folderId }),
    });
    if (!createRes.ok) {
      const t = await createRes.text().catch(() => '');
      return { ok: false, stage: 'create', error: 'POST /web_api/workato_db/tables.json failed: HTTP ' + createRes.status + ' ' + t.slice(0, 400) };
    }
    const createJson = await createRes.json().catch(() => null);
    const created = createJson && createJson.result;
    if (!created || typeof created !== 'object') {
      return { ok: false, stage: 'create', error: 'create response missing result object: ' + JSON.stringify(createJson).slice(0, 400) };
    }
    const newId = created.id || created.table_id;
    if (typeof newId !== 'string' || newId.length === 0) {
      return { ok: false, stage: 'create', error: 'create response missing id/table_id (got ' + JSON.stringify(created).slice(0, 200) + ')' };
    }

    // Step 2 (optional): add user columns via full-schema PUT.
    let finalColumns = null;
    if (Array.isArray(userColumns) && userColumns.length > 0) {
      const fresh = await getTable(newId);
      if (!fresh.ok) return fresh;
      const existing = Array.isArray(fresh.result.schema) ? fresh.result.schema : [];
      // Keep system columns verbatim (including their server-allocated UUIDs);
      // append user columns with only {type,title} so the server assigns ids.
      const next = existing.slice();
      for (let i = 0; i < userColumns.length; i++) {
        const col = userColumns[i] || {};
        const title = typeof col.name === 'string' ? col.name : null;
        if (!title) continue;
        const type = (typeof col.type === 'string' && col.type.length > 0) ? col.type : 'short-text';
        next.push({ type: type, title: title });
      }
      const pr = await putSchema(newId, next, csrf);
      if (!pr.ok) return pr;
      const map = labelMapFromSchema(Array.isArray(pr.result.schema) ? pr.result.schema : []);
      finalColumns = map.columns.filter((c) => !isSystemTitle(c.name));
    } else {
      // No user columns requested — return just the system columns hidden.
      const fresh = await getTable(newId);
      if (fresh.ok) {
        const map = labelMapFromSchema(Array.isArray(fresh.result.schema) ? fresh.result.schema : []);
        finalColumns = map.columns.filter((c) => !isSystemTitle(c.name));
      } else {
        finalColumns = [];
      }
    }

    return {
      ok: true,
      table_id: newId,
      name: created.name || name,
      folder_id: created.folder_id || folderId,
      columns: finalColumns,
    };
  } catch (e) {
    return { ok: false, stage: 'exception', error: String(e && e.message || e) };
  }
})
`;

class WorkatoDataTableCreateImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_DATA_TABLE.TABLE_CREATE;

  async execute(args: DataTableCreateArgs): Promise<ToolResult> {
    console.log('[workato-data-table] table_create requested:', args);
    try {
      if (typeof args?.name !== 'string' || args.name.length === 0) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': name (non-empty string) is required',
        );
      }
      if (typeof args?.folder_id !== 'number' || !Number.isFinite(args.folder_id)) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': folder_id (number) is required',
        );
      }
      // Validate types if provided.
      const userColumns: Array<{ name: string; type?: string }> = [];
      if (Array.isArray(args.columns)) {
        for (const c of args.columns) {
          if (!c || typeof c !== 'object' || typeof c.name !== 'string' || c.name.length === 0) {
            return createErrorResponse(
              ERROR_MESSAGES.INVALID_PARAMETERS +
                ': each column requires a non-empty `name` string',
            );
          }
          if (SYSTEM_COLUMN_TITLES.includes(c.name as (typeof SYSTEM_COLUMN_TITLES)[number])) {
            return createErrorResponse(
              ERROR_MESSAGES.INVALID_PARAMETERS +
                `: cannot create user column named "${c.name}" (reserved system column)`,
            );
          }
          if (
            typeof c.type === 'string' &&
            c.type.length > 0 &&
            !ALLOWED_COLUMN_TYPES.has(c.type)
          ) {
            return createErrorResponse(
              ERROR_MESSAGES.INVALID_PARAMETERS +
                `: unknown column type "${c.type}" (allowed: ${Array.from(ALLOWED_COLUMN_TYPES).join(', ')})`,
            );
          }
          userColumns.push({ name: c.name, type: typeof c.type === 'string' ? c.type : undefined });
        }
      }

      const tabId = await resolveTabId(args);
      await ensureAttached(tabId);
      const url = await getTabUrl(tabId);
      if (!ensureWorkato(url)) {
        return createErrorResponse(
          `workato_data_table_create: active tab is not a Workato page (url=${url}).`,
        );
      }

      const expr = `(${CREATE_TABLE_PAGE_FN})(${JSON.stringify(args.name)}, ${JSON.stringify(args.folder_id)}, ${JSON.stringify(userColumns)})`;
      const result = await evaluateInPage<{
        ok: boolean;
        stage?: string;
        error?: string;
        table_id?: string;
        name?: string;
        folder_id?: number;
        columns?: Array<Record<string, unknown>>;
      }>(tabId, expr, { awaitPromise: true });

      if (!result?.ok) {
        return createErrorResponse(
          `workato_data_table_create: ${result?.error ?? 'unknown error'}` +
            (result?.stage ? ` (stage=${result.stage})` : ''),
        );
      }
      const payload = {
        table_id: result.table_id,
        name: result.name,
        folder_id: result.folder_id,
        columns: result.columns ?? [],
      };
      return {
        content: [
          {
            type: 'text',
            text: `created data table ${result.table_id} "${result.name}" in folder ${result.folder_id}\n${JSON.stringify(payload)}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-data-table] table_create failed:', error);
      return createErrorResponse(
        `workato_data_table_create failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_data_table_rename
// ---------------------------------------------------------------------------

const RENAME_TABLE_PAGE_FN = `
(async (tableId, name) => {
  try {
    ${PAGE_HELPERS}
    const csrf = getCsrf();
    if (!csrf) {
      return { ok: false, stage: 'csrf', error: 'could not find CSRF token; ensure the active tab is a logged-in Workato page' };
    }
    const url = '/web_api/workato_db/tables/' + encodeURIComponent(tableId) + '.json';
    const res = await fetch(url, {
      method: 'PUT',
      credentials: 'include',
      headers: jsonHeaders(csrf),
      body: JSON.stringify({ name: name }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, stage: 'http', error: 'PUT ' + url + ' failed: HTTP ' + res.status + ' ' + t.slice(0, 400) };
    }
    const json = await res.json().catch(() => null);
    const r = json && json.result;
    if (!r || typeof r !== 'object') {
      return { ok: false, stage: 'parse', error: 'rename response missing result object' };
    }
    return { ok: true, table_id: r.id || r.table_id || tableId, name: r.name || name };
  } catch (e) {
    return { ok: false, stage: 'exception', error: String(e && e.message || e) };
  }
})
`;

class WorkatoDataTableRenameImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_DATA_TABLE.TABLE_RENAME;

  async execute(args: DataTableRenameArgs): Promise<ToolResult> {
    console.log('[workato-data-table] table_rename requested:', args);
    try {
      if (typeof args?.table_id !== 'string' || args.table_id.length === 0) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': table_id (string) is required',
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
      if (!ensureWorkato(url)) {
        return createErrorResponse(
          `workato_data_table_rename: active tab is not a Workato page (url=${url}).`,
        );
      }

      const expr = `(${RENAME_TABLE_PAGE_FN})(${JSON.stringify(args.table_id)}, ${JSON.stringify(args.name)})`;
      const result = await evaluateInPage<{
        ok: boolean;
        stage?: string;
        error?: string;
        table_id?: string;
        name?: string;
      }>(tabId, expr, { awaitPromise: true });

      if (!result?.ok) {
        return createErrorResponse(
          `workato_data_table_rename: ${result?.error ?? 'unknown error'}` +
            (result?.stage ? ` (stage=${result.stage})` : ''),
        );
      }
      const payload = { table_id: result.table_id, name: result.name };
      return {
        content: [
          {
            type: 'text',
            text: `renamed data table ${result.table_id} to "${result.name}"\n${JSON.stringify(payload)}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-data-table] table_rename failed:', error);
      return createErrorResponse(
        `workato_data_table_rename failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_data_table_delete
// ---------------------------------------------------------------------------

const DELETE_TABLE_PAGE_FN = `
(async (tableId) => {
  try {
    ${PAGE_HELPERS}
    const csrf = getCsrf();
    if (!csrf) {
      return { ok: false, stage: 'csrf', error: 'could not find CSRF token; ensure the active tab is a logged-in Workato page' };
    }
    const url = '/web_api/workato_db/tables/' + encodeURIComponent(tableId) + '.json';
    const res = await fetch(url, {
      method: 'DELETE',
      credentials: 'include',
      headers: plainHeaders(csrf),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, stage: 'http', error: 'DELETE ' + url + ' failed: HTTP ' + res.status + ' ' + t.slice(0, 400) };
    }
    return { ok: true, table_id: tableId };
  } catch (e) {
    return { ok: false, stage: 'exception', error: String(e && e.message || e) };
  }
})
`;

class WorkatoDataTableDeleteImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_DATA_TABLE.TABLE_DELETE;

  async execute(args: DataTableDeleteArgs): Promise<ToolResult> {
    console.log('[workato-data-table] table_delete requested:', args);
    try {
      if (typeof args?.table_id !== 'string' || args.table_id.length === 0) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': table_id (string) is required',
        );
      }
      const tabId = await resolveTabId(args);
      await ensureAttached(tabId);
      const url = await getTabUrl(tabId);
      if (!ensureWorkato(url)) {
        return createErrorResponse(
          `workato_data_table_delete: active tab is not a Workato page (url=${url}).`,
        );
      }

      const expr = `(${DELETE_TABLE_PAGE_FN})(${JSON.stringify(args.table_id)})`;
      const result = await evaluateInPage<{
        ok: boolean;
        stage?: string;
        error?: string;
        table_id?: string;
      }>(tabId, expr, { awaitPromise: true });

      if (!result?.ok) {
        return createErrorResponse(
          `workato_data_table_delete: ${result?.error ?? 'unknown error'}` +
            (result?.stage ? ` (stage=${result.stage})` : ''),
        );
      }
      const payload = { table_id: result.table_id, deleted: true };
      return {
        content: [
          {
            type: 'text',
            text: `deleted data table ${result.table_id}\n${JSON.stringify(payload)}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-data-table] table_delete failed:', error);
      return createErrorResponse(
        `workato_data_table_delete failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_data_table_add_column
// ---------------------------------------------------------------------------

const ADD_COLUMN_PAGE_FN = `
(async (tableId, columnName, columnType) => {
  try {
    ${PAGE_HELPERS}
    const csrf = getCsrf();
    if (!csrf) {
      return { ok: false, stage: 'csrf', error: 'could not find CSRF token; ensure the active tab is a logged-in Workato page' };
    }
    const fresh = await getTable(tableId);
    if (!fresh.ok) return fresh;
    const schema = Array.isArray(fresh.result.schema) ? fresh.result.schema.slice() : [];
    // Reject conflicts with existing column titles.
    for (let i = 0; i < schema.length; i++) {
      const c = schema[i];
      if (c && typeof c.title === 'string' && c.title === columnName) {
        return { ok: false, stage: 'conflict', error: 'column "' + columnName + '" already exists on this table' };
      }
    }
    const type = (typeof columnType === 'string' && columnType.length > 0) ? columnType : 'short-text';
    schema.push({ type: type, title: columnName });
    const pr = await putSchema(tableId, schema, csrf);
    if (!pr.ok) return pr;
    const map = labelMapFromSchema(Array.isArray(pr.result.schema) ? pr.result.schema : []);
    const added = map.columns.find((c) => c.name === columnName) || null;
    return {
      ok: true,
      table_id: tableId,
      column_id: added ? added.id : null,
      name: columnName,
      type: added ? added.type : type,
    };
  } catch (e) {
    return { ok: false, stage: 'exception', error: String(e && e.message || e) };
  }
})
`;

class WorkatoDataTableAddColumnImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_DATA_TABLE.ADD_COLUMN;

  async execute(args: DataTableAddColumnArgs): Promise<ToolResult> {
    console.log('[workato-data-table] add_column requested:', args);
    try {
      if (typeof args?.table_id !== 'string' || args.table_id.length === 0) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': table_id (string) is required',
        );
      }
      if (typeof args?.name !== 'string' || args.name.length === 0) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': name (non-empty string) is required',
        );
      }
      if (SYSTEM_COLUMN_TITLES.includes(args.name as (typeof SYSTEM_COLUMN_TITLES)[number])) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS +
            `: cannot add column named "${args.name}" (reserved system column)`,
        );
      }
      const type = typeof args.type === 'string' && args.type.length > 0 ? args.type : 'short-text';
      if (!ALLOWED_COLUMN_TYPES.has(type)) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS +
            `: unknown column type "${type}" (allowed: ${Array.from(ALLOWED_COLUMN_TYPES).join(', ')})`,
        );
      }

      const tabId = await resolveTabId(args);
      await ensureAttached(tabId);
      const url = await getTabUrl(tabId);
      if (!ensureWorkato(url)) {
        return createErrorResponse(
          `workato_data_table_add_column: active tab is not a Workato page (url=${url}).`,
        );
      }

      const expr = `(${ADD_COLUMN_PAGE_FN})(${JSON.stringify(args.table_id)}, ${JSON.stringify(args.name)}, ${JSON.stringify(type)})`;
      const result = await evaluateInPage<{
        ok: boolean;
        stage?: string;
        error?: string;
        table_id?: string;
        column_id?: string | null;
        name?: string;
        type?: string;
      }>(tabId, expr, { awaitPromise: true });

      if (!result?.ok) {
        return createErrorResponse(
          `workato_data_table_add_column: ${result?.error ?? 'unknown error'}` +
            (result?.stage ? ` (stage=${result.stage})` : ''),
        );
      }
      const payload = {
        table_id: result.table_id,
        column_id: result.column_id,
        name: result.name,
        type: result.type,
      };
      return {
        content: [
          {
            type: 'text',
            text: `added column "${result.name}" (${result.type}) to data table ${result.table_id}\n${JSON.stringify(payload)}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-data-table] add_column failed:', error);
      return createErrorResponse(
        `workato_data_table_add_column failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_data_table_update_column
// ---------------------------------------------------------------------------

const UPDATE_COLUMN_PAGE_FN = `
(async (tableId, columnName, columnId, newName, newType) => {
  try {
    ${PAGE_HELPERS}
    const csrf = getCsrf();
    if (!csrf) {
      return { ok: false, stage: 'csrf', error: 'could not find CSRF token; ensure the active tab is a logged-in Workato page' };
    }
    const fresh = await getTable(tableId);
    if (!fresh.ok) return fresh;
    const schema = Array.isArray(fresh.result.schema) ? fresh.result.schema.slice() : [];

    // Locate target by id (preferred) or by title.
    let idx = -1;
    for (let i = 0; i < schema.length; i++) {
      const c = schema[i];
      if (!c || typeof c !== 'object') continue;
      if (columnId && c.id === columnId) { idx = i; break; }
      if (!columnId && columnName && c.title === columnName) { idx = i; break; }
    }
    if (idx < 0) {
      return { ok: false, stage: 'lookup', error: 'column not found on table ' + tableId + ' (columnId=' + JSON.stringify(columnId) + ', columnName=' + JSON.stringify(columnName) + ')' };
    }
    const target = schema[idx];
    if (isSystemTitle(target.title)) {
      return { ok: false, stage: 'system', error: 'cannot modify system column "' + target.title + '"' };
    }

    // Check rename conflict.
    if (newName && newName !== target.title) {
      for (let i = 0; i < schema.length; i++) {
        if (i === idx) continue;
        const c = schema[i];
        if (c && typeof c.title === 'string' && c.title === newName) {
          return { ok: false, stage: 'conflict', error: 'column "' + newName + '" already exists on this table' };
        }
      }
    }

    // Mutate in place, preserving id and other server fields.
    const mutated = Object.assign({}, target);
    if (newName) mutated.title = newName;
    if (newType) mutated.type = newType;
    schema[idx] = mutated;

    const pr = await putSchema(tableId, schema, csrf);
    if (!pr.ok) return pr;
    const map = labelMapFromSchema(Array.isArray(pr.result.schema) ? pr.result.schema : []);
    const finalCol = map.columns.find((c) => c.id === target.id) || null;
    return {
      ok: true,
      table_id: tableId,
      column_id: target.id,
      name: finalCol ? finalCol.name : (newName || target.title),
      type: finalCol ? finalCol.type : (newType || target.type),
    };
  } catch (e) {
    return { ok: false, stage: 'exception', error: String(e && e.message || e) };
  }
})
`;

class WorkatoDataTableUpdateColumnImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_DATA_TABLE.UPDATE_COLUMN;

  async execute(args: DataTableUpdateColumnArgs): Promise<ToolResult> {
    console.log('[workato-data-table] update_column requested:', args);
    try {
      if (typeof args?.table_id !== 'string' || args.table_id.length === 0) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': table_id (string) is required',
        );
      }
      const hasId = typeof args?.column_id === 'string' && args.column_id.length > 0;
      const hasName = typeof args?.column_name === 'string' && args.column_name.length > 0;
      if (!hasId && !hasName) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS +
            ': provide column_id or column_name to identify the target column',
        );
      }
      const newName = typeof args?.name === 'string' && args.name.length > 0 ? args.name : null;
      const newType = typeof args?.type === 'string' && args.type.length > 0 ? args.type : null;
      if (!newName && !newType) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': at least one of `name` or `type` must be provided',
        );
      }
      if (
        newName &&
        SYSTEM_COLUMN_TITLES.includes(newName as (typeof SYSTEM_COLUMN_TITLES)[number])
      ) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS +
            `: cannot rename a column to "${newName}" (reserved system column)`,
        );
      }
      if (newType && !ALLOWED_COLUMN_TYPES.has(newType)) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS +
            `: unknown column type "${newType}" (allowed: ${Array.from(ALLOWED_COLUMN_TYPES).join(', ')})`,
        );
      }

      const tabId = await resolveTabId(args);
      await ensureAttached(tabId);
      const url = await getTabUrl(tabId);
      if (!ensureWorkato(url)) {
        return createErrorResponse(
          `workato_data_table_update_column: active tab is not a Workato page (url=${url}).`,
        );
      }

      const expr = `(${UPDATE_COLUMN_PAGE_FN})(${JSON.stringify(args.table_id)}, ${JSON.stringify(
        hasName ? args.column_name : null,
      )}, ${JSON.stringify(hasId ? args.column_id : null)}, ${JSON.stringify(newName)}, ${JSON.stringify(newType)})`;
      const result = await evaluateInPage<{
        ok: boolean;
        stage?: string;
        error?: string;
        table_id?: string;
        column_id?: string;
        name?: string;
        type?: string;
      }>(tabId, expr, { awaitPromise: true });

      if (!result?.ok) {
        return createErrorResponse(
          `workato_data_table_update_column: ${result?.error ?? 'unknown error'}` +
            (result?.stage ? ` (stage=${result.stage})` : ''),
        );
      }
      const payload = {
        table_id: result.table_id,
        column_id: result.column_id,
        name: result.name,
        type: result.type,
      };
      return {
        content: [
          {
            type: 'text',
            text: `updated column ${result.column_id} on data table ${result.table_id} (name="${result.name}", type="${result.type}")\n${JSON.stringify(payload)}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-data-table] update_column failed:', error);
      return createErrorResponse(
        `workato_data_table_update_column failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_data_table_delete_column
// ---------------------------------------------------------------------------

const DELETE_COLUMN_PAGE_FN = `
(async (tableId, columnName, columnId) => {
  try {
    ${PAGE_HELPERS}
    const csrf = getCsrf();
    if (!csrf) {
      return { ok: false, stage: 'csrf', error: 'could not find CSRF token; ensure the active tab is a logged-in Workato page' };
    }
    const fresh = await getTable(tableId);
    if (!fresh.ok) return fresh;
    const schema = Array.isArray(fresh.result.schema) ? fresh.result.schema.slice() : [];

    let idx = -1;
    for (let i = 0; i < schema.length; i++) {
      const c = schema[i];
      if (!c || typeof c !== 'object') continue;
      if (columnId && c.id === columnId) { idx = i; break; }
      if (!columnId && columnName && c.title === columnName) { idx = i; break; }
    }
    if (idx < 0) {
      return { ok: false, stage: 'lookup', error: 'column not found on table ' + tableId + ' (columnId=' + JSON.stringify(columnId) + ', columnName=' + JSON.stringify(columnName) + ')' };
    }
    const target = schema[idx];
    if (isSystemTitle(target.title)) {
      return { ok: false, stage: 'system', error: 'refusing to delete system column "' + target.title + '"' };
    }

    schema.splice(idx, 1);
    const pr = await putSchema(tableId, schema, csrf);
    if (!pr.ok) return pr;
    return { ok: true, table_id: tableId, column_id: target.id, name: target.title };
  } catch (e) {
    return { ok: false, stage: 'exception', error: String(e && e.message || e) };
  }
})
`;

class WorkatoDataTableDeleteColumnImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_DATA_TABLE.DELETE_COLUMN;

  async execute(args: DataTableDeleteColumnArgs): Promise<ToolResult> {
    console.log('[workato-data-table] delete_column requested:', args);
    try {
      if (typeof args?.table_id !== 'string' || args.table_id.length === 0) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': table_id (string) is required',
        );
      }
      const hasId = typeof args?.column_id === 'string' && args.column_id.length > 0;
      const hasName = typeof args?.column_name === 'string' && args.column_name.length > 0;
      if (!hasId && !hasName) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS +
            ': provide column_id or column_name to identify the target column',
        );
      }
      if (
        hasName &&
        SYSTEM_COLUMN_TITLES.includes(
          (args.column_name ?? '') as (typeof SYSTEM_COLUMN_TITLES)[number],
        )
      ) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS +
            `: refusing to delete system column "${args.column_name}"`,
        );
      }

      const tabId = await resolveTabId(args);
      await ensureAttached(tabId);
      const url = await getTabUrl(tabId);
      if (!ensureWorkato(url)) {
        return createErrorResponse(
          `workato_data_table_delete_column: active tab is not a Workato page (url=${url}).`,
        );
      }

      const expr = `(${DELETE_COLUMN_PAGE_FN})(${JSON.stringify(args.table_id)}, ${JSON.stringify(
        hasName ? args.column_name : null,
      )}, ${JSON.stringify(hasId ? args.column_id : null)})`;
      const result = await evaluateInPage<{
        ok: boolean;
        stage?: string;
        error?: string;
        table_id?: string;
        column_id?: string;
        name?: string;
      }>(tabId, expr, { awaitPromise: true });

      if (!result?.ok) {
        return createErrorResponse(
          `workato_data_table_delete_column: ${result?.error ?? 'unknown error'}` +
            (result?.stage ? ` (stage=${result.stage})` : ''),
        );
      }
      const payload = {
        table_id: result.table_id,
        column_id: result.column_id,
        name: result.name,
        deleted: true,
      };
      return {
        content: [
          {
            type: 'text',
            text: `deleted column "${result.name}" (${result.column_id}) from data table ${result.table_id}\n${JSON.stringify(payload)}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-data-table] delete_column failed:', error);
      return createErrorResponse(
        `workato_data_table_delete_column failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_data_table_row_list
// ---------------------------------------------------------------------------

const ROW_LIST_PAGE_FN = `
(async (tableId, orderByLabel, direction, limit, continuationToken) => {
  try {
    ${PAGE_HELPERS}
    const csrf = getCsrf();
    if (!csrf) {
      return { ok: false, stage: 'csrf', error: 'could not find CSRF token; ensure the active tab is a logged-in Workato page' };
    }
    const fresh = await getTable(tableId);
    if (!fresh.ok) return fresh;
    const schema = Array.isArray(fresh.result.schema) ? fresh.result.schema : [];
    const map = labelMapFromSchema(schema);

    const orderLabel = (typeof orderByLabel === 'string' && orderByLabel.length > 0) ? orderByLabel : 'Created time';
    const orderId = map.byLabel[orderLabel] || null;
    if (!orderId) {
      return { ok: false, stage: 'order_by', error: 'order_by_column "' + orderLabel + '" not found on table ' + tableId };
    }
    const dir = (direction === 'asc' || direction === 'desc') ? direction : 'desc';
    const lim = (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) ? limit : 100;

    const body = { order_by: orderId, direction: dir, limit: lim };
    if (typeof continuationToken === 'string' && continuationToken.length > 0) {
      body.continuation_token = continuationToken;
    }

    const url = '/web_api/workato_db/tables/' + encodeURIComponent(tableId) + '/records/query.json';
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: jsonHeaders(csrf),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, stage: 'http', error: 'POST ' + url + ' failed: HTTP ' + res.status + ' ' + t.slice(0, 400) };
    }
    const json = await res.json().catch(() => null);
    if (!json || typeof json !== 'object') {
      return { ok: false, stage: 'parse', error: 'query response not JSON' };
    }
    // Some responses nest under .result; query endpoint returns at top level.
    const payload = (json && typeof json === 'object' && 'records' in json) ? json : (json.result || {});
    const records = Array.isArray(payload.records) ? payload.records : [];
    const rows = records.map((rec) => rowToLabeled(rec, map.byCol, map.recordIdColumnId));
    return {
      ok: true,
      rows: rows,
      count: payload.count,
      limit: payload.limit || lim,
      continuation_token: payload.continuation_token || null,
    };
  } catch (e) {
    return { ok: false, stage: 'exception', error: String(e && e.message || e) };
  }
})
`;

class WorkatoDataTableRowListImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_DATA_TABLE.ROW_LIST;

  async execute(args: DataTableRowListArgs): Promise<ToolResult> {
    console.log('[workato-data-table] row_list requested:', args);
    try {
      if (typeof args?.table_id !== 'string' || args.table_id.length === 0) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': table_id (string) is required',
        );
      }
      const tabId = await resolveTabId(args);
      await ensureAttached(tabId);
      const url = await getTabUrl(tabId);
      if (!ensureWorkato(url)) {
        return createErrorResponse(
          `workato_data_table_row_list: active tab is not a Workato page (url=${url}).`,
        );
      }

      const expr = `(${ROW_LIST_PAGE_FN})(${JSON.stringify(args.table_id)}, ${JSON.stringify(
        typeof args.order_by_column === 'string' ? args.order_by_column : null,
      )}, ${JSON.stringify(args.direction === 'asc' || args.direction === 'desc' ? args.direction : null)}, ${JSON.stringify(
        typeof args.limit === 'number' ? args.limit : null,
      )}, ${JSON.stringify(typeof args.continuation_token === 'string' ? args.continuation_token : null)})`;
      const result = await evaluateInPage<{
        ok: boolean;
        stage?: string;
        error?: string;
        rows?: Array<Record<string, unknown>>;
        count?: number;
        limit?: number;
        continuation_token?: string | null;
      }>(tabId, expr, { awaitPromise: true });

      if (!result?.ok) {
        return createErrorResponse(
          `workato_data_table_row_list: ${result?.error ?? 'unknown error'}` +
            (result?.stage ? ` (stage=${result.stage})` : ''),
        );
      }
      const rowCount = Array.isArray(result.rows) ? result.rows.length : 0;
      const payload = {
        rows: result.rows ?? [],
        count: result.count ?? null,
        limit: result.limit ?? null,
        continuation_token: result.continuation_token ?? null,
      };
      return {
        content: [
          {
            type: 'text',
            text: `listed ${rowCount} row${rowCount === 1 ? '' : 's'} from data table ${args.table_id}\n${JSON.stringify(payload)}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-data-table] row_list failed:', error);
      return createErrorResponse(
        `workato_data_table_row_list failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_data_table_row_create
// ---------------------------------------------------------------------------

const ROW_CREATE_PAGE_FN = `
(async (tableId, rowLabeled) => {
  try {
    ${PAGE_HELPERS}
    const csrf = getCsrf();
    if (!csrf) {
      return { ok: false, stage: 'csrf', error: 'could not find CSRF token; ensure the active tab is a logged-in Workato page' };
    }
    const fresh = await getTable(tableId);
    if (!fresh.ok) return fresh;
    const schema = Array.isArray(fresh.result.schema) ? fresh.result.schema : [];
    const map = labelMapFromSchema(schema);

    const body = rowFromLabeled(rowLabeled, map.byLabel);
    const url = '/web_api/workato_db/tables/' + encodeURIComponent(tableId) + '/records.json';
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: jsonHeaders(csrf),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, stage: 'http', error: 'POST ' + url + ' failed: HTTP ' + res.status + ' ' + t.slice(0, 400) };
    }
    const json = await res.json().catch(() => null);
    const rec = (json && json.result) || json;
    if (!rec || typeof rec !== 'object') {
      return { ok: false, stage: 'parse', error: 'create-row response missing result object' };
    }
    const labeled = rowToLabeled(rec, map.byCol, map.recordIdColumnId);
    const recordId = map.recordIdColumnId ? rec[map.recordIdColumnId] : null;
    return {
      ok: true,
      table_id: tableId,
      record_id: recordId,
      row: labeled,
    };
  } catch (e) {
    return { ok: false, stage: 'exception', error: String(e && e.message || e) };
  }
})
`;

class WorkatoDataTableRowCreateImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_DATA_TABLE.ROW_CREATE;

  async execute(args: DataTableRowCreateArgs): Promise<ToolResult> {
    console.log('[workato-data-table] row_create requested:', args);
    try {
      if (typeof args?.table_id !== 'string' || args.table_id.length === 0) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': table_id (string) is required',
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
      if (!ensureWorkato(url)) {
        return createErrorResponse(
          `workato_data_table_row_create: active tab is not a Workato page (url=${url}).`,
        );
      }

      const expr = `(${ROW_CREATE_PAGE_FN})(${JSON.stringify(args.table_id)}, ${JSON.stringify(args.row)})`;
      const result = await evaluateInPage<{
        ok: boolean;
        stage?: string;
        error?: string;
        table_id?: string;
        record_id?: string | null;
        row?: Record<string, unknown>;
      }>(tabId, expr, { awaitPromise: true });

      if (!result?.ok) {
        return createErrorResponse(
          `workato_data_table_row_create: ${result?.error ?? 'unknown error'}` +
            (result?.stage ? ` (stage=${result.stage})` : ''),
        );
      }
      const payload = { table_id: result.table_id, record_id: result.record_id, row: result.row };
      return {
        content: [
          {
            type: 'text',
            text: `created row ${result.record_id} in data table ${result.table_id}\n${JSON.stringify(payload)}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-data-table] row_create failed:', error);
      return createErrorResponse(
        `workato_data_table_row_create failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_data_table_row_update — endpoint inferred; verify on smoke test.
// ---------------------------------------------------------------------------

const ROW_UPDATE_PAGE_FN = `
(async (tableId, recordId, rowLabeled) => {
  try {
    ${PAGE_HELPERS}
    const csrf = getCsrf();
    if (!csrf) {
      return { ok: false, stage: 'csrf', error: 'could not find CSRF token; ensure the active tab is a logged-in Workato page' };
    }
    const fresh = await getTable(tableId);
    if (!fresh.ok) return fresh;
    const schema = Array.isArray(fresh.result.schema) ? fresh.result.schema : [];
    const map = labelMapFromSchema(schema);

    const body = rowFromLabeled(rowLabeled, map.byLabel);
    const url = '/web_api/workato_db/tables/' + encodeURIComponent(tableId) + '/records/' + encodeURIComponent(recordId) + '.json';
    const res = await fetch(url, {
      method: 'PUT',
      credentials: 'include',
      headers: jsonHeaders(csrf),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, stage: 'http', error: 'PUT ' + url + ' failed: HTTP ' + res.status + ' ' + t.slice(0, 400) };
    }
    const json = await res.json().catch(() => null);
    const rec = (json && json.result) || json || {};
    const labeled = rowToLabeled(rec, map.byCol, map.recordIdColumnId);
    return {
      ok: true,
      table_id: tableId,
      record_id: recordId,
      row: labeled,
    };
  } catch (e) {
    return { ok: false, stage: 'exception', error: String(e && e.message || e) };
  }
})
`;

class WorkatoDataTableRowUpdateImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_DATA_TABLE.ROW_UPDATE;

  async execute(args: DataTableRowUpdateArgs): Promise<ToolResult> {
    console.log('[workato-data-table] row_update requested:', args);
    try {
      if (typeof args?.table_id !== 'string' || args.table_id.length === 0) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': table_id (string) is required',
        );
      }
      if (typeof args?.record_id !== 'string' || args.record_id.length === 0) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': record_id (string) is required',
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
      if (!ensureWorkato(url)) {
        return createErrorResponse(
          `workato_data_table_row_update: active tab is not a Workato page (url=${url}).`,
        );
      }

      const expr = `(${ROW_UPDATE_PAGE_FN})(${JSON.stringify(args.table_id)}, ${JSON.stringify(args.record_id)}, ${JSON.stringify(args.row)})`;
      const result = await evaluateInPage<{
        ok: boolean;
        stage?: string;
        error?: string;
        table_id?: string;
        record_id?: string;
        row?: Record<string, unknown>;
      }>(tabId, expr, { awaitPromise: true });

      if (!result?.ok) {
        return createErrorResponse(
          `workato_data_table_row_update: ${result?.error ?? 'unknown error'}` +
            (result?.stage ? ` (stage=${result.stage})` : ''),
        );
      }
      const payload = { table_id: result.table_id, record_id: result.record_id, row: result.row };
      return {
        content: [
          {
            type: 'text',
            text: `updated row ${result.record_id} in data table ${result.table_id}\n${JSON.stringify(payload)}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-data-table] row_update failed:', error);
      return createErrorResponse(
        `workato_data_table_row_update failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_data_table_row_delete
// ---------------------------------------------------------------------------

const ROW_DELETE_PAGE_FN = `
(async (tableId, recordIds) => {
  try {
    ${PAGE_HELPERS}
    const csrf = getCsrf();
    if (!csrf) {
      return { ok: false, stage: 'csrf', error: 'could not find CSRF token; ensure the active tab is a logged-in Workato page' };
    }
    const url = '/web_api/workato_db/tables/' + encodeURIComponent(tableId) + '/records/delete_batch.json';
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: jsonHeaders(csrf),
      body: JSON.stringify({ record_ids: recordIds }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, stage: 'http', error: 'POST ' + url + ' failed: HTTP ' + res.status + ' ' + t.slice(0, 400) };
    }
    return { ok: true, table_id: tableId, record_ids: recordIds };
  } catch (e) {
    return { ok: false, stage: 'exception', error: String(e && e.message || e) };
  }
})
`;

class WorkatoDataTableRowDeleteImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_DATA_TABLE.ROW_DELETE;

  async execute(args: DataTableRowDeleteArgs): Promise<ToolResult> {
    console.log('[workato-data-table] row_delete requested:', args);
    try {
      if (typeof args?.table_id !== 'string' || args.table_id.length === 0) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': table_id (string) is required',
        );
      }
      const raw = args?.record_ids;
      const ids: string[] = Array.isArray(raw)
        ? raw.filter((x): x is string => typeof x === 'string' && x.length > 0)
        : typeof raw === 'string' && raw.length > 0
          ? [raw]
          : [];
      if (ids.length === 0) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS +
            ': record_ids (string or non-empty string[]) is required',
        );
      }

      const tabId = await resolveTabId(args);
      await ensureAttached(tabId);
      const url = await getTabUrl(tabId);
      if (!ensureWorkato(url)) {
        return createErrorResponse(
          `workato_data_table_row_delete: active tab is not a Workato page (url=${url}).`,
        );
      }

      const expr = `(${ROW_DELETE_PAGE_FN})(${JSON.stringify(args.table_id)}, ${JSON.stringify(ids)})`;
      const result = await evaluateInPage<{
        ok: boolean;
        stage?: string;
        error?: string;
        table_id?: string;
        record_ids?: string[];
      }>(tabId, expr, { awaitPromise: true });

      if (!result?.ok) {
        return createErrorResponse(
          `workato_data_table_row_delete: ${result?.error ?? 'unknown error'}` +
            (result?.stage ? ` (stage=${result.stage})` : ''),
        );
      }
      const payload = {
        table_id: result.table_id,
        record_ids: result.record_ids ?? ids,
        deleted: true,
      };
      return {
        content: [
          {
            type: 'text',
            text: `deleted ${ids.length} row${ids.length === 1 ? '' : 's'} from data table ${result.table_id}\n${JSON.stringify(payload)}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-data-table] row_delete failed:', error);
      return createErrorResponse(
        `workato_data_table_row_delete failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Exports — runtime instances (tools/index.ts reads `.name`).
// ---------------------------------------------------------------------------

export const WorkatoDataTablesListTool = new WorkatoDataTablesListImpl();
export const WorkatoDataTableGetTool = new WorkatoDataTableGetImpl();
export const WorkatoDataTableCreateTool = new WorkatoDataTableCreateImpl();
export const WorkatoDataTableRenameTool = new WorkatoDataTableRenameImpl();
export const WorkatoDataTableDeleteTool = new WorkatoDataTableDeleteImpl();
export const WorkatoDataTableAddColumnTool = new WorkatoDataTableAddColumnImpl();
export const WorkatoDataTableUpdateColumnTool = new WorkatoDataTableUpdateColumnImpl();
export const WorkatoDataTableDeleteColumnTool = new WorkatoDataTableDeleteColumnImpl();
export const WorkatoDataTableRowListTool = new WorkatoDataTableRowListImpl();
export const WorkatoDataTableRowCreateTool = new WorkatoDataTableRowCreateImpl();
export const WorkatoDataTableRowUpdateTool = new WorkatoDataTableRowUpdateImpl();
export const WorkatoDataTableRowDeleteTool = new WorkatoDataTableRowDeleteImpl();
