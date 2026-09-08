/**
 * workato_step_schema with `apply_to`: generate a step's schemas in the
 * extension, then write them onto the step through the mutation engine.
 *
 * Without `apply_to` the tool is a plain extension read and never reaches this
 * file: register-tools forwards it like any other read, auto-file included.
 * With `apply_to` it becomes an orchestrator (extension call, then pull,
 * mutate, validate, save, readback) and needs the engine, so it runs here.
 *
 * Both schema arrays land in ONE saved version. An empty array is not written:
 * `[]` over a schema the step already carries would be a change nobody asked
 * for, and an empty result usually means a schema driver is still missing from
 * the input (the extension's payload says which).
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAMES } from 'workatomcp-shared';
import {
  applySetExtendedSchema,
  errorResult,
  isRecord,
  parseToolJson,
  runRecipeMutation,
  stepLabel,
  type ExtensionCaller,
  type JsonObject,
  type MutationSummary,
} from './workato-recipe-engine';

export const STEP_SCHEMA_TOOL: string = TOOL_NAMES.WORKATO.STEP_SCHEMA;

/** Save modifiers `apply_to` forwards to the engine, by name. */
const APPLY_FORWARDED_KEYS = [
  'comment',
  'expected_base_version_no',
  'dry_run',
  'verify_readback',
  'restart_if_running',
  'ensure_running',
] as const;

/** True when this call must run natively: the name matches and apply_to is set. */
export function isStepSchemaApplyCall(name: string, args: unknown): boolean {
  return name === STEP_SCHEMA_TOOL && isRecord(args) && isRecord(args.apply_to);
}

function firstText(result: CallToolResult): string {
  return (
    result.content?.find((item): item is { type: 'text'; text: string } => item.type === 'text')
      ?.text ?? ''
  );
}

export async function handleWorkatoStepSchemaApplyCall(
  name: string,
  args: JsonObject,
  callExtension: ExtensionCaller,
): Promise<CallToolResult> {
  const applyTo = isRecord(args.apply_to) ? args.apply_to : {};
  const recipeId = Number(applyTo.recipe_id);
  if (!Number.isFinite(recipeId) || recipeId <= 0) {
    return errorResult(`${name}: apply_to.recipe_id must be a positive numeric recipe id`);
  }
  const stepRef = applyTo.step;
  if (
    stepRef === undefined ||
    stepRef === null ||
    (typeof stepRef !== 'string' && typeof stepRef !== 'number') ||
    (typeof stepRef === 'string' && stepRef.trim().length === 0)
  ) {
    return errorResult(`${name}: apply_to.step must be a step number, "as" anchor or uuid`);
  }

  // The generation call is the extension's, unchanged; only apply_to is ours.
  const generateArgs: JsonObject = { ...args };
  delete generateArgs.apply_to;
  const generated = await callExtension(STEP_SCHEMA_TOOL, generateArgs);
  if (generated.isError) return generated;

  let schemas: JsonObject;
  try {
    schemas = parseToolJson(generated);
  } catch (error) {
    return errorResult(
      `${name}: could not parse the generated schemas: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const inputSchema = Array.isArray(schemas.input_schema) ? schemas.input_schema : [];
  const outputSchema = Array.isArray(schemas.output_schema) ? schemas.output_schema : [];

  if (inputSchema.length === 0 && outputSchema.length === 0) {
    const payload: JsonObject = {
      ...schemas,
      applied: false,
      apply_skipped:
        'Both generated schemas are empty, so nothing was written to the step. ' +
        (typeof schemas.note === 'string' ? schemas.note : ''),
    };
    return {
      isError: false,
      content: [
        {
          type: 'text',
          text:
            `${name}: schemas generated but NOT applied to recipe ${recipeId} step ${String(stepRef)}: both empty.\n` +
            JSON.stringify(payload),
        },
      ],
    };
  }

  const mutationArgs: JsonObject = { recipe_id: recipeId, step: stepRef };
  for (const key of APPLY_FORWARDED_KEYS) {
    if (applyTo[key] !== undefined) mutationArgs[key] = applyTo[key];
  }
  // The tab is a property of the CALL, not of the write: the top-level tabId
  // and windowId route both the generation and the save to the same tab.
  if (typeof args.tabId === 'number') mutationArgs.tabId = args.tabId;
  if (typeof args.windowId === 'number') mutationArgs.windowId = args.windowId;

  let mutation: CallToolResult;
  try {
    mutation = await runRecipeMutation({
      name,
      recipe_id: recipeId,
      args: mutationArgs,
      callExtension,
      dry_run: applyTo.dry_run === true,
      defaultComment: 'schema refresh',
      apply: (ctx) => {
        const { step } = ctx.locate(stepRef);
        ctx.touch(step);
        const summaries: MutationSummary[] = [];
        const kinds: Array<['extended_input_schema' | 'extended_output_schema', unknown[]]> = [
          ['extended_input_schema', inputSchema],
          ['extended_output_schema', outputSchema],
        ];
        for (const [kind, schema] of kinds) {
          if (schema.length === 0) continue;
          applySetExtendedSchema(step, { kind, schema });
          ctx.change(`${stepLabel(step)}:${kind}`);
          summaries.push({
            kind: 'set_extended_schema',
            step_number: step.number,
            step_as: step.as,
            schema_kind: kind,
          } as MutationSummary);
        }
        return summaries;
      },
    });
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text:
            `${name}: schemas generated but the write to recipe ${recipeId} failed: ` +
            `${error instanceof Error ? error.message : String(error)}\n` +
            JSON.stringify({ ...schemas, applied: false }),
        },
      ],
    };
  }

  // Merge: the schemas the caller asked for, plus what the save did with them.
  let applied: unknown;
  try {
    applied = parseToolJson(mutation);
  } catch {
    applied = firstText(mutation);
  }
  const payload: JsonObject = {
    ...schemas,
    applied: mutation.isError ? false : applied,
  };
  if (mutation.isError) payload.apply_error = firstText(mutation);
  const headline = firstText(mutation).split(/\r?\n/)[0];
  return {
    isError: mutation.isError === true,
    content: [{ type: 'text', text: `${headline}\n${JSON.stringify(payload)}` }],
  };
}
