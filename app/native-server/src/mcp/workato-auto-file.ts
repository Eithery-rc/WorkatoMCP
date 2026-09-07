/**
 * Generic out_file / auto-file post-processing for large tool results.
 *
 * workato_pull_recipe, workato_lcap_page_get, workato_api_request and
 * workato_adapter_meta each own a hand-written out_file hook. Everything else
 * that can return a large result had no way out: a 200 KB job trace or a broad
 * step search went into the model's context whole.
 *
 * This module adds the same escape hatch to the rest of the read surface,
 * without a per-tool kind switch:
 *
 *   <read tool>(out_file)   -> writes the full text, returns a summary
 *   <read tool>(auto_file)  -> same, but only once the result crosses a
 *                              character threshold (on by default for reads)
 *   chrome_screenshot(out_file) -> writes the decoded image bytes
 *
 * It runs in the native-server (a Node process with `fs`); the Chrome
 * extension never sees the file params. See register-tools.ts for the wiring.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { isWorkatoFileTool } from './workato-file-io';
import { isWorkatoLcapFileTool } from './workato-lcap-io';

export const SCREENSHOT_TOOL = 'chrome_screenshot';

/** Default spill threshold, in characters of response text. */
export const DEFAULT_AUTO_FILE_THRESHOLD_CHARS = 60000;

export const OUT_FILE_ARG = 'out_file';
export const AUTO_FILE_ARG = 'auto_file';
export const AUTO_FILE_THRESHOLD_ARG = 'auto_file_threshold_chars';
export const NO_INLINE_ARG = 'no_inline';

/**
 * Read tools that spill to a file on their own once a result gets large.
 *
 * Tools with their own out_file hook (pull_recipe, lcap_page_get, api_request,
 * adapter_meta) are deliberately absent: they keep their existing behaviour.
 */
export const READ_TOOLS = new Set<string>([
  'workato_list_jobs',
  'workato_job_trace',
  'workato_search_recipes',
  'workato_recipe_step_search',
  'workato_recipe_callers',
  'workato_recipe_grep',
  'workato_recipe_connections',
  'workato_recipe_version_diff',
  'workato_recipe_status',
  'workato_apps_list',
  'workato_pick_list',
  'workato_run_query',
  'workato_call_action',
  'workato_lookup_tables_list',
  'workato_lookup_table_get',
  'workato_lookup_table_row_search',
  'workato_data_tables_list',
  'workato_data_table_get',
  'workato_data_table_row_list',
]);

/** Tools whose served schema gains the out_file / auto_file properties. */
export const AUTO_FILE_SCHEMA_TOOLS = new Set<string>([...READ_TOOLS, SCREENSHOT_TOOL]);

export interface AutoFilePlan {
  tool: string;
  /** Explicit destination, already resolved and checked. */
  outFile?: string;
  /** Spill automatically once the result crosses `thresholdChars`. */
  auto: boolean;
  thresholdChars: number;
  /** For image results: leave the image block out of the response. */
  noInline: boolean;
  /** Recipe/job/table id used to name an auto-generated file. */
  idHint?: string;
}

export interface PreparedAutoFileCall {
  args: Record<string, unknown>;
  plan?: AutoFilePlan;
}

const OUT_FILE_PROPERTY = {
  type: 'string',
  description:
    'Absolute path to write the full result to (its directory must exist). The response becomes a compact summary: saved_to, bytes, top-level keys and item counts.',
};

const AUTO_FILE_PROPERTY = {
  type: 'boolean',
  description:
    'Spill an oversized result to a temp file and return the same summary instead of the full payload. Default: true for Workato read tools, false for chrome_screenshot. Set false to always get the result inline.',
};

const AUTO_FILE_THRESHOLD_PROPERTY = {
  type: 'number',
  description: `Character count above which auto_file spills the result to a file (default: ${DEFAULT_AUTO_FILE_THRESHOLD_CHARS}).`,
};

/**
 * Serve out_file / auto_file on every tool that supports them, so the per-tool
 * schema entries do not each have to repeat the three properties.
 */
