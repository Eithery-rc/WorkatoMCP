/**
 * Pure logic behind the environment and deployment tools: resolving an
 * environment or workspace from what the caller typed, choosing which project
 * assets go into a deployment, joining the source manifest with Workato's diff,
 * the step-level recipe diff with environment remaps taken out, and the run
 * state machine. No chrome.* and no fetch here, so all of it is unit tested.
 *
 * Shapes are the ones captured live on 2026-09-29 (Legacy workspace, Dev
 * 8070978 to Prod 8070980, deployment 313765); see the deploy capture notes
 * summarised in platform-endpoints.md.
 */

import { collectSteps, type StepEntry } from './version-diff';

// ---------------------------------------------------------------------------
// Environments and workspaces
// ---------------------------------------------------------------------------

export interface EnvironmentRef {
  id: number;
  name: string;
  type: string;
}

export interface WorkspaceRef {
  id: number;
  name: string;
}

export type Resolved<T> = { ok: true; value: T } | { ok: false; error: string };

const ENV_TYPE_ALIASES: Record<string, string> = {
  dev: 'dev',
  development: 'dev',
  test: 'test',
  testing: 'test',
  prod: 'prod',
  production: 'prod',
};

function describeEnvs(envs: EnvironmentRef[]): string {
  return envs.map((e) => `${e.name} (${e.type}, id ${e.id})`).join(', ') || '(none)';
}

/**
 * Pick one environment from `envs`. Accepts a numeric id (number or digits),
 * a type alias (dev/development, test, prod/production), or an exact name,
 * case-insensitive. A type shared by two environments is ambiguous.
 */
export function resolveEnvironment(
  query: unknown,
  envs: EnvironmentRef[],
): Resolved<EnvironmentRef> {
  if (typeof query === 'number' || (typeof query === 'string' && /^\d+$/.test(query.trim()))) {
    const id = Number(query);
    const hit = envs.find((e) => e.id === id);
    return hit
      ? { ok: true, value: hit }
      : { ok: false, error: `No environment with id ${id}. Available: ${describeEnvs(envs)}` };
  }
  if (typeof query !== 'string' || query.trim() === '') {
    return { ok: false, error: 'environment must be dev, test, prod, an environment name or id' };
  }
  const wanted = query.trim().toLowerCase();
  const type = ENV_TYPE_ALIASES[wanted];
  if (type) {
    const byType = envs.filter((e) => e.type === type);
    if (byType.length === 1) return { ok: true, value: byType[0] };
    if (byType.length > 1) {
      return {
        ok: false,
        error: `"${query}" matches ${byType.length} environments: ${describeEnvs(byType)}. Pass the name or id.`,
      };
    }
  }
  const byName = envs.filter((e) => e.name.toLowerCase() === wanted);
  if (byName.length === 1) return { ok: true, value: byName[0] };
  return {
    ok: false,
    error: `No environment matches "${query}". Available: ${describeEnvs(envs)}`,
  };
}

/**
 * Pick one workspace. A numeric id matches exactly; a name matches exactly
 * (case-insensitive) first, else as a unique substring. Ambiguity and misses
 * name the candidates instead of guessing.
 */
export function resolveWorkspace(query: unknown, teams: WorkspaceRef[]): Resolved<WorkspaceRef> {
  const list = () => teams.map((t) => `${t.name} (${t.id})`).join(', ') || '(none)';
  if (typeof query === 'number' || (typeof query === 'string' && /^\d+$/.test(query.trim()))) {
    const id = Number(query);
    const hit = teams.find((t) => t.id === id);
    return hit
      ? { ok: true, value: hit }
      : { ok: false, error: `No workspace with id ${id} for this user. Available: ${list()}` };
  }
  if (typeof query !== 'string' || query.trim() === '') {
    return { ok: false, error: 'workspace must be a workspace name or id' };
  }
  const wanted = query.trim().toLowerCase();
  const exact = teams.filter((t) => t.name.toLowerCase() === wanted);
  if (exact.length === 1) return { ok: true, value: exact[0] };
  if (exact.length > 1) {
    return {
      ok: false,
      error: `"${query}" names ${exact.length} workspaces: ${exact.map((t) => `${t.name} (${t.id})`).join(', ')}. Pass the id.`,
    };
  }
  const partial = teams.filter((t) => t.name.toLowerCase().includes(wanted));
  if (partial.length === 1) return { ok: true, value: partial[0] };
  if (partial.length > 1) {
    return {
      ok: false,
      error: `"${query}" matches several workspaces: ${partial.map((t) => `${t.name} (${t.id})`).join(', ')}. Be more specific or pass the id.`,
    };
  }
  return { ok: false, error: `No workspace matches "${query}". Available: ${list()}` };
}

