import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export const WORKATO_RECIPE_MUTATOR_TOOLS = {
  SET_INPUT_PATH: 'workato_recipe_set_input_path',
  DELETE_INPUT_PATH: 'workato_recipe_delete_input_path',
  SET_PY_EVAL_CODE: 'workato_recipe_set_py_eval_code',
  SET_EXTENDED_SCHEMA: 'workato_recipe_set_extended_schema',
} as const;

type RecipeMutatorToolName =
  (typeof WORKATO_RECIPE_MUTATOR_TOOLS)[keyof typeof WORKATO_RECIPE_MUTATOR_TOOLS];

type PathSegment = string | number;
type JsonObject = Record<string, unknown>;
type ExtensionCaller = (name: string, args: Record<string, unknown>) => Promise<CallToolResult>;

interface RecipeStep extends JsonObject {
  number?: number;
  as?: string;
  provider?: string;
  name?: string;
  input?: unknown;
  block?: unknown;
}

interface MutationSummary {
  kind: string;
  step_number?: number;
  step_as?: string;
  path?: string;
  schema_kind?: string;
}

const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

export function isWorkatoRecipeMutatorTool(name: string): name is RecipeMutatorToolName {
  return Object.values(WORKATO_RECIPE_MUTATOR_TOOLS).includes(name as RecipeMutatorToolName);
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function validatePathSegment(segment: PathSegment): PathSegment {
  if (typeof segment === 'number') {
    if (!Number.isInteger(segment) || segment < 0) {
      throw new Error(`invalid array index in path: ${segment}`);
    }
    return segment;
  }
  if (typeof segment !== 'string' || segment.length === 0) {
    throw new Error('empty path segment is not allowed');
  }
  if (UNSAFE_PATH_SEGMENTS.has(segment)) {
    throw new Error(`unsafe path segment is not allowed: ${segment}`);
  }
  return segment;
}

export function parseInputPath(path: unknown): PathSegment[] {
  if (Array.isArray(path)) {
    const segments = path.map((segment) => {
      if (typeof segment !== 'string' && typeof segment !== 'number') {
        throw new Error('path array may contain only strings and non-negative integers');
      }
      return validatePathSegment(segment);
    });
    if (segments.length === 0) throw new Error('path must contain at least one segment');
    return segments;
  }

  if (typeof path !== 'string' || path.trim().length === 0) {
    throw new Error('path must be a non-empty dotted string or string/number array');
  }

  const segments: PathSegment[] = [];
  let token = '';
  for (let i = 0; i < path.length; i += 1) {
    const ch = path[i];
    if (ch === '.') {
      if (token.length > 0) {
        segments.push(validatePathSegment(token));
        token = '';
      } else if (i === 0 || path[i - 1] !== ']') {
        throw new Error(`empty path segment in path: ${path}`);
      }
      continue;
    }

    if (ch === '[') {
      if (token.length > 0) {
        segments.push(validatePathSegment(token));
        token = '';
      }
      const end = path.indexOf(']', i + 1);
      if (end < 0) throw new Error(`unclosed array index in path: ${path}`);
      const rawIndex = path.slice(i + 1, end);
      if (!/^\d+$/.test(rawIndex)) throw new Error(`invalid array index in path: ${path}`);
      segments.push(validatePathSegment(Number(rawIndex)));
      i = end;
      continue;
    }

    if (ch === ']') throw new Error(`unexpected closing bracket in path: ${path}`);
    token += ch;
  }

  if (token.length > 0) {
    segments.push(validatePathSegment(token));
  } else if (path.endsWith('.')) {
    throw new Error(`empty path segment in path: ${path}`);
  }

  if (segments.length === 0) throw new Error('path must contain at least one segment');
  return segments;
}

function pathToString(segments: PathSegment[]): string {
  let out = '';
  for (const segment of segments) {
    if (typeof segment === 'number') {
      out += `[${segment}]`;
    } else {
      out += out.length === 0 ? segment : `.${segment}`;
    }
  }
  return out;
}

function findStep(code: unknown, stepRef: unknown): RecipeStep | null {
  const wantedNumber =
    typeof stepRef === 'number'
      ? stepRef
      : typeof stepRef === 'string' && /^\d+$/.test(stepRef)
        ? Number(stepRef)
        : null;
  const wantedAs = typeof stepRef === 'string' ? stepRef : null;

  function visit(node: unknown): RecipeStep | null {
    if (!isRecord(node)) return null;
    const step = node as RecipeStep;
    if (wantedNumber !== null && step.number === wantedNumber) return step;
    if (wantedAs !== null && step.as === wantedAs) return step;
    if (Array.isArray(step.block)) {
      for (const child of step.block) {
        const found = visit(child);
        if (found) return found;
      }
    }
    return null;
  }

  return visit(code);
}

function requireStep(code: unknown, stepRef: unknown): RecipeStep {
  if (stepRef === undefined || stepRef === null || stepRef === '') {
    throw new Error('step is required and must be a step number or as anchor');
  }
  const step = findStep(code, stepRef);
  if (!step) throw new Error(`step ${String(stepRef)} not found in recipe`);
  return step;
}

function ensureInput(step: RecipeStep): JsonObject {
  if (!isRecord(step.input)) {
    step.input = {};
  }
  return step.input as JsonObject;
}

function isContainer(value: unknown): value is JsonObject | unknown[] {
  return isRecord(value) || Array.isArray(value);
}

function childAt(container: JsonObject | unknown[], key: PathSegment): unknown {
  if (Array.isArray(container)) {
    if (typeof key !== 'number') throw new Error(`expected array index before ${String(key)}`);
    return container[key];
  }
  if (typeof key === 'number') throw new Error(`expected object key before index [${key}]`);
  return container[key];
}

function assignChild(container: JsonObject | unknown[], key: PathSegment, value: unknown): void {
  if (Array.isArray(container)) {
    if (typeof key !== 'number') throw new Error(`expected array index before ${String(key)}`);
    container[key] = value;
    return;
  }
  if (typeof key === 'number') throw new Error(`expected object key before index [${key}]`);
  container[key] = value;
}

function removeChild(container: JsonObject | unknown[], key: PathSegment): void {
  if (Array.isArray(container)) {
    if (typeof key !== 'number') throw new Error(`expected array index before ${String(key)}`);
    container.splice(key, 1);
    return;
  }
  if (typeof key === 'number') throw new Error(`expected object key before index [${key}]`);
  delete container[key];
}

function setAtPath(root: JsonObject, segments: PathSegment[], value: unknown): void {
  let current: JsonObject | unknown[] = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    const nextSegment = segments[i + 1];
    const existing = childAt(current, segment);
    if (existing === undefined || existing === null) {
      const nextContainer: JsonObject | unknown[] = typeof nextSegment === 'number' ? [] : {};
      assignChild(current, segment, nextContainer);
      current = nextContainer;
      continue;
    }
    if (!isContainer(existing)) {
      throw new Error(
        `cannot create child ${String(nextSegment)} under non-container path segment ${String(segment)}`,
      );
    }
    current = existing;
  }
  assignChild(current, segments[segments.length - 1], value);
}

