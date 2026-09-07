/**
 * @fileoverview `workato_recipe_validate`: everything that can be checked
 * locally, before a save creates a version.
 *
 * Workato publishes no validate-without-save endpoint (`validate.json` and
 * `ready.json` are both 404), so the only way to learn that a tree is wrong has
 * been to save it and read `code_errors`, which costs a version. This tool runs
 * the checks that do not need Workato: structure, connection bindings, datapill
 * references, extended schemas, and a preview of the schemas the engine would
 * derive. It reads and never writes.
 *
 * What it does NOT cover is stated in the response rather than implied:
 * formulas are Ruby and are not parsed, and nothing here proves the recipe runs.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import {
  CONNECTIONLESS_PROVIDERS,
  collectProviders,
  errorResult,
  indexSteps,
  isRecord,
  parseConfig,
  parseToolJson,
  stepLabel,
  validateRecipeTree,
  type ExtensionCaller,
  type JsonObject,
  type RecipeStep,
} from './workato-recipe-engine';
import {
  applyDerivedSchemas,
  deriveSchemasForStep,
  isDerivableStep,
  parseVariableComposite,
  VARIABLES_PROVIDER,
  type DerivedSchemaEntry,
} from './workato-recipe-schema';

export const WORKATO_RECIPE_VALIDATE_TOOL = 'workato_recipe_validate';

export function isRecipeValidateTool(name: string): boolean {
  return name === WORKATO_RECIPE_VALIDATE_TOOL;
}

export interface ValidationFinding {
  severity: 'error' | 'warning';
  /** Machine-readable reason, stable across wording changes. */
  code: string;
  message: string;
  step?: string;
  step_number?: number;
  path?: string;
}

export interface ValidationCoverage {
  structure: boolean;
  bindings: boolean;
  datapills: boolean;
  schemas: boolean;
  formulas: boolean;
  runtime: boolean;
}

export interface ValidationReport {
  valid: boolean;
  errors: ValidationFinding[];
  warnings: ValidationFinding[];
  coverage: ValidationCoverage;
  derived_schemas: DerivedSchemaEntry[];
  step_count: number;
  providers: string[];
}

/** Control nodes carry structured input (conditions, sources) by design. */
const CONTROL_KEYWORDS = new Set([
  'if',
  'elsif',
  'else',
  'foreach',
  'repeat',
  'try',
  'catch',
  'while_condition',
]);

/**
 * Providers whose output schema exists ONLY on the step. An app step gets its
 * output shape from the adapter, so a missing `extended_output_schema` there is
 * normal; a Variables step or a catch block has no other source.
 */
const OUTPUT_SCHEMA_ONLY_ON_STEP = new Set([VARIABLES_PROVIDER]);

/** Control nodes whose own output (catch message, loop item) is read by pills on the node itself. */
const SELF_READ_KEYWORDS = new Set(['catch', 'foreach', 'repeat']);

const DP_PAYLOAD = /_dp\('((?:[^'\\]|\\.)*)'\)/g;

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

/**
 * Structural rules, reported as errors.
 *
 * The engine grades the same rules by whether the current call touched the
 * node, because a mutation must stay possible on a recipe that arrived with a
 * quirk. Validation has no such tension: it writes nothing, so every rule is
 * reported at full strength and the caller decides.
 */
export function checkStructure(code: unknown): ValidationFinding[] {
  // Every node counts as touched (numbering and nesting are errors), none as
  // created: a non-hex `as` such as "tjcall01" is accepted by Workato on a
  // saved recipe, so its format is a warning here, not a reason to call a
  // working recipe invalid.
  const nodes = new Set(indexSteps(code).map((entry) => entry.step));
  const result = validateRecipeTree(code, nodes, new Set());
  return [
    ...result.errors.map(
      (message): ValidationFinding => ({ severity: 'error', code: 'structure', message }),
    ),
    ...result.warnings.map(
      (message): ValidationFinding => ({ severity: 'warning', code: 'structure', message }),
    ),
  ];
}

// ---------------------------------------------------------------------------
// Connection bindings
// ---------------------------------------------------------------------------