// ---------------------------------------------------------------------------
// Manifest selection
// ---------------------------------------------------------------------------

/** One asset of `project_build.manifest`, as Workato returns and accepts it. */
export interface ManifestAsset {
  id: number;
  name: string;
  type: string;
  zip_name?: string;
  checked?: boolean;
  deps?: Array<{ id: number; type: string; name?: string; unreachable?: boolean }>;
  include_data?: boolean;
  include_test_cases?: boolean;
  [key: string]: unknown;
}

export type AssetSelection = 'recipe_with_deps' | 'all';

export interface SelectManifestOptions {
  mode: AssetSelection;
  recipeId?: number;
  include?: number[];
  exclude?: number[];
}

function assetKey(type: string, id: number | string): string {
  return `${type}:${id}`;
}

/**
 * Set `checked` on every manifest asset.
 *
 * recipe_with_deps reproduces the recipe page's "Deploy to" preselection seen
 * live: the recipe plus the transitive closure of its deps that are assets of
 * this project (connections outside the project come back `unreachable` and
 * are not in the manifest). A recipe that CALLS this one is not a dep and stays
 * out. include / exclude then toggle by source asset id, exclude winning.
 */
export function selectManifest(
  manifest: ManifestAsset[],
  options: SelectManifestOptions,
): Resolved<ManifestAsset[]> {
  const byKey = new Map(manifest.map((a) => [assetKey(a.type, a.id), a]));
  let selected: Set<string>;
  if (options.mode === 'recipe_with_deps') {
    if (typeof options.recipeId !== 'number') {
      return { ok: false, error: 'recipe_with_deps needs recipe_id' };
    }
    const root = byKey.get(assetKey('recipe', options.recipeId));
    if (!root) {
      return {
        ok: false,
        error: `Recipe ${options.recipeId} is not in this project's deployment manifest.`,
      };
    }
    selected = new Set();
    const queue: ManifestAsset[] = [root];
    while (queue.length > 0) {
      const asset = queue.shift() as ManifestAsset;
      const key = assetKey(asset.type, asset.id);
      if (selected.has(key)) continue;
      selected.add(key);
      for (const dep of asset.deps ?? []) {
        const next = byKey.get(assetKey(dep.type, dep.id));
        if (next && !selected.has(assetKey(next.type, next.id))) queue.push(next);
      }
    }
  } else {
    selected = new Set(manifest.map((a) => assetKey(a.type, a.id)));
  }

  const include = new Set((options.include ?? []).map(Number));
  const exclude = new Set((options.exclude ?? []).map(Number));
  const known = new Set(manifest.map((a) => a.id));
  const unknown = [...include, ...exclude].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `Asset id(s) ${unknown.join(', ')} are not in this project's manifest. Assets: ${manifest
        .map((a) => `${a.name} (${a.type} ${a.id})`)
        .join(', ')}`,
    };
  }

  const out = manifest.map((asset) => {
    let checked = selected.has(assetKey(asset.type, asset.id));
    if (include.has(asset.id)) checked = true;
    if (exclude.has(asset.id)) checked = false;
    return { ...asset, checked };
  });
  if (!out.some((a) => a.checked)) {
    return { ok: false, error: 'Nothing is selected for deployment after include/exclude.' };
  }
  return { ok: true, value: out };
}

// ---------------------------------------------------------------------------
// Plan: manifest joined with manifest_with_diff
// ---------------------------------------------------------------------------