export function withOutFileToolSchemas(tools: Tool[]): Tool[] {
  return tools.map((tool) => {
    if (!AUTO_FILE_SCHEMA_TOOLS.has(tool.name)) return tool;

    const inputSchema = (tool.inputSchema || { type: 'object' }) as Record<string, any>;
    if (inputSchema.type !== 'object') return tool;

    const properties = { ...(inputSchema.properties || {}) };
    if (!properties[OUT_FILE_ARG]) properties[OUT_FILE_ARG] = OUT_FILE_PROPERTY;
    if (!properties[AUTO_FILE_ARG]) properties[AUTO_FILE_ARG] = AUTO_FILE_PROPERTY;
    if (!properties[AUTO_FILE_THRESHOLD_ARG]) {
      properties[AUTO_FILE_THRESHOLD_ARG] = AUTO_FILE_THRESHOLD_PROPERTY;
    }

    return {
      ...tool,
      inputSchema: {
        ...inputSchema,
        type: 'object',
        properties,
        required: Array.isArray(inputSchema.required) ? inputSchema.required : [],
      },
    };
  });
}

/** Tools this post-processor may write files for. */
export function isAutoFileEligible(name: string): boolean {
  if (isWorkatoFileTool(name) || isWorkatoLcapFileTool(name)) return false;
  return name === SCREENSHOT_TOOL || name.startsWith('workato_');
}

/** Tools that spill without being asked. */
export function autoFileDefaultsOn(name: string): boolean {
  return READ_TOOLS.has(name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function resolveOutFile(raw: string): string {
  const outFile = path.resolve(raw);
  const dir = path.dirname(outFile);
  if (!fs.existsSync(dir)) {
    throw new Error(`${OUT_FILE_ARG} directory does not exist: ${dir}`);
  }
  return outFile;
}

/** Atomic write: temp file then rename, so a crash cannot leave half a file. */
function writeAtomic(target: string, data: string | Buffer): void {
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, data as any);
  fs.renameSync(tmp, target);
}

const ID_HINT_KEYS = [
  'recipe_id',
  'job_id',
  'job',
  'table_id',
  'page_id',
  'connection_id',
  'folder_id',
  'app_id',
  'id',
];

function readIdHint(args: Record<string, unknown>): string | undefined {
  for (const key of ID_HINT_KEYS) {
    const value = args[key];
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'string' && value.trim().length > 0) return sanitizeSegment(value);
  }
  return undefined;
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 40) || 'result';
}

const SESSION_STAMP = `${process.pid}-${Date.now().toString(36)}`;

/** Where auto-mode files go: one directory per bridge process. */
export function autoFileSessionDir(): string {
  return path.join(os.tmpdir(), 'workatomcp-results', `session-${SESSION_STAMP}`);
}

function autoFilePath(tool: string, idHint: string | undefined, extension: string): string {
  const dir = autoFileSessionDir();
  fs.mkdirSync(dir, { recursive: true });
  const slug = sanitizeSegment(tool.replace(/^workato_/, '')) || 'tool';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(dir, `${slug}-${idHint || 'result'}-${stamp}${extension}`);
}

function extensionForMime(mimeType: string): string {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/gif') return '.gif';
  return '.bin';
}

function readBoolean(value: unknown, argName: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new Error(`${argName} must be a boolean`);
  }
  return value;
}