/**
 * Every connection-backed provider used by the tree needs a config entry with
 * an `account_id`. Without one the save succeeds and the START fails, async,
 * with `account_id can't be blank` recorded only in state.json.
 */
export function checkBindings(code: unknown, config: unknown): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const parsed = parseConfig(config);

  if (parsed === undefined || parsed === null) {
    findings.push({
      severity: 'warning',
      code: 'config_absent',
      message:
        'no recipe config was supplied, so connection bindings were not checked. Pass config, or ' +
        'validate by recipe_id so the config is pulled with the recipe.',
    });
    return findings;
  }
  if (!Array.isArray(parsed)) {
    findings.push({
      severity: 'warning',
      code: 'config_unparseable',
      message: 'the recipe config is not a JSON array, so connection bindings were not checked',
    });
    return findings;
  }

  const entries = parsed.filter(isRecord);
  const used = collectProviders(code);
  for (const provider of used) {
    if (CONNECTIONLESS_PROVIDERS.has(provider)) continue;
    const entry = entries.find((item) => item.provider === provider);
    if (!entry) {
      findings.push({
        severity: 'error',
        code: 'config_entry_missing',
        message:
          `provider ${provider} is used by a step but has no entry in the recipe config, so no ` +
          `connection can be bound to it`,
      });
      continue;
    }
    if (entry.account_id === undefined || entry.account_id === null || entry.account_id === '') {
      findings.push({
        severity: 'error',
        code: 'account_id_missing',
        message:
          `provider ${provider} has a config entry with no account_id. Workato saves this and then ` +
          `refuses to start the recipe with "account_id can't be blank". Bind a connection with ` +
          `workato_recipe_apply(bind_connection).`,
      });
    }
  }

  for (const entry of entries) {
    if (typeof entry.provider !== 'string') continue;
    if (CONNECTIONLESS_PROVIDERS.has(entry.provider)) continue;
    if (entry.account_id !== undefined) continue;
    if (used.includes(entry.provider)) continue;
    findings.push({
      severity: 'warning',
      code: 'config_entry_unused',
      message: `the config binds ${entry.provider}, which no step in this recipe uses`,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Datapill references
// ---------------------------------------------------------------------------

export interface DatapillReference {
  /** Label of the step holding the reference. */
  step: string;
  step_number?: number;
  /** Position of the referencing step in the depth-first walk. */
  order: number;
  /** Where inside the step the reference sits. */
  path: string;
  /** The `as` anchor the pill points at. */
  line: string;
  /** Path inside the referenced step's output. */
  target_path: unknown[];
  /** True for the `<uuid>:<as>` lookup key the Variables actions use. */
  composite: boolean;
}

/** Every `_dp(...)` pill and Variables composite in the tree, with its origin. */
export function collectDatapillReferences(code: unknown): DatapillReference[] {
  const references: DatapillReference[] = [];

  const scanString = (value: string, step: RecipeStep, order: number, where: string) => {
    DP_PAYLOAD.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = DP_PAYLOAD.exec(value)) !== null) {
      let pill: unknown;
      try {
        pill = JSON.parse(match[1].replace(/\\'/g, "'"));
      } catch {
        continue;
      }
      if (!isRecord(pill)) continue;
      if (typeof pill.line !== 'string' || pill.line.length === 0) continue;
      references.push({
        step: stepLabel(step),
        step_number: typeof step.number === 'number' ? step.number : undefined,
        order,
        path: where,
        line: pill.line,
        target_path: Array.isArray(pill.path) ? pill.path : [],
        composite: false,
      });
    }
  };

  const walk = (value: unknown, step: RecipeStep, order: number, where: string) => {
    if (typeof value === 'string') {
      scanString(value, step, order, where);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, step, order, `${where}[${i}]`));
      return;
    }
    if (isRecord(value)) {
      for (const [key, child] of Object.entries(value)) {
        if (key === 'block') continue;
        walk(child, step, order, where ? `${where}.${key}` : key);
      }
    }
  };

  for (const entry of indexSteps(code)) {
    const step = entry.step;
    for (const [key, value] of Object.entries(step)) {
      if (key === 'block') continue;
      walk(value, step, entry.order, key);
    }
    // The Variables lookup key is not a pill and the pill scan cannot see it.
    if (step.provider === VARIABLES_PROVIDER && isRecord(step.input)) {
      const composite = parseVariableComposite((step.input as JsonObject).name);
      if (composite) {
        references.push({
          step: stepLabel(step),
          step_number: typeof step.number === 'number' ? step.number : undefined,
          order: entry.order,
          path: 'input.name',
          line: composite.as,
          target_path: composite.variable ? [composite.variable] : [],
          composite: true,
        });
      }
    }
  }

  return references;
}

/**
 * Every datapill must point at a step that exists AND that runs before the
 * reference. A pill pointing at a later step, or at an anchor a removed step
 * took with it, saves cleanly and then fails at validation or at run time with
 * "Unknown data field".
 */
export function checkDatapillReferences(code: unknown): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const order = new Map<string, number>();
  const keywordByAnchor = new Map<string, string>();
  for (const entry of indexSteps(code)) {
    const anchor = entry.step.as;
    if (typeof anchor === 'string' && anchor.length > 0 && !order.has(anchor)) {
      order.set(anchor, entry.order);
      keywordByAnchor.set(anchor, String(entry.step.keyword));
    }
  }

  for (const reference of collectDatapillReferences(code)) {
    const targetOrder = order.get(reference.line);
    if (targetOrder === undefined) {
      findings.push({
        severity: 'error',
        code: reference.composite ? 'broken_variable_reference' : 'broken_datapill',
        step: reference.step,
        step_number: reference.step_number,
        path: reference.path,
        message:
          `${reference.path} points at anchor ${reference.line}, which is not a step in this ` +
          `recipe. ${reference.composite ? 'The Variables action would not find its declaration.' : 'Workato reports this as "Unknown data field".'}`,
      });
      continue;
    }
    // A catch block reads its own error (catch.<as>.message) in its filter and
    // its children; a foreach reads its own item the same way. Those are
    // self-reads of a control node, not forward references.
    const selfRead =
      targetOrder === reference.order &&
      SELF_READ_KEYWORDS.has(keywordByAnchor.get(reference.line) ?? '');
    if (targetOrder >= reference.order && !selfRead) {
      findings.push({
        severity: 'error',
        code: 'datapill_not_upstream',
        step: reference.step,
        step_number: reference.step_number,
        path: reference.path,
        message:
          `${reference.path} references step ${reference.line}, which runs at or after this step. ` +
          `A datapill can only read a step that already ran.`,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Extended schemas
// ---------------------------------------------------------------------------

function declaresField(schema: unknown, name: string): boolean {
  return Array.isArray(schema) && schema.some((entry) => isRecord(entry) && entry.name === name);
}

/** An input value structured enough for Workato to drop it without a schema. */
function isStructuredValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => isRecord(item));
  if (!isRecord(value)) return false;
  return Object.values(value).some((child) => isRecord(child) || Array.isArray(child));
}

/**
 * The two silent-strip rules, checked in both directions:
 * structured input without an `extended_input_schema` is dropped on save, and
 * a step whose output is read by a datapill but whose shape exists nowhere else
 * makes the reading step fail validation.
 */
export function checkSchemas(code: unknown): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const steps = indexSteps(code);

  for (const entry of steps) {
    const step = entry.step;
    const label = stepLabel(step);
    const stepNumber = typeof step.number === 'number' ? step.number : undefined;

    if (isDerivableStep(step)) {
      const derived = deriveSchemasForStep(step, code);
      if (!derived.ok) {
        findings.push({
          severity: 'warning',
          code: 'declaration_missing',
          step: label,
          step_number: stepNumber,
          message: derived.reason,
        });
      } else {
        for (const key of ['extended_input_schema', 'extended_output_schema'] as const) {
          const fields = derived[key];
          if (!fields) continue;
          if (step[key] === undefined || step[key] === null) {
            findings.push({
              severity: 'warning',
              code: 'missing_extended_schema',
              step: label,
              step_number: stepNumber,
              path: key,
              message:
                `${derived.kind} ${label} has no ${key} for ${fields.map((f) => f.name).join(', ')}. ` +
                `Workato saves this with code_errors [] and drops the field on readback. ` +
                `workato_recipe_apply(auto_schema) derives it from the step's own declaration.`,
            });
          }
        }
      }
    }

    if (!CONTROL_KEYWORDS.has(String(step.keyword)) && isRecord(step.input)) {
      for (const [key, value] of Object.entries(step.input as JsonObject)) {
        if (!isStructuredValue(value)) continue;
        if (declaresField(step.extended_input_schema, key)) continue;
        findings.push({
          severity: 'warning',
          code: 'structured_input_no_schema',
          step: label,
          step_number: stepNumber,
          path: `input.${key}`,
          message:
            `input.${key} is a structured value and ${label} declares no extended_input_schema ` +
            `entry for it. If it is not part of the action's base schema, Workato drops it on save.`,
        });
      }
    }
  }

  const byAnchor = new Map<string, RecipeStep>();
  for (const entry of steps) {
    if (typeof entry.step.as === 'string') byAnchor.set(entry.step.as, entry.step);
  }
  const reported = new Set<string>();
  for (const reference of collectDatapillReferences(code)) {
    if (reference.composite || reference.target_path.length === 0) continue;
    const target = byAnchor.get(reference.line);
    if (!target) continue;
    // A catch publishes message/error implicitly and never carries a schema.
    const providerNeedsIt =
      typeof target.provider === 'string' && OUTPUT_SCHEMA_ONLY_ON_STEP.has(target.provider);
    if (!providerNeedsIt) continue;
    if (target.extended_output_schema !== undefined && target.extended_output_schema !== null) {
      continue;
    }
    if (reported.has(reference.line)) continue;
    reported.add(reference.line);
    findings.push({
      severity: 'warning',
      code: 'datapill_target_no_output_schema',
      step: stepLabel(target),
      step_number: typeof target.number === 'number' ? target.number : undefined,
      path: 'extended_output_schema',
      message:
        `step ${reference.step} reads ${reference.line} at ${reference.path}, but ${reference.line} ` +
        `declares no extended_output_schema and its provider publishes none. The reference fails ` +
        `validation with "Unknown data field".`,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export function buildValidationReport(input: {
  code: unknown;
  config?: unknown;
}): ValidationReport {
  const findings = [
    ...checkStructure(input.code),
    ...checkBindings(input.code, input.config),
    ...checkDatapillReferences(input.code),
    ...checkSchemas(input.code),
  ];
  const errors = findings.filter((finding) => finding.severity === 'error');
  const warnings = findings.filter((finding) => finding.severity === 'warning');

  // Preview only: the tree handed in is never written back from here.
  const derived = applyDerivedSchemas(input.code, { dryRun: true });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    coverage: {
      structure: true,
      bindings: true,
      datapills: true,
      schemas: true,
      formulas: false,
      runtime: false,
    },
    derived_schemas: derived.applied,
    step_count: indexSteps(input.code).length,
    providers: collectProviders(input.code),
  };
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export interface ValidationSource {
  kind: 'recipe' | 'file' | 'inline';
  recipe_id?: number;
  version_no?: unknown;
  name?: unknown;
  code: unknown;
  config?: unknown;
  path?: string;
}

/** Read a recipe file written by `workato_pull_recipe(out_file)`, or a bare tree. */
export function loadRecipeTreeFromFile(codePath: string): ValidationSource {
  const resolved = path.resolve(codePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`code_path file not found: ${resolved}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    throw new Error(
      `code_path file is not valid JSON (${resolved}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new Error(`code_path file must contain a JSON object: ${resolved}`);
  }
  const isEnvelope = isRecord(parsed.code);
  if (!isEnvelope) {
    return { kind: 'file', code: parsed, path: resolved };
  }
  return {
    kind: 'file',
    code: parsed.code,
    config: parsed.config,
    recipe_id: typeof parsed.recipe_id === 'number' ? parsed.recipe_id : undefined,
    version_no: parsed.version_no,
    name: parsed.name,
    path: resolved,
  };
}

async function resolveSource(
  args: JsonObject,
  callExtension: ExtensionCaller,
): Promise<ValidationSource> {
  if (args.code !== undefined) {
    if (!isRecord(args.code)) throw new Error('code must be the recipe trigger object');
    return {
      kind: 'inline',
      code: args.code,
      config: args.config,
      recipe_id: typeof args.recipe_id === 'number' ? args.recipe_id : undefined,
    };
  }

  if (typeof args.code_path === 'string' && args.code_path.length > 0) {
    const source = loadRecipeTreeFromFile(args.code_path);
    if (args.config !== undefined) source.config = args.config;
    if (typeof args.recipe_id === 'number') {
      if (source.recipe_id !== undefined && source.recipe_id !== args.recipe_id) {
        throw new Error(
          `recipe_id mismatch: ${source.path} holds recipe ${source.recipe_id}, but the call names ` +
            `recipe ${args.recipe_id}. Nothing was read from Workato.`,
        );
      }
      source.recipe_id = args.recipe_id;
    }
    return source;
  }

  if (typeof args.recipe_id !== 'number') {
    throw new Error(
      'pass recipe_id to validate the saved recipe, code_path to validate a pulled file, or code ' +
        'to validate a tree you are about to save',
    );
  }

  const pullArgs: JsonObject = { recipe_id: args.recipe_id, view: 'full' };
  if (typeof args.tabId === 'number') pullArgs.tabId = args.tabId;
  if (typeof args.windowId === 'number') pullArgs.windowId = args.windowId;
  const pulled = parseToolJson(await callExtension('workato_pull_recipe', pullArgs));
  if (!isRecord(pulled.code)) {
    throw new Error('workato_pull_recipe did not return a recipe code object');
  }
  const version = isRecord(pulled.version) ? pulled.version : {};
  return {
    kind: 'recipe',
    code: pulled.code,
    config: args.config !== undefined ? args.config : version.config,
    recipe_id: args.recipe_id,
    version_no: version.version_no,
    name: version.name,
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

function describeSource(source: ValidationSource): string {
  if (source.kind === 'file') return `file ${source.path}`;
  if (source.kind === 'inline') return 'the supplied code tree';
  return `recipe ${String(source.recipe_id)} version ${String(source.version_no ?? '?')}`;
}

export async function handleWorkatoRecipeValidateCall(
  name: string,
  args: JsonObject,
  callExtension: ExtensionCaller,
): Promise<CallToolResult> {
  try {
    const source = await resolveSource(args, callExtension);
    const report = buildValidationReport({ code: source.code, config: source.config });

    const payload: JsonObject = {
      ok: true,
      source: source.kind,
      recipe_id: source.recipe_id,
      version_no: source.version_no,
      valid: report.valid,
      errors: report.errors,
      warnings: report.warnings,
      coverage: report.coverage,
      derived_schemas: report.derived_schemas,
      step_count: report.step_count,
      providers: report.providers,
      saved: false,
      note:
        'Local checks only. Formulas are not parsed and nothing was executed, so a valid result ' +
        'is not proof the recipe runs. Workato has no validate-without-save endpoint.',
    };
    if (source.path) payload.code_path = source.path;

    const headline =
      `${name}: ${describeSource(source)} is ${report.valid ? 'locally VALID' : 'INVALID'} ` +
      `(${report.errors.length} error${report.errors.length === 1 ? '' : 's'}, ` +
      `${report.warnings.length} warning${report.warnings.length === 1 ? '' : 's'}, ` +
      `${report.derived_schemas.length} schema${report.derived_schemas.length === 1 ? '' : 's'} ` +
      `would be derived). Nothing was saved.`;

    return {
      isError: false,
      content: [{ type: 'text', text: `${headline}\n${JSON.stringify(payload)}` }],
    };
  } catch (error) {
    return errorResult(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
