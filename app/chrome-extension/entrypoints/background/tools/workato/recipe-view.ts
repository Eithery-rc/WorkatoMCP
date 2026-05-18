/**
 * Pure transform layer for `workato_pull_recipe`.
 *
 * A raw Workato recipe code tree is dominated by UI-metadata sections
 * (`extended_input_schema` alone is ~78% of a real recipe). These functions
 * project that tree into AI-friendly shapes:
 *
 *  - `toCompactRecipe` — the whole recipe with UI metadata stripped and
 *    `_dp(...)` datapills shortened for readability; with `omitInput` it drops
 *    every step's `input` for an even lighter structural outline.
 *  - `findStep` + `inspectStep` — drill into one step: its config distilled
 *    into a classified `mappings` list, the settable input fields, and the
 *    datapills produced by upstream steps that it can reference.
 *
 * Everything here is pure: it runs in the background script on the parsed
 * `code` object after `pullInPage` returns. The in-page fetch is untouched.
 */

/** A node in the raw recipe code tree (trigger or any step). */
export interface RawNode {
  number?: number;
  keyword?: string;
  provider?: string;
  name?: string;
  as?: string;
  uuid?: string;
  title?: string | null;
  description?: string;
  input?: Record<string, unknown>;
  skip?: boolean;
  block?: RawNode[];
  extended_input_schema?: RawSchemaEntry[];
  extended_output_schema?: RawSchemaEntry[];
  [key: string]: unknown;
}

/** A single field descriptor inside an `extended_*_schema` array. */
export interface RawSchemaEntry {
  name?: string;
  label?: string;
  type?: string;
  optional?: boolean;
  control_type?: string;
  properties?: RawSchemaEntry[];
  [key: string]: unknown;
}

/** Version metadata as produced by `pullInPage`. */
export interface RecipeVersion {
  version_no: number;
  name: string;
  folder_id: number;
  description: string;
  [key: string]: unknown;
}

/** A pruned step node in the compact view. */
export interface CompactStep {
  n?: number;
  type?: string;
  app?: string;
  name?: string;
  as?: string;
  uuid?: string;
  title?: string | null;
  description?: string;
  skip?: true;
  input?: Record<string, unknown>;
  block?: CompactStep[];
}

/** The compact whole-recipe payload. */
export interface CompactRecipe {
  recipe_id: number;
  name: string;
  version: { version_no: number; folder_id: number; description: string };
  step_count: number;
  trigger: CompactStep;
  steps: CompactStep[];
}

/** A flattened schema field in `step` mode. */
export interface FieldEntry {
  path: string;
  name: string;
  label: string;
  type: string;
  optional: boolean;
  control_type: string;
  io: 'in' | 'out';
}

/** How a step's input leaf is wired. */
export type MappingKind = 'datapill' | 'formula' | 'interpolated' | 'literal' | 'code';

/** One distilled input leaf — the wiring/logic of a step. */
export interface Mapping {
  path: string;
  kind: MappingKind;
  value: unknown;
  /** set when a long literal blob was previewed instead of returned whole */
  truncated?: true;
  /** original length, present only alongside `truncated` */
  chars?: number;
}

/** A datapill an upstream step exposes for the inspected step to reference. */
export interface DatapillRef {
  ref: string;
  label: string;
  type: string;
}

/** The `step`-mode payload. */
export interface StepView {
  recipe_id: number;
  step: CompactStep;
  mappings: Mapping[];
  fields: FieldEntry[];
  total_fields: number;
  fields_truncated: boolean;
  available_datapills: DatapillRef[];
  total_datapills: number;
  datapills_truncated: boolean;
}

/** Max fields/datapills returned in `step` mode before truncation kicks in. */
export const FIELD_CAP = 60;

/** Plain-literal strings longer than this are previewed, not returned whole. */
export const LITERAL_CAP = 256;

