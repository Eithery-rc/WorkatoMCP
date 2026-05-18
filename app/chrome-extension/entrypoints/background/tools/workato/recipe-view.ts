/**
 * Pure transform layer for `workato_pull_recipe`.
 *
 * A raw Workato recipe code tree is dominated by UI-metadata sections
 * (`extended_input_schema` alone is ~78% of a real recipe). These functions
 * project that tree into AI-friendly shapes:
 *
 *  - `toCompactRecipe` — the whole recipe with UI metadata stripped (~78%
 *    smaller), keeping each step's configured `input` verbatim.
 *  - `findStep` + `searchFields` — drill into one step and flatten/search its
 *    input & output schema fields.
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

/** The `step`-mode payload. */
export interface StepView {
  recipe_id: number;
  step: CompactStep;
  fields: FieldEntry[];
  total_fields: number;
  fields_truncated: boolean;
}

/** Max fields returned in `step` mode before truncation kicks in. */
export const FIELD_CAP = 60;

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
 * `input` is kept verbatim (it holds `#{_dp(...)}` datapills); `block` is
 * recursed so nested if/try/foreach branches are preserved.
 */
export function compactNode(node: RawNode): CompactStep {
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
  if (node.input && typeof node.input === 'object') out.input = node.input;
  if (Array.isArray(node.block)) out.block = node.block.map(compactNode);
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

/** Project a raw recipe code tree into the compact whole-recipe payload. */
export function toCompactRecipe(
  code: RawNode,
  recipeId: number,
  version: RecipeVersion,
): CompactRecipe {
  const trigger = compactNode(code);
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

/**
 * Build the `step`-mode payload: the step's compact config plus a flat catalog
 * of its input & output schema fields. Without `query` the catalog is capped at
 * `FIELD_CAP`; with `query` it is filtered (by name/label, case-insensitive)
 * and uncapped.
 */
export function searchFields(node: RawNode, recipeId: number, query?: string): StepView {
  const step = compactNode(node);
  delete step.block;
  const all = [
    ...flattenSchema(node.extended_input_schema, 'in'),
    ...flattenSchema(node.extended_output_schema, 'out'),
  ];

  if (query && query.trim() !== '') {
    const needle = query.trim().toLowerCase();
    const matched = all.filter(
      (f) => f.name.toLowerCase().includes(needle) || f.label.toLowerCase().includes(needle),
    );
    return {
      recipe_id: recipeId,
      step,
      fields: matched,
      total_fields: matched.length,
      fields_truncated: false,
    };
  }

  return {
    recipe_id: recipeId,
    step,
    fields: all.slice(0, FIELD_CAP),
    total_fields: all.length,
    fields_truncated: all.length > FIELD_CAP,
  };
}
