/**
 * @fileoverview Deterministic extended-schema derivation.
 *
 * Workato accepts a save whose structured input has no matching
 * `extended_input_schema`, reports `code_errors: []`, and then drops the input
 * on readback. The same silence applies the other way round: a step whose
 * output a downstream datapill reads needs an `extended_output_schema` or the
 * reference fails validation. Both schemas are mechanical restatements of a
 * declaration the step already carries, which is why they can be derived here
 * instead of copied by hand from another recipe.
 *
 * Every derivation reads a DECLARATION (`input.list_item_schema_json`,
 * `input.variables.schema`, the clock trigger's own unit) and never the current
 * values: a list that happens to hold three strings today says nothing about
 * the type the author declared. When the declaration is missing, the derivation
 * refuses with a reason rather than inventing a shape.
 *
 * Evidence per kind is reported alongside the result:
 *   verified   - observed persisting on a live save (declare_list 2026-05-12,
 *                the clock trigger's trigger_every 2026-09-07).
 *   documented - the silent-strip rule in skills/workato-recipes/code-tree.md,
 *                applied to an action whose failure was not probed directly.
 *
 * Only types are imported from the engine, so this module stays free of a
 * runtime cycle with it.
 */

import type { JsonObject, RecipeStep } from './workato-recipe-engine';

/** One field as Workato writes it inside an extended schema. */
export interface SchemaField {
  name: string;
  label?: string;
  type?: string;
  of?: string;
  control_type?: string;
  optional?: boolean;
  properties?: SchemaField[];
  hint?: string;
  [key: string]: unknown;
}

export const VARIABLES_PROVIDER = 'workato_variable';
export const CLOCK_PROVIDER = 'clock';
export const CLOCK_TRIGGER_ACTION = 'scheduled_event';

export type DerivedSchemaKind =
  | 'declare_list'
  | 'insert_to_list'
  | 'declare_variable'
  | 'update_variables'
  | 'clock_trigger';

export type SchemaKey = 'extended_input_schema' | 'extended_output_schema';

export interface DerivedSchemas {
  ok: true;
  kind: DerivedSchemaKind;
  extended_input_schema?: SchemaField[];
  extended_output_schema?: SchemaField[];
  /** Top-level field names this derivation declares. */
  fields: string[];
  evidence: 'verified' | 'documented';
  notes?: string[];
}

export interface DerivationRefusal {
  ok: false;
  reason: string;
  kind?: DerivedSchemaKind;
}

export type DerivationResult = DerivedSchemas | DerivationRefusal;

/** The most nesting a declared field is followed to. Deeper children are dropped. */
const MAX_FIELD_DEPTH = 5;

/** How many values a clock select offers, per time unit. */
const CLOCK_UNIT_MAX: Record<string, number> = { minutes: 60, hours: 24, days: 31 };

function isRecordValue(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** `as` when the step has one, else `#<number>`, matching the engine's labels. */
function labelOf(step: RecipeStep): string {
  if (typeof step.as === 'string' && step.as.length > 0) return step.as;
  if (typeof step.number === 'number') return `#${step.number}`;
  if (typeof step.uuid === 'string' && step.uuid.length > 0) return step.uuid;
  return '#?';
}

/** Depth-first walk in the order Workato numbers the tree. */
function walkSteps(code: unknown): RecipeStep[] {
  const out: RecipeStep[] = [];
  const visit = (node: unknown) => {
    if (!isRecordValue(node)) return;
    const step = node as RecipeStep;
    out.push(step);
    if (Array.isArray(step.block)) {
      for (const child of step.block) visit(child);
    }
  };
  visit(code);
  return out;
}

function stepInput(step: RecipeStep): JsonObject {
  return isRecordValue(step.input) ? (step.input as JsonObject) : {};
}

/** "asset_id" -> "Asset id". Used only when the declaration carries no label. */
export function humanizeFieldName(name: string): string {
  const spaced = name.replace(/[_-]+/g, ' ').trim();
  if (spaced.length === 0) return name;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Parse a declared field list: either the string-encoded JSON array Workato
 * stores (`list_item_schema_json`, `variables.schema`) or an already-parsed
 * array. Returns null when the value is absent or is not an array of objects.
 */
export function parseDeclaredFields(raw: unknown): SchemaField[] | null {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed)) return null;
  const fields: SchemaField[] = [];
  for (const entry of parsed) {
    if (!isRecordValue(entry)) return null;
    if (typeof entry.name !== 'string' || entry.name.length === 0) return null;
    fields.push(normalizeDeclaredField(entry));
  }
  return fields;
}