function isEmptyContainer(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return isRecord(value) && Object.keys(value).length === 0;
}

function deleteAtPath(root: JsonObject, segments: PathSegment[]): void {
  let current: JsonObject | unknown[] = root;
  const trail: Array<{ container: JsonObject | unknown[]; key: PathSegment }> = [];

  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    const next = childAt(current, segment);
    if (!isContainer(next)) {
      throw new Error(`path ${pathToString(segments)} not found`);
    }
    trail.push({ container: current, key: segment });
    current = next;
  }

  const leaf = segments[segments.length - 1];
  if (childAt(current, leaf) === undefined) {
    throw new Error(`path ${pathToString(segments)} not found`);
  }
  removeChild(current, leaf);

  for (let i = trail.length - 1; i >= 0; i -= 1) {
    const { container, key } = trail[i];
    const child = childAt(container, key);
    if (!isEmptyContainer(child)) break;
    removeChild(container, key);
  }
}

function parseDatapillShorthand(value: string): JsonObject {
  const trimmed = value.trim();
  const inner =
    trimmed.startsWith('datapill(') && trimmed.endsWith(')')
      ? trimmed.slice('datapill('.length, -1)
      : trimmed;
  const [provider, line, ...rawPath] = inner.split('.');
  if (!provider || !line) {
    throw new Error(
      'datapill shorthand must be provider.line.path or datapill(provider.line.path)',
    );
  }

  const path: unknown[] = [];
  for (const part of rawPath) {
    if (part.endsWith('[]')) {
      const name = part.slice(0, -2);
      if (name.length > 0) path.push(name);
      path.push({ path_element_type: 'current_item' });
    } else {
      path.push(part);
    }
  }

  return { pill_type: 'output', provider, line, path };
}

