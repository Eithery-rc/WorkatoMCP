/**
 * Guards that make `workato_ui_save_recipe_code` honest about what Workato
 * actually persisted.
 *
 * Two failure modes motivated this module, both silent in the raw API:
 *
 *  1. **Silent input strip.** A step whose `input` carries dynamic keys the
 *     action's base schema doesn't declare (py_eval `code_input.data`,
 *     `call_recipe.parameters`, NetSuite `custom_fields`, data-table columns,
 *     `declare_variable.variables`, …) needs a matching `extended_input_schema`.
 *     Without one the PUT returns 200 with an empty `code_errors` and the keys
 *     are dropped on the way to storage. The recipe then runs "successfully"
 *     with empty data. `diffPersistedTree` catches that by reading the tree
 *     back and comparing it against what we sent.
 *
 *  2. **Whitespace-sensitive datapills.** Workato matches `#{_dp('<json>')}`
 *     byte-for-byte. A pill serialized by `json.dumps` (spaces after `:` and
 *     `,`) saves fine and silently resolves to nothing. `normalizeDatapills`
 *     re-serializes every pill payload compactly before the save.
 *
 * Everything here is pure so it can be unit-tested without a browser.
 */

/** Matches a `_dp('<single-quoted JSON>')` datapill reference. */
const DATAPILL_RE = /_dp\('([\s\S]*?)'\)/g;

/** Result of a datapill normalization pass. */
export interface NormalizeResult<T = unknown> {
  value: T;
  /** How many pill payloads were rewritten (only re-serializations that changed bytes). */
  normalized: number;
}

/**
 * Re-serialize every `_dp('...')` payload in a value (string, array, object,
 * or a JSON-stringified code tree) into the compact form Workato's parser
 * expects. Payloads that don't parse as JSON are left byte-for-byte alone.
 */
export function normalizeDatapills<T = unknown>(value: T): NormalizeResult<T> {
  let normalized = 0;

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      return node.replace(DATAPILL_RE, (whole, payload: string) => {
        const compact = compactPillPayload(payload);
        if (compact === null || compact === payload) return whole;
        normalized += 1;
        return `_dp('${compact}')`;
      });
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
        out[key] = walk(val);
      }
      return out;
    }
    return node;
  };

  return { value: walk(value) as T, normalized };
}

/**
 * Normalize the datapills of a whole code tree, accepting either the parsed
 * object or the JSON string form the save tool also takes. A string tree is
 * parsed first: inside a JSON string every `"` of a pill payload is escaped,
 * so the pills are only reachable once the tree is real objects again. The
 * returned tree keeps the caller's form.
 */
export function normalizeCodeTree(code: object | string): {
  code: object | string;
  normalized: number;
} {
  if (typeof code === 'string') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(code);
    } catch {
      // Not a JSON tree — fall back to a plain string pass so a stray pill in
      // a non-JSON payload still gets normalized.
      const flat = normalizeDatapills(code);
      return { code: flat.value, normalized: flat.normalized };
    }
    const { value, normalized } = normalizeDatapills(parsed);
    return { code: normalized > 0 ? JSON.stringify(value) : code, normalized };
  }
  const { value, normalized } = normalizeDatapills(code);
  return { code: value, normalized };
}

/**
 * Compact one pill payload as it appears between `_dp('` and `')`, keeping the
 * single-quote escaping the surrounding literal needs. Returns null when the
 * payload is not JSON we understand.
 */