/** One asset of `manifest_with_diff`: ids here are TARGET environment ids. */
export interface DiffAsset {
  id: number;
  name: string;
  type: string;
  state: string;
  zip_name?: string;
  changes?: string[];
  running?: boolean;
  folder?: string;
  include_data?: boolean;
  include_test_cases?: boolean;
  contains_data?: boolean;
}

export interface PlanAsset {
  name: string;
  type: string;
  source_id: number | null;
  target_id: number | null;
  state: string;
  changes?: string[];
  running?: boolean;
  checked: true;
  folder?: string;
  include_data?: boolean;
  include_test_cases?: boolean;
}

export interface PlanJoin {
  summary: { added: number; updated: number; unchanged: number; other?: number };
  assets: PlanAsset[];
  not_included: Array<{ name: string; type: string; source_id: number }>;
  will_stop: Array<{ name: string; source_id: number | null; target_id: number | null }>;
  /** source asset id -> target asset id, for recognising remapped ids in a recipe diff. */
  id_map: Map<string, string>;
}

const ADDED_STATES = new Set(['new', 'added', 'add', 'create', 'created']);
const UPDATED_STATES = new Set(['changed', 'updated', 'update', 'modified']);
export const UNCHANGED_STATES = new Set(['no_change', 'unchanged', 'same']);

/**
 * Join the source manifest (source ids, `checked`) with Workato's diff (target
 * ids, state). They share `zip_name`; the diff only lists checked assets.
 */
export function joinPlan(manifest: ManifestAsset[], withDiff: DiffAsset[]): PlanJoin {
  const byZip = new Map(
    manifest.filter((a) => typeof a.zip_name === 'string').map((a) => [a.zip_name as string, a]),
  );
  const summary = { added: 0, updated: 0, unchanged: 0, other: 0 };
  const assets: PlanAsset[] = [];
  const willStop: PlanJoin['will_stop'] = [];
  const idMap = new Map<string, string>();

  for (const item of withDiff) {
    const source = item.zip_name ? byZip.get(item.zip_name) : undefined;
    const state = String(item.state ?? 'unknown');
    if (ADDED_STATES.has(state)) summary.added += 1;
    else if (UPDATED_STATES.has(state)) summary.updated += 1;
    else if (UNCHANGED_STATES.has(state)) summary.unchanged += 1;
    else summary.other += 1;

    const asset: PlanAsset = {
      name: item.name,
      type: item.type,
      source_id: source ? source.id : null,
      target_id: typeof item.id === 'number' ? item.id : null,
      state,
      checked: true,
    };
    if (Array.isArray(item.changes) && item.changes.length > 0) asset.changes = item.changes;
    if (typeof item.running === 'boolean') asset.running = item.running;
    if (item.folder !== undefined) asset.folder = item.folder;
    if (typeof item.include_data === 'boolean') asset.include_data = item.include_data;
    if (typeof item.include_test_cases === 'boolean') {
      asset.include_test_cases = item.include_test_cases;
    }
    assets.push(asset);

    if (asset.source_id !== null && asset.target_id !== null) {
      idMap.set(String(asset.source_id), String(asset.target_id));
    }
    if (item.type === 'recipe' && item.running === true && !UNCHANGED_STATES.has(state)) {
      willStop.push({ name: item.name, source_id: asset.source_id, target_id: asset.target_id });
    }
  }

  const summaryOut: PlanJoin['summary'] = {
    added: summary.added,
    updated: summary.updated,
    unchanged: summary.unchanged,
  };
  if (summary.other > 0) summaryOut.other = summary.other;

  return {
    summary: summaryOut,
    assets,
    not_included: manifest
      .filter((a) => a.checked === false)
      .map((a) => ({ name: a.name, type: a.type, source_id: a.id })),
    will_stop: willStop,
    id_map: idMap,
  };
}

// ---------------------------------------------------------------------------
// Unified line diff
// ---------------------------------------------------------------------------

/** DP cells above which the middle of a diff is shown as one replace block. */
const LCS_CELL_LIMIT = 4_000_000;

type LineOp = { op: ' ' | '-' | '+'; line: string; a: number; b: number };

