/**
 * workato_recipe_* — high-level recipe mutators.
 *
 * Each tool performs one logical change to a recipe's code tree via a single
 * GET-mutate-PUT round-trip in the page context of the active Workato tab:
 *
 *   1. GET /recipes/<id>/code.json?mode=view -> parse `result` as the code tree
 *   2. mutate (insert step / set field / map datapill)
 *   3. PUT /recipes/<id>.json with {flow: {code: <stringified>, config: <stringified>}}
 *
 * Auth re-uses the user's session cookie + CSRF read from the XSRF-TOKEN-V2
 * cookie — identical to CREATE_RECIPE_PAGE_FN / SAVE_RECIPE_CODE_PAGE_FN in
 * ../workato-ui/handlers.ts.
 *
 * Spec source: prompt — Workato recipe-mutator tool family v1.
 */

import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { ERROR_MESSAGES } from '@/common/constants';
import { TOOL_NAMES } from 'workatomcp-shared';
import { BaseBrowserToolExecutor } from '../base-browser';
import { ensureAttached } from '../browser/snapshot/debugger-session';
import { evaluateInPage, getTabUrl, resolveTabId } from '../workato-ui/dom-helpers';
import type { RecipeAddStepArgs, RecipeMapDatapillArgs, RecipeSetStepInputArgs } from './types';