function datapillToInterpolated(value: unknown): string {
  const source = typeof value === 'string' ? parseDatapillShorthand(value) : value;
  if (!isRecord(source)) throw new Error('datapill value must be an object or shorthand string');

  const pillType = typeof source.pill_type === 'string' ? source.pill_type : 'output';
  const pill: JsonObject = { pill_type: pillType };
  if (pillType !== 'job_context') {
    if (typeof source.provider !== 'string' || source.provider.length === 0) {
      throw new Error('datapill provider is required');
    }
    if (typeof source.line !== 'string' || source.line.length === 0) {
      throw new Error('datapill line is required');
    }
    pill.provider = source.provider;
    pill.line = source.line;
  }
  if (!Array.isArray(source.path)) throw new Error('datapill path must be an array');
  pill.path = source.path;

  const json = JSON.stringify(pill).replace(/'/g, "\\'");
  return `#{_dp('${json}')}`;
}

function normalizeInputValue(value: unknown, valueKind: unknown): unknown {
  const kind = valueKind ?? 'literal';
  if (kind === 'literal') return value;
  if (kind === 'formula') {
    if (typeof value !== 'string') throw new Error('formula value must be a string');
    return value.startsWith('=') ? value : `=${value}`;
  }
  if (kind === 'interpolated') {
    if (typeof value !== 'string') throw new Error('interpolated value must be a string');
    return value;
  }
  if (kind === 'datapill') return datapillToInterpolated(value);
  throw new Error(`value_kind must be literal, datapill, formula, or interpolated`);
}

function requireRecipeId(args: JsonObject): number {
  if (typeof args.recipe_id !== 'number' || !Number.isFinite(args.recipe_id)) {
    throw new Error('recipe_id must be a finite number');
  }
  return args.recipe_id;
}

export function mutateRecipeCode(name: string, args: JsonObject, code: unknown): MutationSummary {
  requireRecipeId(args);

  if (name === WORKATO_RECIPE_MUTATOR_TOOLS.SET_INPUT_PATH) {
    const step = requireStep(code, args.step ?? args.step_number);
    const segments = parseInputPath(args.path);
    const value = normalizeInputValue(args.value, args.value_kind);
    setAtPath(ensureInput(step), segments, value);
    return {
      kind: 'set_input_path',
      step_number: step.number,
      step_as: step.as,
      path: pathToString(segments),
    };
  }

  if (name === WORKATO_RECIPE_MUTATOR_TOOLS.DELETE_INPUT_PATH) {
    const step = requireStep(code, args.step ?? args.step_number);
    const segments = parseInputPath(args.path);
    deleteAtPath(ensureInput(step), segments);
    return {
      kind: 'delete_input_path',
      step_number: step.number,
      step_as: step.as,
      path: pathToString(segments),
    };
  }

  if (name === WORKATO_RECIPE_MUTATOR_TOOLS.SET_PY_EVAL_CODE) {
    const step = requireStep(code, args.step ?? args.step_number);
    if (typeof args.code !== 'string') throw new Error('code must be a string');
    if (
      args.validate_step !== false &&
      (step.provider !== 'py_eval' || step.name !== 'invoke_custom_py_code')
    ) {
      throw new Error('target step is not a py_eval invoke_custom_py_code step');
    }
    ensureInput(step).code = args.code;
    return {
      kind: 'set_py_eval_code',
      step_number: step.number,
      step_as: step.as,
      path: 'code',
    };
  }

  if (name === WORKATO_RECIPE_MUTATOR_TOOLS.SET_EXTENDED_SCHEMA) {
    const step = requireStep(code, args.step ?? args.step_number);
    if (args.kind !== 'extended_input_schema' && args.kind !== 'extended_output_schema') {
      throw new Error('kind must be extended_input_schema or extended_output_schema');
    }
    if (!Array.isArray(args.schema)) throw new Error('schema must be an array');
    step[args.kind] = args.schema;
    return {
      kind: 'set_extended_schema',
      step_number: step.number,
      step_as: step.as,
      schema_kind: args.kind,
    };
  }

  throw new Error(`unsupported recipe mutator tool: ${name}`);
}

export function parseToolJson(result: CallToolResult): JsonObject {
  if (result.isError) {
    const message =
      result.content?.find((item): item is { type: 'text'; text: string } => item.type === 'text')
        ?.text ?? 'tool call failed';
    throw new Error(message);
  }

  const text =
    result.content?.find((item): item is { type: 'text'; text: string } => item.type === 'text')
      ?.text ?? '';
  const candidates = [
    text,
    ...text
      .split(/\r?\n/)
      .reverse()
      .filter((line) => line.trim()),
  ];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (isRecord(parsed)) return parsed;
    } catch {
      /* try next candidate */
    }
  }
  throw new Error('tool response did not contain a JSON object');
}