/** Shape of the JSON argument inside a `_dp('...')` datapill reference. */
interface RawPill {
  pill_type?: string;
  provider?: string;
  line?: string;
  path?: Array<string | { path_element_type?: string }>;
}

/**
 * Render a parsed datapill as a short dotted reference, e.g.
 * `py_eval.e4f443bd.output.Invoices[].lines[].amount` or
 * `job_context.parameters.flowCode`. Loop items collapse to `[]`, array
 * sizes to `.size`.
 */
export function pillToRef(pill: RawPill): string {
  const segments: string[] = [];
  if (typeof pill.pill_type === 'string' && pill.pill_type !== 'output') {
    segments.push(pill.pill_type);
  }
  if (typeof pill.provider === 'string') segments.push(pill.provider);
  if (typeof pill.line === 'string') segments.push(pill.line);

  for (const element of pill.path ?? []) {
    if (element && typeof element === 'object') {
      const kind = element.path_element_type;
      if (kind === 'current_item') {
        if (segments.length > 0) segments[segments.length - 1] += '[]';
        else segments.push('[]');
      } else if (kind === 'size') {
        segments.push('size');
      } else {
        segments.push('?');
      }
    } else {
      segments.push(String(element));
    }
  }
  return `datapill(${segments.join('.')})`;
}

/** Matches a `_dp('<single-quoted JSON>')` datapill reference. */
const DATAPILL_RE = /_dp\('([\s\S]*?)'\)/g;

/**
 * Recursively rewrite verbose `_dp('{...json...}')` datapill references inside
 * an `input` value into the short `datapill(...)` form. Datapills whose JSON
 * fails to parse are left untouched. This is lossy-but-readable — `view:'full'`
 * remains the source of the exact reference.
 */
export function shortenDatapills(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(DATAPILL_RE, (whole, json: string) => {
      try {
        const pill = JSON.parse(json) as RawPill;
        if (pill && typeof pill === 'object' && (pill.pill_type || pill.provider)) {
          return pillToRef(pill);
        }
      } catch {
        /* not parseable — leave the original reference in place */
      }
      return whole;
    });
  }
  if (Array.isArray(value)) return value.map(shortenDatapills);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) out[key] = shortenDatapills(val);
    return out;
  }
  return value;
}

