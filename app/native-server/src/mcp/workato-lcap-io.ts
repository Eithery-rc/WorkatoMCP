/**
 * File round-trip for Workflow App (LCAP) pages, and for the raw-request
 * escape hatch.
 *
 * Same idea as workato-file-io.ts, and for the same reason: a page tree is
 * several KB of JSON that an agent should edit on disk rather than carry
 * through a tool call and back.
 *
 *   workato_lcap_page_get(out_file)      -> writes {page_id, updated_at, content}, returns the index
 *   workato_lcap_page_save(content_path) -> reads that file, pushes the tree
 *   workato_api_request(out_file)        -> writes the raw response body
 *   workato_adapter_meta(out_file)       -> writes the raw meta document
 *
 * These hooks run in the native-server (a Node process with `fs`); the Chrome
 * extension never sees the file params. See register-tools.ts for the wiring.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export const LCAP_PAGE_GET_TOOL = 'workato_lcap_page_get';
export const LCAP_PAGE_SAVE_TOOL = 'workato_lcap_page_save';
export const LCAP_PAGE_VALIDATE_TOOL = 'workato_lcap_page_validate';
export const LCAP_PAGE_CREATE_TOOL = 'workato_lcap_page_create';
export const API_REQUEST_TOOL = 'workato_api_request';
export const ADAPTER_META_TOOL = 'workato_adapter_meta';

/** What `writeLcapOutFile` should pull out of the response. */
export type LcapOutKind = 'page' | 'api' | 'meta';

export interface LcapOutFile {
  path: string;
  kind: LcapOutKind;
}

export interface PreparedLcapCall {
  args: Record<string, unknown>;
  outFile?: LcapOutFile;
}

const CONTENT_PATH_TOOLS = new Set([
  LCAP_PAGE_SAVE_TOOL,
  LCAP_PAGE_VALIDATE_TOOL,
  LCAP_PAGE_CREATE_TOOL,
]);

export function isWorkatoLcapFileTool(name: string): boolean {
  return (
    name === LCAP_PAGE_GET_TOOL ||
    name === API_REQUEST_TOOL ||
    name === ADAPTER_META_TOOL ||
    CONTENT_PATH_TOOLS.has(name)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function resolveOutFile(raw: string): string {
  const outFile = path.resolve(raw);
  const dir = path.dirname(outFile);
  if (!fs.existsSync(dir)) {
    throw new Error(`out_file directory does not exist: ${dir}`);
  }
  return outFile;
}

/** Atomic write: temp file then rename, so a crash cannot leave half a tree. */
function writeAtomic(target: string, text: string): void {
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, target);
}

/**
 * Read a page tree off disk.
 *
 * Accepts the bare content tree, or any envelope carrying it under `content`
 * (which is what `workato_lcap_page_get(out_file)` writes), so a caller can
 * round-trip the file it was given without unwrapping it by hand.
 */
export function loadContentFile(rawPath: string): unknown {
  const filePath = path.resolve(rawPath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`content_path file not found: ${filePath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(
      `content_path file is not valid JSON: ${filePath} (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }
  const content = isRecord(parsed) && parsed.content !== undefined ? parsed.content : parsed;
  if (!isRecord(content) || !Array.isArray(content.layout)) {
    throw new Error(
      `content_path file does not hold a page tree: ${filePath}. Expected either the content ` +
        'object itself (with a `layout` array) or an envelope with a `content` key, as written ' +
        'by workato_lcap_page_get(out_file).',
    );
  }
  return content;
}

/** Resolve file params before the call leaves for the extension. */
export function prepareLcapCall(name: string, rawArgs: Record<string, unknown>): PreparedLcapCall {
  if (CONTENT_PATH_TOOLS.has(name) && typeof rawArgs.content_path === 'string') {
    const args = { ...rawArgs };
    args.content = loadContentFile(rawArgs.content_path as string);
    delete args.content_path;
    return { args };
  }

  if (name === LCAP_PAGE_GET_TOOL && typeof rawArgs.out_file === 'string') {
    const outFile = resolveOutFile(rawArgs.out_file);
    const args = { ...rawArgs };
    delete args.out_file;
    args.view = 'full'; // the file needs the tree, the response does not
    return { args, outFile: { path: outFile, kind: 'page' } };
  }

  if (name === API_REQUEST_TOOL && typeof rawArgs.out_file === 'string') {
    const outFile = resolveOutFile(rawArgs.out_file);
    const args = { ...rawArgs };
    delete args.out_file;
    // Ask for the whole body: it is going to disk, not into the context.
    args.max_bytes = 200_000;
    return { args, outFile: { path: outFile, kind: 'api' } };
  }

  if (name === ADAPTER_META_TOOL && typeof rawArgs.out_file === 'string') {
    const outFile = resolveOutFile(rawArgs.out_file);
    const args = { ...rawArgs };
    delete args.out_file;
    args.raw = true;
    return { args, outFile: { path: outFile, kind: 'meta' } };
  }

  return { args: rawArgs };
}

/** Parse a tool response's first text block, or null when it is not JSON. */
function parsePayload(result: CallToolResult): Record<string, unknown> | null {
  const first = Array.isArray(result.content) ? result.content[0] : undefined;
  if (!first || first.type !== 'text' || typeof first.text !== 'string') return null;
  try {
    const parsed = JSON.parse(first.text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function summaryResult(payload: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: false };
}

/**
 * Post-process a response whose payload was destined for disk: write the file,
 * and hand back a summary with the bulky part removed. On any unexpected shape
 * the original result is returned untouched rather than swallowed.
 */
export function writeLcapOutFile(outFile: LcapOutFile, result: CallToolResult): CallToolResult {
  if (result.isError) return result;
  const payload = parsePayload(result);
  if (!payload) return result;

  if (outFile.kind === 'page') {
    if (payload.content === undefined) return result;
    const envelope = {
      page_id: payload.page_id,
      name: payload.name,
      updated_at: payload.updated_at,
      content: payload.content,
    };
    writeAtomic(outFile.path, JSON.stringify(envelope, null, 2));
    const { content: _content, ...rest } = payload;
    return summaryResult({
      ...rest,
      saved_to: outFile.path,
      note:
        'The content tree was written to disk, not returned. Edit that file and push it back ' +
        'with workato_lcap_page_save(content_path), passing expected_updated_at.',
    });
  }

  if (outFile.kind === 'api') {
    const body = payload.body;
    const text = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
    if (text === undefined) return result;
    writeAtomic(outFile.path, text);
    const { body: _body, ...rest } = payload;
    return summaryResult({
      ...rest,
      saved_to: outFile.path,
      bytes_written: text.length,
    });
  }

  // adapter meta
  const raw = payload.raw ?? payload.adapters;
  if (raw === undefined) return result;
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
  writeAtomic(outFile.path, text);
  const { raw: _raw, ...rest } = payload;
  return summaryResult({
    ...rest,
    saved_to: outFile.path,
    bytes_written: text.length,
  });
}
