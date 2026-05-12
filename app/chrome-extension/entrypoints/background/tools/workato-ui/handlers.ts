/**
 * workato_ui_* — macro tools that drive Workato's recipe editor.
 *
 * These nine tools sit on top of the CDP/AX-tree primitives in
 * ../browser/snapshot/. They reuse the 'snapshot' owner tag against
 * cdpSessionManager (per spec — both families are mutually exclusive in
 * normal use, so refcount sharing is fine).
 *
 * Spec source: prompt — Workato-UI tool family v1.
 *
 * Each tool is exported as a runtime INSTANCE (not a class), matching the
 * convention established by the snapshot handlers: tools/index.ts reads
 * `.name` on each value to build its registry.
 */

import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { ERROR_MESSAGES } from '@/common/constants';
import { TOOL_NAMES } from 'workatomcp-shared';
import { BaseBrowserToolExecutor } from '../base-browser';
import { ensureAttached, sendCommand } from '../browser/snapshot/debugger-session';
import {
  axName,
  axRole,
  callFunctionOnObject,
  clickByAxNode,
  DIRTY_STATE_SNIPPET,
  evaluateInPage,
  findAllAxNodes,
  findAxNode,
  getAxTree,
  getTabUrl,
  LIST_STEPS_SNIPPET,
  pollUntil,
  resolveBackendNodeToObjectId,
  resolveTabId,
  sleep,
} from './dom-helpers';
import type {
  AddStepArgs,
  EnterEditModeArgs,
  ExitEditModeArgs,
  FocusStepArgs,
  InsertDatapillArgs,
  ListStepsArgs,
  OpenRecipeArgs,
  SaveRecipeArgs,
  SetFieldArgs,
  StepInfo,
} from './types';

// ---------------------------------------------------------------------------
// workato_ui_open_recipe
// ---------------------------------------------------------------------------

class WorkatoUiOpenRecipeImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_UI.OPEN_RECIPE;

  async execute(args: OpenRecipeArgs): Promise<ToolResult> {
    console.log('[workato-ui] open_recipe requested:', args);
    try {
      if (typeof args?.recipe_id !== 'number' || !Number.isFinite(args.recipe_id)) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': recipe_id (number) is required',
        );
      }
      const mode = args.mode === 'edit' ? 'edit' : 'view';

      // Find any existing Workato tab on this same recipe (any *.workato.com / .is host).
      const workatoTabs = await chrome.tabs.query({
        url: ['*://*.workato.com/*', '*://*.workato.is/*'],
      });
      const matchPath = `/recipes/${args.recipe_id}`;
      const sameRecipeTab = workatoTabs.find(
        (t) => typeof t.url === 'string' && t.url.includes(matchPath),
      );

      let targetTabId: number;
      let originHost: string | undefined;

      if (sameRecipeTab?.id) {
        targetTabId = sameRecipeTab.id;
        if (sameRecipeTab.url) originHost = new URL(sameRecipeTab.url).host;
        await chrome.tabs.update(targetTabId, { active: true });
        if (typeof sameRecipeTab.windowId === 'number') {
          await chrome.windows.update(sameRecipeTab.windowId, { focused: true });
        }
        // If we're in view mode but caller wants edit, navigate. Otherwise no-op
        // navigation if already on the desired URL.
        const currentUrl = sameRecipeTab.url ?? '';
        const wantEditUrl = currentUrl.endsWith('/edit');
        if (mode === 'edit' && !wantEditUrl) {
          await chrome.tabs.update(targetTabId, {
            url: `${new URL(currentUrl).origin}/recipes/${args.recipe_id}/edit`,
          });
        }
      } else {
        // Use the active Workato tab as our nav target, otherwise fall back to
        // active tab in current window.
        const anyWorkato = workatoTabs.find((t) => typeof t.id === 'number');
        if (anyWorkato?.id) {
          targetTabId = anyWorkato.id;
          if (anyWorkato.url) originHost = new URL(anyWorkato.url).host;
        } else {
          targetTabId = await resolveTabId(args);
        }
        const origin = originHost ? `https://${originHost}` : 'https://app.workato.com';
        const url = `${origin}/recipes/${args.recipe_id}${mode === 'edit' ? '/edit' : ''}`;
        await chrome.tabs.update(targetTabId, { url, active: true });
      }

      // Wait for the page's AX tree to show a Save (edit mode) or any recipe
      // toolbar button (view mode). Poll the tab url + AX tree for ~10s.
      const success = await pollUntil(
        async () => {
          const url = await getTabUrl(targetTabId);
          if (!url.includes(matchPath)) return false;
          try {
            const nodes = await getAxTree(targetTabId);
            // In edit mode: look for Save button. In view mode: look for Edit button.
            const targetName = mode === 'edit' ? 'Save' : 'Edit';
            const found = findAxNode(nodes, { role: 'button', nameEquals: targetName });
            if (found) return true;
            // Also accept any recipe heading if Save/Edit isn't visible yet.
            const heading = findAxNode(nodes, { role: 'heading' });
            return !!heading;
          } catch {
            return false;
          }
        },
        { timeoutMs: 12_000, intervalMs: 350 },
      );

      if (!success) {
        return createErrorResponse(
          `workato_ui_open_recipe: timed out waiting for recipe ${args.recipe_id} ` +
            `to load (mode=${mode}) in tab ${targetTabId}`,
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: `opened recipe ${args.recipe_id} in tab ${targetTabId} (mode=${mode})`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-ui] open_recipe failed:', error);
      return createErrorResponse(
        `workato_ui_open_recipe failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_ui_enter_edit_mode
// ---------------------------------------------------------------------------

class WorkatoUiEnterEditModeImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_UI.ENTER_EDIT_MODE;

  async execute(args: EnterEditModeArgs): Promise<ToolResult> {
    console.log('[workato-ui] enter_edit_mode requested:', args);
    try {
      const tabId = await resolveTabId(args ?? {});
      let url = await getTabUrl(tabId);

      if (url.endsWith('/edit')) {
        return {
          content: [{ type: 'text', text: `already in edit mode (recipe url: ${url})` }],
          isError: false,
        };
      }

      await ensureAttached(tabId);
      const nodes = await getAxTree(tabId);
      const editBtn = findAxNode(nodes, { role: 'button', nameEquals: 'Edit' });
      if (!editBtn) {
        return createErrorResponse(
          'workato_ui_enter_edit_mode: could not find toolbar "Edit" button. ' +
            'Is the recipe open and viewable?',
        );
      }

      await clickByAxNode(tabId, editBtn);

      // Wait up to 8s for Save button to appear.
      const ok = await pollUntil(
        async () => {
          try {
            const ns = await getAxTree(tabId);
            return !!findAxNode(ns, { role: 'button', nameEquals: 'Save' });
          } catch {
            return false;
          }
        },
        { timeoutMs: 8000, intervalMs: 250 },
      );
      if (!ok) {
        return createErrorResponse(
          'workato_ui_enter_edit_mode: clicked Edit but Save button did not appear within 8s',
        );
      }

      url = await getTabUrl(tabId);
      return {
        content: [{ type: 'text', text: `entered edit mode (recipe url: ${url})` }],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-ui] enter_edit_mode failed:', error);
      return createErrorResponse(
        `workato_ui_enter_edit_mode failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_ui_list_steps
// ---------------------------------------------------------------------------

class WorkatoUiListStepsImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_UI.LIST_STEPS;

  async execute(args: ListStepsArgs): Promise<ToolResult> {
    console.log('[workato-ui] list_steps requested:', args);
    try {
      const tabId = await resolveTabId(args ?? {});
      await ensureAttached(tabId);
      const raw = await evaluateInPage<StepInfo[] | { __error: string }>(tabId, LIST_STEPS_SNIPPET);
      if (raw && typeof raw === 'object' && '__error' in raw) {
        return createErrorResponse(
          `workato_ui_list_steps: page-side error: ${(raw as { __error: string }).__error}`,
        );
      }
      const steps = Array.isArray(raw) ? raw : [];
      return {
        content: [{ type: 'text', text: JSON.stringify({ steps }, null, 2) }],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-ui] list_steps failed:', error);
      return createErrorResponse(
        `workato_ui_list_steps failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_ui_focus_step
// ---------------------------------------------------------------------------

class WorkatoUiFocusStepImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_UI.FOCUS_STEP;

  async execute(args: FocusStepArgs): Promise<ToolResult> {
    console.log('[workato-ui] focus_step requested:', args);
    try {
      if (typeof args?.step_number !== 'number' || !Number.isFinite(args.step_number)) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': step_number (number) is required',
        );
      }
      const tabId = await resolveTabId(args);
      await ensureAttached(tabId);

      const nodes = await getAxTree(tabId);
      const candidates = findAllAxNodes(nodes, {
        role: 'button',
        nameEquals: String(args.step_number),
      });
      if (candidates.length === 0) {
        return createErrorResponse(
          `workato_ui_focus_step: no step bubble with number=${args.step_number} found`,
        );
      }

      await clickByAxNode(tabId, candidates[0]);

      // Wait for a config-panel heading to appear (heuristic: any role=heading
      // after the click). Tighter heuristics depend on knowing the action name,
      // which the caller can verify itself via list_steps.
      const before = Date.now();
      await pollUntil(
        async () => {
          try {
            const ns = await getAxTree(tabId);
            return findAxNode(ns, { role: 'heading' }) !== null;
          } catch {
            return false;
          }
        },
        { timeoutMs: 3000, intervalMs: 200 },
      );

      return {
        content: [
          {
            type: 'text',
            text: `focused step ${args.step_number} (panel settled in ${Date.now() - before}ms)`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-ui] focus_step failed:', error);
      return createErrorResponse(
        `workato_ui_focus_step failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_ui_add_step
// ---------------------------------------------------------------------------

class WorkatoUiAddStepImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_UI.ADD_STEP;

  async execute(args: AddStepArgs): Promise<ToolResult> {
    console.log('[workato-ui] add_step requested:', args);
    try {
      if (typeof args?.after_step !== 'number') {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': after_step (number) is required',
        );
      }
      if (!args.app || !args.action) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': app and action are required',
        );
      }
      const kind = args.kind ?? 'action';
      const tabId = await resolveTabId(args);
      await ensureAttached(tabId);

      // Step 1: find the "Add step" button *after* step `after_step`.
      // Workato renders one Add-step button per gap. We find them in DOM
      // order and pick the N-th, where N = after_step (1-indexed from the
      // first gap-after-step). This is the same semantics as the spec.
      const nodes = await getAxTree(tabId);
      const addStepNodes = findAllAxNodes(nodes, { role: 'button', nameContains: 'Add step' });
      if (addStepNodes.length === 0) {
        return createErrorResponse(
          'workato_ui_add_step: no "Add step" buttons found — is the recipe in edit mode?',
        );
      }
      // After step N: there are typically N "Add step" buttons (one between
      // each step and one after the last). We pick index = after_step - 1.
      const targetIdx = Math.max(0, Math.min(addStepNodes.length - 1, args.after_step - 1));
      const addBtn = addStepNodes[targetIdx];
      await clickByAxNode(tabId, addBtn);

      // Step 2: wait for the action picker menu (role=menuitem items).
      const menuNodes = await pollUntil(
        async () => {
          const ns = await getAxTree(tabId);
          const items = findAllAxNodes(ns, { role: 'menuitem' });
          return items.length > 0 ? ns : null;
        },
        { timeoutMs: 5000, intervalMs: 200 },
      );
      if (!menuNodes) {
        return createErrorResponse(
          'workato_ui_add_step: action picker menu did not appear within 5s',
        );
      }

      // Map kind → menuitem label.
      const kindLabelMap: Record<string, string> = {
        action: 'Action in app',
        if: 'IF condition',
        repeat: 'Repeat',
        stop: 'Stop job',
        handle_errors: 'Handle errors',
      };
      const kindLabel = kindLabelMap[kind] ?? 'Action in app';
      const kindItems = findAllAxNodes(menuNodes, {
        role: 'menuitem',
        nameContains: kindLabel,
      });
      if (kindItems.length === 0) {
        return createErrorResponse(
          `workato_ui_add_step: could not find menuitem matching "${kindLabel}"`,
        );
      }
      await clickByAxNode(tabId, kindItems[0]);

      // For non-action kinds we're done as far as the picker chain goes.
      if (kind !== 'action') {
        return {
          content: [
            {
              type: 'text',
              text: `added ${kind} step after step ${args.after_step}`,
            },
          ],
          isError: false,
        };
      }

      // Step 3: wait for app picker side panel — textbox "Text to search".
      const pickerNodes = await pollUntil(
        async () => {
          const ns = await getAxTree(tabId);
          const sb = findAxNode(ns, { role: 'textbox', nameContains: 'search' });
          return sb ? ns : null;
        },
        { timeoutMs: 6000, intervalMs: 250 },
      );
      if (!pickerNodes) {
        return createErrorResponse(
          'workato_ui_add_step: app picker side panel did not appear within 6s',
        );
      }

      // Step 4: type `app` into the search textbox.
      const searchBox = findAxNode(pickerNodes, { role: 'textbox', nameContains: 'search' });
      if (!searchBox || typeof searchBox.backendDOMNodeId !== 'number') {
        return createErrorResponse('workato_ui_add_step: search textbox lost between AX fetches');
      }
      await sendCommand(tabId, 'DOM.focus', { backendNodeId: searchBox.backendDOMNodeId });
      // Clear with select-all then insertText.
      await sendCommand(tabId, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        modifiers: 2,
        key: 'a',
        code: 'KeyA',
        text: '\x01',
        windowsVirtualKeyCode: 65,
        nativeVirtualKeyCode: 65,
      });
      await sendCommand(tabId, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        modifiers: 2,
        key: 'a',
        code: 'KeyA',
        windowsVirtualKeyCode: 65,
        nativeVirtualKeyCode: 65,
      });
      await sendCommand(tabId, 'Input.insertText', { text: args.app });
      await sleep(400); // let the list filter

      // Step 5: click the app button.
      const appNodes = await pollUntil(
        async () => {
          const ns = await getAxTree(tabId);
          const btns = findAllAxNodes(ns, {
            role: 'button',
            nameContains: args.app,
          });
          // Exclude the "Add step" or other unrelated buttons by requiring close-ish name match.
          const filtered = btns.filter((b) => {
            const nm = axName(b).toLowerCase();
            return !nm.includes('add step') && !nm.includes('search');
          });
          return filtered.length > 0 ? filtered : null;
        },
        { timeoutMs: 5000, intervalMs: 250 },
      );
      if (!appNodes) {
        return createErrorResponse(
          `workato_ui_add_step: no app button matching "${args.app}" found in picker`,
        );
      }
      await clickByAxNode(tabId, appNodes[0]);

      // Step 6: wait for action picker — buttons whose names are action names.
      // The action panel appears in the same side panel. We poll until a
      // button matching `action` is present.
      const actionMatches = await pollUntil(
        async () => {
          const ns = await getAxTree(tabId);
          const btns = findAllAxNodes(ns, {
            role: 'button',
            nameContains: args.action,
          });
          const filtered = btns.filter((b) => {
            const nm = axName(b).toLowerCase();
            return !nm.includes('add step') && !nm.includes('search');
          });
          return filtered.length > 0 ? filtered : null;
        },
        { timeoutMs: 6000, intervalMs: 250 },
      );
      if (!actionMatches) {
        return createErrorResponse(
          `workato_ui_add_step: no action button matching "${args.action}" found after picking app "${args.app}"`,
        );
      }
      await clickByAxNode(tabId, actionMatches[0]);

      // Step 7: re-list steps to discover the new step number.
      await sleep(600);
      const stepsAfter = await evaluateInPage<StepInfo[]>(tabId, LIST_STEPS_SNIPPET).catch(
        () => [] as StepInfo[],
      );
      const newStepNum = Array.isArray(stepsAfter)
        ? Math.max(args.after_step + 1, ...stepsAfter.map((s) => s.number))
        : args.after_step + 1;

      return {
        content: [
          {
            type: 'text',
            text: `added step ${newStepNum} (${args.app} → ${args.action})`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-ui] add_step failed:', error);
      return createErrorResponse(
        `workato_ui_add_step failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_ui_set_field
// ---------------------------------------------------------------------------

/**
 * Find a field by visible label or data-field-id, then write the value
 * through the most appropriate path (CodeMirror / contenteditable / input).
 *
 * Page-side function — kept compact because it ships via Runtime.evaluate.
 * Returns:
 *   { ok: true, kind: 'codemirror'|'input'|'textarea'|'contenteditable', label: string }
 *   { ok: false, error: string }
 */
const SET_FIELD_PAGE_FN = `
((field, value, mode) => {
  try {
    // ---- find the field's input element ----
    let wrapper = null;
    let matchedLabel = '';

    // Strategy 1: visible label match via w-form-field-simple-label > w-searchable.
    const labels = Array.from(document.querySelectorAll('w-form-field-simple-label, [class*="form-field-simple-label"]'));
    const fieldLower = field.toLowerCase();
    for (const lab of labels) {
      const searchable = lab.querySelector('w-searchable') || lab;
      const txt = (searchable.textContent || '').trim();
      if (!txt) continue;
      if (txt.toLowerCase() === fieldLower || txt.toLowerCase().includes(fieldLower)) {
        // Walk up to the field container (w-form-field / form-field), then find
        // the input wrapper inside.
        let container = lab.closest('w-form-field, [class*="form-field"]') || lab.parentElement;
        if (container) {
          wrapper = container.querySelector('w-text-field, w-textarea, w-formula-field, w-toggle, input, textarea, [contenteditable], .CodeMirror');
          if (wrapper) {
            matchedLabel = txt;
            break;
          }
        }
      }
    }

    // Strategy 2: data-field-id match.
    if (!wrapper) {
      const byId = document.querySelector('w-text-field[data-field-id="' + CSS.escape(field) + '"], [data-field-id="' + CSS.escape(field) + '"]');
      if (byId) {
        wrapper = byId;
        matchedLabel = field;
      }
    }

    if (!wrapper) {
      return { ok: false, error: 'field not found by label or data-field-id: ' + field };
    }

    // Optional: toggle text/formula switcher if mode is provided.
    if (mode === 'text' || mode === 'formula') {
      const container = wrapper.closest('w-form-field, [class*="form-field"]') || wrapper.parentElement;
      if (container) {
        const switcher = container.querySelectorAll('.formula-switcher__item, [class*="formula-switcher"] [class*="item"]');
        for (const item of switcher) {
          const t = (item.textContent || '').trim().toLowerCase();
          if ((mode === 'formula' && t.startsWith('formula')) || (mode === 'text' && t.startsWith('text'))) {
            const isActive = (item.className || '').includes('active') || (item.getAttribute('aria-selected') === 'true');
            if (!isActive && typeof item.click === 'function') {
              item.click();
              break;
            }
          }
        }
      }
    }

    // ---- write the value ----
    // Priority 1: CodeMirror.
    const cmRoot = wrapper.classList && wrapper.classList.contains('CodeMirror')
      ? wrapper
      : wrapper.querySelector('.CodeMirror') || (wrapper.closest && wrapper.closest('.CodeMirror'));
    if (cmRoot && cmRoot.CodeMirror) {
      cmRoot.CodeMirror.focus();
      cmRoot.CodeMirror.setValue(value);
      // Synthesize a focus/blur to nudge Angular's ng-dirty bookkeeping.
      const ta = cmRoot.querySelector('textarea');
      if (ta) {
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return { ok: true, kind: 'codemirror', label: matchedLabel };
    }

    // Priority 2: plain input/textarea.
    const input = wrapper.tagName === 'INPUT' || wrapper.tagName === 'TEXTAREA'
      ? wrapper
      : wrapper.querySelector('input, textarea');
    if (input) {
      input.focus();
      // Use native setter so React/Angular controlled inputs see the change.
      const proto = input.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
      if (setter) setter.call(input, value);
      else input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, kind: input.tagName.toLowerCase(), label: matchedLabel };
    }

    // Priority 3: contenteditable.
    const editable = wrapper.isContentEditable
      ? wrapper
      : wrapper.querySelector('[contenteditable="true"]');
    if (editable) {
      editable.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editable);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertText', false, value);
      return { ok: true, kind: 'contenteditable', label: matchedLabel };
    }

    return { ok: false, error: 'found field wrapper but no input/CodeMirror/contenteditable inside' };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
})
`;

class WorkatoUiSetFieldImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_UI.SET_FIELD;

  async execute(args: SetFieldArgs): Promise<ToolResult> {
    console.log('[workato-ui] set_field requested:', args);
    try {
      if (!args?.field) {
        return createErrorResponse(ERROR_MESSAGES.INVALID_PARAMETERS + ': field is required');
      }
      if (args.value === undefined || args.value === null) {
        return createErrorResponse(ERROR_MESSAGES.INVALID_PARAMETERS + ': value is required');
      }
      const tabId = await resolveTabId(args);
      await ensureAttached(tabId);

      // Wrap the page-side fn in an IIFE call so Runtime.evaluate returns
      // the result by-value.
      const expr = `(${SET_FIELD_PAGE_FN})(${JSON.stringify(args.field)}, ${JSON.stringify(
        String(args.value),
      )}, ${JSON.stringify(args.mode ?? null)})`;
      const result = await evaluateInPage<{
        ok: boolean;
        kind?: string;
        label?: string;
        error?: string;
      }>(tabId, expr);

      if (!result?.ok) {
        return createErrorResponse(
          `workato_ui_set_field: ${result?.error ?? 'unknown error'} (field="${args.field}")`,
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: `set "${result.label || args.field}" = ${JSON.stringify(String(args.value))} (kind=${result.kind})`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-ui] set_field failed:', error);
      return createErrorResponse(
        `workato_ui_set_field failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_ui_insert_datapill
// ---------------------------------------------------------------------------

/**
 * Two-phase insert. Phase A: HTML5 drag emulation. Phase B (fallback):
 * pull recipe code, find the source step's `as` line + provider, and write
 * an `=_dp(...)` formula via the CodeMirror set path.
 *
 * The page-side function returns:
 *   { ok: true, method: 'drag' | 'formula', pill: string }
 *   { ok: false, error: string, attempted: ['drag', 'formula'] }
 */
const INSERT_DATAPILL_PAGE_FN = `
((field, sourceStep, path, recipeId) => {
  function findFieldWrapper(field) {
    const labels = Array.from(document.querySelectorAll('w-form-field-simple-label, [class*="form-field-simple-label"]'));
    const fieldLower = field.toLowerCase();
    for (const lab of labels) {
      const searchable = lab.querySelector('w-searchable') || lab;
      const txt = (searchable.textContent || '').trim();
      if (!txt) continue;
      if (txt.toLowerCase() === fieldLower || txt.toLowerCase().includes(fieldLower)) {
        const container = lab.closest('w-form-field, [class*="form-field"]') || lab.parentElement;
        if (container) {
          const w = container.querySelector('w-text-field, w-textarea, w-formula-field, .CodeMirror, [contenteditable]');
          if (w) return w;
        }
      }
    }
    const byId = document.querySelector('w-text-field[data-field-id="' + CSS.escape(field) + '"], [data-field-id="' + CSS.escape(field) + '"]');
    return byId;
  }

  function expandStep(sourceStep) {
    // Datatree groups are usually labeled with the step number/name. Try
    // clicking any collapsed header that mentions the step number.
    const groups = Array.from(document.querySelectorAll('w-datatree-group, [class*="datatree-group"]'));
    for (const g of groups) {
      const header = g.querySelector('[class*="header"], [role="button"]');
      if (!header) continue;
      const txt = (header.textContent || '').trim();
      if (txt && txt.indexOf(String(sourceStep)) >= 0) {
        const isCollapsed = g.classList && (g.classList.contains('collapsed') || g.classList.contains('is-collapsed'));
        if (isCollapsed && typeof header.click === 'function') {
          try { header.click(); } catch (_) {}
        }
        return g;
      }
    }
    return null;
  }

  function findPill(sourceStep, leafName) {
    const group = expandStep(sourceStep);
    const root = group || document;
    const pills = Array.from(root.querySelectorAll('span.data-tree-pill.data-tree-pill_draggable, span.data-tree-pill_draggable'));
    const leafLower = leafName.toLowerCase();
    for (const p of pills) {
      const txt = (p.textContent || '').trim();
      if (txt.toLowerCase() === leafLower || txt.toLowerCase().includes(leafLower)) {
        return p;
      }
    }
    return null;
  }

  function simulateDrag(pill, dropZone) {
    if (!pill || !dropZone) return false;
    try {
      const dt = new DataTransfer();
      // Workato's drag handler typically reads HTML/text; we'll let the live
      // drag-source's own dragstart populate dt where possible.
      const ds = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt });
      pill.dispatchEvent(ds);
      const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt });
      dropZone.dispatchEvent(over);
      const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
      dropZone.dispatchEvent(drop);
      const end = new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt });
      pill.dispatchEvent(end);
      return true;
    } catch (e) {
      return false;
    }
  }

  function writeFormula(wrapper, formula) {
    const cmRoot = wrapper.classList && wrapper.classList.contains('CodeMirror')
      ? wrapper
      : wrapper.querySelector('.CodeMirror') || (wrapper.closest && wrapper.closest('.CodeMirror'));
    if (cmRoot && cmRoot.CodeMirror) {
      cmRoot.CodeMirror.focus();
      cmRoot.CodeMirror.setValue(formula);
      const ta = cmRoot.querySelector('textarea');
      if (ta) {
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    }
    return false;
  }

  function fetchRecipeCode(rid) {
    const opts = {
      credentials: 'include',
      headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
    };
    return fetch('/recipes/' + rid + '/code.json?mode=view', opts).then((r) => r.json()).then((j) => {
      try { return JSON.parse(j.result); } catch (_) { return null; }
    });
  }

  function findStepNode(code, stepNumber) {
    // Walk the recipe code tree to find the step whose number === stepNumber.
    // The root flow exposes a 'block' array of nested steps; numbering follows
    // depth-first order starting at 1 (the trigger).
    let counter = { n: 0, found: null };
    function walk(node) {
      if (!node || counter.found) return;
      counter.n += 1;
      if (counter.n === stepNumber) {
        counter.found = node;
        return;
      }
      if (Array.isArray(node.block)) {
        for (const b of node.block) walk(b);
      }
    }
    walk(code);
    return counter.found;
  }

  const wrapper = findFieldWrapper(field);
  if (!wrapper) return { ok: false, error: 'field not found: ' + field, attempted: [] };

  const leafName = path[path.length - 1] || '';
  const pill = findPill(sourceStep, leafName);

  let dragOk = false;
  if (pill) {
    // The drop zone is usually the wrapper itself or a child input/CodeMirror.
    const dropZone = wrapper.querySelector('.CodeMirror, [contenteditable], input, textarea') || wrapper;
    const beforeText = (dropZone.value || dropZone.textContent || '').slice(0, 40);
    simulateDrag(pill, dropZone);
    // Note: HTML5 synthetic drag rarely registers because the browser
    // requires real mouse events. We mark drag as "attempted" and verify by
    // checking value/text changed.
    return new Promise((resolve) => {
      setTimeout(() => {
        const afterText = (dropZone.value || dropZone.textContent || '').slice(0, 40);
        dragOk = afterText !== beforeText;
        if (dragOk) {
          resolve({ ok: true, method: 'drag', pill: leafName });
          return;
        }
        // Fall back to formula injection.
        if (!recipeId || !Number.isFinite(recipeId)) {
          resolve({ ok: false, error: 'drag did not take effect and no recipe_id available for formula fallback', attempted: ['drag'] });
          return;
        }
        fetchRecipeCode(recipeId).then((code) => {
          if (!code) {
            resolve({ ok: false, error: 'drag failed; could not fetch recipe code for formula fallback', attempted: ['drag', 'formula'] });
            return;
          }
          const stepNode = findStepNode(code, sourceStep);
          if (!stepNode) {
            resolve({ ok: false, error: 'drag failed; step ' + sourceStep + ' not found in recipe code', attempted: ['drag', 'formula'] });
            return;
          }
          const line = stepNode.as || stepNode.line || '';
          const provider = stepNode.provider || '';
          const dp = { pill_type: 'output', provider: provider, line: line, path: path };
          const formula = "=_dp('" + JSON.stringify(dp).replace(/'/g, "\\\\'") + "')";
          const wrote = writeFormula(wrapper, formula);
          if (wrote) {
            resolve({ ok: true, method: 'formula', pill: leafName });
          } else {
            resolve({ ok: false, error: 'drag failed; formula fallback could not write to field (no CodeMirror found)', attempted: ['drag', 'formula'] });
          }
        }).catch((e) => {
          resolve({ ok: false, error: 'drag failed; formula fetch error: ' + String(e && e.message || e), attempted: ['drag', 'formula'] });
        });
      }, 300);
    });
  }

  // No pill found — go straight to formula path if we have a recipe id.
  if (!recipeId || !Number.isFinite(recipeId)) {
    return { ok: false, error: 'pill not found for step ' + sourceStep + ' leaf "' + leafName + '" and no recipe_id for formula fallback', attempted: [] };
  }
  return fetchRecipeCode(recipeId).then((code) => {
    if (!code) return { ok: false, error: 'could not fetch recipe code for formula fallback', attempted: ['formula'] };
    const stepNode = findStepNode(code, sourceStep);
    if (!stepNode) return { ok: false, error: 'step ' + sourceStep + ' not found in recipe code', attempted: ['formula'] };
    const line = stepNode.as || stepNode.line || '';
    const provider = stepNode.provider || '';
    const dp = { pill_type: 'output', provider: provider, line: line, path: path };
    const formula = "=_dp('" + JSON.stringify(dp).replace(/'/g, "\\\\'") + "')";
    const wrote = writeFormula(wrapper, formula);
    if (wrote) return { ok: true, method: 'formula', pill: leafName };
    return { ok: false, error: 'formula fallback could not write to field (no CodeMirror)', attempted: ['formula'] };
  });
})
`;

class WorkatoUiInsertDatapillImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_UI.INSERT_DATAPILL;

  async execute(args: InsertDatapillArgs): Promise<ToolResult> {
    console.log('[workato-ui] insert_datapill requested:', args);
    try {
      if (!args?.field) {
        return createErrorResponse(ERROR_MESSAGES.INVALID_PARAMETERS + ': field is required');
      }
      if (typeof args.source_step !== 'number') {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': source_step (number) is required',
        );
      }
      if (!Array.isArray(args.path) || args.path.length === 0) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': path (non-empty string array) is required',
        );
      }
      const tabId = await resolveTabId(args);
      await ensureAttached(tabId);

      // Try to extract recipe_id from the tab URL (for the formula fallback).
      const url = await getTabUrl(tabId);
      const m = url.match(/\/recipes\/(\d+)/);
      const recipeId = m ? Number(m[1]) : null;

      const expr = `(${INSERT_DATAPILL_PAGE_FN})(${JSON.stringify(args.field)}, ${JSON.stringify(
        args.source_step,
      )}, ${JSON.stringify(args.path)}, ${JSON.stringify(recipeId)})`;
      const result = await evaluateInPage<{
        ok: boolean;
        method?: string;
        pill?: string;
        error?: string;
        attempted?: string[];
      }>(tabId, expr, { awaitPromise: true });

      if (!result?.ok) {
        return createErrorResponse(
          `workato_ui_insert_datapill: ${result?.error ?? 'unknown error'} ` +
            `(attempted: ${(result?.attempted ?? []).join(', ') || 'none'})`,
        );
      }
      return {
        content: [
          {
            type: 'text',
            text: `inserted datapill from step ${args.source_step} path ${args.path.join('.')} into ${args.field} (method=${result.method})`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-ui] insert_datapill failed:', error);
      return createErrorResponse(
        `workato_ui_insert_datapill failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_ui_save_recipe
// ---------------------------------------------------------------------------

class WorkatoUiSaveRecipeImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_UI.SAVE_RECIPE;

  async execute(args: SaveRecipeArgs): Promise<ToolResult> {
    console.log('[workato-ui] save_recipe requested:', args);
    try {
      const tabId = await resolveTabId(args ?? {});
      await ensureAttached(tabId);

      const nodes = await getAxTree(tabId);
      const saveBtn = findAxNode(nodes, { role: 'button', nameEquals: 'Save' });
      if (!saveBtn) {
        return createErrorResponse(
          'workato_ui_save_recipe: no Save button visible — is the recipe in edit mode?',
        );
      }
      await clickByAxNode(tabId, saveBtn);

      // Poll until ng-dirty count drops to 0 (and no validation errors).
      const start = Date.now();
      const cleared = await pollUntil(
        async () => {
          const state = await evaluateInPage<{
            dirtyCount: number;
            unsavedFlag: boolean;
            validationErrors: string[];
          }>(tabId, DIRTY_STATE_SNIPPET);
          if (state.validationErrors.length > 0) {
            throw new Error(`validation errors: ${state.validationErrors.join('; ')}`);
          }
          if (state.dirtyCount === 0 && !state.unsavedFlag)
            return { elapsedMs: Date.now() - start };
          return false;
        },
        { timeoutMs: 10_000, intervalMs: 250 },
      );

      if (!cleared) {
        return createErrorResponse(
          `workato_ui_save_recipe: save did not clear ng-dirty within 10s`,
        );
      }

      return {
        content: [
          { type: 'text', text: `saved recipe (ng-dirty cleared in ${cleared.elapsedMs}ms)` },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-ui] save_recipe failed:', error);
      return createErrorResponse(
        `workato_ui_save_recipe failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// workato_ui_exit_edit_mode
// ---------------------------------------------------------------------------

class WorkatoUiExitEditModeImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_UI.EXIT_EDIT_MODE;

  async execute(args: ExitEditModeArgs): Promise<ToolResult> {
    console.log('[workato-ui] exit_edit_mode requested:', args);
    try {
      const tabId = await resolveTabId(args ?? {});
      await ensureAttached(tabId);

      const nodes = await getAxTree(tabId);
      const exitBtn = findAxNode(nodes, { role: 'button', nameEquals: 'Exit' });
      if (!exitBtn) {
        // Already out of edit mode if there's no Exit button.
        const url = await getTabUrl(tabId);
        if (!url.endsWith('/edit')) {
          return {
            content: [{ type: 'text', text: `already out of edit mode (url: ${url})` }],
            isError: false,
          };
        }
        return createErrorResponse(
          'workato_ui_exit_edit_mode: in /edit but no "Exit" button found',
        );
      }
      await clickByAxNode(tabId, exitBtn);
      await sleep(300);

      // Check for a confirm dialog.
      const dialogNodes = await getAxTree(tabId);
      const dialog = findAxNode(dialogNodes, { role: 'dialog' });
      if (dialog) {
        // Choose Discard/Leave (when discard=true) or Cancel/Stay (when discard=false).
        const wantDiscard = args.discard === true;
        const buttons = findAllAxNodes(dialogNodes, { role: 'button' });
        // Filter to buttons inside the dialog (by name heuristic).
        const discardLikeRe = /(discard|leave|don.t save|exit)/i;
        const cancelLikeRe = /(cancel|stay|keep editing|back)/i;
        let target = null;
        for (const b of buttons) {
          const nm = axName(b);
          if (wantDiscard && discardLikeRe.test(nm)) {
            target = b;
            break;
          }
          if (!wantDiscard && cancelLikeRe.test(nm)) {
            target = b;
            break;
          }
        }
        if (target) {
          await clickByAxNode(tabId, target);
        }
      }

      // Verify we navigated off /edit (or stayed if cancel).
      await sleep(400);
      const urlAfter = await getTabUrl(tabId);
      return {
        content: [
          {
            type: 'text',
            text: `exit_edit_mode finished (url: ${urlAfter}, discard=${args.discard === true})`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-ui] exit_edit_mode failed:', error);
      return createErrorResponse(
        `workato_ui_exit_edit_mode failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Exports — runtime instances (tools/index.ts reads `.name`).
// ---------------------------------------------------------------------------

// Suppress an unused warning for callFunctionOnObject + resolveBackendNodeToObjectId —
// they're exported helpers reserved for the datapill drag/focus implementation
// if we later need raw-pointer-event fallback. Mark as referenced.
void callFunctionOnObject;
void resolveBackendNodeToObjectId;
void axRole;

export const WorkatoUiOpenRecipeTool = new WorkatoUiOpenRecipeImpl();
export const WorkatoUiEnterEditModeTool = new WorkatoUiEnterEditModeImpl();
export const WorkatoUiListStepsTool = new WorkatoUiListStepsImpl();
export const WorkatoUiFocusStepTool = new WorkatoUiFocusStepImpl();
export const WorkatoUiAddStepTool = new WorkatoUiAddStepImpl();
export const WorkatoUiSetFieldTool = new WorkatoUiSetFieldImpl();
export const WorkatoUiInsertDatapillTool = new WorkatoUiInsertDatapillImpl();
export const WorkatoUiSaveRecipeTool = new WorkatoUiSaveRecipeImpl();
export const WorkatoUiExitEditModeTool = new WorkatoUiExitEditModeImpl();