function lineOps(a: string[], b: string[]): LineOp[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const ops: LineOp[] = [];
  for (let i = 0; i < start; i += 1) ops.push({ op: ' ', line: a[i], a: i, b: i });

  const n = endA - start;
  const m = endB - start;
  if (n * m <= LCS_CELL_LIMIT && n > 0 && m > 0) {
    // lcs[i][j] = LCS length of a[start+i..endA) and b[start+j..endB)
    const width = m + 1;
    const lcs = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        lcs[i * width + j] =
          a[start + i] === b[start + j]
            ? lcs[(i + 1) * width + j + 1] + 1
            : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) {
        ops.push({ op: ' ', line: a[start + i], a: start + i, b: start + j });
        i += 1;
        j += 1;
      } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
        ops.push({ op: '-', line: a[start + i], a: start + i, b: start + j });
        i += 1;
      } else {
        ops.push({ op: '+', line: b[start + j], a: start + i, b: start + j });
        j += 1;
      }
    }
    for (; i < n; i += 1) ops.push({ op: '-', line: a[start + i], a: start + i, b: endB });
    for (; j < m; j += 1) ops.push({ op: '+', line: b[start + j], a: endA, b: start + j });
  } else {
    for (let i = start; i < endA; i += 1) ops.push({ op: '-', line: a[i], a: i, b: start });
    for (let j = start; j < endB; j += 1) ops.push({ op: '+', line: b[j], a: endA, b: j });
  }
  for (let k = 0; k < a.length - endA; k += 1) {
    ops.push({ op: ' ', line: a[endA + k], a: endA + k, b: endB + k });
  }
  return ops;
}

export interface UnifiedDiff {
  diff: string;
  /** Lines of the complete diff, before the cap. */
  total_lines: number;
  truncated: boolean;
  added_lines: number;
  removed_lines: number;
}

/**
 * Unified diff of two texts (`before` = what the target runs now, `after` =
 * what the deployment writes), with `context` lines around each hunk and at
 * most `maxLines` output lines.
 */
export function unifiedDiff(
  before: string,
  after: string,
  options: { context?: number; maxLines?: number; labels?: [string, string] } = {},
): UnifiedDiff {
  const context = options.context ?? 2;
  const maxLines = options.maxLines ?? 150;
  const [labelA, labelB] = options.labels ?? ['target (now)', 'source (deploys)'];
  const ops = lineOps(before.split('\n'), after.split('\n'));

  const lines: string[] = [`--- ${labelA}`, `+++ ${labelB}`];
  let added = 0;
  let removed = 0;
  let k = 0;
  while (k < ops.length) {
    if (ops[k].op === ' ') {
      k += 1;
      continue;
    }
    // Hunk: back up `context` lines, then run until `2*context` unchanged lines in a row.
    let first = k;
    let back = 0;
    while (first > 0 && ops[first - 1].op === ' ' && back < context) {
      first -= 1;
      back += 1;
    }
    let last = k;
    let quiet = 0;
    let scan = k;
    while (scan < ops.length) {
      if (ops[scan].op === ' ') {
        quiet += 1;
        if (quiet > context * 2) break;
      } else {
        quiet = 0;
        last = scan;
      }
      scan += 1;
    }
    let end = last;
    let fwd = 0;
    while (end + 1 < ops.length && ops[end + 1].op === ' ' && fwd < context) {
      end += 1;
      fwd += 1;
    }
    const hunk = ops.slice(first, end + 1);
    const aLines = hunk.filter((o) => o.op !== '+').length;
    const bLines = hunk.filter((o) => o.op !== '-').length;
    const aStart = hunk[0].a + 1;
    const bStart = hunk[0].b + 1;
    lines.push(`@@ -${aStart},${aLines} +${bStart},${bLines} @@`);
    for (const o of hunk) {
      lines.push(`${o.op}${o.line}`);
      if (o.op === '+') added += 1;
      if (o.op === '-') removed += 1;
    }
    k = end + 1;
  }

  const truncated = lines.length > maxLines;
  return {
    diff: (truncated ? lines.slice(0, maxLines) : lines).join('\n'),
    total_lines: lines.length,
    truncated,
    added_lines: added,
    removed_lines: removed,
  };
}

