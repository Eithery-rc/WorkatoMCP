/**
 * workato_operation_status: read, refresh and finish a journalled operation.
 *
 * A client that times out on `workato_recipe_save_with_dependents` has not
 * lost the operation: the bridge journalled every phase before it made the
 * call it never got an answer to. This tool is how that journal is read back
 * and, with `resume:true`, how the restore is finished.
 *
 * It runs entirely in the bridge for the read path (no browser round trip) and
 * only touches Workato when the caller asks for `refresh` (one recipe_status
 * per affected recipe) or `resume`.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAMES } from 'workatomcp-shared';

import {
  listOperations,
  readOperation,
  summarizeOperation,
  type OperationRecord,
} from './workato-operations';
import { resumeSaveOperation } from './workato-save-dependents';

type JsonObject = Record<string, unknown>;
type ExtensionCaller = (name: string, args: Record<string, unknown>) => Promise<CallToolResult>;

export const OPERATION_STATUS_TOOL = TOOL_NAMES.WORKATO.OPERATION_STATUS;

export function isWorkatoOperationTool(name: string): boolean {
  return name === OPERATION_STATUS_TOOL;
}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function firstText(result: CallToolResult | undefined): string {
  const block = Array.isArray(result?.content)
    ? result!.content.find((item: any) => item?.type === 'text')
    : undefined;
  return typeof (block as any)?.text === 'string' ? (block as any).text : '';
}

/** The last JSON object line of a `summary\nJSON` response text. */
function trailingJson(text: string): JsonObject | null {
  const lines = text.split(/\r?\n/).reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      /* try the next line */
    }
  }
  return null;
}

export interface LiveRecipeState extends JsonObject {
  recipe_id: number;
  running: boolean | null;
  state: string | null;
  version_no: number | null;
  error?: string;
}

/** One workato_recipe_status per affected recipe. Bounded by the journal. */
async function readLiveStates(
  record: OperationRecord,
  callExtension: ExtensionCaller,
): Promise<LiveRecipeState[]> {
  const out: LiveRecipeState[] = [];
  for (const recipe of record.recipes) {
    const args: JsonObject = { recipe_id: recipe.recipe_id };
    if (typeof record.context.tab_id === 'number') args.tabId = record.context.tab_id;
    try {
      const result = await callExtension('workato_recipe_status', args);
      if (result.isError) {
        out.push({
          recipe_id: recipe.recipe_id,
          running: null,
          state: null,
          version_no: null,
          error: firstText(result),
        });
        continue;
      }
      const payload = trailingJson(firstText(result));
      out.push({
        recipe_id: recipe.recipe_id,
        running: payload?.running === true ? true : payload?.running === false ? false : null,
        state: typeof payload?.state === 'string' ? payload.state : null,
        version_no: typeof payload?.version_no === 'number' ? payload.version_no : null,
      });
    } catch (err) {
      out.push({
        recipe_id: recipe.recipe_id,
        running: null,
        state: null,
        version_no: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

/** Compare the journal's initial snapshot with the live reading. */
export function describeDrift(record: OperationRecord, live: LiveRecipeState[]): string[] {
  const notes: string[] = [];
  for (const state of live) {
    const recipe = record.recipes.find((r) => r.recipe_id === state.recipe_id);
    if (!recipe) continue;
    if (state.error) {
      notes.push(`recipe ${state.recipe_id}: live state could not be read (${state.error})`);
      continue;
    }
    if (recipe.initial.running === true && state.running === false) {
      notes.push(
        `recipe ${state.recipe_id} (${recipe.role}) was RUNNING before the operation and is ` +
          'stopped now',
      );
    }
    if (recipe.initial.running === false && state.running === true) {
      notes.push(
        `recipe ${state.recipe_id} (${recipe.role}) was stopped before the operation and is ` +
          'running now',
      );
    }
    if (
      typeof recipe.initial.version_no === 'number' &&
      typeof state.version_no === 'number' &&
      state.version_no !== recipe.initial.version_no
    ) {
      notes.push(
        `recipe ${state.recipe_id} moved from version ${recipe.initial.version_no} to ` +
          `${state.version_no}`,
      );
    }
  }
  return notes;
}

export async function handleWorkatoOperationCall(
  name: string,
  args: JsonObject,
  callExtension: ExtensionCaller,
): Promise<CallToolResult> {
  if (!isWorkatoOperationTool(name)) return errorResult(`unsupported tool: ${name}`);

  const wantsList = args.list === true;
  const operationId = typeof args.operation_id === 'string' ? args.operation_id.trim() : '';

  if (!wantsList && operationId.length === 0) {
    return errorResult(
      `${OPERATION_STATUS_TOOL}: pass operation_id (from the save response) or list:true to see ` +
        'the most recent operations.',
    );
  }

  if (wantsList && operationId.length === 0) {
    const rawLimit = typeof args.limit === 'number' ? args.limit : 10;
    const limit = Math.min(Math.max(Math.trunc(rawLimit) || 10, 1), 50);
    const operations = listOperations(limit);
    return {
      isError: false,
      content: [
        {
          type: 'text',
          text:
            `${operations.length} operation(s), newest first (limit ${limit})\n` +
            JSON.stringify({
              operations,
              limit,
              returned: operations.length,
              // Retention is 200 files / 7 days; an empty list is not proof
              // nothing ever ran, only that nothing is retained.
              truncated: operations.length >= limit,
              next_cursor: null,
            }),
        },
      ],
    };
  }

  let record = readOperation(operationId);
  if (!record) {
    return errorResult(
      `${OPERATION_STATUS_TOOL}: no journal for operation "${operationId}". Operations are kept ` +
        'for 7 days or 200 records, whichever comes first, and only in the bridge that ran them. ' +
        `List what is there with ${OPERATION_STATUS_TOOL}(list:true).`,
    );
  }

  let resumeOutcome: unknown;
  if (args.resume === true) {
    if (record.kind !== 'save_with_dependents') {
      return errorResult(
        `${OPERATION_STATUS_TOOL}: operation ${operationId} is of kind "${record.kind}", which ` +
          'has no resume path.',
      );
    }
    try {
      resumeOutcome = await resumeSaveOperation(record, callExtension);
    } catch (err) {
      return errorResult(
        `${OPERATION_STATUS_TOOL}: resuming operation ${operationId} failed ` +
          `(${err instanceof Error ? err.message : String(err)}). The journal is unchanged past ` +
          'the point it reached; nothing was rolled back.',
      );
    }
    record = readOperation(operationId) ?? record;
  }

  let live: LiveRecipeState[] | undefined;
  let drift: string[] | undefined;
  if (args.refresh === true || args.resume === true) {
    live = await readLiveStates(record, callExtension);
    drift = describeDrift(record, live);
  }

  const payload: JsonObject = {
    operation: record,
    summary: summarizeOperation(record),
  };
  if (live) {
    payload.live = live;
    payload.live_count = live.length;
    payload.drift = drift ?? [];
  }
  if (resumeOutcome !== undefined) payload.resume = resumeOutcome;

  const headline =
    `operation ${record.operation_id} (${record.kind}): status ${record.status}, phase ` +
    `${record.phase}, ${record.recipes.length} recipe(s)` +
    (record.status === 'interrupted'
      ? `; INTERRUPTED, run ${OPERATION_STATUS_TOOL}(operation_id, resume:true) to finish the restore`
      : '') +
    (drift && drift.length > 0 ? `\n${drift.join('\n')}` : '');

  return {
    isError: false,
    content: [{ type: 'text', text: `${headline}\n${JSON.stringify(payload)}` }],
  };
}
