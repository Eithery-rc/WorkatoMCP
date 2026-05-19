/**
 * File round-trip for large Workato recipes.
 *
 * Lets an agent pull a recipe to a local JSON file, edit it on disk, and push it
 * back — without the (often 100 KB+) code tree ever passing through a tool call
 * or the agent's context.
 *
 *   workato_pull_recipe(recipe_id, out_file)  -> writes a recipe file, returns a summary
 *   workato_ui_save_recipe_code(code_path)    -> reads that file, pushes it
 *
 * Both hooks run here in the native-server (a Node process with `fs` access);
 * the Chrome extension is untouched. See register-tools.ts for the wiring.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export const PULL_RECIPE_TOOL = 'workato_pull_recipe';
export const SAVE_RECIPE_CODE_TOOL = 'workato_ui_save_recipe_code';

/** Recipe file envelope: written by the pull hook, read by the push hook. */
interface RecipeFile {
  recipe_id?: number;
  name?: unknown;
  version_no?: unknown;
  code: unknown;
  config?: unknown;
}

interface StepRef {
  n: number;
  keyword?: unknown;
  name?: unknown;
  as?: unknown;
}

interface PreparedCall {
  /** Arguments to forward to the extension (file params resolved/stripped). */
  args: Record<string, unknown>;
  /** When set, the response must be passed through `writePulledRecipe`. */
  pullOutFile?: string;
}

export function isWorkatoFileTool(name: string): boolean {
  return name === PULL_RECIPE_TOOL || name === SAVE_RECIPE_CODE_TOOL;
}

/** Walk a recipe code tree and collect a lightweight step list. */
function collectSteps(node: unknown, out: StepRef[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) collectSteps(child, out);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (typeof obj.number === 'number') {
    out.push({ n: obj.number, keyword: obj.keyword, name: obj.name, as: obj.as });
  }
  if (Array.isArray(obj.block)) {
    for (const child of obj.block) collectSteps(child, out);
  }
}

/** Resolve a `code_path` recipe file into concrete save_recipe_code arguments. */
function loadRecipeFile(rawArgs: Record<string, unknown>): Record<string, unknown> {
  const codePath = path.resolve(rawArgs.code_path as string);
  if (!fs.existsSync(codePath)) {
    throw new Error(`code_path file not found: ${codePath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(codePath, 'utf8'));
  } catch (e) {
    throw new Error(
      `code_path file is not valid JSON (${codePath}): ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`code_path file must contain a JSON object: ${codePath}`);
  }

  // The file is either an envelope { recipe_id, code, config, ... } as written by
  // the pull hook, or a bare recipe code tree. Detect by the presence of `.code`.
  const obj = parsed as Record<string, unknown>;
  const isEnvelope = obj.code != null && typeof obj.code === 'object';
  const env: RecipeFile = isEnvelope
    ? {
        recipe_id: typeof obj.recipe_id === 'number' ? obj.recipe_id : undefined,
        name: obj.name,
        version_no: obj.version_no,
        code: obj.code,
        config: obj.config,
      }
    : { code: parsed };

  const args: Record<string, unknown> = { ...rawArgs };
  delete args.code_path;
  args.code = env.code;
  if (env.config != null && args.config == null) args.config = env.config;
  if (args.recipe_id == null && typeof env.recipe_id === 'number') {
    args.recipe_id = env.recipe_id;
  }
  if (typeof args.recipe_id !== 'number') {
    throw new Error(
      'recipe_id is required: pass it explicitly, or use a code_path file that ' +
        'contains a numeric "recipe_id" field.',
    );
  }
  return args;
}

/**
 * Pre-process a tool call. For the two file-aware Workato tools this resolves
 * `code_path` / `out_file`; every other tool is returned unchanged.
 */
export function prepareWorkatoCall(name: string, rawArgs: Record<string, unknown>): PreparedCall {
  if (name === SAVE_RECIPE_CODE_TOOL && typeof rawArgs.code_path === 'string') {
    return { args: loadRecipeFile(rawArgs) };
  }
  if (name === PULL_RECIPE_TOOL && typeof rawArgs.out_file === 'string') {
    const outFile = path.resolve(rawArgs.out_file);
    const dir = path.dirname(outFile);
    if (!fs.existsSync(dir)) {
      throw new Error(`out_file directory does not exist: ${dir}`);
    }
    const args: Record<string, unknown> = { ...rawArgs };
    delete args.out_file;
    delete args.step;
    delete args.field_query;
    args.view = 'full'; // need the lossless tree to write the file
    return { args, pullOutFile: outFile };
  }
  return { args: rawArgs };
}

/**
 * Post-process a `workato_pull_recipe` result when `out_file` was requested:
 * write the full recipe to disk and replace the response with a compact summary.
 * On any unexpected shape or upstream error the original result is passed back.
 */
export function writePulledRecipe(outFile: string, result: CallToolResult): CallToolResult {
  if (result.isError) return result;
  const first = Array.isArray(result.content) ? result.content[0] : undefined;
  if (!first || first.type !== 'text' || typeof first.text !== 'string') return result;

  let payload: { recipe_id?: number; code?: unknown; version?: Record<string, unknown> };
  try {
    payload = JSON.parse(first.text);
  } catch {
    return result;
  }
  if (payload.code == null) return result;

  const version = payload.version ?? {};
  let config: unknown = version.config;
  if (typeof config === 'string') {
    try {
      config = JSON.parse(config);
    } catch {
      /* leave config as a string if it is not parseable */
    }
  }

  const envelope: RecipeFile = {
    recipe_id: payload.recipe_id,
    name: version.name,
    version_no: version.version_no,
    code: payload.code,
    config,
  };

  // Atomic write: temp file then rename.
  const tmp = outFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(envelope, null, 2), 'utf8');
  fs.renameSync(tmp, outFile);

  const steps: StepRef[] = [];
  collectSteps(payload.code, steps);
  steps.sort((a, b) => a.n - b.n);

  const summary = {
    saved_to: outFile,
    recipe_id: envelope.recipe_id,
    name: envelope.name,
    version_no: envelope.version_no,
    step_count: steps.length,
    steps,
    hint:
      'Full recipe code tree written to file. Edit the file directly, then push it back ' +
      `with workato_ui_save_recipe_code(code_path:"${outFile}"). For one step's detail use ` +
      'workato_pull_recipe(recipe_id, step:"<number|as>").',
  };
  return { content: [{ type: 'text', text: JSON.stringify(summary) }], isError: false };
}
