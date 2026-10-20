/**
 * Small readers for tool results, shared by the router and the modules.
 *
 * The context block is a core convention: a module's extension side may append
 * one trailing `{"context":{...}}` text block naming the tab a call ran in.
 * The router stamps the routed profile into it (only the bridge knows that)
 * and auto-file keeps it out of spilled files.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

type JsonObject = Record<string, any>;

export const CONTEXT_BLOCK_PREFIX = '{"context":';

/** The first text block of a result, or ''. */
export function firstText(result: CallToolResult | undefined): string {
  const block = Array.isArray(result?.content)
    ? result.content.find((item: any) => item?.type === 'text')
    : undefined;
  return typeof (block as any)?.text === 'string' ? (block as any).text : '';
}

/** Parse the last JSON object line of a `summary\nJSON` tool response. */
export function parseLastJsonObject(text: string): JsonObject | null {
  const lines = text.split(/\r?\n/).reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      /* try the next line */
    }
  }
  return null;
}

/** Index of the trailing context block, if any. */
function contextBlockIndex(result: CallToolResult | undefined): number {
  if (!result || !Array.isArray(result.content) || result.content.length === 0) return -1;
  const last = result.content.length - 1;
  const block: any = result.content[last];
  if (block?.type !== 'text' || typeof block.text !== 'string') return -1;
  return block.text.startsWith(CONTEXT_BLOCK_PREFIX) ? last : -1;
}

/** The trailing context block, parsed. Null when there is none. */
export function readContextBlock(result: CallToolResult | undefined): JsonObject | null {
  const index = contextBlockIndex(result);
  if (index < 0) return null;
  try {
    const parsed = JSON.parse((result!.content[index] as any).text);
    const context = parsed?.context;
    return context && typeof context === 'object' && !Array.isArray(context) ? context : null;
  } catch {
    return null;
  }
}

/**
 * Add the routed profile to the context block. The extension knows the tab
 * (and a module its own fields); only the bridge knows which profile the call
 * went to.
 */
export function stampContextBlock(result: CallToolResult, profile: string | null): CallToolResult {
  const index = contextBlockIndex(result);
  if (index < 0) return result;
  const context = readContextBlock(result);
  if (!context) return result;
  const content = [...result.content];
  content[index] = {
    type: 'text',
    text: JSON.stringify({ context: { ...context, profile: profile ?? null } }),
  };
  return { ...result, content };
}
