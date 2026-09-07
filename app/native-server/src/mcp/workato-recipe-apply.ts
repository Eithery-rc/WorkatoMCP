/**
 * @fileoverview `workato_recipe_apply` and the three legacy mutator names.
 *
 * Every operation here is a pure edit against the engine's cloned tree; the
 * engine does the pull, the validation, the config merge and the single save.
 * The batch is all-or-nothing: an invalid operation throws before the save, so
 * a half-applied tree is never written.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import {
  applyDeleteInput,
  applySetExtendedSchema,
  applySetInput,
  applySetPyEvalCode,
  buildMutatorSummary,
  datapillToFormula,
  datapillToInterpolated,
  errorResult,
  findDatapillReferences,
  indexSteps,
  isRecord,
  normalizeInputValue,
  parseDatapillPath,
  requireRecipeId,
  RecipeMutationError,
  runRecipeMutation,
  stepLabel,
  WORKATO_RECIPE_MUTATOR_TOOLS,
  type ExtensionCaller,
  type JsonObject,
  type MutationSummary,
  type RecipeMutationContext,
  type RecipeStep,
  type StepLocation,
} from './workato-recipe-engine';
import { deriveSchemasForStep, writeDerivedSchemas } from './workato-recipe-schema';

export const RECIPE_APPLY_OPS = [
  'set_input',
  'delete_input',
  'set_extended_schema',
  'set_py_eval_code',
  'map_datapill',
  'insert_step',
  'remove_step',
  'move_step',
  'set_loop_source',
  'bind_connection',
  'derive_schema',
] as const;

export type RecipeApplyOp = (typeof RECIPE_APPLY_OPS)[number];

export const MAX_APPLY_CHANGES = 50;

const INSERTABLE_KEYWORDS = new Set(['action', 'if', 'foreach', 'repeat', 'try', 'stop']);
const BLOCK_KEYWORDS = new Set([
  'trigger',
  'if',
  'elsif',
  'else',
  'foreach',
  'repeat',
  'try',
  'catch',
]);
/** Nodes whose position inside their parent block is structural, not editorial. */
const STRUCTURAL_KEYWORDS = new Set(['elsif', 'else', 'catch', 'while_condition']);

// ---------------------------------------------------------------------------
// Insertion anchors
// ---------------------------------------------------------------------------

interface Insertion {
  block: RecipeStep[];
  index: number;
  parent: RecipeStep;
  describe: string;
}

function childArray(node: RecipeStep): RecipeStep[] {
  if (!Array.isArray(node.block)) {
    if (!BLOCK_KEYWORDS.has(String(node.keyword))) {
      throw new Error(
        `step ${stepLabel(node)} (keyword ${String(node.keyword)}) cannot hold nested steps`,
      );
    }
    node.block = [];
  }
  return node.block as RecipeStep[];
}

/**
 * Where a step may be inserted inside a block, honouring the nesting rules:
 * elsif/else stay at the tail of an if block, catch stays last inside try, and
 * a repeat's while_condition stays first.
 */
function boundedIndex(parent: RecipeStep, block: RecipeStep[], position: 'first' | 'last'): number {
  if (position === 'first') {
    return parent.keyword === 'repeat' && block[0]?.keyword === 'while_condition' ? 1 : 0;
  }
  let index = block.length;
  if (parent.keyword === 'if' || parent.keyword === 'elsif') {
    while (
      index > 0 &&
      (block[index - 1]?.keyword === 'else' || block[index - 1]?.keyword === 'elsif')
    ) {
      index -= 1;
    }
  }
  if (parent.keyword === 'try') {
    while (index > 0 && block[index - 1]?.keyword === 'catch') index -= 1;
  }
  return index;
}