export function buildMutatorSummary(
  toolName: string,
  input: {
    recipe_id: unknown;
    version_no: unknown;
    code_errors: unknown;
    mutation: MutationSummary;
  },
): CallToolResult {
  const codeErrors = Array.isArray(input.code_errors) ? input.code_errors : [];
  const payload = {
    ok: true,
    recipe_id: input.recipe_id,
    version_no: input.version_no,
    mutation: input.mutation,
    code_errors: codeErrors,
  };
  const text =
    `${toolName} updated recipe ${String(input.recipe_id)} (version ${String(input.version_no)}` +
    (codeErrors.length > 0
      ? `, ${codeErrors.length} validation error${codeErrors.length === 1 ? '' : 's'}`
      : '') +
    `)\n${JSON.stringify(payload)}`;
  return { isError: false, content: [{ type: 'text', text }] };
}

function parseConfig(config: unknown): unknown {
  if (typeof config !== 'string') return config;
  try {
    return JSON.parse(config);
  } catch {
    return config;
  }
}

export async function handleWorkatoRecipeMutatorCall(
  name: string,
  args: JsonObject,
  callExtension: ExtensionCaller,
): Promise<CallToolResult> {
  try {
    if (!isWorkatoRecipeMutatorTool(name)) {
      return errorResult(`unsupported native recipe mutator tool: ${name}`);
    }
    requireRecipeId(args);

    const pullArgs: JsonObject = { recipe_id: args.recipe_id, view: 'full' };
    if (typeof args.tabId === 'number') pullArgs.tabId = args.tabId;
    if (typeof args.windowId === 'number') pullArgs.windowId = args.windowId;

    const pulled = parseToolJson(await callExtension('workato_pull_recipe', pullArgs));
    const code = pulled.code;
    if (!isRecord(code)) throw new Error('workato_pull_recipe did not return a recipe code object');

    const mutation = mutateRecipeCode(name, args, code);
    const version = isRecord(pulled.version) ? pulled.version : {};
    const saveArgs: JsonObject = {
      recipe_id: args.recipe_id,
      code,
      config: parseConfig(version.config),
    };
    if (typeof args.tabId === 'number') saveArgs.tabId = args.tabId;
    if (typeof args.windowId === 'number') saveArgs.windowId = args.windowId;

    const saved = parseToolJson(await callExtension('workato_ui_save_recipe_code', saveArgs));
    return buildMutatorSummary(name, {
      recipe_id: saved.recipe_id ?? args.recipe_id,
      version_no: saved.version_no,
      code_errors: saved.code_errors,
      mutation,
    });
  } catch (error) {
    return errorResult(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
