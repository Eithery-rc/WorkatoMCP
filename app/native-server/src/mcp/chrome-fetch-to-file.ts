/**
 * chrome_fetch_to_file: the bridge half.
 *
 * The extension fetches the URL in the page and replies with the body as
 * base64. That reply must never reach the caller: this module resolves
 * out_file before the call leaves (a bad directory fails before any browser
 * work), tells the extension it may answer with the body (__to_file), and on
 * the way back decodes the body into out_file and answers with a summary.
 *
 * Every path out of finishFetchToFile drops the base64: an unparseable reply
 * becomes an error that does not quote it.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { CORE_TOOL_NAMES } from 'workatomcp-shared';

export const FETCH_TO_FILE_TOOL = CORE_TOOL_NAMES.BROWSER.FETCH_TO_FILE;

const OUT_FILE_ARG = 'out_file';
/** Extension-side signal that the bridge owns the reply (see fetch-to-file.ts). */
const TO_FILE_FLAG = '__to_file';
const MAGIC_BYTES = 8;

export function isFetchToFileTool(name: string): boolean {
  return name === FETCH_TO_FILE_TOOL;
}

export interface PreparedFetchToFileCall {
  args: Record<string, unknown>;
  outFile: string;
}

/** Validate and strip out_file; throws when it is missing or its directory does not exist. */
export function prepareFetchToFileCall(rawArgs: Record<string, unknown>): PreparedFetchToFileCall {
  const raw = rawArgs[OUT_FILE_ARG];
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error(`${OUT_FILE_ARG} is required: an absolute path for the fetched body`);
  }
  if (!path.isAbsolute(raw.trim())) {
    throw new Error(`${OUT_FILE_ARG} must be an absolute path: ${raw}`);
  }
  const outFile = path.resolve(raw.trim());
  const dir = path.dirname(outFile);
  if (!fs.existsSync(dir)) {
    throw new Error(`${OUT_FILE_ARG} directory does not exist: ${dir}`);
  }
  if (fs.existsSync(outFile) && fs.statSync(outFile).isDirectory()) {
    throw new Error(`${OUT_FILE_ARG} is a directory, not a file path: ${outFile}`);
  }
  const args = { ...rawArgs };
  delete args[OUT_FILE_ARG];
  args[TO_FILE_FLAG] = true;
  return { args, outFile };
}

interface ExtensionFetchReply {
  ok?: boolean;
  status?: number;
  statusText?: string;
  final_url?: string;
  content_type?: string;
  content_disposition?: string;
  bytes?: number;
  base64?: string;
  tabId?: number;
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/** Atomic write: temp file then rename, so a crash cannot leave half a file. */
function writeAtomic(target: string, data: Buffer): void {
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, target);
}

/** The filename from a Content-Disposition header (filename* wins over filename). */
export function filenameFromDisposition(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[2].trim().replace(/^"|"$/g, ''));
    } catch {
      // fall through to the plain form
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header);
  if (!plain) return undefined;
  const value = (plain[2] ?? plain[1]).trim();
  return value || undefined;
}

/** The first bytes as text when they are printable ASCII, e.g. "%PDF-1.7". */
export function printableMagic(data: Buffer): string | undefined {
  const head = data.subarray(0, MAGIC_BYTES);
  if (head.length === 0) return undefined;
  for (const byte of head) {
    if (byte < 0x20 || byte > 0x7e) return undefined;
  }
  return head.toString('latin1');
}

/**
 * Turn the extension reply into the file plus a summary. An error reply from
 * the extension carries no body and passes through unchanged.
 */
export function finishFetchToFile(outFile: string, result: CallToolResult): CallToolResult {
  if (result.isError) return result;
  const content = Array.isArray(result.content) ? result.content : [];
  const first: any = content[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string') {
    return errorResult(
      'chrome_fetch_to_file: the extension reply had no body. Nothing was written.',
    );
  }

  let reply: ExtensionFetchReply;
  try {
    reply = JSON.parse(first.text) as ExtensionFetchReply;
  } catch {
    return errorResult(
      'chrome_fetch_to_file: the extension reply could not be parsed. Nothing was written.',
    );
  }
  if (!reply || typeof reply !== 'object' || typeof reply.base64 !== 'string') {
    return errorResult(
      'chrome_fetch_to_file: the extension reply had no body. Nothing was written.',
    );
  }

  const data = Buffer.from(reply.base64, 'base64');
  if (typeof reply.bytes === 'number' && reply.bytes !== data.length) {
    return errorResult(
      `chrome_fetch_to_file: the body decoded to ${data.length} bytes, but the page read ` +
        `${reply.bytes}. Nothing was written.`,
    );
  }

  writeAtomic(outFile, data);
  const status = typeof reply.status === 'number' ? reply.status : 0;
  const ok = reply.ok === true;
  const summary: Record<string, unknown> = {
    tool: FETCH_TO_FILE_TOOL,
    saved_to: outFile,
    bytes: data.length,
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
    status,
    ok,
    content_type: reply.content_type || '',
  };
  const filename = filenameFromDisposition(reply.content_disposition);
  if (filename) summary.filename = filename;
  if (reply.final_url) summary.final_url = reply.final_url;
  const magic = printableMagic(data);
  if (magic !== undefined) summary.magic = magic;
  if (typeof reply.tabId === 'number') summary.tabId = reply.tabId;
  if (!ok) {
    summary.note =
      `HTTP ${status}${reply.statusText ? ` ${reply.statusText}` : ''}: the error body was ` +
      'written to the file for diagnosis.';
  }

  return { content: [{ type: 'text', text: JSON.stringify(summary) }], isError: !ok };
}
