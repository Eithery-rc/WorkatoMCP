/**
 * Callable-recipe schema tools.
 *
 *   workato_callable_schema_set — write a recipe function's parameter and
 *   result schemas as one coherent unit.
 *   workato_caller_bind        — teach a `call_recipe` step what its callee
 *   returns, and repoint the pills that were written against the old shape.
 *
 * ## Why one tool instead of four edits
 *
 * A recipe function's contract lives in FOUR places that must agree, and
 * nothing in Workato checks that they do:
 *
 *   1. trigger `input.parameters_schema_json`  — flat field list, JSON string
 *   2. trigger `input.result_schema_json`      — flat field list, JSON string
 *   3. trigger `extended_output_schema`        — the `parameters` wrapper node
 *   4. `return_result` step                    — `extended_input_schema` as a
 *      single `result` object node, `input` as `{result: {...}}`, and
 *      `visible_config_fields` as `result.<field>`
 *
 * Miss #2 and the failure is silent and total: the callee saves cleanly, its
 * job succeeds, its trace shows the full payload — and the caller's
 * `call_recipe` output is `{job_id, job_url, result: null}`. Every downstream
 * pill resolves empty. Nothing anywhere says a schema is missing.
 *
 * The fingerprint of that bug is a `return_result` trace line carrying
 * `"result": null` beside the real values. `applyCallableSchema` also migrates
 * that exact shape: values found at `input.<field>` (the flat, pre-fix form)
 * are moved under `input.result.<field>` instead of being dropped.
 *
 * Everything here is pure and synchronous apart from the two handlers, so the
 * schema assembly is unit-testable without a browser or a Workato session.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { buildMutatorSummary, parseToolJson } from './workato-recipe-mutators';

export const WORKATO_CALLABLE_TOOLS = {
  CALLABLE_SCHEMA_SET: 'workato_callable_schema_set',
  CALLER_BIND: 'workato_caller_bind',
} as const;

type CallableToolName = (typeof WORKATO_CALLABLE_TOOLS)[keyof typeof WORKATO_CALLABLE_TOOLS];

type JsonObject = Record<string, unknown>;
type ExtensionCaller = (name: string, args: Record<string, unknown>) => Promise<CallToolResult>;

/** The adapter that owns recipe functions, on both the callee and caller side. */
const RECIPE_FUNCTION_PROVIDER = 'workato_recipe_function';

/**
 * Version comments are client-visible: these recipes get promoted to the
 * client's production environment and the version history travels with them.
 * The default therefore says what kind of change it was and nothing else — no
 * narrative of what the tool did, and never anything that reads as agent
 * output. A caller supplying its own comment is trusted, but the tool
 * descriptions carry the same rule so one does not get invented upstream.
 */
export const NEUTRAL_VERSION_COMMENT = 'schema refresh';