// ---------------------------------------------------------------------------
// Recipe diff with environment remaps taken out
// ---------------------------------------------------------------------------

export interface StepFieldChange {
  path: string;
  kind: 'code' | 'value';
  diff?: string;
  total_lines?: number;
  truncated?: boolean;
  before?: string;
  after?: string;
}

export interface StepHeaderSlim {
  as: string;
  number?: number;
  keyword?: string;
  provider?: string;
  name?: string;
  title?: string;
}

export interface RecipeRemap {
  as: string;
  path: string;
  type?: string;
  name?: string;
  /** Id in the source environment (what the deployment carries). */
  from: string;
  /** Id in the target environment (what it is rewritten to). */
  to: string;
}

export interface RecipeDeployDiff {
  steps_changed: Array<StepHeaderSlim & { fields: StepFieldChange[] }>;
  steps_added: StepHeaderSlim[];
  steps_removed: StepHeaderSlim[];
  remaps: RecipeRemap[];
  connection_config?: { before: string; after: string };
}

const STEP_IGNORED_KEYS = new Set(['block', 'number', 'uuid']);
const VALUE_EXCERPT_CHARS = 300;
const CODE_DIFF_MAX_LINES = 150;
const MAX_FIELDS_PER_STEP = 40;

function header(step: StepEntry): StepHeaderSlim {
  const out: StepHeaderSlim = { as: step.as ?? step.key };
  if (step.number !== undefined) out.number = step.number;
  if (step.keyword) out.keyword = step.keyword;
  if (step.provider) out.provider = step.provider;
  if (step.name) out.name = step.name;
  if (step.title) out.title = step.title;
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** {id, type, name} as Workato writes a reference to another asset (table_id, flow_id). */
function isAssetRef(v: unknown): v is { id: string | number; type: string; name: string } {
  return (
    isPlainObject(v) &&
    (typeof v.id === 'string' || typeof v.id === 'number') &&
    typeof v.type === 'string' &&
    typeof v.name === 'string'
  );
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(',')}}`;
  }
  const s = JSON.stringify(value);
  return s === undefined ? 'undefined' : s;
}

function excerptValue(value: unknown): string {
  const s = typeof value === 'string' ? value : stableStringify(value);
  return s.length <= VALUE_EXCERPT_CHARS
    ? s
    : `${s.slice(0, VALUE_EXCERPT_CHARS)}...(+${s.length - VALUE_EXCERPT_CHARS} chars)`;
}

function isIdLike(v: unknown): boolean {
  return (
    (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^\d+$/.test(v))
  );
}

function diffStepValues(
  target: unknown,
  source: unknown,
  path: string,
  as: string,
  idMap: Map<string, string>,
  fields: StepFieldChange[],
  remaps: RecipeRemap[],
): void {
  if (fields.length >= MAX_FIELDS_PER_STEP) return;
  if (stableStringify(target) === stableStringify(source)) return;

  if (
    isAssetRef(target) &&
    isAssetRef(source) &&
    target.type === source.type &&
    target.name === source.name &&
    String(target.id) !== String(source.id) &&
    // Only this deployment's own source->target mapping makes it a remap: a
    // same-named ref to some OTHER asset is a rewire and must show as a change.
    idMap.get(String(source.id)) === String(target.id)
  ) {
    remaps.push({
      as,
      path,
      type: source.type,
      name: source.name,
      from: String(source.id),
      to: String(target.id),
    });
    return;
  }

  if (isPlainObject(target) && isPlainObject(source)) {
    const keys = new Set([...Object.keys(target), ...Object.keys(source)]);
    for (const key of keys) {
      if (path === '' && STEP_IGNORED_KEYS.has(key)) continue;
      diffStepValues(
        target[key],
        source[key],
        path === '' ? key : `${path}.${key}`,
        as,
        idMap,
        fields,
        remaps,
      );
    }
    return;
  }

  // A bare id that the deployment maps from source to target is a remap too.
  if (isIdLike(target) && isIdLike(source) && idMap.get(String(source)) === String(target)) {
    remaps.push({ as, path, from: String(source), to: String(target) });
    return;
  }

  const multiline =
    typeof target === 'string' &&
    typeof source === 'string' &&
    (target.includes('\n') || source.includes('\n'));
  if (multiline) {
    const d = unifiedDiff(target as string, source as string, { maxLines: CODE_DIFF_MAX_LINES });
    fields.push({
      path,
      kind: 'code',
      diff: d.diff,
      total_lines: d.total_lines,
      truncated: d.truncated,
    });
    return;
  }
  const change: StepFieldChange = { path, kind: 'value' };
  if (target !== undefined) change.before = excerptValue(target);
  if (source !== undefined) change.after = excerptValue(source);
  fields.push(change);
}

function parseCode(code: unknown): unknown {
  if (typeof code !== 'string') return code;
  try {
    return JSON.parse(code);
  } catch {
    return null;
  }
}

/**
 * Step-level diff of GET /recipes/compare: `target` is what the target
 * environment runs now (target ids), `source` is the source recipe's latest
 * version (source ids). Differences that only swap one environment's id for
 * the other's are reported as remaps, not changes, which is what the editor's
 * "1 step change" count does.
 */
export function diffDeployRecipe(
  target: { code?: unknown; connection_config?: unknown },
  source: { code?: unknown; connection_config?: unknown },
  idMap: Map<string, string> = new Map(),
): RecipeDeployDiff {
  const targetSteps = collectSteps(parseCode(target.code));
  const sourceSteps = collectSteps(parseCode(source.code));
  const out: RecipeDeployDiff = {
    steps_changed: [],
    steps_added: [],
    steps_removed: [],
    remaps: [],
  };

  for (const [key, sourceStep] of sourceSteps) {
    const targetStep = targetSteps.get(key);
    if (!targetStep) {
      out.steps_added.push(header(sourceStep));
      continue;
    }
    const fields: StepFieldChange[] = [];
    const as = sourceStep.as ?? sourceStep.key;
    diffStepValues(targetStep.node, sourceStep.node, '', as, idMap, fields, out.remaps);
    if (fields.length > 0) out.steps_changed.push({ ...header(sourceStep), fields });
  }
  for (const [key, targetStep] of targetSteps) {
    if (!sourceSteps.has(key)) out.steps_removed.push(header(targetStep));
  }

  const targetConfig = stableStringify(parseCode(target.connection_config));
  const sourceConfig = stableStringify(parseCode(source.connection_config));
  if (targetConfig !== sourceConfig) {
    out.connection_config = {
      before: excerptValue(targetConfig),
      after: excerptValue(sourceConfig),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Deployment run state machine
// ---------------------------------------------------------------------------

export interface DeploymentState {
  state?: string;
  error?: string | null;
  recipes_to_stop?: Array<{ id: number; name?: string; stop_reason?: unknown }>;
}

export type RunDecision =
  | { kind: 'start' }
  | { kind: 'poll' }
  | { kind: 'finished' }
  | { kind: 'needs_stop' }
  | { kind: 'failed' }
  | { kind: 'not_ready' };

/**
 * "Recipes require action: stop" is Workato asking before it stops running
 * target recipes, not a failure: nothing was written yet.
 */
export function isStopRequired(dep: DeploymentState): boolean {
  if (dep.state !== 'deploy_failed') return false;
  if (typeof dep.error === 'string' && /require[sd]? action:\s*stop/i.test(dep.error)) return true;
  return Array.isArray(dep.recipes_to_stop) && dep.recipes_to_stop.length > 0;
}

/** What workato_deploy_run should do with a deployment in this state. */
export function decideRun(dep: DeploymentState): RunDecision {
  const state = String(dep.state ?? '');
  if (state === 'diff_calculation_finished') return { kind: 'start' };
  if (state === 'deploy_finished') return { kind: 'finished' };
  if (isStopRequired(dep)) return { kind: 'needs_stop' };
  if (state === 'deploy_failed' || state.endsWith('_failed')) return { kind: 'failed' };
  if (state.startsWith('deploy_')) return { kind: 'poll' };
  return { kind: 'not_ready' };
}