/** Strip HTML tags from a Workato description, collapsing whitespace. */
export function stripHtml(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Prune one raw node into a compact step. UI-metadata sections are dropped;
 * `input` is kept with its `_dp(...)` datapills shortened for readability (or
 * dropped entirely when `omitInput` is set, for the outline view); `block` is
 * recursed so nested if/try/foreach branches are preserved.
 */
export function compactNode(node: RawNode, omitInput = false): CompactStep {
  const out: CompactStep = {};
  if (typeof node.number === 'number') out.n = node.number;
  if (typeof node.keyword === 'string') out.type = node.keyword;
  if (typeof node.provider === 'string') out.app = node.provider;
  if (typeof node.name === 'string') out.name = node.name;
  if (typeof node.as === 'string') out.as = node.as;
  if (typeof node.uuid === 'string') out.uuid = node.uuid;
  if (node.title != null && node.title !== '') out.title = node.title;
  if (node.description) out.description = stripHtml(node.description);
  if (node.skip === true) out.skip = true;
  if (!omitInput && node.input && typeof node.input === 'object') {
    out.input = shortenDatapills(node.input) as Record<string, unknown>;
  }
  if (Array.isArray(node.block)) {
    out.block = node.block.map((child) => compactNode(child, omitInput));
  }
  return out;
}

/** Count every node in a compact step subtree (inclusive). */
function countSteps(steps: CompactStep[]): number {
  let total = 0;
  for (const step of steps) {
    total += 1;
    if (step.block) total += countSteps(step.block);
  }
  return total;
}

/**
 * Project a raw recipe code tree into the compact whole-recipe payload.
 * With `omitInput` set, every step's `input` is dropped — the outline view.
 */
export function toCompactRecipe(
  code: RawNode,
  recipeId: number,
  version: RecipeVersion,
  omitInput = false,
): CompactRecipe {
  const trigger = compactNode(code, omitInput);
  const steps = trigger.block ?? [];
  delete trigger.block;
  return {
    recipe_id: recipeId,
    name: version?.name ?? '',
    version: {
      version_no: version?.version_no ?? 0,
      folder_id: version?.folder_id ?? 0,
      description: version?.description ?? '',
    },
    // Counts action/control steps only; the trigger is reported separately.
    step_count: countSteps(steps),
    trigger,
    steps,
  };
}

/**
 * Locate a single node by its `as` anchor or numeric step number.
 * The trigger (`code` itself) is included in the search. Returns null on miss.
 */
export function findStep(code: RawNode, ref: string): RawNode | null {
  const trimmed = ref.trim();
  const asNumber = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
  const matches = (node: RawNode): boolean =>
    node.as === trimmed || (asNumber !== null && node.number === asNumber);

  const walk = (node: RawNode): RawNode | null => {
    if (matches(node)) return node;
    if (Array.isArray(node.block)) {
      for (const child of node.block) {
        const hit = walk(child);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(code);
}

/** List every step's `{ n, as }` — used to build a helpful not-found error. */
export function listStepRefs(code: RawNode): Array<{ n?: number; as?: string }> {
  const refs: Array<{ n?: number; as?: string }> = [];
  const walk = (node: RawNode): void => {
    refs.push({ n: node.number, as: node.as });
    if (Array.isArray(node.block)) node.block.forEach(walk);
  };
  walk(code);
  return refs;
}

/**
 * Flatten a schema array into dotted-path field entries. Nested `properties`
 * recurse; array-typed entries prefix their children with `[]`.
 */
export function flattenSchema(
  entries: RawSchemaEntry[] | undefined,
  io: 'in' | 'out',
  parentPath = '',
): FieldEntry[] {
  if (!Array.isArray(entries)) return [];
  const fields: FieldEntry[] = [];
  for (const entry of entries) {
    const name = typeof entry.name === 'string' ? entry.name : '';
    if (!name) continue;
    const path = parentPath ? `${parentPath}.${name}` : name;
    fields.push({
      path,
      name,
      label: typeof entry.label === 'string' ? entry.label : '',
      type: typeof entry.type === 'string' ? entry.type : '',
      optional: entry.optional === true,
      control_type: typeof entry.control_type === 'string' ? entry.control_type : '',
      io,
    });
    if (Array.isArray(entry.properties) && entry.properties.length > 0) {
      const childPrefix = entry.type === 'array' ? `${path}[]` : path;
      fields.push(...flattenSchema(entry.properties, io, childPrefix));
    }
  }
  return fields;
}

/** A whole value that is a single datapill reference (interpolated or formula). */
const PURE_DATAPILL_RE = /^#\{datapill\([^)]*\)\}$|^=datapill\([^)]*\)$/;

/**
 * Classify one input leaf by how it is wired: a bare datapill reference, a
 * formula (`=` prefix), an interpolated string with embedded datapills, a code
 * body (a long non-JSON string — Python/SQL), or a plain literal. Long literal
 * JSON blobs (e.g. embedded schemas) are previewed rather than returned whole.
 */
function classifyValue(raw: unknown): Omit<Mapping, 'path'> {
  if (typeof raw !== 'string') return { kind: 'literal', value: raw };

  const shortened = shortenDatapills(raw) as string;
  if (PURE_DATAPILL_RE.test(shortened.trim())) return { kind: 'datapill', value: shortened };
  if (shortened.startsWith('=')) return { kind: 'formula', value: shortened };
  if (shortened.includes('#{')) return { kind: 'interpolated', value: shortened };

  if (raw.length > LITERAL_CAP) {
    let isJson = false;
    try {
      JSON.parse(raw);
      isJson = true;
    } catch {
      /* not JSON — treat as a code/text body */
    }
    if (isJson) {
      return {
        kind: 'literal',
        value: `${raw.slice(0, LITERAL_CAP)}…`,
        truncated: true,
        chars: raw.length,
      };
    }
    return { kind: 'code', value: shortened };
  }
  return { kind: 'literal', value: shortened };
}

/**
 * Flatten a step's `input` object into a flat list of classified leaf mappings.
 * Object keys join with `.`, array elements with `[index]`.
 */
export function flattenInput(value: unknown, parentPath = ''): Mapping[] {
  if (Array.isArray(value)) {
    const out: Mapping[] = [];
    value.forEach((element, index) => {
      out.push(...flattenInput(element, `${parentPath}[${index}]`));
    });
    return out;
  }
  if (value && typeof value === 'object') {
    const out: Mapping[] = [];
    for (const [key, val] of Object.entries(value)) {
      out.push(...flattenInput(val, parentPath ? `${parentPath}.${key}` : key));
    }
    return out;
  }
  return [{ path: parentPath || '(value)', ...classifyValue(value) }];
}

/**
 * Collect every datapill that steps numbered below `beforeNumber` expose —
 * the references the inspected step is allowed to wire in. Built from each
 * upstream step's `extended_output_schema`.
 */
export function collectUpstreamDatapills(code: RawNode, beforeNumber: number): DatapillRef[] {
  const refs: DatapillRef[] = [];
  const walk = (node: RawNode): void => {
    if (
      typeof node.number === 'number' &&
      node.number < beforeNumber &&
      typeof node.provider === 'string' &&
      typeof node.as === 'string' &&
      Array.isArray(node.extended_output_schema)
    ) {
      const head = `${node.provider}.${node.as}`;
      for (const field of flattenSchema(node.extended_output_schema, 'out')) {
        refs.push({ ref: `datapill(${head}.${field.path})`, label: field.label, type: field.type });
      }
    }
    if (Array.isArray(node.block)) node.block.forEach(walk);
  };
  walk(code);
  return refs;
}

/**
 * Build the `step`-mode payload: the step header, its `input` distilled into a
 * classified `mappings` list, the settable input `fields`, and the
 * `available_datapills` produced by upstream steps. `fields` and
 * `available_datapills` are capped at `FIELD_CAP`; passing `query` filters both
 * (by name/label/ref, case-insensitive) and lifts the cap. `mappings` — the
 * core wiring/logic of the step — is always returned in full.
 */
export function inspectStep(
  code: RawNode,
  node: RawNode,
  recipeId: number,
  query?: string,
): StepView {
  const step = compactNode(node, true);
  delete step.block;

  const mappings = flattenInput(node.input ?? {});
  const allFields = flattenSchema(node.extended_input_schema, 'in');
  const targetNumber = typeof node.number === 'number' ? node.number : Number.POSITIVE_INFINITY;
  const allDatapills = collectUpstreamDatapills(code, targetNumber);

  const needle = query && query.trim() !== '' ? query.trim().toLowerCase() : null;
  const fields = needle
    ? allFields.filter(
        (f) => f.name.toLowerCase().includes(needle) || f.label.toLowerCase().includes(needle),
      )
    : allFields.slice(0, FIELD_CAP);
  const datapills = needle
    ? allDatapills.filter(
        (d) => d.ref.toLowerCase().includes(needle) || d.label.toLowerCase().includes(needle),
      )
    : allDatapills.slice(0, FIELD_CAP);

  return {
    recipe_id: recipeId,
    step,
    mappings,
    fields,
    total_fields: needle ? fields.length : allFields.length,
    fields_truncated: needle ? false : allFields.length > FIELD_CAP,
    available_datapills: datapills,
    total_datapills: needle ? datapills.length : allDatapills.length,
    datapills_truncated: needle ? false : allDatapills.length > FIELD_CAP,
  };
}
