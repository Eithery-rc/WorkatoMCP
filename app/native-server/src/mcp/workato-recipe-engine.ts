/**
 * @fileoverview The one guarded recipe mutation engine.
 *
 * Every native tool that changes a recipe code tree runs through
 * `runRecipeMutation`: pull once, clone the tree, apply operations to the
 * CLONE, validate locally, merge (never rebuild) the config, save once,
 * summarize once. A half-applied tree never reaches Workato, and a caller
 * always learns whether the result was persisted, valid and verified.
 *
 * The primitives below (path parsing, datapill encoding, step addressing,
 * numbering, validation, config merge) are pure and unit tested; the
 * orchestration at the bottom is the only part that talks to the extension.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { describePyEvalFailure, lintPyEvalSource, type PyLintIssue } from './workato-pyeval-lint';

export type PathSegment = string | number;
export type JsonObject = Record<string, unknown>;
export type ExtensionCaller = (
  name: string,
  args: Record<string, unknown>,
) => Promise<CallToolResult>;

export interface RecipeStep extends JsonObject {
  number?: number;
  as?: string;
  uuid?: string;
  keyword?: string;
  provider?: string;
  name?: string;
  input?: unknown;
  block?: unknown;
}

export interface MutationSummary {
  kind: string;
  step_number?: number;
  step_as?: string;
  path?: string;
  schema_kind?: string;
  /** Non-blocking findings, e.g. a py_eval output shadowing a code_input key. */
  warnings?: PyLintIssue[];
  /** How the Python source was checked, so a skipped compile is never read as a pass. */
  python_check?: string;
  /** Extra per-op detail (inserted keyword, moved anchor, bound provider...). */
  detail?: JsonObject;
}

/** The four surgical mutators plus the batch tool and the three legacy names. */
export const WORKATO_RECIPE_MUTATOR_TOOLS = {
  SET_INPUT_PATH: 'workato_recipe_set_input_path',
  DELETE_INPUT_PATH: 'workato_recipe_delete_input_path',
  SET_PY_EVAL_CODE: 'workato_recipe_set_py_eval_code',
  SET_EXTENDED_SCHEMA: 'workato_recipe_set_extended_schema',
  APPLY: 'workato_recipe_apply',
  ADD_STEP: 'workato_recipe_add_step',
  SET_STEP_INPUT: 'workato_recipe_set_step_input',
  MAP_DATAPILL: 'workato_recipe_map_datapill',
} as const;

export type RecipeMutatorToolName =
  (typeof WORKATO_RECIPE_MUTATOR_TOOLS)[keyof typeof WORKATO_RECIPE_MUTATOR_TOOLS];

export function isWorkatoRecipeMutatorTool(name: string): name is RecipeMutatorToolName {
  return Object.values(WORKATO_RECIPE_MUTATOR_TOOLS).includes(name as RecipeMutatorToolName);
}

const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

/** Adapters observed to carry no `account_id` in a recipe config (skill: code-tree.md). */
export const CONNECTIONLESS_PROVIDERS = new Set([
  'clock',
  'csv_parser',
  'email',
  'logger',
  'py_eval',
  'workato_pub_sub',
  'workato_recipe_function',
  'workato_variable',
]);

const AS_HEX = /^[0-9a-f]{8}$/;
const AS_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/**
 * An operation refused before the save, carrying the fields a caller needs to
 * fix it: which change, which step, and why.
 */
export class RecipeMutationError extends Error {
  readonly details: JsonObject;

  constructor(message: string, details: JsonObject = {}) {
    super(message);
    this.name = 'RecipeMutationError';
    this.details = details;
  }
}

/** Deep copy of a JSON tree. Operations run on the copy so a refusal changes nothing. */
export function cloneTree<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ---------------------------------------------------------------------------
// Input paths
// ---------------------------------------------------------------------------

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