/**
 * Restate one declared field in the shape Workato emits inside an extended
 * schema. Declared keys are copied; `label` falls back to the humanized name
 * and `type` to "string" (the only default the declaration format implies).
 * Nothing else is invented: an absent `optional` or `control_type` stays absent.
 */
export function normalizeDeclaredField(raw: JsonObject, depth = 0): SchemaField {
  const name = String(raw.name);
  const field: SchemaField = {
    label:
      typeof raw.label === 'string' && raw.label.length > 0 ? raw.label : humanizeFieldName(name),
    name,
    type: typeof raw.type === 'string' && raw.type.length > 0 ? raw.type : 'string',
  };
  if (typeof raw.of === 'string' && raw.of.length > 0) field.of = raw.of;
  if (typeof raw.control_type === 'string' && raw.control_type.length > 0) {
    field.control_type = raw.control_type;
  }
  if (typeof raw.optional === 'boolean') field.optional = raw.optional;
  if (typeof raw.hint === 'string' && raw.hint.length > 0) field.hint = raw.hint;
  if (Array.isArray(raw.properties) && depth < MAX_FIELD_DEPTH) {
    const children: SchemaField[] = [];
    for (const child of raw.properties) {
      if (isRecordValue(child) && typeof child.name === 'string' && child.name.length > 0) {
        children.push(normalizeDeclaredField(child, depth + 1));
      }
    }
    if (children.length > 0) field.properties = children;
  }
  return field;
}

// ---------------------------------------------------------------------------
// Composites
// ---------------------------------------------------------------------------

/**
 * The Variables actions address their declaration with `<uuid>:<as>` (a list)
 * or `<uuid>:<as>:<variable>` (one variable). This is a lookup key, not a
 * datapill, which is why the `as` sits in the middle rather than in `line`.
 */
export function parseVariableComposite(
  value: unknown,
): { uuid: string; as: string; variable?: string } | null {
  if (typeof value !== 'string') return null;
  const parts = value.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  const [uuid, as, variable] = parts;
  if (!/^[0-9a-f-]{8,36}$/.test(uuid)) return null;
  if (!/^[0-9a-f]{8}$/.test(as)) return null;
  if (parts.length === 3 && (!variable || variable.length === 0)) return null;
  return variable === undefined ? { uuid, as } : { uuid, as, variable };
}