function readThreshold(value: unknown): number {
  if (value === undefined) return DEFAULT_AUTO_FILE_THRESHOLD_CHARS;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${AUTO_FILE_THRESHOLD_ARG} must be a non-negative number of characters`);
  }
  return value;
}

/**
 * Resolve the file params before the call leaves for the extension, the way
 * prepareWorkatoCall does: the extension never learns about paths, and a bad
 * out_file directory fails before any browser work happens.
 */
export function prepareAutoFileCall(
  name: string,
  rawArgs: Record<string, unknown>,
): PreparedAutoFileCall {
  if (!isAutoFileEligible(name)) return { args: rawArgs };

  const hasOutFile = rawArgs[OUT_FILE_ARG] !== undefined;
  const hasAuto = rawArgs[AUTO_FILE_ARG] !== undefined;
  const hasThreshold = rawArgs[AUTO_FILE_THRESHOLD_ARG] !== undefined;
  const hasNoInline = rawArgs[NO_INLINE_ARG] !== undefined;
  if (!hasOutFile && !hasAuto && !hasThreshold && !hasNoInline && !autoFileDefaultsOn(name)) {
    return { args: rawArgs };
  }

  let outFile: string | undefined;
  if (hasOutFile) {
    const raw = rawArgs[OUT_FILE_ARG];
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw new Error(`${OUT_FILE_ARG} must be a non-empty absolute path`);
    }
    outFile = resolveOutFile(raw);
  }

  const auto = readBoolean(rawArgs[AUTO_FILE_ARG], AUTO_FILE_ARG) ?? autoFileDefaultsOn(name);
  const noInline = readBoolean(rawArgs[NO_INLINE_ARG], NO_INLINE_ARG) ?? false;
  const thresholdChars = readThreshold(rawArgs[AUTO_FILE_THRESHOLD_ARG]);

  const args = { ...rawArgs };
  delete args[OUT_FILE_ARG];
  delete args[AUTO_FILE_ARG];
  delete args[AUTO_FILE_THRESHOLD_ARG];
  // no_inline is read here, like the rest: the extension never sees a file param.
  delete args[NO_INLINE_ARG];

  return {
    args,
    plan: {
      tool: name,
      outFile,
      auto,
      thresholdChars,
      noInline,
      idHint: readIdHint(rawArgs),
    },
  };
}

interface TextBlock {
  type: 'text';
  text: string;
}

interface ImageBlock {
  type: 'image';
  data: string;
  mimeType?: string;
}

function textBlocks(result: CallToolResult): TextBlock[] {
  const content = Array.isArray(result.content) ? result.content : [];
  return content.filter(
    (block: any) => block && block.type === 'text' && typeof block.text === 'string',
  ) as unknown as TextBlock[];
}

function firstImageBlock(result: CallToolResult): ImageBlock | undefined {
  const content = Array.isArray(result.content) ? result.content : [];
  return content.find(
    (block: any) =>
      block && block.type === 'image' && typeof block.data === 'string' && block.data.length > 0,
  ) as unknown as ImageBlock | undefined;
}

/**
 * Parse a response payload. Handles the plain-JSON form and the
 * `${summary}\n${JSON.stringify(payload)}` form several Workato tools use.
 */
export function parseResultPayload(text: string): unknown {
  const attempt = (candidate: string): unknown => {
    try {
      return JSON.parse(candidate);
    } catch {
      return undefined;
    }
  };
  const whole = attempt(text.trim());
  if (whole !== undefined) return whole;

  const braceAt = text.indexOf('{');
  const bracketAt = text.indexOf('[');
  const candidates = [braceAt, bracketAt].filter((index) => index > 0).sort((a, b) => a - b);
  for (const index of candidates) {
    const parsed = attempt(text.slice(index).trim());
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

/** Keys copied verbatim into the summary so a partial result cannot read as complete. */
const TRUNCATION_KEYS = [
  'truncated',
  'truncated_fields',
  'total_bytes',
  'total_items',
  'total_count',
  'has_more',
  'next_page',
  'next_cursor',
  'limit',
  'coverage',
  'search_mode',
  'warning',
];

function describePayload(payload: unknown): Record<string, unknown> {
  const summary: Record<string, unknown> = {};

  if (Array.isArray(payload)) {
    summary.top_level_keys = [];
    summary.item_counts = { items: payload.length };
    return summary;
  }
  if (!isRecord(payload)) {
    summary.top_level_keys = [];
    summary.item_counts = {};
    return summary;
  }

  const keys = Object.keys(payload);
  summary.top_level_keys = keys.slice(0, 100);
  const counts: Record<string, number> = {};
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) counts[key] = value.length;
  }
  summary.item_counts = counts;
  if (payload.version_no !== undefined) summary.version_no = payload.version_no;
  for (const key of TRUNCATION_KEYS) {
    // Preserve 0 and false: "truncated: false" is information, not noise.
    if (payload[key] !== undefined) summary[key] = payload[key];
  }
  return summary;
}

const SUMMARY_NOTE =
  'full result written to file; read it with your file tools or re-run with narrower projection';

function summaryBlock(payload: Record<string, unknown>): TextBlock {
  return { type: 'text', text: JSON.stringify(payload) };
}

/**
 * Post-process a response destined for disk: write the file and hand back a
 * summary. Returns the original result untouched when nothing needs writing,
 * when the call failed, or when the response carries nothing writable.
 *
 * A failed write in auto mode also returns the original result: the caller
 * asked for data, not for a file, so losing the data to a disk error would be
 * the worse outcome. An explicit out_file failure is raised.
 */
export function applyAutoFile(
  name: string,
  plan: AutoFilePlan | undefined,
  result: CallToolResult,
): CallToolResult {
  if (!plan) return result;
  if (result.isError) return result;
  if (!Array.isArray(result.content) || result.content.length === 0) return result;

  // The extension appends a small {"context":...} text block last; it describes
  // the tab the call ran in and must stay on the response, never in the file.
  const contextBlock = trailingContextBlock(result);
  const body: CallToolResult = contextBlock
    ? { ...result, content: result.content.slice(0, -1) }
    : result;
  const image = firstImageBlock(body);
  const texts = textBlocks(body);
  const measuredChars =
    texts.reduce((total, block) => total + block.text.length, 0) + (image ? image.data.length : 0);

  const explicit = plan.outFile !== undefined;
  const shouldWrite = explicit || (plan.auto && measuredChars > plan.thresholdChars);
  if (!shouldWrite) return result;

  try {
    const written = image
      ? writeImageResult(name, plan, image, texts)
      : writeTextResult(name, plan, body, texts);
    if (written === body) return result;
    return contextBlock
      ? { ...written, content: [...written.content, contextBlock as any] }
      : written;
  } catch (err) {
    if (explicit) throw err;
    return result;
  }
}

/** The trailing actual-context block the extension appends, if present. */
function trailingContextBlock(result: CallToolResult): TextBlock | undefined {
  const content = Array.isArray(result.content) ? result.content : [];
  if (content.length < 2) return undefined;
  const last: any = content[content.length - 1];
  if (last?.type !== 'text' || typeof last.text !== 'string') return undefined;
  return last.text.startsWith('{"context":') ? (last as TextBlock) : undefined;
}

function writeImageResult(
  name: string,
  plan: AutoFilePlan,
  image: ImageBlock,
  texts: TextBlock[],
): CallToolResult {
  const mimeType = image.mimeType || 'image/png';
  const bytes = Buffer.from(image.data, 'base64');
  const target = plan.outFile ?? autoFilePath(name, plan.idHint, extensionForMime(mimeType));
  writeAtomic(target, bytes);

  const payload = texts.length > 0 ? parseResultPayload(texts[0].text) : undefined;
  const summary: Record<string, unknown> = {
    tool: name,
    mode: plan.outFile ? 'out_file' : 'auto_file',
    saved_to: target,
    bytes: bytes.length,
    content_type: mimeType,
    ...describePayload(payload),
    image_returned: !plan.noInline,
    note: plan.noInline
      ? SUMMARY_NOTE
      : 'image written to file and returned inline; open the file for the full-resolution copy',
  };
  if (isRecord(payload)) summary.metadata = payload;

  const content: CallToolResult['content'] = [];
  if (!plan.noInline) content.push(image as any);
  content.push(summaryBlock(summary) as any);
  return { content, isError: false };
}

function writeTextResult(
  name: string,
  plan: AutoFilePlan,
  result: CallToolResult,
  texts: TextBlock[],
): CallToolResult {
  if (texts.length === 0) return result;
  const text = texts.map((block) => block.text).join('\n');
  const payload = parseResultPayload(text);
  let isJson = false;
  try {
    JSON.parse(text.trim());
    isJson = true;
  } catch {
    isJson = false;
  }

  const target = plan.outFile ?? autoFilePath(name, plan.idHint, isJson ? '.json' : '.txt');
  writeAtomic(target, text);

  return {
    content: [
      summaryBlock({
        tool: name,
        mode: plan.outFile ? 'out_file' : 'auto_file',
        saved_to: target,
        bytes: Buffer.byteLength(text, 'utf8'),
        content_type: isJson ? 'application/json' : 'text/plain',
        ...describePayload(payload),
        note: SUMMARY_NOTE,
      }) as any,
    ],
    isError: false,
  };
}