export function pathToString(segments: PathSegment[]): string {
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

export function setAtPath(root: JsonObject, segments: PathSegment[], value: unknown): void {
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

export function deleteAtPath(root: JsonObject, segments: PathSegment[]): void {
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

export function ensureInput(step: RecipeStep): JsonObject {
  if (!isRecord(step.input)) {
    step.input = {};
  }
  return step.input as JsonObject;
}

// ---------------------------------------------------------------------------
// Datapills
// ---------------------------------------------------------------------------

/**
 * Parse the path portion of a datapill shorthand.
 *
 * Two array accessors ride on a path segment, matching what the editor emits:
 *   `rows[]`     -> the element under iteration  {path_element_type:"current_item"}
 *   `rows#size`  -> the collection's length      {path_element_type:"size"}
 */
export function parseDatapillPath(rawPath: string[]): unknown[] {
  const path: unknown[] = [];
  for (const part of rawPath) {
    if (part.endsWith('[]')) {
      const name = part.slice(0, -2);
      if (name.length > 0) path.push(name);
      path.push({ path_element_type: 'current_item' });
    } else if (part.endsWith('#size')) {
      const name = part.slice(0, -'#size'.length);
      if (name.length > 0) path.push(name);
      path.push({ path_element_type: 'size' });
    } else if (part.length > 0) {
      path.push(part);
    }
  }
  return path;
}

export function parseDatapillShorthand(value: string): JsonObject {
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

  return { pill_type: 'output', provider, line, path: parseDatapillPath(rawPath) };
}

/** Normalize a pill spec (object or shorthand) into the compact payload object. */
export function normalizeDatapillSpec(value: unknown): JsonObject {
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
  return pill;
}

/** `#{_dp('<compact json>')}`: the interpolated (text-mode) form. */
export function datapillToInterpolated(value: unknown): string {
  return `#{_dp('${renderDatapillJson(normalizeDatapillSpec(value))}')}`;
}

/** `=_dp('<compact json>')`: the formula-mode form. */
export function datapillToFormula(value: unknown): string {
  return `=_dp('${renderDatapillJson(normalizeDatapillSpec(value))}')`;
}

function renderDatapillJson(pill: JsonObject): string {
  // Workato matches the payload byte-for-byte, so it is serialized compact and
  // single quotes are escaped for the surrounding _dp('...') literal.
  return JSON.stringify(pill).replace(/'/g, "\\'");
}

export function normalizeInputValue(value: unknown, valueKind: unknown): unknown {
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

// ---------------------------------------------------------------------------
// Step addressing
// ---------------------------------------------------------------------------

export interface StepLocation {
  step: RecipeStep;
  /** The node holding `block`, or null for the root. */
  parent: RecipeStep | null;
  /** The block array the step lives in, or null for the root. */
  block: RecipeStep[] | null;
  /** Index of the step inside `block`, or -1 for the root. */
  index: number;
  /** Position in the global depth-first walk (the `number` a healthy tree has). */
  order: number;
}

/** Depth-first walk in the order Workato numbers the tree: root, then blocks. */
export function indexSteps(code: unknown): StepLocation[] {
  const out: StepLocation[] = [];
  if (!isRecord(code)) return out;

  const visit = (
    node: RecipeStep,
    parent: RecipeStep | null,
    block: RecipeStep[] | null,
    index: number,
  ) => {
    out.push({ step: node, parent, block, index, order: out.length });
    if (Array.isArray(node.block)) {
      const children = node.block as RecipeStep[];
      for (let i = 0; i < children.length; i += 1) {
        if (isRecord(children[i])) visit(children[i], node, children, i);
      }
    }
  };

  visit(code as RecipeStep, null, null, -1);
  return out;
}

/** A short, stable label for a step: its `as` when it has one, else `#<number>`. */
export function stepLabel(step: RecipeStep): string {
  if (typeof step.as === 'string' && step.as.length > 0) return step.as;
  if (typeof step.number === 'number') return `#${step.number}`;
  if (typeof step.uuid === 'string' && step.uuid.length > 0) return step.uuid;
  return '#?';
}

/**
 * Resolve a step reference: a number (or all-digit string) matches `number`, a
 * string matches `as` and then `uuid`.
 *
 * A duplicated number is refused rather than resolved to the first hit: a tree
 * corrupted by an older renumbering bug would otherwise silently take the edit
 * on the wrong step.
 */
export function locateStep(code: unknown, stepRef: unknown): StepLocation {
  if (stepRef === undefined || stepRef === null || stepRef === '') {
    throw new Error('step is required and must be a step number, `as` anchor, or uuid');
  }
  const steps = indexSteps(code);

  const wantedNumber =
    typeof stepRef === 'number'
      ? stepRef
      : typeof stepRef === 'string' && /^\d+$/.test(stepRef)
        ? Number(stepRef)
        : null;

  if (wantedNumber !== null) {
    const hits = steps.filter((entry) => entry.step.number === wantedNumber);
    if (hits.length > 1) {
      throw new Error(
        `step number ${wantedNumber} appears ${hits.length} times in this recipe (the tree ` +
          `numbering is corrupted). Address the step by its \`as\` anchor or uuid instead ` +
          `(candidates: ${hits.map((hit) => stepLabel(hit.step)).join(', ')}).`,
      );
    }
    if (hits.length === 1) return hits[0];
  }

  if (typeof stepRef === 'string') {
    const byAs = steps.filter((entry) => entry.step.as === stepRef);
    if (byAs.length > 1) {
      throw new Error(`\`as\` anchor ${stepRef} is not unique in this recipe`);
    }
    if (byAs.length === 1) return byAs[0];
    const byUuid = steps.filter((entry) => entry.step.uuid === stepRef);
    if (byUuid.length === 1) return byUuid[0];
    if (byUuid.length > 1) throw new Error(`uuid ${stepRef} is not unique in this recipe`);
  }

  throw new Error(`step ${String(stepRef)} not found in recipe`);
}

export function findStep(code: unknown, stepRef: unknown): RecipeStep | null {
  try {
    return locateStep(code, stepRef).step;
  } catch {
    return null;
  }
}

export function requireStep(code: unknown, stepRef: unknown): RecipeStep {
  return locateStep(code, stepRef).step;
}

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

export function collectAsAnchors(code: unknown): Set<string> {
  const used = new Set<string>();
  for (const entry of indexSteps(code)) {
    if (typeof entry.step.as === 'string') used.add(entry.step.as);
  }
  return used;
}

/** A fresh 8-hex `as` that does not collide with anything already in the tree. */
export function newAsAnchor(used: Set<string>): string {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = randomBytes(4).toString('hex');
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  throw new Error('could not generate a unique `as` anchor');
}

export function newNodeUuid(): string {
  return randomUUID();
}

// ---------------------------------------------------------------------------
// Numbering and validation
// ---------------------------------------------------------------------------

/** Renumber the WHOLE tree, nested blocks included. Repairs prior corruption. */
export function renumberTree(code: unknown): number {
  const steps = indexSteps(code);
  for (const entry of steps) {
    entry.step.number = entry.order;
  }
  return steps.length;
}

export interface TreeValidation {
  errors: string[];
  warnings: string[];
}

const CONTROL_KEYWORDS_WITH_BLOCK = new Set([
  'trigger',
  'if',
  'elsif',
  'else',
  'foreach',
  'repeat',
  'try',
  'catch',
]);

/**
 * Local structural validation, run before the save.
 *
 * Issues on nodes this call created or changed are errors: the caller can fix
 * them. Issues on untouched nodes are warnings: a recipe that arrived with a
 * pre-existing quirk (a trigger whose `as` is a full uuid, a node saved
 * without one) must still be editable, and refusing the save would only strand
 * the caller.
 */
export function validateRecipeTree(
  code: unknown,
  touched: Set<unknown> = new Set(),
  created: Set<unknown> = new Set(),
): TreeValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const steps = indexSteps(code);

  const report = (nodes: RecipeStep[], message: string) => {
    if (nodes.some((node) => touched.has(node) || created.has(node))) errors.push(message);
    else warnings.push(message);
  };
  // `as` format and uuid presence are only this call's fault on a node it
  // created. A recipe pulled without a uuid on some node, or with the full-uuid
  // `as` Workato itself writes on a recipe_function trigger, must stay editable.
  const reportOnCreated = (nodes: RecipeStep[], message: string) => {
    if (nodes.some((node) => created.has(node))) errors.push(message);
    else warnings.push(message);
  };

  const seenAs = new Map<string, RecipeStep[]>();

  for (const entry of steps) {
    const step = entry.step;
    const label = stepLabel(step);

    if (step.number !== entry.order) {
      report(
        [step],
        `step ${label} has number ${String(step.number)} but is at position ${entry.order} in the tree; ` +
          `numbering must be globally sequential`,
      );
    }

    if (step.as !== undefined) {
      if (typeof step.as !== 'string' || (!AS_HEX.test(step.as) && !AS_UUID.test(step.as))) {
        reportOnCreated(
          [step],
          `step ${label} has an invalid \`as\` (${String(step.as)}); it must be 8 lowercase hex characters`,
        );
      } else {
        const bucket = seenAs.get(step.as) ?? [];
        bucket.push(step);
        seenAs.set(step.as, bucket);
      }
    }

    if (typeof step.uuid !== 'string' || step.uuid.length === 0) {
      reportOnCreated(
        [step],
        `step ${label} has no uuid; Workato rejects a code tree whose nodes lack one`,
      );
    }

    if (step.keyword === 'foreach') {
      const source = step.source;
      if (typeof source !== 'string' || source.length === 0) {
        report(
          [step],
          `foreach ${label} has no \`source\`; it belongs at the node root, not under input`,
        );
      }
      if (isRecord(step.input) && (step.input as JsonObject).source !== undefined) {
        report(
          [step],
          `foreach ${label} carries \`source\` inside input; it belongs at the node root`,
        );
      }
    }

    if (Array.isArray(step.block)) {
      const children = (step.block as unknown[]).filter(isRecord) as RecipeStep[];

      // else / elsif live at the END of the if's own block, never as siblings.
      if (step.keyword === 'if' || step.keyword === 'elsif') {
        let tail = false;
        for (const child of children) {
          const isBranch = child.keyword === 'elsif' || child.keyword === 'else';
          if (isBranch) tail = true;
          else if (tail) {
            report(
              [step, child],
              `step ${stepLabel(child)} sits after an elsif/else inside ${label}.block; ` +
                `elsif and else must be the LAST entries of the if block`,
            );
          }
        }
        const elseIndex = children.findIndex((child) => child.keyword === 'else');
        if (elseIndex >= 0 && elseIndex !== children.length - 1) {
          report([step, children[elseIndex]], `else must be the last entry inside ${label}.block`);
        }
      }

      if (step.keyword === 'try') {
        const catchIndex = children.findIndex((child) => child.keyword === 'catch');
        if (catchIndex >= 0 && catchIndex !== children.length - 1) {
          report(
            [step, children[catchIndex]],
            `catch must be the last entry inside try ${label}.block`,
          );
        }
      }

      if (step.keyword === 'repeat') {
        if (children.length === 0 || children[0].keyword !== 'while_condition') {
          report(
            [step],
            `repeat ${label} must have a while_condition as the first child of its block`,
          );
        }
      }

      for (const child of children) {
        if (
          (child.keyword === 'elsif' || child.keyword === 'else') &&
          step.keyword !== 'if' &&
          step.keyword !== 'elsif'
        ) {
          report(
            [step, child],
            `${child.keyword} may only appear inside an if/elsif block, not inside ${label}`,
          );
        }
        if (child.keyword === 'catch' && step.keyword !== 'try') {
          report([step, child], `catch may only appear inside a try block, not inside ${label}`);
        }
        if (child.keyword === 'while_condition' && step.keyword !== 'repeat') {
          report(
            [step, child],
            `while_condition may only appear inside a repeat block, not inside ${label}`,
          );
        }
      }

      if (!CONTROL_KEYWORDS_WITH_BLOCK.has(String(step.keyword)) && children.length > 0) {
        report([step], `step ${label} (keyword ${String(step.keyword)}) cannot hold nested steps`);
      }
    }
  }

  for (const [anchor, nodes] of seenAs) {
    if (nodes.length > 1) {
      report(
        nodes,
        `\`as\` anchor ${anchor} is used by ${nodes.length} steps; datapills would resolve to the wrong step`,
      );
    }
  }

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Datapill references (used by remove_step)
// ---------------------------------------------------------------------------

const DP_PAYLOAD = /_dp\('((?:[^'\\]|\\.)*)'\)/g;
const VARIABLE_COMPOSITE = /^[0-9a-f-]{8,36}:([0-9a-f]{8})(?::|$)/;

/**
 * Every step outside `exclude` that references one of `anchors`, either through
 * a `_dp(...)` pill line or the `<uuid>:<as>` composite the Variables actions use.
 */
export function findDatapillReferences(
  code: unknown,
  anchors: Set<string>,
  exclude: Set<unknown> = new Set(),
): Array<{ step: string; where: string; anchor: string }> {
  const hits: Array<{ step: string; where: string; anchor: string }> = [];
  if (anchors.size === 0) return hits;

  const scanString = (value: string, step: RecipeStep, where: string) => {
    DP_PAYLOAD.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = DP_PAYLOAD.exec(value)) !== null) {
      try {
        const pill = JSON.parse(match[1].replace(/\\'/g, "'"));
        if (isRecord(pill) && typeof pill.line === 'string' && anchors.has(pill.line)) {
          hits.push({ step: stepLabel(step), where, anchor: pill.line });
        }
      } catch {
        /* an unparseable pill is the save guard's problem, not this one */
      }
    }
    const composite = VARIABLE_COMPOSITE.exec(value);
    if (composite && anchors.has(composite[1])) {
      hits.push({ step: stepLabel(step), where, anchor: composite[1] });
    }
  };

  const walk = (value: unknown, step: RecipeStep, where: string) => {
    if (typeof value === 'string') {
      scanString(value, step, where);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, step, `${where}[${i}]`));
      return;
    }
    if (isRecord(value)) {
      for (const [key, child] of Object.entries(value)) {
        if (key === 'block') continue;
        walk(child, step, where ? `${where}.${key}` : key);
      }
    }
  };

  for (const entry of indexSteps(code)) {
    if (exclude.has(entry.step)) continue;
    for (const [key, value] of Object.entries(entry.step)) {
      if (key === 'block') continue;
      walk(value, entry.step, key);
    }
  }

  return hits;
}

// ---------------------------------------------------------------------------
// Config merge
// ---------------------------------------------------------------------------

export interface ConfigMergeResult {
  config: unknown;
  added: string[];
  bound: string[];
  missing_binding: string[];
  note?: string;
}

export function parseConfig(config: unknown): unknown {
  if (typeof config !== 'string') return config;
  try {
    return JSON.parse(config);
  } catch {
    return config;
  }
}

export function collectProviders(code: unknown): string[] {
  const providers: string[] = [];
  for (const entry of indexSteps(code)) {
    const provider = entry.step.provider;
    if (typeof provider === 'string' && provider.length > 0 && !providers.includes(provider)) {
      providers.push(provider);
    }
  }
  return providers;
}

/**
 * Merge, never rebuild.
 *
 * Every existing entry survives untouched, `account_id` and `skip_validation`
 * included: rebuilding the array from the providers found in the tree is what
 * silently unbound both connections in the audit. Only `newProviders` (the
 * providers this call introduced) can be appended, and only an explicit
 * binding writes an `account_id`.
 */
export function mergeRecipeConfig(
  existingConfig: unknown,
  newProviders: Iterable<string> = [],
  bindings: Map<string, unknown> = new Map(),
): ConfigMergeResult {
  const added: string[] = [];
  const bound: string[] = [];
  const missing: string[] = [];

  if (existingConfig !== undefined && existingConfig !== null && !Array.isArray(existingConfig)) {
    // An unparseable config is passed straight back rather than replaced: a
    // guess here would unbind whatever it actually holds.
    return {
      config: existingConfig,
      added,
      bound,
      missing_binding: missing,
      note: 'the recipe config could not be parsed as an array and was passed through unchanged',
    };
  }

  const source = Array.isArray(existingConfig) ? existingConfig : [];
  const config = source.map((entry) => (isRecord(entry) ? { ...entry } : entry));
  const entryFor = (provider: string): JsonObject | undefined =>
    config.find((entry) => isRecord(entry) && entry.provider === provider) as
      | JsonObject
      | undefined;

  for (const provider of newProviders) {
    if (entryFor(provider)) continue;
    const entry: JsonObject = {
      keyword: 'application',
      name: provider,
      provider,
      skip_validation: false,
    };
    config.push(entry);
    added.push(provider);
  }

  for (const [provider, accountId] of bindings) {
    let entry = entryFor(provider);
    if (!entry) {
      entry = { keyword: 'application', name: provider, provider, skip_validation: false };
      config.push(entry);
      added.push(provider);
    }
    if (accountId === null) {
      delete entry.account_id;
    } else {
      entry.account_id = accountId;
    }
    bound.push(provider);
  }

  for (const provider of added) {
    const entry = entryFor(provider);
    if (!entry || entry.account_id !== undefined) continue;
    if (CONNECTIONLESS_PROVIDERS.has(provider)) continue;
    missing.push(provider);
  }

  return { config, added, bound, missing_binding: missing };
}

// ---------------------------------------------------------------------------
// Per-operation appliers (pure, on an already located step)
// ---------------------------------------------------------------------------

export function applySetInput(step: RecipeStep, args: JsonObject): { path: string } {
  const segments = parseInputPath(args.path);
  const value = normalizeInputValue(args.value, args.value_kind);
  setAtPath(ensureInput(step), segments, value);
  return { path: pathToString(segments) };
}

export function applyDeleteInput(step: RecipeStep, args: JsonObject): { path: string } {
  const segments = parseInputPath(args.path);
  deleteAtPath(ensureInput(step), segments);
  return { path: pathToString(segments) };
}

export function applySetPyEvalCode(
  step: RecipeStep,
  args: JsonObject,
): { warnings: PyLintIssue[] } {
  if (typeof args.code !== 'string') throw new Error('code must be a string');
  if (
    args.validate_step !== false &&
    (step.provider !== 'py_eval' || step.name !== 'invoke_custom_py_code')
  ) {
    throw new Error('target step is not a py_eval invoke_custom_py_code step');
  }

  // A py_eval step's declared inputs arrive as variables of the same name, so
  // an output reusing one silently destroys the input. Structural errors refuse
  // the save outright.
  const input = ensureInput(step);
  const codeInput = isRecord(input.code_input) ? Object.keys(input.code_input) : [];
  const lint = lintPyEvalSource(args.code, codeInput);
  if (lint.errors.length > 0) {
    throw new Error(describePyEvalFailure(lint, null, 'the code being written'));
  }
  input.code = args.code;
  return { warnings: lint.warnings };
}

export function applySetExtendedSchema(step: RecipeStep, args: JsonObject): { kind: string } {
  if (args.kind !== 'extended_input_schema' && args.kind !== 'extended_output_schema') {
    throw new Error('kind must be extended_input_schema or extended_output_schema');
  }
  if (!Array.isArray(args.schema)) throw new Error('schema must be an array');
  step[args.kind] = args.schema;
  return { kind: args.kind };
}

// ---------------------------------------------------------------------------
// Response formatting
// ---------------------------------------------------------------------------

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

/** Save-response fields a mutator caller must not lose to the summary. */
const SAVE_SIGNAL_KEYS = [
  'save_status',
  'was_running',
  'running_after_save',
  'restarted',
  'restart_error',
  'stopped_at',
  'datapills_normalized',
  'verification_error',
  'value_mismatches',
  'version_no_unknown',
  'base_version_no',
  'py_eval_warnings',
] as const;

export interface MutatorSummaryInput {
  recipe_id: unknown;
  version_no: unknown;
  code_errors: unknown;
  mutation: MutationSummary;
  /** Every operation applied, for the batch tool. Defaults to [mutation]. */
  mutations?: MutationSummary[];
  /**
   * The underlying save's own report. A mutator that silently swallowed it
   * would hand back a clean "updated recipe N" for a save that left the
   * recipe stopped, or whose readback could not be verified at all.
   */
  save?: JsonObject;
  changed_paths?: string[];
  validation_warnings?: string[];
  notices?: string[];
  config_notes?: JsonObject;
  /** No save was attempted; the summary describes what a save would do. */
  dry_run?: boolean;
  would_save_version?: unknown;
  /** What the caller asked of the readback guard, so `verified` cannot lie. */
  verify_readback?: unknown;
}

export function buildMutatorSummary(toolName: string, input: MutatorSummaryInput): CallToolResult {
  const codeErrors = Array.isArray(input.code_errors) ? input.code_errors : [];
  const save = input.save ?? {};
  const dryRun = input.dry_run === true;

  const payload: JsonObject = {
    ok: true,
    recipe_id: input.recipe_id,
    version_no: input.version_no,
    mutation: input.mutation,
    code_errors: codeErrors,
  };
  if (input.mutations && input.mutations.length > 1) payload.mutations = input.mutations;

  // Request accepted, state reached, persisted, valid, verified are different
  // outcomes. A save that stored a tree Workato rejects is persisted and NOT
  // valid, and saying so is the whole point of these three booleans.
  const persisted = dryRun ? false : save.save_status !== 'persisted_incomplete';
  const valid = codeErrors.length === 0;
  const verified = dryRun
    ? false
    : input.verify_readback === false
      ? false
      : typeof save.verification_error !== 'string' &&
        !(Array.isArray(save.value_mismatches) && save.value_mismatches.length > 0) &&
        save.save_status !== 'succeeded_after_timeout';
  payload.persisted = persisted;
  payload.valid = valid;
  payload.verified = verified;

  if (dryRun) {
    payload.dry_run = true;
    if (input.would_save_version !== undefined)
      payload.would_save_version = input.would_save_version;
  }
  if (input.changed_paths) payload.changed_paths = input.changed_paths;
  if (input.validation_warnings && input.validation_warnings.length > 0) {
    payload.validation_warnings = input.validation_warnings;
  }
  if (input.config_notes && Object.keys(input.config_notes).length > 0) {
    payload.config = input.config_notes;
  }

  const lintWarnings = (input.mutations ?? [input.mutation]).flatMap((mutation) =>
    Array.isArray(mutation.warnings) ? mutation.warnings : [],
  );
  for (const key of SAVE_SIGNAL_KEYS) {
    if (save[key] !== undefined) payload[key] = save[key];
  }

  // A recipe left stopped, or a readback that never happened, has to reach the
  // first line, the payload alone is too easy to skim past.
  const notices: string[] = [...(input.notices ?? [])];
  if (!dryRun && !valid) notices.push('persisted but INVALID (Workato reported validation errors)');
  if (save.running_after_save === false) {
    notices.push('recipe is STOPPED (pass ensure_running:true to start it)');
  }
  if (save.restarted === false) notices.push('RESTART FAILED, recipe is stopped');
  if (typeof save.verification_error === 'string') {
    notices.push(`readback NOT verified: ${save.verification_error}`);
  }
  if (save.save_status === 'already_applied') {
    notices.push('already at this tree, no new version created');
  }
  // Pre-existing quirks in an untouched part of the tree are worth saying once,
  // not once per node on a large recipe.
  const treeWarnings = input.validation_warnings ?? [];
  for (const warning of treeWarnings.slice(0, 3)) {
    notices.push(`tree warning: ${warning}`);
  }
  if (treeWarnings.length > 3) {
    notices.push(`${treeWarnings.length - 3} more tree warnings in validation_warnings`);
  }
  // A shadowed input produces wrong data with no error anywhere, so it has to
  // reach the first line rather than sit inside the payload.
  for (const warning of lintWarnings) {
    notices.push(`WARNING line ${warning.line}: ${warning.message}`);
  }

  const versionLabel =
    input.version_no === undefined || input.version_no === null
      ? 'version unknown'
      : `version ${String(input.version_no)}`;
  const headline = dryRun
    ? `${toolName} dry run on recipe ${String(input.recipe_id)} (nothing saved, base ${versionLabel}`
    : `${toolName} updated recipe ${String(input.recipe_id)} (${versionLabel}`;
  const text =
    headline +
    (codeErrors.length > 0
      ? `, ${codeErrors.length} validation error${codeErrors.length === 1 ? '' : 's'}`
      : '') +
    notices.map((n) => `, ${n}`).join('') +
    `)\n${JSON.stringify(payload)}`;
  return { isError: false, content: [{ type: 'text', text }] };
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export interface RecipeMutationContext {
  /** The CLONE of the pulled tree. Operations mutate this, never the pulled object. */
  readonly code: RecipeStep;
  /**
   * Swap in a rebuilt tree, for an operation that returns a new object rather
   * than mutating in place. Clears the touched set: re-`touch` whatever the
   * operation changed, or its issues are reported as pre-existing.
   */
  replaceCode(next: RecipeStep): void;
  /** The pulled `version` block (version_no, name, config, folder_id...). */
  readonly version: JsonObject;
  /** Resolve a step by number, `as`, or uuid. Throws with a usable message. */
  locate(stepRef: unknown): StepLocation;
  /** Mark a node as changed by this call (drives error vs warning on validation). */
  touch(node: RecipeStep): void;
  /** Mark a node as CREATED by this call: every rule is an error on it. */
  create(node: RecipeStep): void;
  /** Record a changed path for the summary. */
  change(path: string): void;
  /** Add a first-line notice. */
  note(text: string): void;
  /** Ask for a whole-tree renumber (any structural change must). */
  requestRenumber(): void;
  /** Bind a provider to a connection id in the config (null clears it). */
  bindProvider(provider: string, accountId: unknown): void;
  /** A fresh `as` that does not collide with the tree. */
  newAs(): string;
  newUuid(): string;
}

export interface RunRecipeMutationOptions {
  /** Tool name, used for routing the summary text and errors. */
  name: string;
  recipe_id: number;
  args: JsonObject;
  callExtension: ExtensionCaller;
  apply: (
    ctx: RecipeMutationContext,
  ) => MutationSummary | MutationSummary[] | Promise<MutationSummary | MutationSummary[]>;
  dry_run?: boolean;
  /** Version comment used when the caller passed none. */
  defaultComment?: string;
}

/**
 * Pull once, mutate a clone, validate, merge config, save once, summarize once.
 */
export async function runRecipeMutation(
  options: RunRecipeMutationOptions,
): Promise<CallToolResult> {
  const { name, recipe_id, args, callExtension } = options;

  const pullArgs: JsonObject = { recipe_id, view: 'full' };
  if (typeof args.tabId === 'number') pullArgs.tabId = args.tabId;
  if (typeof args.windowId === 'number') pullArgs.windowId = args.windowId;

  const pulled = parseToolJson(await callExtension('workato_pull_recipe', pullArgs));
  if (!isRecord(pulled.code)) {
    throw new Error('workato_pull_recipe did not return a recipe code object');
  }
  const version = isRecord(pulled.version) ? pulled.version : {};

  // A caller who pinned a base version is telling us what they read. If the
  // recipe has moved on since, refuse here rather than at the save: the
  // operations would be computed against a tree the caller never saw.
  if (
    typeof args.expected_base_version_no === 'number' &&
    typeof version.version_no === 'number' &&
    args.expected_base_version_no !== version.version_no
  ) {
    throw new RecipeMutationError(
      `recipe ${recipe_id} is at version ${version.version_no} but expected_base_version_no is ` +
        `${args.expected_base_version_no}. Someone else saved in between; nothing was changed. ` +
        `Re-read the recipe and reapply the change against the current version.`,
      {
        stage: 'version_lock',
        expected_base_version_no: args.expected_base_version_no,
        current_version_no: version.version_no,
      },
    );
  }

  // Everything below runs on the clone: a refusal at any point leaves the
  // pulled tree, and therefore Workato, untouched.
  let code = cloneTree(pulled.code) as RecipeStep;

  const touched = new Set<unknown>();
  const created = new Set<unknown>();
  const changedPaths: string[] = [];
  const notices: string[] = [];
  const bindings = new Map<string, unknown>();
  const newProviders = new Set<string>();
  const anchors = collectAsAnchors(code);
  let renumber = false;

  const ctx: RecipeMutationContext = {
    get code() {
      return code;
    },
    replaceCode: (next) => {
      code = next;
      touched.clear();
      created.clear();
    },
    version,
    locate: (stepRef) => locateStep(code, stepRef),
    touch: (node) => touched.add(node),
    create: (node) => {
      created.add(node);
      touched.add(node);
      // A provider the recipe did not use before needs its own config entry.
      if (typeof node.provider === 'string' && node.provider.length > 0) {
        newProviders.add(node.provider);
      }
    },
    change: (path) => {
      if (!changedPaths.includes(path)) changedPaths.push(path);
    },
    note: (text) => notices.push(text),
    requestRenumber: () => {
      renumber = true;
    },
    bindProvider: (provider, accountId) => bindings.set(provider, accountId),
    newAs: () => newAsAnchor(anchors),
    newUuid: () => newNodeUuid(),
  };

  const applied = await options.apply(ctx);
  const mutations = Array.isArray(applied) ? applied : [applied];
  if (mutations.length === 0) {
    throw new RecipeMutationError('nothing to apply', { stage: 'apply' });
  }

  if (renumber) renumberTree(code);

  const validation = validateRecipeTree(code, touched, created);
  if (validation.errors.length > 0) {
    throw new RecipeMutationError(
      `local validation refused the change before saving:\n- ${validation.errors.join('\n- ')}`,
      { stage: 'validate', errors: validation.errors },
    );
  }

  const merged = mergeRecipeConfig(parseConfig(version.config), newProviders, bindings);
  const configNotes: JsonObject = {};
  if (merged.added.length > 0) configNotes.added_providers = merged.added;
  if (merged.bound.length > 0) configNotes.bound_providers = merged.bound;
  if (merged.missing_binding.length > 0) {
    configNotes.connection_binding = 'missing';
    configNotes.unbound_providers = merged.missing_binding;
    notices.push(
      `connection_binding: missing for ${merged.missing_binding.join(', ')} ` +
        `(pass connection_id, or bind_connection, before the recipe can start)`,
    );
  }
  if (merged.note) notices.push(merged.note);

  const baseVersion = typeof version.version_no === 'number' ? version.version_no : undefined;

  if (options.dry_run === true) {
    return buildMutatorSummary(name, {
      recipe_id,
      version_no: baseVersion,
      code_errors: [],
      mutation: mutations[0],
      mutations,
      changed_paths: changedPaths,
      validation_warnings: validation.warnings,
      notices,
      config_notes: configNotes,
      dry_run: true,
      would_save_version: baseVersion === undefined ? undefined : baseVersion + 1,
      verify_readback: args.verify_readback,
    });
  }

  const saveArgs: JsonObject = { recipe_id, code, config: merged.config };
  if (typeof args.tabId === 'number') saveArgs.tabId = args.tabId;
  if (typeof args.windowId === 'number') saveArgs.windowId = args.windowId;
  // Pass through save modifiers so one call can also handle a running recipe
  // (stop, save, restart) and annotate the new version.
  if (args.restart_if_running === true) saveArgs.restart_if_running = true;
  if (args.ensure_running === true) saveArgs.ensure_running = true;
  if (typeof args.comment === 'string') saveArgs.comment = args.comment;
  else if (options.defaultComment) saveArgs.comment = options.defaultComment;
  // The readback guard is on by default; a caller needs the same opt-out the
  // save tool gives, or a false positive leaves them no way past.
  if (args.verify_readback === false) saveArgs.verify_readback = false;
  // Optimistic lock: this call just pulled the recipe, so pin the save to the
  // version it mutated unless the caller supplied their own expectation.
  if (typeof args.expected_base_version_no === 'number') {
    saveArgs.expected_base_version_no = args.expected_base_version_no;
  } else if (baseVersion !== undefined) {
    saveArgs.expected_base_version_no = baseVersion;
  }

  const saved = parseToolJson(await callExtension('workato_ui_save_recipe_code', saveArgs));
  return buildMutatorSummary(name, {
    recipe_id: saved.recipe_id ?? recipe_id,
    version_no: saved.version_no,
    code_errors: saved.code_errors,
    mutation: mutations[0],
    mutations,
    save: saved,
    changed_paths: changedPaths,
    validation_warnings: validation.warnings,
    notices,
    config_notes: configNotes,
    verify_readback: args.verify_readback,
  });
}

export function requireRecipeId(args: JsonObject, key = 'recipe_id'): number {
  const value = args[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number`);
  }
  return value;
}
