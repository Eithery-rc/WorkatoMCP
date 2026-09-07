/**
 * @fileoverview The four surgical recipe mutators, as thin wrappers over the
 * shared engine in `workato-recipe-engine.ts`.
 *
 * This module keeps the tool-name routing and the single-operation
 * `mutateRecipeCode` primitive; the pull/validate/config-merge/save/summarize
 * cycle lives in the engine so the batch tool, the legacy names and the
 * callable-schema orchestrator all behave identically.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { compilePythonSource, describePyEvalFailure } from './workato-pyeval-lint';
import { handleWorkatoRecipeApplyCall, isRecipeApplyTool } from './workato-recipe-apply';
import {
  applyDeleteInput,
  applySetExtendedSchema,
  applySetInput,
  applySetPyEvalCode,
  errorResult,
  requireRecipeId,
  requireStep,
  runRecipeMutation,
  stepLabel,
  WORKATO_RECIPE_MUTATOR_TOOLS,
  type ExtensionCaller,
  type JsonObject,
  type MutationSummary,
} from './workato-recipe-engine';

export {
  WORKATO_RECIPE_MUTATOR_TOOLS,
  isWorkatoRecipeMutatorTool,
  buildMutatorSummary,
  parseDatapillPath,
  parseDatapillShorthand,
  parseInputPath,
  parseToolJson,
  type MutationSummary,
} from './workato-recipe-engine';

/**
 * Apply exactly one surgical mutation to a code tree, in place.
 *
 * Kept as the single-operation primitive: the batch tool reaches the same
 * appliers through `workato-recipe-apply`.
 */
export function mutateRecipeCode(name: string, args: JsonObject, code: unknown): MutationSummary {
  requireRecipeId(args);

  if (name === WORKATO_RECIPE_MUTATOR_TOOLS.SET_INPUT_PATH) {
    const step = requireStep(code, args.step ?? args.step_number);
    const { path } = applySetInput(step, args);
    return { kind: 'set_input_path', step_number: step.number, step_as: step.as, path };
  }

  if (name === WORKATO_RECIPE_MUTATOR_TOOLS.DELETE_INPUT_PATH) {
    const step = requireStep(code, args.step ?? args.step_number);
    const { path } = applyDeleteInput(step, args);
    return { kind: 'delete_input_path', step_number: step.number, step_as: step.as, path };
  }

  if (name === WORKATO_RECIPE_MUTATOR_TOOLS.SET_PY_EVAL_CODE) {
    const step = requireStep(code, args.step ?? args.step_number);
    const { warnings } = applySetPyEvalCode(step, args);
    const summary: MutationSummary = {
      kind: 'set_py_eval_code',
      step_number: step.number,
      step_as: step.as,
      path: 'code',
    };
    if (warnings.length > 0) summary.warnings = warnings;
    return summary;
  }

  if (name === WORKATO_RECIPE_MUTATOR_TOOLS.SET_EXTENDED_SCHEMA) {
    const step = requireStep(code, args.step ?? args.step_number);
    const { kind } = applySetExtendedSchema(step, args);
    return {
      kind: 'set_extended_schema',
      step_number: step.number,
      step_as: step.as,
      schema_kind: kind,
    };
  }

  throw new Error(`unsupported recipe mutator tool: ${name}`);
}

/** What a single mutation changed, in the engine's `changed_paths` vocabulary. */
function changedPathFor(label: string, summary: MutationSummary): string {
  if (summary.kind === 'delete_input_path') return `${label}:-input.${summary.path}`;
  if (summary.kind === 'set_extended_schema') return `${label}:${summary.schema_kind}`;
  return `${label}:input.${summary.path}`;
}

export async function handleWorkatoRecipeMutatorCall(
  name: string,
  args: JsonObject,
  callExtension: ExtensionCaller,
): Promise<CallToolResult> {
  // The batch tool and the three legacy names share one implementation.
  if (isRecipeApplyTool(name)) {
    return handleWorkatoRecipeApplyCall(name, args, callExtension);
  }

  try {
    if (
      name !== WORKATO_RECIPE_MUTATOR_TOOLS.SET_INPUT_PATH &&
      name !== WORKATO_RECIPE_MUTATOR_TOOLS.DELETE_INPUT_PATH &&
      name !== WORKATO_RECIPE_MUTATOR_TOOLS.SET_PY_EVAL_CODE &&
      name !== WORKATO_RECIPE_MUTATOR_TOOLS.SET_EXTENDED_SCHEMA
    ) {
      return errorResult(`unsupported native recipe mutator tool: ${name}`);
    }
    const recipeId = requireRecipeId(args);

    // Compile with a real Python when one is on PATH. Done before the pull so
    // a syntax error costs nothing, and reported honestly when unavailable:
    // "not checked" must never read as "checked and fine".
    let pythonCheck: string | undefined;
    if (name === WORKATO_RECIPE_MUTATOR_TOOLS.SET_PY_EVAL_CODE && typeof args.code === 'string') {
      const compiled = compilePythonSource(args.code);
      if (compiled.available && !compiled.ok) {
        return errorResult(
          `${name} failed: ${describePyEvalFailure({ errors: [], warnings: [] }, compiled, 'the code being written')}`,
        );
      }
      pythonCheck = compiled.available
        ? `compiled with ${compiled.interpreter}`
        : 'no python on PATH, structural lint only, syntax NOT verified';
    }

    return await runRecipeMutation({
      name,
      recipe_id: recipeId,
      args,
      callExtension,
      dry_run: args.dry_run === true,
      apply: (ctx) => {
        const step = ctx.locate(args.step ?? args.step_number).step;
        ctx.touch(step);
        const summary = mutateRecipeCode(name, args, ctx.code);
        if (pythonCheck) summary.python_check = pythonCheck;
        ctx.change(changedPathFor(stepLabel(step), summary));
        return summary;
      },
    });
  } catch (error) {
    return errorResult(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