function resolveAnchor(ctx: RecipeMutationContext, anchor: unknown): Insertion {
  const spec: JsonObject = isRecord(anchor) ? anchor : {};
  const mode = spec.mode === undefined ? 'into' : spec.mode;
  const stepRef = spec.step === undefined ? 0 : spec.step;
  if (mode !== 'after' && mode !== 'before' && mode !== 'into') {
    throw new Error('anchor.mode must be after, before, or into');
  }

  const located: StepLocation = ctx.locate(stepRef);
  const label = stepLabel(located.step);

  if (mode === 'into') {
    const position = spec.position === 'first' ? 'first' : 'last';
    const block = childArray(located.step);
    return {
      block,
      index: boundedIndex(located.step, block, position),
      parent: located.step,
      describe: `into ${label} (${position})`,
    };
  }

  if (located.block === null || located.parent === null) {
    // The trigger is the root node, not an entry in any block.
    if (mode === 'before') {
      throw new Error(
        'nothing can be inserted before the trigger; use anchor mode into with position first',
      );
    }
    const block = childArray(located.step);
    return {
      block,
      index: boundedIndex(located.step, block, 'first'),
      parent: located.step,
      describe: `into ${label} (first)`,
    };
  }

  if (STRUCTURAL_KEYWORDS.has(String(located.step.keyword))) {
    const hint =
      located.step.keyword === 'while_condition'
        ? 'a repeat while_condition must stay the first child'
        : `${String(located.step.keyword)} must stay at the end of its parent block; insert into it instead`;
    throw new Error(`cannot insert ${mode} ${label}: ${hint}`);
  }

  return {
    block: located.block,
    index: mode === 'after' ? located.index + 1 : located.index,
    parent: located.parent,
    describe: `${mode} ${label}`,
  };
}

// ---------------------------------------------------------------------------
// Node builders
// ---------------------------------------------------------------------------

function buildNode(ctx: RecipeMutationContext, change: JsonObject): RecipeStep {
  const keyword = change.keyword === undefined ? 'action' : change.keyword;
  if (typeof keyword !== 'string' || !INSERTABLE_KEYWORDS.has(keyword)) {
    throw new Error(`keyword must be one of ${[...INSERTABLE_KEYWORDS].join(', ')}`);
  }

  const input = change.input === undefined ? {} : change.input;
  if (!isRecord(input)) throw new Error('input must be an object');

  const as =
    change.as === undefined
      ? undefined
      : typeof change.as === 'string' && /^[0-9a-f]{8}$/.test(change.as)
        ? change.as
        : (() => {
            throw new Error('as must be 8 lowercase hex characters');
          })();

  const node: RecipeStep = { number: 0, keyword, uuid: ctx.newUuid() };

  if (keyword === 'action') {
    if (typeof change.provider !== 'string' || change.provider.length === 0) {
      throw new Error('provider is required for an action step');
    }
    if (typeof change.action_name !== 'string' || change.action_name.length === 0) {
      throw new Error('action_name is required for an action step');
    }
    node.provider = change.provider;
    node.name = change.action_name;
    node.as = as ?? ctx.newAs();
    node.input = { ...input };
  } else if (keyword === 'if') {
    node.input = isRecord(change.input)
      ? { ...input }
      : { type: 'compound', operand: 'and', conditions: [] };
    node.block = [];
  } else if (keyword === 'foreach') {
    node.as = as ?? ctx.newAs();
    node.clear_scope = typeof change.clear_scope === 'string' ? change.clear_scope : 'false';
    node.repeat_mode = change.repeat_mode === 'batch' ? 'batch' : 'simple';
    if (node.repeat_mode === 'batch') {
      node.batch_size = change.batch_size === undefined ? '10' : String(change.batch_size);
    }
    if (change.source !== undefined)
      node.source = encodeLoopSource(change.source, change.source_kind);
    node.input = { ...input };
    node.block = [];
  } else if (keyword === 'repeat') {
    node.as = as ?? ctx.newAs();
    node.input = { ...input };
    // The while_condition is the repeat's first child, never a sibling.
    node.block = [
      {
        keyword: 'while_condition',
        number: 0,
        uuid: ctx.newUuid(),
        input: isRecord(change.while_condition)
          ? change.while_condition
          : { type: 'compound', operand: 'and', conditions: [] },
      },
    ];
  } else if (keyword === 'try') {
    node.input = { ...input };
    // catch is the LAST entry inside try.block, never a sibling.
    node.block = [
      {
        as: ctx.newAs(),
        keyword: 'catch',
        number: 0,
        uuid: ctx.newUuid(),
        input: { max_retry_count: '0', retry_interval: '3' },
        block: [],
      },
    ];
  } else {
    // stop
    node.as = as ?? ctx.newAs();
    node.input = Object.keys(input).length > 0 ? { ...input } : { stop_with_error: 'false' };
  }

  if (typeof change.title === 'string') node.title = change.title;
  if (typeof change.description === 'string') node.description = change.description;
  if (Array.isArray(change.extended_input_schema)) {
    node.extended_input_schema = change.extended_input_schema;
  }
  if (Array.isArray(change.extended_output_schema)) {
    node.extended_output_schema = change.extended_output_schema;
  }
  return node;
}