export function isWorkatoCallableTool(name: string): name is CallableToolName {
  return Object.values(WORKATO_CALLABLE_TOOLS).includes(name as CallableToolName);
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

// ---------------------------------------------------------------------------
// Field normalization
// ---------------------------------------------------------------------------

export interface SchemaField extends JsonObject {
  name: string;
  type: string;
  control_type?: string;
  label?: string;
  optional?: boolean;
  of?: string;
  properties?: SchemaField[];
}

/** `je_count` -> `Je count`, matching how the schema designer labels a field. */
export function humanizeName(name: string): string {
  const spaced = name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  if (spaced.length === 0) return name;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** The control the editor renders for a given wire type. */
function defaultControlType(type: string): string {
  switch (type) {
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'checkbox';
    case 'date':
    case 'date_time':
      return 'date';
    case 'object':
    case 'array':
      return 'text';
    default:
      return 'text';
  }
}

/**
 * Fill in everything the schema designer would have written, so a caller can
 * pass `{name, type}` and still get a schema Workato accepts.
 *
 * Nested `properties` recurse; an `array` without an explicit `of` is assumed
 * to be an array of objects when it has properties, of strings when it does
 * not — the two shapes that actually occur in a result schema.
 */
export function normalizeSchemaField(raw: unknown, trail = ''): SchemaField {
  if (!isRecord(raw)) {
    throw new Error(`schema field${trail} must be an object, got ${JSON.stringify(raw)}`);
  }
  const name = raw.name;
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error(`schema field${trail} requires a non-empty string "name"`);
  }
  const where = trail ? `${trail}.${name}` : name;

  const properties = raw.properties;
  const hasProps = Array.isArray(properties) && properties.length > 0;
  const type = typeof raw.type === 'string' && raw.type.length > 0 ? raw.type : 'string';

  const field: SchemaField = {
    name,
    type,
    control_type:
      typeof raw.control_type === 'string' && raw.control_type.length > 0
        ? raw.control_type
        : defaultControlType(type),
    label: typeof raw.label === 'string' && raw.label.length > 0 ? raw.label : humanizeName(name),
    // Workato's designer marks result fields optional by default; a required
    // result field is the unusual case and has to be asked for.
    optional: raw.optional === false ? false : true,
  };

  if (type === 'array') {
    field.of =
      typeof raw.of === 'string' && raw.of.length > 0 ? raw.of : hasProps ? 'object' : 'string';
  }
  if (hasProps) {
    field.properties = (properties as unknown[]).map((child) => normalizeSchemaField(child, where));
  } else if (type === 'object') {
    // An object node with no properties offers no pills; that is almost always
    // a mistake worth naming rather than silently saving.
    throw new Error(
      `schema field "${where}" has type "object" but no properties — an empty object node ` +
        'produces no datapills downstream. Declare its properties, or use type "string".',
    );
  }
  return field;
}

export function normalizeFieldList(raw: unknown, label: string): SchemaField[] {
  if (!Array.isArray(raw)) throw new Error(`${label} must be an array of field definitions`);
  const seen = new Set<string>();
  return raw.map((entry) => {
    const field = normalizeSchemaField(entry);
    if (seen.has(field.name)) {
      throw new Error(`${label} declares "${field.name}" twice`);
    }
    seen.add(field.name);
    return field;
  });
}

// ---------------------------------------------------------------------------
// Artefact builders
// ---------------------------------------------------------------------------

/**
 * Both schema_json fields are JSON *strings* holding the flat field list.
 * Compact separators, matching what the designer writes.
 */
export function buildSchemaJson(fields: SchemaField[]): string {
  return JSON.stringify(fields);
}

/** Trigger output: parameters arrive wrapped in a `parameters` object node. */
export function buildParametersNode(fields: SchemaField[]): JsonObject {
  return { label: 'Parameters', name: 'parameters', type: 'object', properties: fields };
}

/** `return_result` input: results must be written wrapped in a `result` node. */
export function buildResultNode(fields: SchemaField[]): JsonObject {
  return {
    label: 'Result',
    name: 'result',
    type: 'object',
    optional: true,
    properties: fields,
  };
}

// ---------------------------------------------------------------------------
// Tree walking
// ---------------------------------------------------------------------------

interface RecipeStep extends JsonObject {
  keyword?: unknown;
  provider?: unknown;
  name?: unknown;
  as?: unknown;
  number?: number;
  input?: unknown;
  block?: unknown;
}

/** Depth-first walk over every node that looks like a step. */
export function walkSteps(code: unknown, visit: (step: RecipeStep) => void): void {
  const seen = new Set<unknown>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (!isRecord(node) || seen.has(node)) return;
    seen.add(node);
    if (typeof node.keyword === 'string') visit(node as RecipeStep);
    if (Array.isArray(node.block)) walk(node.block);
  };
  walk(code);
}

function findTrigger(code: unknown): RecipeStep | null {
  let found: RecipeStep | null = null;
  walkSteps(code, (step) => {
    if (!found && step.keyword === 'trigger') found = step;
  });
  return found;
}

function findSteps(code: unknown, pred: (step: RecipeStep) => boolean): RecipeStep[] {
  const out: RecipeStep[] = [];
  walkSteps(code, (step) => {
    if (pred(step)) out.push(step);
  });
  return out;
}