function compactPillPayload(payload: string): string | null {
  const unescaped = payload.replace(/\\'/g, "'");
  let parsed: unknown;
  try {
    parsed = JSON.parse(unescaped);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return JSON.stringify(parsed).replace(/'/g, "\\'");
}

// ---------------------------------------------------------------------------
// Sent-vs-persisted diff
// ---------------------------------------------------------------------------

/** One discrepancy between the tree we sent and the tree Workato stored. */
export interface TreeIssue {
  /** `missing` — the key never made it to storage. `changed` — stored under a different value. */
  kind: 'missing' | 'changed' | 'step_missing' | 'step_mismatch';
  /** Step number as sent, when known. */
  step_number?: number;
  /** Step `as` id, the stable identifier across saves. */
  step_as?: string;
  provider?: string;
  name?: string;
  /** Dotted input path inside the step, e.g. `code_input.data.client_email`. */
  path?: string;
  sent?: unknown;
  saved?: unknown;
}

export interface TreeDiff {
  /** Keys (or whole steps) we sent that are absent from the stored tree. */
  missing: TreeIssue[];
  /** Keys stored under a value different from the one we sent. */
  changed: TreeIssue[];
  /** True when the issue lists were capped. */
  truncated: boolean;
}

/** Max issues of each kind carried in a diff before truncation kicks in. */
export const ISSUE_CAP = 25;

/** Values Workato legitimately prunes — never reported as a silent strip. */
function isPrunable(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

function isNode(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Stable identity of a step for reporting. */
function stepLabel(
  node: Record<string, unknown>,
): Pick<TreeIssue, 'step_number' | 'step_as' | 'provider' | 'name'> {
  const out: Pick<TreeIssue, 'step_number' | 'step_as' | 'provider' | 'name'> = {};
  if (typeof node.number === 'number') out.step_number = node.number;
  if (typeof node.as === 'string') out.step_as = node.as;
  if (typeof node.provider === 'string') out.provider = node.provider;
  if (typeof node.name === 'string') out.name = node.name;
  return out;
}

/** Short, log-safe rendering of a value that may be a large blob. */
function preview(value: unknown): unknown {
  if (typeof value === 'string') return value.length > 120 ? `${value.slice(0, 120)}…` : value;
  if (value === null || typeof value !== 'object') return value;
  const json = JSON.stringify(value);
  return json.length > 120 ? `${json.slice(0, 120)}…` : value;
}

/**
 * Compare the code tree we sent against the one Workato stored.
 *
 * The comparison is deliberately one-directional: it asks "is everything I
 * wrote still there?", never "did Workato add anything?". Workato routinely
 * enriches a saved tree with defaults, and those additions are not defects.
 * Empty values are ignored too — Workato prunes them by design.
 */
export function diffPersistedTree(sent: unknown, persisted: unknown): TreeDiff {
  const diff: TreeDiff = { missing: [], changed: [], truncated: false };

  const push = (bucket: 'missing' | 'changed', issue: TreeIssue): void => {
    const list = diff[bucket];
    if (list.length >= ISSUE_CAP) {
      diff.truncated = true;
      return;
    }
    list.push(issue);
  };

  const diffValue = (
    sentValue: unknown,
    savedValue: unknown,
    path: string,
    label: ReturnType<typeof stepLabel>,
  ): void => {
    if (isPrunable(sentValue)) return;

    if (savedValue === undefined) {
      push('missing', { kind: 'missing', ...label, path, sent: preview(sentValue) });
      return;
    }

    if (Array.isArray(sentValue)) {
      if (!Array.isArray(savedValue)) {
        push('changed', {
          kind: 'changed',
          ...label,
          path,
          sent: preview(sentValue),
          saved: preview(savedValue),
        });
        return;
      }
      for (let i = 0; i < sentValue.length; i += 1) {
        diffValue(sentValue[i], savedValue[i], `${path}[${i}]`, label);
      }
      return;
    }

    if (isNode(sentValue)) {
      if (!isNode(savedValue)) {
        push('changed', {
          kind: 'changed',
          ...label,
          path,
          sent: preview(sentValue),
          saved: preview(savedValue),
        });
        return;
      }
      for (const [key, value] of Object.entries(sentValue)) {
        diffValue(value, savedValue[key], path ? `${path}.${key}` : key, label);
      }
      return;
    }

    if (sentValue !== savedValue) {
      push('changed', {
        kind: 'changed',
        ...label,
        path,
        sent: preview(sentValue),
        saved: preview(savedValue),
      });
    }
  };

  const diffNode = (sentNode: unknown, savedNode: unknown, trail: string): void => {
    if (!isNode(sentNode)) return;
    const label = stepLabel(sentNode);

    if (!isNode(savedNode)) {
      push('missing', { kind: 'step_missing', ...label, path: trail });
      return;
    }

    // Identity check first — diffing two different steps produces noise, not signal.
    if (
      typeof sentNode.as === 'string' &&
      typeof savedNode.as === 'string' &&
      sentNode.as !== savedNode.as
    ) {
      push('changed', {
        kind: 'step_mismatch',
        ...label,
        path: trail,
        sent: sentNode.as,
        saved: savedNode.as,
      });
      return;
    }

    if (isNode(sentNode.input)) {
      diffValue(sentNode.input, isNode(savedNode.input) ? savedNode.input : undefined, '', label);
    }

    if (Array.isArray(sentNode.block)) {
      const savedBlock = Array.isArray(savedNode.block) ? savedNode.block : [];
      for (let i = 0; i < sentNode.block.length; i += 1) {
        diffNode(sentNode.block[i], savedBlock[i], `${trail}block[${i}]`);
      }
    }
  };

  diffNode(sent, persisted, '');

  // `diffValue` is seeded with an empty path at the input root, which leaves
  // top-level input keys pathless. Normalize those for readability.
  for (const issue of [...diff.missing, ...diff.changed]) {
    if (issue.path === '') issue.path = 'input';
  }

  return diff;
}

/** True when the stored tree carries everything we sent, values included. */
export function isFullyPersisted(diff: TreeDiff): boolean {
  return diff.missing.length === 0 && diff.changed.length === 0 && !diff.truncated;
}

/**
 * Human-readable explanation of a silent strip, including the fix. This text
 * ends up in the tool's error output, so it has to tell an agent exactly what
 * to do next.
 */
export function describeMissing(diff: TreeDiff): string {
  const steps = new Map<string, string[]>();
  for (const issue of diff.missing) {
    const key =
      issue.step_as ??
      (issue.step_number !== undefined ? `step ${issue.step_number}` : 'trigger/root');
    const label =
      issue.step_number !== undefined
        ? `step ${issue.step_number}` + (issue.step_as ? ` (${issue.step_as})` : '')
        : key;
    const entry = steps.get(label) ?? [];
    entry.push(issue.kind === 'step_missing' ? '<whole step>' : (issue.path ?? '?'));
    steps.set(label, entry);
  }

  const lines = [...steps.entries()].map(([step, paths]) => `  ${step}: ${paths.join(', ')}`);
  return (
    `Workato accepted the save but did NOT persist ${diff.missing.length} value(s)` +
    (diff.truncated ? '+ (list truncated)' : '') +
    `:\n${lines.join('\n')}\n` +
    `This is the silent-strip failure: a step's dynamic input keys are dropped unless the ` +
    `step carries an extended_input_schema declaring them. Fix by adding the schema ` +
    `(workato_recipe_set_extended_schema) for the listed fields, then save again. ` +
    `The recipe is now at a version whose data is INCOMPLETE — do not start it as-is.`
  );
}