function findStepByAnchor(code: unknown, anchor: string): RecipeStep | null {
  for (const step of walkSteps(code)) {
    if (step.as === anchor) return step;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Variables by Workato
// ---------------------------------------------------------------------------

function cloneFields(fields: SchemaField[]): SchemaField[] {
  return JSON.parse(JSON.stringify(fields)) as SchemaField[];
}

function listItemWrapper(label: string, properties: SchemaField[], optional: boolean): SchemaField {
  // The input and output wrappers must not share their property array: an edit
  // to one would silently change the other, and the two are compared separately.
  return {
    label,
    name: 'list_items',
    type: 'array',
    of: 'object',
    optional,
    properties: cloneFields(properties),
  };
}

/**
 * Derive the extended schemas of a Variables-by-Workato step from its own
 * declaration.
 *
 * `declare_list` and `declare_variable` declare in place; `insert_to_list` and
 * `update_variables` name the declaring step through a composite, so the tree
 * must be supplied through `options.code` for those two.
 */
export function deriveVariablesSchema(
  step: RecipeStep,
  options: { code?: unknown } = {},
): DerivationResult {
  if (step.provider !== VARIABLES_PROVIDER) {
    return {
      ok: false,
      reason: `step ${labelOf(step)} has provider ${String(step.provider)}, not ${VARIABLES_PROVIDER}`,
    };
  }
  const input = stepInput(step);
  const action = String(step.name ?? '');

  if (action === 'declare_list') {
    const fields = parseDeclaredFields(input.list_item_schema_json);
    if (!fields) {
      return {
        ok: false,
        kind: 'declare_list',
        reason:
          `declare_list ${labelOf(step)} has no parseable input.list_item_schema_json, so the item ` +
          `shape is not declared anywhere. Set it first; the schema is never guessed from list_items.`,
      };
    }
    if (fields.length === 0) {
      return {
        ok: false,
        kind: 'declare_list',
        reason: `declare_list ${labelOf(step)} declares an empty list_item_schema_json`,
      };
    }
    const label =
      typeof input.name === 'string' && input.name.length > 0 ? input.name : 'List items';
    return {
      ok: true,
      kind: 'declare_list',
      // Workato's own shape: the input wrapper is optional, the output wrapper
      // is not. Verified end to end on a live recipe.
      extended_input_schema: [listItemWrapper(label, fields, true)],
      extended_output_schema: [listItemWrapper(label, fields, false)],
      fields: ['list_items'],
      evidence: 'verified',
    };
  }

  if (action === 'insert_to_list') {
    const composite = parseVariableComposite(input.name);
    if (!composite) {
      return {
        ok: false,
        kind: 'insert_to_list',
        reason:
          `insert_to_list ${labelOf(step)} has no \`<uuid>:<as>\` input.name naming the list it ` +
          `writes to, so the declaring declare_list cannot be found`,
      };
    }
    if (options.code === undefined) {
      return {
        ok: false,
        kind: 'insert_to_list',
        reason: `insert_to_list ${labelOf(step)} needs the recipe tree to read the declaring declare_list`,
      };
    }
    const target = findStepByAnchor(options.code, composite.as);
    if (!target) {
      return {
        ok: false,
        kind: 'insert_to_list',
        reason: `insert_to_list ${labelOf(step)} points at anchor ${composite.as}, which is not a step in this recipe`,
      };
    }
    if (target.provider !== VARIABLES_PROVIDER || target.name !== 'declare_list') {
      return {
        ok: false,
        kind: 'insert_to_list',
        reason: `insert_to_list ${labelOf(step)} points at step ${composite.as}, which is not a declare_list`,
      };
    }
    const fields = parseDeclaredFields(stepInput(target).list_item_schema_json);
    if (!fields || fields.length === 0) {
      return {
        ok: false,
        kind: 'insert_to_list',
        reason: `declare_list ${composite.as} has no parseable list_item_schema_json to derive the item shape from`,
      };
    }
    return {
      ok: true,
      kind: 'insert_to_list',
      extended_input_schema: [
        {
          label: 'List item',
          name: 'list_item',
          type: 'object',
          optional: false,
          properties: fields,
        },
      ],
      fields: ['list_item'],
      evidence: 'documented',
    };
  }

  if (action === 'declare_variable') {
    const variables = isRecordValue(input.variables) ? (input.variables as JsonObject) : null;
    const fields = variables ? parseDeclaredFields(variables.schema) : null;
    if (!fields) {
      return {
        ok: false,
        kind: 'declare_variable',
        reason:
          `declare_variable ${labelOf(step)} has no parseable input.variables.schema, so the variable ` +
          `types are not declared anywhere`,
      };
    }
    if (fields.length === 0) {
      return {
        ok: false,
        kind: 'declare_variable',
        reason: `declare_variable ${labelOf(step)} declares an empty variables.schema`,
      };
    }
    return {
      ok: true,
      kind: 'declare_variable',
      // The declared variables are this step's output pills; the input side is
      // the action's own `variables` field and needs no extended schema.
      extended_output_schema: fields,
      fields: fields.map((field) => field.name),
      evidence: 'documented',
    };
  }

  if (action === 'update_variables') {
    const composite = parseVariableComposite(input.name);
    if (!composite || !composite.variable) {
      return {
        ok: false,
        kind: 'update_variables',
        reason:
          `update_variables ${labelOf(step)} has no \`<uuid>:<as>:<variable>\` input.name, so the ` +
          `declaring declare_variable cannot be found`,
      };
    }
    if (options.code === undefined) {
      return {
        ok: false,
        kind: 'update_variables',
        reason: `update_variables ${labelOf(step)} needs the recipe tree to read the declaring declare_variable`,
      };
    }
    const target = findStepByAnchor(options.code, composite.as);
    if (!target) {
      return {
        ok: false,
        kind: 'update_variables',
        reason: `update_variables ${labelOf(step)} points at anchor ${composite.as}, which is not a step in this recipe`,
      };
    }
    if (target.provider !== VARIABLES_PROVIDER || target.name !== 'declare_variable') {
      return {
        ok: false,
        kind: 'update_variables',
        reason: `update_variables ${labelOf(step)} points at step ${composite.as}, which is not a declare_variable`,
      };
    }
    const targetVariables = isRecordValue(stepInput(target).variables)
      ? (stepInput(target).variables as JsonObject)
      : null;
    const declaredFields = targetVariables ? parseDeclaredFields(targetVariables.schema) : null;
    if (!declaredFields || declaredFields.length === 0) {
      return {
        ok: false,
        kind: 'update_variables',
        reason: `declare_variable ${composite.as} has no parseable variables.schema to derive the variable types from`,
      };
    }
    const byName = new Map(declaredFields.map((field) => [field.name, field]));
    const written: string[] = [];
    for (const key of Object.keys(input)) {
      if (key === 'input_mode' || key === 'name') continue;
      written.push(key);
    }
    if (!written.includes(composite.variable)) written.push(composite.variable);
    const undeclared = written.filter((key) => !byName.has(key));
    if (undeclared.length > 0) {
      return {
        ok: false,
        kind: 'update_variables',
        reason:
          `update_variables ${labelOf(step)} writes ${undeclared.join(', ')}, which declare_variable ` +
          `${composite.as} does not declare. The type is never taken from the value being written.`,
      };
    }
    return {
      ok: true,
      kind: 'update_variables',
      extended_input_schema: written.map((key) => byName.get(key) as SchemaField),
      fields: written,
      evidence: 'documented',
    };
  }

  return {
    ok: false,
    reason: `Variables action ${action || '(unnamed)'} has no deterministic schema derivation`,
  };
}

// ---------------------------------------------------------------------------
// Clock trigger
// ---------------------------------------------------------------------------

/**
 * Derive the clock trigger's `extended_input_schema`.
 *
 * A scheduled trigger saved as `{time_unit, trigger_every}` alone comes back
 * without `trigger_every`: the save reports `code_errors: []` and the readback
 * shows the field gone. Declaring it as the select it is makes it persist
 * (probed live on 2026-09-07 with time_unit minutes and days).
 *
 * The option list is the integer range Workato offers for the unit, plus the
 * value the step already carries, so a value outside the range is never
 * dropped by the very schema that is meant to preserve it.
 */
export function deriveClockTriggerSchema(step: RecipeStep): DerivationResult {
  if (step.provider !== CLOCK_PROVIDER || step.name !== CLOCK_TRIGGER_ACTION) {
    return {
      ok: false,
      reason:
        `step ${labelOf(step)} is ${String(step.provider)}/${String(step.name)}, not ` +
        `${CLOCK_PROVIDER}/${CLOCK_TRIGGER_ACTION}`,
    };
  }
  const input = stepInput(step);
  const current = input.trigger_every;
  if (current === undefined || current === null || current === '') {
    return {
      ok: false,
      kind: 'clock_trigger',
      reason: `clock trigger ${labelOf(step)} declares no input.trigger_every to preserve`,
    };
  }

  const notes: string[] = [];
  const rawUnit = typeof input.time_unit === 'string' ? input.time_unit : '';
  const unit = CLOCK_UNIT_MAX[rawUnit] === undefined ? 'minutes' : rawUnit;
  if (unit !== rawUnit) {
    notes.push(
      `input.time_unit is ${rawUnit === '' ? 'absent' : rawUnit}; the option list uses the minutes range`,
    );
  }

  const max = CLOCK_UNIT_MAX[unit];
  const values: string[] = [];
  for (let i = 1; i <= max; i += 1) values.push(String(i));
  const currentValue = String(current);
  if (!values.includes(currentValue)) {
    values.push(currentValue);
    notes.push(
      `trigger_every ${currentValue} is outside the ${unit} range and was added to the options`,
    );
  }

  const field: SchemaField = {
    name: 'trigger_every',
    type: 'string',
    control_type: 'select',
    label: 'Trigger every',
    optional: false,
    options: values.map((value) => [value, value]),
  };
  const derived: DerivedSchemas = {
    ok: true,
    kind: 'clock_trigger',
    extended_input_schema: [field],
    fields: ['trigger_every'],
    evidence: 'verified',
  };
  if (notes.length > 0) derived.notes = notes;
  return derived;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/** Which structured input makes a step a derivation candidate at all. */
function hasStructuredInput(step: RecipeStep): boolean {
  const input = stepInput(step);
  if (step.provider === CLOCK_PROVIDER && step.name === CLOCK_TRIGGER_ACTION) {
    return input.trigger_every !== undefined && input.trigger_every !== null;
  }
  if (step.provider !== VARIABLES_PROVIDER) return false;
  const action = String(step.name ?? '');
  // list_items with no declared item shape is the dangerous case: the items are
  // dropped on save and nothing can derive the schema, so it must be REPORTED
  // rather than quietly passed over.
  if (action === 'declare_list') {
    return typeof input.list_item_schema_json === 'string' || input.list_items !== undefined;
  }
  if (action === 'insert_to_list') return isRecordValue(input.list_item);
  if (action === 'declare_variable') return isRecordValue(input.variables);
  if (action === 'update_variables') {
    return Object.keys(input).some((key) => key !== 'input_mode' && key !== 'name');
  }
  return false;
}

/** True when this step is one the derivation knows how to handle at all. */
export function isDerivableStep(step: RecipeStep): boolean {
  if (step.provider === CLOCK_PROVIDER && step.name === CLOCK_TRIGGER_ACTION) return true;
  if (step.provider !== VARIABLES_PROVIDER) return false;
  return ['declare_list', 'insert_to_list', 'declare_variable', 'update_variables'].includes(
    String(step.name ?? ''),
  );
}

/** Derive whatever this step's own declaration supports, or say why it cannot. */
export function deriveSchemasForStep(step: RecipeStep, code?: unknown): DerivationResult {
  if (step.provider === CLOCK_PROVIDER && step.name === CLOCK_TRIGGER_ACTION) {
    return deriveClockTriggerSchema(step);
  }
  if (step.provider === VARIABLES_PROVIDER) {
    return deriveVariablesSchema(step, { code });
  }
  return {
    ok: false,
    reason:
      `step ${labelOf(step)} (${String(step.provider)}/${String(step.name)}) has no deterministic ` +
      `schema derivation. Only Variables by Workato steps and the clock trigger declare their own shape.`,
  };
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export interface SchemaComparison {
  agrees: boolean;
  differences: string[];
}

function fieldByName(list: unknown, name: string): JsonObject | undefined {
  if (!Array.isArray(list)) return undefined;
  return list.find((entry) => isRecordValue(entry) && entry.name === name) as
    | JsonObject
    | undefined;
}

function compareField(
  existing: JsonObject,
  derived: SchemaField,
  where: string,
  differences: string[],
  compareOptional: boolean,
): void {
  if (derived.type !== undefined && existing.type !== derived.type) {
    differences.push(
      `${where} is declared ${String(derived.type)} but the schema says ${String(existing.type)}`,
    );
  }
  if (derived.of !== undefined && existing.of !== derived.of) {
    differences.push(
      `${where} declares items of ${String(derived.of)} but the schema says ${String(existing.of)}`,
    );
  }
  if (
    compareOptional &&
    derived.optional !== undefined &&
    typeof existing.optional === 'boolean' &&
    existing.optional !== derived.optional
  ) {
    differences.push(
      `${where} is declared ${derived.optional ? 'optional' : 'required'} but the schema says the opposite`,
    );
  }
  if (Array.isArray(derived.properties)) {
    for (const child of derived.properties) {
      const existingChild = fieldByName(existing.properties, child.name);
      if (!existingChild) {
        differences.push(`${where}.${child.name} is declared but the schema does not list it`);
        continue;
      }
      compareField(existingChild, child, `${where}.${child.name}`, differences, true);
    }
  }
}

/**
 * Does an existing schema still match the declaration it was derived from?
 *
 * A field the schema declares on top of the derivation is left alone: a step
 * may legitimately describe more than the derivation knows. Labels and
 * control types are cosmetic and are not compared, and the top-level
 * `optional` is not compared either, because Workato itself writes the input
 * wrapper optional and the output wrapper required for the same declaration.
 */
export function compareSchemas(existing: unknown, derived: SchemaField[]): SchemaComparison {
  const differences: string[] = [];
  if (!Array.isArray(existing)) {
    return { agrees: false, differences: ['the existing schema is not an array'] };
  }
  for (const field of derived) {
    const match = fieldByName(existing, field.name);
    if (!match) {
      differences.push(`${field.name} is declared but the schema does not list it`);
      continue;
    }
    compareField(match, field, field.name, differences, false);
  }
  return { agrees: differences.length === 0, differences };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface SchemaWriteResult {
  schemas: SchemaKey[];
  /**
   * `added` filled an absent schema, `corrected` replaced one that disagreed
   * with the declaration, `rewritten` re-wrote an agreeing schema because the
   * caller asked for it, `unchanged` touched nothing.
   */
  status: 'added' | 'corrected' | 'rewritten' | 'unchanged';
  differences: string[];
}

const SCHEMA_KEYS: SchemaKey[] = ['extended_input_schema', 'extended_output_schema'];

/**
 * Write a derivation onto a step. An absent schema is filled in; a schema that
 * disagrees with the declaration is corrected; an agreeing schema is left
 * byte-for-byte alone so a save does not churn it.
 */
export function writeDerivedSchemas(
  step: RecipeStep,
  derived: DerivedSchemas,
  options: { replace?: boolean } = {},
): SchemaWriteResult {
  const written: SchemaKey[] = [];
  const differences: string[] = [];
  let corrected = false;
  let added = false;

  for (const key of SCHEMA_KEYS) {
    const fields = derived[key];
    if (!fields) continue;
    const existing = step[key];
    if (existing === undefined || existing === null) {
      step[key] = cloneFields(fields);
      written.push(key);
      added = true;
      continue;
    }
    const comparison = compareSchemas(existing, fields);
    if (comparison.agrees && options.replace !== true) continue;
    for (const difference of comparison.differences) differences.push(`${key}: ${difference}`);
    // Cloned on the way in: the tree must not share structure with the
    // derivation result, or a later edit to one would rewrite the other.
    step[key] = cloneFields(fields);
    written.push(key);
    if (!comparison.agrees) corrected = true;
  }

  return {
    schemas: written,
    status: corrected
      ? 'corrected'
      : added
        ? 'added'
        : written.length > 0
          ? 'rewritten'
          : 'unchanged',
    differences,
  };
}

// ---------------------------------------------------------------------------
// Whole-tree derivation
// ---------------------------------------------------------------------------

export interface DerivedSchemaEntry {
  /** The step's `as` anchor, or `#<number>` when it has none. */
  step: string;
  step_number?: number;
  kind: DerivedSchemaKind;
  /** Top-level field names the derivation declares. */
  fields: string[];
  /** Which schemas were written. */
  schemas: SchemaKey[];
  status: 'added' | 'corrected';
  evidence: 'verified' | 'documented';
  differences?: string[];
  notes?: string[];
}

export interface SkippedDerivation {
  step: string;
  reason: string;
}

export interface ApplyDerivedResult {
  applied: DerivedSchemaEntry[];
  /** Steps that looked derivable but whose declaration was missing. */
  skipped: SkippedDerivation[];
}

export interface ApplyDerivedOptions {
  /** Restrict the walk to these step objects (identity). Default: every step. */
  only?: ReadonlySet<unknown>;
  /** Report what would be written without touching the tree. */
  dryRun?: boolean;
}

/**
 * Fill in every extended schema the tree's own declarations imply.
 *
 * Runs over the WHOLE tree, not only the steps a call edited: a save writes the
 * whole tree back, so an untouched declare_list with no schema loses its items
 * on this save just as surely as one that was edited.
 */
export function applyDerivedSchemas(
  code: unknown,
  options: ApplyDerivedOptions = {},
): ApplyDerivedResult {
  const applied: DerivedSchemaEntry[] = [];
  const skipped: SkippedDerivation[] = [];

  for (const step of walkSteps(code)) {
    if (options.only && !options.only.has(step)) continue;
    if (!isDerivableStep(step) || !hasStructuredInput(step)) continue;

    const result = deriveSchemasForStep(step, code);
    if (!result.ok) {
      skipped.push({ step: labelOf(step), reason: result.reason });
      continue;
    }

    // A dry run writes onto a shallow copy: only the two schema keys are ever
    // assigned, so nothing inside the real tree is touched.
    const target = options.dryRun === true ? ({ ...step } as RecipeStep) : step;
    const write = writeDerivedSchemas(target, result);
    if (write.status !== 'added' && write.status !== 'corrected') continue;

    const entry: DerivedSchemaEntry = {
      step: labelOf(step),
      kind: result.kind,
      fields: result.fields,
      schemas: write.schemas,
      status: write.status,
      evidence: result.evidence,
    };
    if (typeof step.number === 'number') entry.step_number = step.number;
    if (write.differences.length > 0) entry.differences = write.differences;
    if (result.notes && result.notes.length > 0) entry.notes = result.notes;
    applied.push(entry);
  }

  return { applied, skipped };
}

// ---------------------------------------------------------------------------
// Static + dynamic field merge
// ---------------------------------------------------------------------------

export type FieldProvenance = 'static' | 'dynamic' | 'both';

export interface MergedField extends SchemaField {
  provenance: FieldProvenance;
  properties?: MergedField[];
}

export interface FieldMergeReport {
  fields: MergedField[];
  /** Provenance of every top-level field, by name. */
  provenance: Record<string, FieldProvenance>;
  /** True only when both sources were present and describe the same field set. */
  complete: boolean;
  only_static: string[];
  only_dynamic: string[];
  /** Why `complete` is false, in words. */
  reasons: string[];
}

function normalizeSourceFields(value: unknown): SchemaField[] {
  if (!Array.isArray(value)) return [];
  const out: SchemaField[] = [];
  for (const entry of value) {
    if (!isRecordValue(entry)) continue;
    if (typeof entry.name !== 'string' || entry.name.length === 0) continue;
    out.push(entry as unknown as SchemaField);
  }
  return out;
}

function mergeOne(
  staticField: SchemaField | undefined,
  dynamicField: SchemaField | undefined,
): MergedField {
  const provenance: FieldProvenance =
    staticField && dynamicField ? 'both' : staticField ? 'static' : 'dynamic';
  // The step's own schema is what Workato applies, so it wins on every key it
  // actually carries; the adapter meta fills in what the step leaves unsaid.
  const merged: MergedField = {
    ...(staticField ?? {}),
    ...(dynamicField ?? {}),
    name: String((dynamicField ?? staticField)?.name),
    provenance,
  } as MergedField;

  const staticChildren = normalizeSourceFields(staticField?.properties);
  const dynamicChildren = normalizeSourceFields(dynamicField?.properties);
  if (staticChildren.length > 0 || dynamicChildren.length > 0) {
    merged.properties = mergeFieldLists(staticChildren, dynamicChildren).fields;
  }
  return merged;
}

function mergeFieldLists(
  staticFields: SchemaField[],
  dynamicFields: SchemaField[],
): { fields: MergedField[]; provenance: Record<string, FieldProvenance> } {
  const dynamicByName = new Map(dynamicFields.map((field) => [field.name, field]));
  const staticByName = new Map(staticFields.map((field) => [field.name, field]));
  const fields: MergedField[] = [];
  const provenance: Record<string, FieldProvenance> = {};

  for (const field of staticFields) {
    const merged = mergeOne(field, dynamicByName.get(field.name));
    fields.push(merged);
    provenance[merged.name] = merged.provenance;
  }
  for (const field of dynamicFields) {
    if (staticByName.has(field.name)) continue;
    const merged = mergeOne(undefined, field);
    fields.push(merged);
    provenance[merged.name] = merged.provenance;
  }
  return { fields, provenance };
}

/**
 * Merge the adapter's static field list with the schema the step itself
 * declares, and report where each field came from.
 *
 * `complete` is deliberately strict: it is true only when both sources were
 * supplied and every field is in both. A step that declares a field the adapter
 * never mentions, or an adapter field the step omits, is a real gap in the
 * picture and saying so is the point of the report.
 */
export function mergeFieldSchemas(staticFields: unknown, dynamicSchema: unknown): FieldMergeReport {
  const statics = normalizeSourceFields(staticFields);
  const dynamics = normalizeSourceFields(dynamicSchema);
  const { fields, provenance } = mergeFieldLists(statics, dynamics);

  const only_static = fields.filter((f) => f.provenance === 'static').map((f) => f.name);
  const only_dynamic = fields.filter((f) => f.provenance === 'dynamic').map((f) => f.name);

  const reasons: string[] = [];
  if (statics.length === 0) reasons.push('no static adapter fields were supplied');
  if (dynamics.length === 0) reasons.push('the step declares no extended schema');
  if (statics.length > 0 && only_static.length > 0) {
    reasons.push(`${only_static.length} adapter field(s) are not declared on the step`);
  }
  if (dynamics.length > 0 && only_dynamic.length > 0) {
    reasons.push(`${only_dynamic.length} declared field(s) are not in the adapter meta`);
  }

  return {
    fields,
    provenance,
    complete: reasons.length === 0,
    only_static,
    only_dynamic,
    reasons,
  };
}