function ensureInput(step: RecipeStep): JsonObject {
  if (!isRecord(step.input)) step.input = {};
  return step.input as JsonObject;
}

// ---------------------------------------------------------------------------
// workato_callable_schema_set
// ---------------------------------------------------------------------------

export interface CallableSchemaSummary extends JsonObject {
  kind: 'callable_schema_set';
  trigger_as?: string;
  return_result_as?: string;
  parameters?: string[];
  results?: string[];
  /** Result values recovered from the pre-fix flat `input.<field>` shape. */
  migrated_from_flat?: string[];
  /** Result fields whose existing datapill mapping was carried over. */
  preserved_mappings?: string[];
  /** Result fields that now have no value mapped — they will return null. */
  unmapped?: string[];
}

/**
 * Write all four coupled artefacts into a pulled code tree.
 *
 * Mutates `code` in place and returns what changed. Throws with an actionable
 * message when the recipe is not a callable, or when results were requested on
 * a recipe that has no `return_result` step to carry them.
 */
export function applyCallableSchema(
  code: unknown,
  opts: { parameters?: SchemaField[]; results?: SchemaField[] },
): CallableSchemaSummary {
  const trigger = findTrigger(code);
  if (!trigger) throw new Error('recipe has no trigger node');
  if (trigger.provider !== RECIPE_FUNCTION_PROVIDER) {
    throw new Error(
      `recipe trigger is provider "${String(trigger.provider)}", not "${RECIPE_FUNCTION_PROVIDER}" — ` +
        'workato_callable_schema_set only applies to a recipe function (callable) recipe. ' +
        'App-function recipes (workato_workflow_task) declare parameters_schema_json on their ' +
        'own trigger; use workato_recipe_set_input_path for those.',
    );
  }

  const summary: CallableSchemaSummary = { kind: 'callable_schema_set' };
  if (typeof trigger.as === 'string') summary.trigger_as = trigger.as;
  const triggerInput = ensureInput(trigger);

  // --- 1 + 3: parameters -------------------------------------------------
  if (opts.parameters) {
    triggerInput.parameters_schema_json = buildSchemaJson(opts.parameters);
    trigger.extended_output_schema = [buildParametersNode(opts.parameters)];
    summary.parameters = opts.parameters.map((f) => f.name);
  }

  // --- 2 + 4: results ----------------------------------------------------
  if (opts.results) {
    triggerInput.result_schema_json = buildSchemaJson(opts.results);
    summary.results = opts.results.map((f) => f.name);

    const returns = findSteps(
      code,
      (step) => step.provider === RECIPE_FUNCTION_PROVIDER && step.name === 'return_result',
    );
    if (returns.length === 0) {
      throw new Error(
        'results were given but the recipe has no `return_result` step to carry them. ' +
          'Add one first (keyword:"action", provider:"workato_recipe_function", ' +
          'name:"return_result") — it must sit OUTSIDE any if/try block, or the caller ' +
          'receives nothing when the condition is false.',
      );
    }
    if (returns.length > 1) {
      throw new Error(
        `recipe has ${returns.length} \`return_result\` steps (as: ` +
          `${returns.map((s) => String(s.as)).join(', ')}). Schema writing is ambiguous — ` +
          'collapse them into one, or edit each with workato_recipe_set_extended_schema.',
      );
    }

    const ret = returns[0];
    if (typeof ret.as === 'string') summary.return_result_as = ret.as;
    const existingInput = isRecord(ret.input) ? ret.input : {};
    const existingResult = isRecord(existingInput.result) ? existingInput.result : {};

    // Carry existing mappings across. Values live under `result` once the
    // schema is right; before the fix they sit flat on `input`, which is the
    // `result: null` bug — recover those rather than wiping the user's work.
    const nextResult: JsonObject = {};
    const migrated: string[] = [];
    const preserved: string[] = [];
    const unmapped: string[] = [];
    for (const field of opts.results) {
      if (existingResult[field.name] !== undefined) {
        nextResult[field.name] = existingResult[field.name];
        preserved.push(field.name);
      } else if (existingInput[field.name] !== undefined) {
        nextResult[field.name] = existingInput[field.name];
        migrated.push(field.name);
      } else {
        unmapped.push(field.name);
      }
    }

    ret.extended_input_schema = [buildResultNode(opts.results)];
    ret.input = { result: nextResult };
    ret.visible_config_fields = opts.results.map((f) => `result.${f.name}`);

    if (migrated.length > 0) summary.migrated_from_flat = migrated;
    if (preserved.length > 0) summary.preserved_mappings = preserved;
    if (unmapped.length > 0) summary.unmapped = unmapped;
  }

  return summary;
}

