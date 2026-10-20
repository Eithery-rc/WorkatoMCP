import { runInWorkatoTab, workatoNotFoundHint, WorkatoDispatchError } from './tab-dispatch';

/**
 * GET /web_api/recipes/<id>/state.json is the ONLY place Workato records why an
 * activation failed.
 *
 * POST start.json always answers 202 {status:"enqueued"}, and /recipes/<id>.json
 * afterwards shows a plain stopped recipe: no stop_reason, no last_actionable_error,
 * no requirements_errors. state.json is what the editor polls right after the Start
 * click, and it is the only read that carries the reason (verified live 2026-09-07).
 * The error is written by an activation ATTEMPT: a recipe saved but never started
 * answers {state, error: null}, and the error survives a later stop and save.
 *
 * There is no pre-start validation endpoint (/recipes/<id>/validate.json,
 * /web_api/recipes/<id>/validate.json and /recipes/<id>/ready.json are all 404),
 * so this read after a failed start is the whole diagnostic.
 */

/** One config error, normalized from either serialization Workato uses. */
export interface NormalizedConfigError {
  line_number: number | null;
  field: string | null;
  value: unknown;
  message: string;
}

/** Normalized state.json error. All four arrays are always present (possibly empty). */
export interface RecipeStartError {
  state: string;
  code_errors: unknown[];
  config_errors: NormalizedConfigError[];
  param_errors: unknown[];
  requirements_errors: unknown[];
  /** Present for the runtime-failure shape {details:{message}}. */
  message?: string;
}

export interface RecipeActivationStateRaw {
  state: string;
  error: unknown;
}

interface StateInPageResult {
  ok: boolean;
  state?: string;
  error?: unknown;
  failure?: {
    stage: 'fetch' | 'shape';
    status?: number;
    body_excerpt?: string;
    message: string;
  };
}

/**
 * Runs in the Workato tab's MAIN world. Plain function with .then() chains and
 * every helper inline. async/await is rewritten by the bundler into a hoisted
 * helper that does not survive Function.prototype.toString (see pull-recipe.ts).
 */
export function fetchRecipeActivationStateInPage(recipeId: number): Promise<StateInPageResult> {
  const url = `/web_api/recipes/${recipeId}/state.json`;
  return fetch(url, {
    credentials: 'include',
    headers: {
      accept: 'application/json, text/plain, */*',
      'x-requested-with': 'XMLHttpRequest',
    },
  }).then((r) =>
    r.text().then((bodyText) => {
      if (r.status < 200 || r.status >= 300) {
        return {
          ok: false,
          failure: {
            stage: 'fetch' as const,
            status: r.status,
            body_excerpt: bodyText.slice(0, 512),
            message: `GET ${url} returned HTTP ${r.status}`,
          },
        };
      }
      let json: unknown = null;
      try {
        json = JSON.parse(bodyText);
      } catch (e) {
        return {
          ok: false,
          failure: {
            stage: 'shape' as const,
            body_excerpt: bodyText.slice(0, 512),
            message: `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`,
          },
        };
      }
      if (!json || typeof json !== 'object') {
        return {
          ok: false,
          failure: {
            stage: 'shape' as const,
            body_excerpt: bodyText.slice(0, 512),
            message: `Unexpected response shape from ${url} - expected an object.`,
          },
        };
      }
      const state = (json as { state?: unknown }).state;
      return {
        ok: true,
        state: typeof state === 'string' ? state : 'unknown',
        error: (json as { error?: unknown }).error ?? null,
      };
    }),
  );
}