// ---------------------------------------------------------------------------
// Shared page-side helpers (embedded as a string fragment into each IIFE).
//
// These build the readCookie() and CSRF lookup, plus pull-and-PUT helpers
// that every mutator uses. Kept as a single template-literal block so each
// tool's IIFE is self-contained — no extra evaluation round trips.
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
async function pullRecipeCode(recipeId) {
  const res = await fetch('/recipes/' + recipeId + '/code.json?mode=view', {
    method: 'GET',
    credentials: 'include',
    headers: { 'accept': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return { ok: false, stage: 'pull', error: 'GET /recipes/' + recipeId + '/code.json failed: HTTP ' + res.status + ' ' + t.slice(0, 400) };
  }
  const json = await res.json().catch(() => null);
  if (!json) {
    return { ok: false, stage: 'pull', error: 'pull response was not JSON' };
  }
  // Response shape: { result: "<JSON-stringified code tree>", ... } OR direct object.
  let codeStr = null;
  if (typeof json.result === 'string') {
    codeStr = json.result;
  } else if (json.result && typeof json.result === 'object') {
    return { ok: true, code: json.result, raw: json };
  } else if (typeof json.code === 'string') {
    codeStr = json.code;
  } else if (json.code && typeof json.code === 'object') {
    return { ok: true, code: json.code, raw: json };
  }
  if (!codeStr) {
    return { ok: false, stage: 'pull', error: 'pull response missing code: ' + JSON.stringify(json).slice(0, 400) };
  }
  let code;
  try { code = JSON.parse(codeStr); } catch (e) {
    return { ok: false, stage: 'pull', error: 'could not parse code JSON: ' + String(e && e.message || e) };
  }
  return { ok: true, code, raw: json };
}
function randomAs() {
  const bytes = new Uint8Array(4);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    const h = bytes[i].toString(16);
    s += h.length === 1 ? '0' + h : h;
  }
  return s;
}
function newUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
function collectProviders(code) {
  // Walk the code tree and collect every distinct provider used by the
  // trigger and every action in any nested block.
  const seen = new Set();
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (typeof node.provider === 'string' && node.provider.length > 0) seen.add(node.provider);
    if (Array.isArray(node.block)) for (const child of node.block) visit(child);
  }
  visit(code);
  const out = [];
  for (const name of seen) {
    out.push({ keyword: 'application', name: name, provider: name, skip_validation: false });
  }
  return out;
}
function renumberBlock(block, start) {
  if (!Array.isArray(block)) return;
  let n = start;
  for (let i = 0; i < block.length; i++) {
    if (block[i] && typeof block[i] === 'object') {
      block[i].number = n;
      n += 1;
    }
  }
}
function findStepRef(code, ref) {
  // Accepts a step number (0 = trigger/root) or an 'as' anchor string.
  // Recurses into nested blocks (if/foreach/try...), unlike the old
  // top-level-only lookup that made nested steps unreachable.
  if (ref === 0 || ref === '0') return code;
  const wantNumber = typeof ref === 'number' ? ref
    : (typeof ref === 'string' && /^[0-9]+$/.test(ref)) ? Number(ref) : null;
  const wantAs = typeof ref === 'string' && !/^[0-9]+$/.test(ref) ? ref : null;
  function visit(node) {
    if (!node || typeof node !== 'object') return null;
    if (wantNumber !== null && node.number === wantNumber) return node;
    if (wantAs !== null && node.as === wantAs) return node;
    if (Array.isArray(node.block)) {
      for (let i = 0; i < node.block.length; i++) {
        const found = visit(node.block[i]);
        if (found) return found;
      }
    }
    return null;
  }
  if (wantAs !== null && code && code.as === wantAs) return code;
  if (Array.isArray(code && code.block)) {
    for (let i = 0; i < code.block.length; i++) {
      const found = visit(code.block[i]);
      if (found) return found;
    }
  }
  return null;
}
function findStepByNumber(code, stepNumber) {
  return findStepRef(code, stepNumber);
}
function parsePathSegs(path) {
  // 'a.b[0].c' -> ['a', 'b', 0, 'c']. Plain field names pass through as [name].
  const segs = [];
  let token = '';
  for (let i = 0; i < path.length; i++) {
    const ch = path[i];
    if (ch === '.') {
      if (token) { segs.push(token); token = ''; }
      continue;
    }
    if (ch === '[') {
      if (token) { segs.push(token); token = ''; }
      const end = path.indexOf(']', i + 1);
      if (end < 0) throw new Error('unclosed [ in path: ' + path);
      const raw = path.slice(i + 1, end);
      if (!/^[0-9]+$/.test(raw)) throw new Error('invalid array index in path: ' + path);
      segs.push(Number(raw));
      i = end;
      continue;
    }
    token += ch;
  }
  if (token) segs.push(token);
  if (!segs.length) throw new Error('empty path');
  return segs;
}
function setAtPath(root, segs, value) {
  let cur = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const k = segs[i];
    const nxt = segs[i + 1];
    let child = cur[k];
    if (child === undefined || child === null) {
      child = typeof nxt === 'number' ? [] : {};
      cur[k] = child;
    }
    if (typeof child !== 'object') {
      throw new Error('path segment "' + k + '" exists but is not an object/array');
    }
    cur = child;
  }
  cur[segs[segs.length - 1]] = value;
}
async function putRecipe(recipeId, code, config) {
  const csrf = getCsrf();
  if (!csrf) {
    return { ok: false, stage: 'csrf', error: 'could not find CSRF token in XSRF-TOKEN-V2 cookie or meta tag; ensure the active tab is a logged-in Workato page' };
  }
  const res = await fetch('/recipes/' + recipeId + '.json', {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-csrf-token': csrf,
      'x-requested-with': 'XMLHttpRequest',
      'accept': 'application/json',
    },
    body: JSON.stringify({ flow: { code: JSON.stringify(code), config: JSON.stringify(config) } }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return { ok: false, stage: 'http', error: 'PUT /recipes/' + recipeId + '.json failed: HTTP ' + res.status + ' ' + t.slice(0, 500) };
  }
  const json = await res.json().catch(() => null);
  const flow = json && json.result && json.result.flow;
  if (!flow) {
    return { ok: false, stage: 'parse', error: 'save response missing result.flow: ' + JSON.stringify(json).slice(0, 400) };
  }
  return {
    ok: true,
    version_no: flow.version_no,
    updated_at: flow.updated_at,
    code_errors: Array.isArray(flow.code_errors) ? flow.code_errors : [],
  };
}
`;

// ---------------------------------------------------------------------------
// workato_recipe_add_step
// ---------------------------------------------------------------------------

const ADD_STEP_PAGE_FN = `
(async (recipeId, afterStep, provider, actionName, inputObj, keyword) => {
  try {
    ${PAGE_HELPERS}
    const pulled = await pullRecipeCode(recipeId);
    if (!pulled.ok) return pulled;
    const code = pulled.code;
    if (!code || typeof code !== 'object') {
      return { ok: false, stage: 'pull', error: 'pulled code was not an object' };
    }
    if (!Array.isArray(code.block)) code.block = [];

    const newStep = {
      as: randomAs(),
      description: null,
      input: (inputObj && typeof inputObj === 'object') ? inputObj : {},
      keyword: keyword || 'action',
      name: actionName,
      number: 0, // re-numbered below
      provider: provider,
      title: null,
      uuid: newUuid(),
    };

    let insertIndex;
    if (afterStep === 0) {
      insertIndex = 0;
    } else {
      let foundAt = -1;
      for (let i = 0; i < code.block.length; i++) {
        if (code.block[i] && code.block[i].number === afterStep) { foundAt = i; break; }
      }
      if (foundAt < 0) {
        return { ok: false, stage: 'locate', error: 'after_step ' + afterStep + ' not found in recipe block' };
      }
      insertIndex = foundAt + 1;
    }
    code.block.splice(insertIndex, 0, newStep);

    // Workato numbers the trigger as 0 and the first action as 1 — so the
    // block (which holds only actions/control-flow) is renumbered from 1.
    renumberBlock(code.block, 1);

    const config = collectProviders(code);

    const saved = await putRecipe(recipeId, code, config);
    if (!saved.ok) return saved;
    return {
      ok: true,
      recipe_id: recipeId,
      version_no: saved.version_no,
      updated_at: saved.updated_at,
      new_step_number: newStep.number,
      new_step_as: newStep.as,
      code_errors: saved.code_errors,
    };
  } catch (e) {
    return { ok: false, stage: 'exception', error: String(e && e.message || e) };
  }
})
`;

class WorkatoRecipeAddStepImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_RECIPE.ADD_STEP;

  async execute(args: RecipeAddStepArgs): Promise<ToolResult> {
    console.log('[workato-recipe] add_step requested:', args);
    try {
      if (typeof args?.recipe_id !== 'number' || !Number.isFinite(args.recipe_id)) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': recipe_id (number) is required',
        );
      }
      if (typeof args.after_step !== 'number' || !Number.isFinite(args.after_step)) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': after_step (number) is required',
        );
      }
      if (typeof args.provider !== 'string' || args.provider.length === 0) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': provider (string) is required',
        );
      }
      if (typeof args.action_name !== 'string' || args.action_name.length === 0) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': action_name (string) is required',
        );
      }

      const tabId = await resolveTabId(args);
      await ensureAttached(tabId);

      const url = await getTabUrl(tabId);
      if (!/workato\.(com|is)/.test(url)) {
        return createErrorResponse(
          `workato_recipe_add_step: active tab is not a Workato page (url=${url}). ` +
            `Open a Workato tab and sign in first.`,
        );
      }

      const expr =
        `(${ADD_STEP_PAGE_FN})(` +
        `${JSON.stringify(args.recipe_id)}, ` +
        `${JSON.stringify(args.after_step)}, ` +
        `${JSON.stringify(args.provider)}, ` +
        `${JSON.stringify(args.action_name)}, ` +
        `${JSON.stringify(args.input ?? {})}, ` +
        `${JSON.stringify(args.keyword ?? 'action')}` +
        `)`;

      const result = await evaluateInPage<{
        ok: boolean;
        stage?: string;
        error?: string;
        recipe_id?: number;
        version_no?: number;
        updated_at?: string;
        new_step_number?: number;
        new_step_as?: string;
        code_errors?: unknown[];
      }>(tabId, expr, { awaitPromise: true });

      if (!result?.ok) {
        return createErrorResponse(
          `workato_recipe_add_step: ${result?.error ?? 'unknown error'}` +
            (result?.stage ? ` (stage=${result.stage})` : ''),
        );
      }

      const errCount = Array.isArray(result.code_errors) ? result.code_errors.length : 0;
      const payload = {
        ok: true,
        recipe_id: result.recipe_id,
        version_no: result.version_no,
        new_step_number: result.new_step_number,
        new_step_as: result.new_step_as,
        code_errors: result.code_errors,
      };
      const text =
        `added step ${result.new_step_number} to recipe ${result.recipe_id} ` +
        `(version ${result.version_no}` +
        (errCount > 0 ? `, ${errCount} validation error${errCount === 1 ? '' : 's'}` : '') +
        `)\n` +
        JSON.stringify(payload);
      return {
        content: [{ type: 'text', text }],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-recipe] add_step failed:', error);
      return createErrorResponse(
        `workato_recipe_add_step failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_recipe_set_step_input
// ---------------------------------------------------------------------------

const SET_STEP_INPUT_PAGE_FN = `
(async (recipeId, stepNumber, fieldName, value) => {
  try {
    ${PAGE_HELPERS}
    const pulled = await pullRecipeCode(recipeId);
    if (!pulled.ok) return pulled;
    const code = pulled.code;
    if (!code || typeof code !== 'object') {
      return { ok: false, stage: 'pull', error: 'pulled code was not an object' };
    }
    const step = findStepRef(code, stepNumber);
    if (!step) {
      return { ok: false, stage: 'locate', error: 'step ' + stepNumber + ' not found in recipe (searched nested blocks; accepts number or as-anchor)' };
    }
    if (!step.input || typeof step.input !== 'object') step.input = {};
    setAtPath(step.input, parsePathSegs(fieldName), value);

    const config = collectProviders(code);
    const saved = await putRecipe(recipeId, code, config);
    if (!saved.ok) return saved;
    return {
      ok: true,
      recipe_id: recipeId,
      version_no: saved.version_no,
      updated_at: saved.updated_at,
      code_errors: saved.code_errors,
    };
  } catch (e) {
    return { ok: false, stage: 'exception', error: String(e && e.message || e) };
  }
})
`;

class WorkatoRecipeSetStepInputImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_RECIPE.SET_STEP_INPUT;

  async execute(args: RecipeSetStepInputArgs): Promise<ToolResult> {
    console.log('[workato-recipe] set_step_input requested:', args);
    try {
      if (typeof args?.recipe_id !== 'number' || !Number.isFinite(args.recipe_id)) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': recipe_id (number) is required',
        );
      }
      const stepRefOk =
        (typeof args.step_number === 'number' && Number.isFinite(args.step_number)) ||
        (typeof args.step_number === 'string' && args.step_number.length > 0);
      if (!stepRefOk) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS +
            ': step_number (number, or `as` anchor string) is required',
        );
      }
      if (typeof args.field !== 'string' || args.field.length === 0) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS +
            ': field (string; nested dotted paths like "parameters.sysid_param.asset_id" supported) is required',
        );
      }
      if (args.value === undefined) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS +
            ': value is required (string, number, boolean, object, or array)',
        );
      }

      const tabId = await resolveTabId(args);
      await ensureAttached(tabId);

      const url = await getTabUrl(tabId);
      if (!/workato\.(com|is)/.test(url)) {
        return createErrorResponse(
          `workato_recipe_set_step_input: active tab is not a Workato page (url=${url}).`,
        );
      }

      const expr =
        `(${SET_STEP_INPUT_PAGE_FN})(` +
        `${JSON.stringify(args.recipe_id)}, ` +
        `${JSON.stringify(args.step_number)}, ` +
        `${JSON.stringify(args.field)}, ` +
        `${JSON.stringify(args.value)}` +
        `)`;

      const result = await evaluateInPage<{
        ok: boolean;
        stage?: string;
        error?: string;
        recipe_id?: number;
        version_no?: number;
        updated_at?: string;
        code_errors?: unknown[];
      }>(tabId, expr, { awaitPromise: true });

      if (!result?.ok) {
        return createErrorResponse(
          `workato_recipe_set_step_input: ${result?.error ?? 'unknown error'}` +
            (result?.stage ? ` (stage=${result.stage})` : ''),
        );
      }

      const errCount = Array.isArray(result.code_errors) ? result.code_errors.length : 0;
      const payload = {
        ok: true,
        recipe_id: result.recipe_id,
        version_no: result.version_no,
        code_errors: result.code_errors,
      };
      const text =
        `set step ${args.step_number}.${args.field} on recipe ${result.recipe_id} ` +
        `(version ${result.version_no}` +
        (errCount > 0 ? `, ${errCount} validation error${errCount === 1 ? '' : 's'}` : '') +
        `)\n` +
        JSON.stringify(payload);
      return {
        content: [{ type: 'text', text }],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-recipe] set_step_input failed:', error);
      return createErrorResponse(
        `workato_recipe_set_step_input failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_recipe_map_datapill
// ---------------------------------------------------------------------------

const MAP_DATAPILL_PAGE_FN = `
(async (recipeId, targetStep, targetField, sourceStep, pathArr) => {
  try {
    ${PAGE_HELPERS}
    const pulled = await pullRecipeCode(recipeId);
    if (!pulled.ok) return pulled;
    const code = pulled.code;
    if (!code || typeof code !== 'object') {
      return { ok: false, stage: 'pull', error: 'pulled code was not an object' };
    }

    const src = findStepRef(code, sourceStep);
    if (!src) {
      return { ok: false, stage: 'locate', error: 'source step ' + sourceStep + ' not found in recipe (searched nested blocks; accepts number or as-anchor)' };
    }
    if (!src.as || !src.provider) {
      return { ok: false, error: 'source step ' + sourceStep + ' has no as/provider — configure it first' };
    }

    const tgt = findStepRef(code, targetStep);
    if (!tgt) {
      return { ok: false, stage: 'locate', error: 'target step ' + targetStep + ' not found in recipe (searched nested blocks; accepts number or as-anchor)' };
    }
    if (!tgt.input || typeof tgt.input !== 'object') tgt.input = {};

    // Normalize path elements: strings pass through; 'items[]' expands to
    // 'items' + {path_element_type:'current_item'} (list/current-item pills);
    // bare '[]' is just the current_item marker; objects pass through as-is.
    const dpPath = [];
    const rawPath = Array.isArray(pathArr) ? pathArr : [];
    for (let i = 0; i < rawPath.length; i++) {
      const el = rawPath[i];
      if (typeof el === 'string' && el.slice(-2) === '[]') {
        const name = el.slice(0, -2);
        if (name.length > 0) dpPath.push(name);
        dpPath.push({ path_element_type: 'current_item' });
      } else {
        dpPath.push(el);
      }
    }

    const dp = { pill_type: 'output', provider: src.provider, line: src.as, path: dpPath };
    const formula = "=_dp('" + JSON.stringify(dp).replace(/'/g, "\\'") + "')";
    setAtPath(tgt.input, parsePathSegs(targetField), formula);

    const config = collectProviders(code);
    const saved = await putRecipe(recipeId, code, config);
    if (!saved.ok) return saved;
    return {
      ok: true,
      recipe_id: recipeId,
      version_no: saved.version_no,
      updated_at: saved.updated_at,
      formula: formula,
      code_errors: saved.code_errors,
    };
  } catch (e) {
    return { ok: false, stage: 'exception', error: String(e && e.message || e) };
  }
})
`;

class WorkatoRecipeMapDatapillImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_RECIPE.MAP_DATAPILL;

  async execute(args: RecipeMapDatapillArgs): Promise<ToolResult> {
    console.log('[workato-recipe] map_datapill requested:', args);
    try {
      if (typeof args?.recipe_id !== 'number' || !Number.isFinite(args.recipe_id)) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': recipe_id (number) is required',
        );
      }
      const targetOk =
        (typeof args.target_step === 'number' && Number.isFinite(args.target_step)) ||
        (typeof args.target_step === 'string' && args.target_step.length > 0);
      if (!targetOk) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS +
            ': target_step (number, or `as` anchor string) is required',
        );
      }
      if (typeof args.target_field !== 'string' || args.target_field.length === 0) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS +
            ': target_field (string; nested dotted paths like "parameters.sysid_param.asset_id" supported) is required',
        );
      }
      const sourceOk =
        (typeof args.source_step === 'number' && Number.isFinite(args.source_step)) ||
        (typeof args.source_step === 'string' && args.source_step.length > 0);
      if (!sourceOk) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS +
            ': source_step (number, or `as` anchor string) is required',
        );
      }
      if (!Array.isArray(args.path)) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS +
            ': path (array of strings/objects; "items[]" expands to a current_item segment) is required',
        );
      }

      const tabId = await resolveTabId(args);
      await ensureAttached(tabId);

      const url = await getTabUrl(tabId);
      if (!/workato\.(com|is)/.test(url)) {
        return createErrorResponse(
          `workato_recipe_map_datapill: active tab is not a Workato page (url=${url}).`,
        );
      }

      const expr =
        `(${MAP_DATAPILL_PAGE_FN})(` +
        `${JSON.stringify(args.recipe_id)}, ` +
        `${JSON.stringify(args.target_step)}, ` +
        `${JSON.stringify(args.target_field)}, ` +
        `${JSON.stringify(args.source_step)}, ` +
        `${JSON.stringify(args.path)}` +
        `)`;

      const result = await evaluateInPage<{
        ok: boolean;
        stage?: string;
        error?: string;
        recipe_id?: number;
        version_no?: number;
        updated_at?: string;
        formula?: string;
        code_errors?: unknown[];
      }>(tabId, expr, { awaitPromise: true });

      if (!result?.ok) {
        return createErrorResponse(
          `workato_recipe_map_datapill: ${result?.error ?? 'unknown error'}` +
            (result?.stage ? ` (stage=${result.stage})` : ''),
        );
      }

      const errCount = Array.isArray(result.code_errors) ? result.code_errors.length : 0;
      const payload = {
        ok: true,
        recipe_id: result.recipe_id,
        version_no: result.version_no,
        formula: result.formula,
        code_errors: result.code_errors,
      };
      const text =
        `mapped datapill (step ${args.source_step} -> step ${args.target_step}.${args.target_field}) ` +
        `on recipe ${result.recipe_id} (version ${result.version_no}` +
        (errCount > 0 ? `, ${errCount} validation error${errCount === 1 ? '' : 's'}` : '') +
        `)\n` +
        JSON.stringify(payload);
      return {
        content: [{ type: 'text', text }],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-recipe] map_datapill failed:', error);
      return createErrorResponse(
        `workato_recipe_map_datapill failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Exports — runtime instances (tools/index.ts reads `.name`).
// ---------------------------------------------------------------------------

export const WorkatoRecipeAddStepTool = new WorkatoRecipeAddStepImpl();
export const WorkatoRecipeSetStepInputTool = new WorkatoRecipeSetStepInputImpl();
export const WorkatoRecipeMapDatapillTool = new WorkatoRecipeMapDatapillImpl();