// ---------------------------------------------------------------------------
// workato_caller_bind
// ---------------------------------------------------------------------------

/** Matches a `_dp('<single-quoted JSON>')` datapill reference. */
const DATAPILL_RE = /_dp\('([\s\S]*?)'\)/g;

/**
 * Rewrite every pill that reads `line`'s output so its path starts with
 * `result`.
 *
 * Parse-and-rebuild, never regex-across-a-boundary: a pill payload contains
 * commas and quotes of its own, so patching the surrounding string with a
 * regex corrupts the reference. Re-serialization is compact — Workato matches
 * `_dp('<json>')` byte-for-byte and a pill with spaces resolves to nothing.
 */
export function repointPillsToResult(
  value: unknown,
  line: string,
  fieldNames: string[],
): { value: unknown; repointed: number } {
  const wanted = new Set(fieldNames);
  let repointed = 0;

  const rewritePayload = (payload: string): string | null => {
    const unescaped = payload.replace(/\\'/g, "'");
    let parsed: unknown;
    try {
      parsed = JSON.parse(unescaped);
    } catch {
      return null; // not ours to touch
    }
    if (!isRecord(parsed)) return null;
    if (parsed.line !== line) return null;
    if (!Array.isArray(parsed.path) || parsed.path.length === 0) return null;
    const head = parsed.path[0];
    if (typeof head !== 'string' || !wanted.has(head)) return null;
    parsed.path = ['result', ...parsed.path];
    repointed += 1;
    return JSON.stringify(parsed).replace(/'/g, "\\'");
  };

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      return node.replace(DATAPILL_RE, (whole, payload: string) => {
        const next = rewritePayload(payload);
        return next === null ? whole : `_dp('${next}')`;
      });
    }
    if (Array.isArray(node)) return node.map(walk);
    if (isRecord(node)) {
      const out: JsonObject = {};
      for (const [key, val] of Object.entries(node)) out[key] = walk(val);
      return out;
    }
    return node;
  };

  return { value: walk(value), repointed };
}

export interface CallerBindSummary extends JsonObject {
  kind: 'caller_bind';
  step_as?: string;
  callee_recipe_id?: string;
  results?: string[];
  parameters?: string[];
  pills_repointed?: number;
}

/** The two fields `call_recipe` always emits, ahead of the callee's result. */
function callRecipeBaseOutput(): JsonObject[] {
  return [
    { control_type: 'text', label: 'Job ID', name: 'job_id', type: 'string' },
    { control_type: 'text', label: 'Job URL', name: 'job_url', type: 'string' },
  ];
}

/**
 * Bind one `call_recipe` step to its callee's declared contract.
 *
 * Writes the step's `extended_output_schema` (job_id, job_url, and the
 * callee's `result` node) plus its `extended_input_schema` (the `parameters`
 * node), then repoints any pill in the tree that reads a result field
 * directly off this step — the shape written before the callee declared a
 * result schema.
 */