/** Read the activation state from the tool layer. Throws WorkatoDispatchError on failure. */
export async function fetchRecipeActivationState(
  tabId: number,
  recipeId: number,
): Promise<RecipeActivationStateRaw> {
  const result = await runInWorkatoTab(tabId, fetchRecipeActivationStateInPage, [recipeId], {
    timeoutMs: 15_000,
  });
  if (!result.ok || typeof result.state !== 'string') {
    throw new WorkatoDispatchError(
      'UnexpectedShape',
      `recipe state fetch failed (${result.failure?.stage}): ${result.failure?.message ?? 'unknown'}` +
        workatoNotFoundHint(result.failure?.status),
    );
  }
  return { state: result.state, error: result.error ?? null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toMessage(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return JSON.stringify(value);
}

/**
 * Normalize `config_errors` from either serialization Workato returns.
 *
 * Positional (what later reads return):
 *   [[1, [["account_id", null, "can't be blank"]]]]
 * Object (what the read right after activation returns):
 *   [{line_number: 1, errors: [{field_label: "account_id", value: null, message: "can't be blank"}]}]
 *
 * Both were captured from the same recipe with identical request headers, so the
 * shape is not caller-controlled and both must be handled. Values are preserved
 * as-is: `0`, `false` and `null` are real field values, not absence.
 */
export function normalizeConfigErrors(raw: unknown): NormalizedConfigError[] {
  if (!Array.isArray(raw)) return [];
  const out: NormalizedConfigError[] = [];

  for (const entry of raw) {
    // Positional: [line, [[field, value, message], ...]]
    if (Array.isArray(entry)) {
      const line = typeof entry[0] === 'number' ? entry[0] : null;
      const errors = Array.isArray(entry[1]) ? entry[1] : [];
      if (errors.length === 0) {
        out.push({ line_number: line, field: null, value: undefined, message: '' });
        continue;
      }
      for (const err of errors) {
        if (Array.isArray(err)) {
          out.push({
            line_number: line,
            field: typeof err[0] === 'string' ? err[0] : null,
            value: err[1],
            message: toMessage(err[2]),
          });
        } else {
          out.push({ line_number: line, field: null, value: err, message: toMessage(err) });
        }
      }
      continue;
    }

    // Object: {line_number, errors: [{field_label, value, message}]}
    if (isRecord(entry)) {
      const line = typeof entry.line_number === 'number' ? entry.line_number : null;
      const errors = Array.isArray(entry.errors) ? entry.errors : [];
      if (errors.length === 0) {
        out.push({
          line_number: line,
          field: typeof entry.field_label === 'string' ? entry.field_label : null,
          value: entry.value,
          message: toMessage(entry.message),
        });
        continue;
      }
      for (const err of errors) {
        if (isRecord(err)) {
          const field = err.field_label ?? err.field;
          out.push({
            line_number: typeof err.line_number === 'number' ? err.line_number : line,
            field: typeof field === 'string' ? field : null,
            value: err.value,
            message: toMessage(err.message),
          });
        } else {
          out.push({ line_number: line, field: null, value: err, message: toMessage(err) });
        }
      }
      continue;
    }

    out.push({ line_number: null, field: null, value: entry, message: toMessage(entry) });
  }

  return out;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Turn a state.json body into a RecipeStartError, or null when Workato recorded
 * no activation error. `error: null` means "no failed activation attempt on
 * record", which is NOT the same as "the recipe is fine".
 */
export function normalizeStartError(raw: RecipeActivationStateRaw): RecipeStartError | null {
  const state = typeof raw?.state === 'string' ? raw.state : 'unknown';
  const error = raw?.error;
  if (!isRecord(error)) return null;

  const details = isRecord(error.details) ? error.details : error;
  const message = typeof details.message === 'string' ? details.message : undefined;

  const normalized: RecipeStartError = {
    state,
    code_errors: asArray(details.code_errors),
    config_errors: normalizeConfigErrors(details.config_errors),
    param_errors: asArray(details.param_errors),
    requirements_errors: asArray(details.requirements_errors),
  };
  if (message !== undefined) normalized.message = message;

  const empty =
    normalized.code_errors.length === 0 &&
    normalized.config_errors.length === 0 &&
    normalized.param_errors.length === 0 &&
    normalized.requirements_errors.length === 0 &&
    message === undefined;

  return empty ? null : normalized;
}

/** One-line description of a start error, naming the offending line and field. */
export function describeStartError(err: RecipeStartError): string {
  const parts: string[] = [];
  if (err.message) parts.push(err.message);
  for (const ce of err.config_errors) {
    const where = ce.line_number !== null ? `line ${ce.line_number}` : 'config';
    const field = ce.field ? ` field ${ce.field}` : '';
    parts.push(`${where}${field}: ${ce.message || 'invalid'}`);
  }
  for (const arr of [err.requirements_errors, err.param_errors, err.code_errors]) {
    for (const item of arr) parts.push(toMessage(item));
  }
  return parts.filter((p) => p.length > 0).join('; ');
}

/** True when a config error points at a connection binding (`account_id`). */
export function mentionsAccountId(err: RecipeStartError): boolean {
  return err.config_errors.some(
    (ce) =>
      (ce.field ?? '').toLowerCase().includes('account_id') ||
      ce.message.toLowerCase().includes('account_id'),
  );
}