/** A loop `source` is a `#{_dp(...)}` formula; a literal is passed through as given. */
function encodeLoopSource(source: unknown, kind: unknown): string {
  if (kind === 'literal') {
    if (typeof source !== 'string') throw new Error('a literal source must be a string');
    return source;
  }
  if (kind === 'formula') return String(normalizeInputValue(source, 'formula'));
  if (kind === 'interpolated') return String(normalizeInputValue(source, 'interpolated'));
  if (kind === 'datapill') return datapillToInterpolated(source);
  if (isRecord(source)) return datapillToInterpolated(source);
  if (typeof source === 'string') {
    // Already an encoded pill or formula: leave it byte-for-byte alone.
    if (source.startsWith('#{') || source.startsWith('=')) return source;
    return datapillToInterpolated(source);
  }
  throw new Error('source must be a datapill object, a datapill shorthand, or an encoded string');
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

function subtreeNodes(root: RecipeStep): Set<RecipeStep> {
  return new Set(indexSteps(root).map((entry) => entry.step));
}

function applyOne(ctx: RecipeMutationContext, change: JsonObject): MutationSummary {
  const op = change.op;

  if (
    op === 'set_input' ||
    op === 'delete_input' ||
    op === 'set_py_eval_code' ||
    op === 'set_extended_schema'
  ) {
    const located = ctx.locate(change.step);
    ctx.touch(located.step);
    const label = stepLabel(located.step);
    if (op === 'set_input') {
      const { path } = applySetInput(located.step, change);
      ctx.change(`${label}:input.${path}`);
      return {
        kind: 'set_input',
        step_number: located.step.number,
        step_as: located.step.as,
        path,
      };
    }
    if (op === 'delete_input') {
      const { path } = applyDeleteInput(located.step, change);
      ctx.change(`${label}:-input.${path}`);
      return {
        kind: 'delete_input',
        step_number: located.step.number,
        step_as: located.step.as,
        path,
      };
    }
    if (op === 'set_py_eval_code') {
      const { warnings } = applySetPyEvalCode(located.step, change);
      ctx.change(`${label}:input.code`);
      const summary: MutationSummary = {
        kind: 'set_py_eval_code',
        step_number: located.step.number,
        step_as: located.step.as,
        path: 'code',
      };
      if (warnings.length > 0) summary.warnings = warnings;
      return summary;
    }
    const { kind } = applySetExtendedSchema(located.step, change);
    ctx.change(`${label}:${kind}`);
    return {
      kind: 'set_extended_schema',
      step_number: located.step.number,
      step_as: located.step.as,
      schema_kind: kind,
    };
  }

  if (op === 'map_datapill') {
    const target = ctx.locate(change.step);
    const source = ctx.locate(change.source_step);
    const provider =
      typeof source.step.provider === 'string' && source.step.provider.length > 0
        ? source.step.provider
        : ['foreach', 'repeat', 'catch'].includes(String(source.step.keyword))
          ? String(source.step.keyword)
          : undefined;
    if (!provider) {
      throw new Error(
        `source step ${stepLabel(source.step)} has no provider to build a datapill from`,
      );
    }
    if (typeof source.step.as !== 'string' || source.step.as.length === 0) {
      throw new Error(`source step ${stepLabel(source.step)} has no \`as\` anchor to reference`);
    }
    const rawPath = change.source_path ?? change.segments ?? [];
    if (!Array.isArray(rawPath)) throw new Error('source_path must be an array');
    // `rows[]` and `rows#size` expand to their accessor objects; raw path
    // objects (e.g. {path_element_type:"current_item"}) pass through unchanged.
    const path: unknown[] = [];
    for (const part of rawPath) {
      if (typeof part === 'string') path.push(...parseDatapillPath([part]));
      else path.push(part);
    }
    const pill = { pill_type: 'output', provider, line: source.step.as, path };
    const value =
      change.mode === 'formula' ? datapillToFormula(pill) : datapillToInterpolated(pill);
    ctx.touch(target.step);
    const { path: written } = applySetInput(target.step, {
      path: change.path,
      value,
      value_kind: 'interpolated',
    });
    ctx.change(`${stepLabel(target.step)}:input.${written}`);
    return {
      kind: 'map_datapill',
      step_number: target.step.number,
      step_as: target.step.as,
      path: written,
      detail: { source_step: source.step.as, formula: value },
    };
  }

  if (op === 'insert_step') {
    const node = buildNode(ctx, change);
    const insertion = resolveAnchor(ctx, change.anchor);
    insertion.block.splice(insertion.index, 0, node);
    for (const child of subtreeNodes(node)) ctx.create(child);
    ctx.requestRenumber();
    if (
      typeof node.provider === 'string' &&
      change.connection_id !== undefined &&
      change.connection_id !== null
    ) {
      ctx.bindProvider(node.provider, change.connection_id);
      ctx.change(`config:${node.provider}.account_id`);
    }
    ctx.change(`${stepLabel(node)}:inserted ${insertion.describe}`);
    return {
      kind: 'insert_step',
      step_as: node.as,
      detail: {
        keyword: node.keyword,
        provider: node.provider,
        name: node.name,
        anchor: insertion.describe,
      },
    };
  }

  if (op === 'remove_step') {
    const located = ctx.locate(change.step);
    if (located.block === null) throw new Error('the trigger cannot be removed');
    if (STRUCTURAL_KEYWORDS.has(String(located.step.keyword)) && change.force !== true) {
      throw new Error(
        `step ${stepLabel(located.step)} is a ${String(located.step.keyword)} branch of its parent; ` +
          `removing it changes the parent's control flow. Pass force:true if that is intended.`,
      );
    }
    const doomed = subtreeNodes(located.step);
    const anchors = new Set<string>();
    for (const node of doomed) {
      if (typeof node.as === 'string' && node.as.length > 0) anchors.add(node.as);
    }
    const references = findDatapillReferences(ctx.code, anchors, doomed);
    if (references.length > 0 && change.force !== true) {
      const listed = references
        .slice(0, 5)
        .map((hit) => `step ${hit.step} (${hit.where} -> ${hit.anchor})`)
        .join('; ');
      throw new Error(
        `step ${stepLabel(located.step)} is referenced by ${references.length} datapill(s): ${listed}` +
          `${references.length > 5 ? ', ...' : ''}. Repoint them first, or pass force:true to remove it anyway.`,
      );
    }
    const label = stepLabel(located.step);
    located.block.splice(located.index, 1);
    ctx.touch(located.parent as RecipeStep);
    ctx.requestRenumber();
    ctx.change(`${label}:removed`);
    return {
      kind: 'remove_step',
      step_as: typeof located.step.as === 'string' ? located.step.as : undefined,
      detail: {
        keyword: located.step.keyword,
        removed_steps: doomed.size,
        forced_over_references: references.length > 0 ? references.length : undefined,
      },
    };
  }

  if (op === 'move_step') {
    const located = ctx.locate(change.step);
    if (located.block === null) throw new Error('the trigger cannot be moved');
    if (STRUCTURAL_KEYWORDS.has(String(located.step.keyword))) {
      throw new Error(
        `step ${stepLabel(located.step)} is a ${String(located.step.keyword)} branch and must stay where it is`,
      );
    }
    const moving = subtreeNodes(located.step);
    const anchorSpec: JsonObject = isRecord(change.anchor) ? change.anchor : {};
    const anchorTarget = ctx.locate(anchorSpec.step === undefined ? 0 : anchorSpec.step);
    if (moving.has(anchorTarget.step)) {
      throw new Error(`step ${stepLabel(located.step)} cannot be moved inside its own subtree`);
    }
    const node = located.step;
    const label = stepLabel(node);
    located.block.splice(located.index, 1);
    const insertion = resolveAnchor(ctx, change.anchor);
    insertion.block.splice(insertion.index, 0, node);
    for (const child of moving) ctx.touch(child);
    ctx.requestRenumber();
    ctx.change(`${label}:moved ${insertion.describe}`);
    return {
      kind: 'move_step',
      step_as: typeof node.as === 'string' ? node.as : undefined,
      detail: { anchor: insertion.describe, moved_steps: moving.size },
    };
  }

  if (op === 'set_loop_source') {
    const located = ctx.locate(change.step);
    if (located.step.keyword !== 'foreach') {
      throw new Error(
        `step ${stepLabel(located.step)} is not a foreach; only a foreach has a loop source`,
      );
    }
    if (change.source !== undefined) {
      // `source` lives at the node root. Workato's UI calls it "Input list",
      // which is why it keeps ending up inside `input`.
      located.step.source = encodeLoopSource(change.source, change.source_kind);
      if (isRecord(located.step.input)) delete (located.step.input as JsonObject).source;
      ctx.change(`${stepLabel(located.step)}:source`);
    }
    if (change.repeat_mode !== undefined) {
      if (change.repeat_mode !== 'simple' && change.repeat_mode !== 'batch') {
        throw new Error('repeat_mode must be simple or batch');
      }
      located.step.repeat_mode = change.repeat_mode;
      ctx.change(`${stepLabel(located.step)}:repeat_mode`);
    }
    if (change.batch_size !== undefined) {
      located.step.batch_size = String(change.batch_size);
      ctx.change(`${stepLabel(located.step)}:batch_size`);
    }
    if (change.clear_scope !== undefined) {
      located.step.clear_scope = String(change.clear_scope);
      ctx.change(`${stepLabel(located.step)}:clear_scope`);
    }
    if (located.step.repeat_mode === 'batch' && located.step.batch_size === undefined) {
      located.step.batch_size = '10';
    }
    if (!isRecord(located.step.input)) located.step.input = {};
    ctx.touch(located.step);
    return {
      kind: 'set_loop_source',
      step_number: located.step.number,
      step_as: located.step.as,
      detail: { repeat_mode: located.step.repeat_mode },
    };
  }

  if (op === 'derive_schema') {
    const located = ctx.locate(change.step);
    const derived = deriveSchemasForStep(located.step, ctx.code);
    if (!derived.ok) throw new Error(derived.reason);
    // Explicit ask, so an existing schema that disagrees with the declaration
    // is replaced rather than left as the caller found it.
    const write = writeDerivedSchemas(located.step, derived, { replace: true });
    ctx.touch(located.step);
    for (const key of write.schemas) ctx.change(`${stepLabel(located.step)}:${key}`);
    return {
      kind: 'derive_schema',
      step_number: located.step.number,
      step_as: located.step.as,
      detail: {
        derived_kind: derived.kind,
        fields: derived.fields,
        schemas: write.schemas,
        status: write.status,
        evidence: derived.evidence,
        differences: write.differences.length > 0 ? write.differences : undefined,
      },
    };
  }

  if (op === 'bind_connection') {
    if (typeof change.provider !== 'string' || change.provider.length === 0) {
      throw new Error('provider is required');
    }
    if (change.connection_id === undefined) {
      throw new Error('connection_id is required (pass null to clear the binding)');
    }
    ctx.bindProvider(change.provider, change.connection_id);
    ctx.change(`config:${change.provider}.account_id`);
    return {
      kind: 'bind_connection',
      detail: { provider: change.provider, account_id: change.connection_id },
    };
  }

  throw new Error(`op must be one of ${RECIPE_APPLY_OPS.join(', ')}`);
}

/** Apply every change to the engine's clone, refusing the whole batch on the first bad one. */
export function applyRecipeChanges(
  ctx: RecipeMutationContext,
  changes: unknown,
): MutationSummary[] {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new RecipeMutationError('changes must be a non-empty array of operations', {
      stage: 'changes',
    });
  }
  if (changes.length > MAX_APPLY_CHANGES) {
    throw new RecipeMutationError(
      `changes holds ${changes.length} operations; the cap is ${MAX_APPLY_CHANGES} per call`,
      { stage: 'changes' },
    );
  }

  const summaries: MutationSummary[] = [];
  for (let i = 0; i < changes.length; i += 1) {
    const change = changes[i];
    if (!isRecord(change)) {
      throw new RecipeMutationError(`change[${i}] must be an object with an \`op\` field`, {
        stage: 'changes',
        op_index: i,
      });
    }
    try {
      summaries.push(applyOne(ctx, change));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const stepRef = change.step ?? change.provider ?? null;
      throw new RecipeMutationError(
        `change[${i}] (${String(change.op)}${stepRef === null ? '' : `, step ${String(stepRef)}`}): ${reason}`,
        {
          stage: 'apply',
          op_index: i,
          op: change.op ?? null,
          step: stepRef,
          reason,
        },
      );
    }
  }
  return summaries;
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

interface IdempotencyEntry {
  version_no: unknown;
  summary: string;
  at: number;
}

const IDEMPOTENCY_LIMIT = 100;
const idempotencyStore = new Map<string, IdempotencyEntry>();

function rememberIdempotency(key: string, version_no: unknown, summary: string): void {
  if (idempotencyStore.size >= IDEMPOTENCY_LIMIT) {
    const oldest = idempotencyStore.keys().next();
    if (!oldest.done) idempotencyStore.delete(oldest.value);
  }
  idempotencyStore.set(key, { version_no, summary, at: Date.now() });
}

/** Test seam: the store lives for the life of the bridge process. */
export function clearIdempotencyStore(): void {
  idempotencyStore.clear();
}

// ---------------------------------------------------------------------------
// Legacy argument translation
// ---------------------------------------------------------------------------

function legacyAddStepChange(args: JsonObject): JsonObject {
  const change: JsonObject = {
    op: 'insert_step',
    keyword: args.keyword ?? 'action',
    provider: args.provider,
    action_name: args.action_name,
    input: args.input,
  };
  for (const key of [
    'as',
    'title',
    'description',
    'connection_id',
    'extended_input_schema',
    'extended_output_schema',
    'source',
    'source_kind',
    'repeat_mode',
    'batch_size',
    'clear_scope',
  ]) {
    if (args[key] !== undefined) change[key] = args[key];
  }

  if (isRecord(args.anchor)) {
    change.anchor = args.anchor;
  } else if (args.after_step === undefined || args.after_step === null) {
    change.anchor = { mode: 'into', step: 0, position: 'last' };
  } else if (args.after_step === 0 || args.after_step === '0') {
    // Historic contract: 0 means "the first action right after the trigger".
    change.anchor = { mode: 'into', step: 0, position: 'first' };
  } else {
    change.anchor = { mode: 'after', step: args.after_step };
  }
  return change;
}

function legacyChanges(name: string, args: JsonObject): JsonObject[] {
  if (name === WORKATO_RECIPE_MUTATOR_TOOLS.ADD_STEP) return [legacyAddStepChange(args)];
  if (name === WORKATO_RECIPE_MUTATOR_TOOLS.SET_STEP_INPUT) {
    return [
      {
        op: 'set_input',
        step: args.step_number ?? args.step,
        path: args.field,
        value: args.value,
        value_kind: args.value_kind,
      },
    ];
  }
  if (name === WORKATO_RECIPE_MUTATOR_TOOLS.MAP_DATAPILL) {
    return [
      {
        op: 'map_datapill',
        step: args.target_step,
        path: args.target_field,
        source_step: args.source_step,
        source_path: args.path,
        // The legacy tool has always written the formula form; callers embed it
        // in larger expressions, so the shape is kept.
        mode: 'formula',
      },
    ];
  }
  throw new Error(`unsupported legacy recipe mutator tool: ${name}`);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function isRecipeApplyTool(name: string): boolean {
  return (
    name === WORKATO_RECIPE_MUTATOR_TOOLS.APPLY ||
    name === WORKATO_RECIPE_MUTATOR_TOOLS.ADD_STEP ||
    name === WORKATO_RECIPE_MUTATOR_TOOLS.SET_STEP_INPUT ||
    name === WORKATO_RECIPE_MUTATOR_TOOLS.MAP_DATAPILL
  );
}

export async function handleWorkatoRecipeApplyCall(
  name: string,
  args: JsonObject,
  callExtension: ExtensionCaller,
): Promise<CallToolResult> {
  try {
    const recipeId = requireRecipeId(args);
    const changes =
      name === WORKATO_RECIPE_MUTATOR_TOOLS.APPLY ? args.changes : legacyChanges(name, args);
    const dryRun = args.dry_run === true;

    const idempotencyKey =
      typeof args.idempotency_key === 'string' && args.idempotency_key.length > 0
        ? `${recipeId}:${args.idempotency_key}`
        : null;
    if (idempotencyKey && !dryRun) {
      const seen = idempotencyStore.get(idempotencyKey);
      if (seen) {
        return {
          isError: false,
          content: [
            {
              type: 'text',
              text:
                `${name}: idempotency_key already applied to recipe ${recipeId} ` +
                `(version ${String(seen.version_no)}), no save performed.\n${seen.summary}`,
            },
          ],
        };
      }
    }

    const result = await runRecipeMutation({
      name,
      recipe_id: recipeId,
      args,
      callExtension,
      dry_run: dryRun,
      apply: (ctx) => applyRecipeChanges(ctx, changes),
    });

    if (idempotencyKey && !dryRun && !result.isError) {
      const text =
        result.content?.find((item): item is { type: 'text'; text: string } => item.type === 'text')
          ?.text ?? '';
      const jsonLine = text.split('\n').slice(1).join('\n');
      let versionNo: unknown;
      try {
        versionNo = (JSON.parse(jsonLine) as JsonObject).version_no;
      } catch {
        versionNo = undefined;
      }
      rememberIdempotency(idempotencyKey, versionNo, text);
    }

    return result;
  } catch (error) {
    if (error instanceof RecipeMutationError) {
      return errorResult(
        `${name} failed: ${error.message}\n${JSON.stringify({ ok: false, ...error.details })}`,
      );
    }
    return errorResult(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