export function applyCallerBind(
  code: JsonObject,
  opts: { step: RecipeStep; results: SchemaField[]; parameters?: SchemaField[] },
): { code: JsonObject; summary: CallerBindSummary } {
  const { step, results, parameters } = opts;
  const summary: CallerBindSummary = { kind: 'caller_bind' };
  if (typeof step.as === 'string') summary.step_as = step.as;

  const input = ensureInput(step);
  if (typeof input.flow_id === 'string') summary.callee_recipe_id = input.flow_id;

  step.extended_output_schema = [...callRecipeBaseOutput(), buildResultNode(results)];
  summary.results = results.map((f) => f.name);

  if (parameters && parameters.length > 0) {
    step.extended_input_schema = [buildParametersNode(parameters)];
    summary.parameters = parameters.map((f) => f.name);
  }

  // Pills written before the callee had a result schema point straight at the
  // field (`path: ["rows"]`). They must read through the wrapper now.
  let next: JsonObject = code;
  if (typeof step.as === 'string') {
    const { value, repointed } = repointPillsToResult(
      code,
      step.as,
      results.map((f) => f.name),
    );
    next = value as JsonObject;
    summary.pills_repointed = repointed;
  }
  return { code: next, summary };
}

/** Read a callable's declared field lists back off its trigger. */
export function readCalleeContract(code: unknown): {
  parameters: SchemaField[];
  results: SchemaField[];
} {
  const trigger = findTrigger(code);
  if (!trigger) throw new Error('callee recipe has no trigger node');
  if (trigger.provider !== RECIPE_FUNCTION_PROVIDER) {
    throw new Error(
      `callee recipe's trigger is provider "${String(trigger.provider)}", not ` +
        `"${RECIPE_FUNCTION_PROVIDER}" — it is not a callable recipe function.`,
    );
  }
  const input = isRecord(trigger.input) ? trigger.input : {};

  const parse = (raw: unknown, label: string): SchemaField[] => {
    if (raw === undefined || raw === null || raw === '') return [];
    if (typeof raw !== 'string') throw new Error(`callee trigger ${label} is not a JSON string`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(
        `callee trigger ${label} is not parseable JSON: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return normalizeFieldList(parsed, `callee ${label}`);
  };

  const results = parse(input.result_schema_json, 'result_schema_json');
  if (results.length === 0) {
    throw new Error(
      'callee recipe declares no result_schema_json — binding it would produce ' +
        '`result: null` at runtime with no error anywhere. Run ' +
        'workato_callable_schema_set on the CALLEE first, then bind the caller.',
    );
  }
  return { parameters: parse(input.parameters_schema_json, 'parameters_schema_json'), results };
}

/** Locate the `call_recipe` step to bind. */
export function findCallRecipeStep(
  code: unknown,
  opts: { stepRef?: unknown; calleeId?: string },
): RecipeStep {
  const calls = findSteps(
    code,
    (step) =>
      step.provider === RECIPE_FUNCTION_PROVIDER &&
      (step.name === 'call_recipe' || step.name === 'call_recipe_async'),
  );
  if (calls.length === 0) {
    throw new Error('caller recipe has no `call_recipe` step');
  }

  const describe = (): string =>
    calls
      .map((s) => {
        const input = isRecord(s.input) ? s.input : {};
        return `${String(s.as)} -> flow_id ${String(input.flow_id ?? '?')}`;
      })
      .join(', ');

  if (opts.stepRef !== undefined && opts.stepRef !== null) {
    const ref = String(opts.stepRef);
    const match = calls.find((s) => String(s.as) === ref || String(s.number) === ref);
    if (!match) throw new Error(`no call_recipe step matching [${ref}]. Steps: ${describe()}`);
    return match;
  }

  if (opts.calleeId) {
    const matching = calls.filter((s) => {
      const input = isRecord(s.input) ? s.input : {};
      return String(input.flow_id ?? '') === opts.calleeId;
    });
    if (matching.length === 1) return matching[0];
    if (matching.length === 0) {
      throw new Error(`no call_recipe step targets recipe ${opts.calleeId}. Steps: ${describe()}`);
    }
    throw new Error(
      `${matching.length} call_recipe steps target recipe ${opts.calleeId}. ` +
        `Pass step:"<as>" to pick one. Steps: ${describe()}`,
    );
  }

  if (calls.length > 1) {
    throw new Error(
      `caller recipe has ${calls.length} call_recipe steps — pass step:"<as>" or ` +
        `callee_recipe_id. Steps: ${describe()}`,
    );
  }
  return calls[0];
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

function requireRecipeId(args: JsonObject, key = 'recipe_id'): number {
  const value = args[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number`);
  }
  return value;
}

function parseConfig(config: unknown): unknown {
  if (typeof config !== 'string') return config;
  try {
    return JSON.parse(config);
  } catch {
    return config;
  }
}

/** Copy the tab/window routing and save modifiers a caller may have passed. */
function withPassThrough(args: JsonObject, target: JsonObject): JsonObject {
  if (typeof args.tabId === 'number') target.tabId = args.tabId;
  if (typeof args.windowId === 'number') target.windowId = args.windowId;
  return target;
}

export async function handleWorkatoCallableCall(
  name: string,
  args: JsonObject,
  callExtension: ExtensionCaller,
): Promise<CallToolResult> {
  try {
    if (!isWorkatoCallableTool(name)) {
      return errorResult(`unsupported native callable-schema tool: ${name}`);
    }
    const recipeId = requireRecipeId(args);

    const pulled = parseToolJson(
      await callExtension(
        'workato_pull_recipe',
        withPassThrough(args, { recipe_id: recipeId, view: 'full' }),
      ),
    );
    let code = pulled.code;
    if (!isRecord(code)) throw new Error('workato_pull_recipe did not return a recipe code object');
    const version = isRecord(pulled.version) ? pulled.version : {};

    let mutation: JsonObject;

    if (name === WORKATO_CALLABLE_TOOLS.CALLABLE_SCHEMA_SET) {
      if (args.parameters === undefined && args.results === undefined) {
        throw new Error('pass parameters[], results[], or both — nothing to write otherwise');
      }
      const parameters =
        args.parameters === undefined
          ? undefined
          : normalizeFieldList(args.parameters, 'parameters');
      const results =
        args.results === undefined ? undefined : normalizeFieldList(args.results, 'results');
      mutation = applyCallableSchema(code, { parameters, results });
    } else {
      // caller_bind: the callee's own trigger is the source of truth for the
      // contract, so nothing here is guessed from the caller's side.
      const step = findCallRecipeStep(code, {
        stepRef: args.step,
        calleeId: args.callee_recipe_id === undefined ? undefined : String(args.callee_recipe_id),
      });
      const stepInput = isRecord(step.input) ? step.input : {};
      const calleeId = String(args.callee_recipe_id ?? stepInput.flow_id ?? '');
      if (!/^\d+$/.test(calleeId)) {
        throw new Error(
          `could not determine the callee recipe id (step flow_id = ${JSON.stringify(
            stepInput.flow_id,
          )}). Pass callee_recipe_id explicitly.`,
        );
      }
      const calleePulled = parseToolJson(
        await callExtension(
          'workato_pull_recipe',
          withPassThrough(args, { recipe_id: Number(calleeId), view: 'full' }),
        ),
      );
      const contract = readCalleeContract(calleePulled.code);
      const bound = applyCallerBind(code, {
        step,
        results: contract.results,
        parameters: contract.parameters,
      });
      code = bound.code;
      mutation = bound.summary;
    }

    const saveArgs: JsonObject = withPassThrough(args, {
      recipe_id: recipeId,
      code,
      config: parseConfig(version.config),
    });
    if (args.restart_if_running === true) saveArgs.restart_if_running = true;
    if (args.ensure_running === true) saveArgs.ensure_running = true;
    saveArgs.comment = typeof args.comment === 'string' ? args.comment : NEUTRAL_VERSION_COMMENT;
    if (args.verify_readback === false) saveArgs.verify_readback = false;
    if (typeof args.expected_base_version_no === 'number') {
      saveArgs.expected_base_version_no = args.expected_base_version_no;
    } else if (typeof version.version_no === 'number') {
      saveArgs.expected_base_version_no = version.version_no;
    }

    const saved = parseToolJson(await callExtension('workato_ui_save_recipe_code', saveArgs));
    return buildMutatorSummary(name, {
      recipe_id: saved.recipe_id ?? recipeId,
      version_no: saved.version_no,
      code_errors: saved.code_errors,
      mutation: mutation as never,
      save: saved,
    });
  } catch (error) {
    return errorResult(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
