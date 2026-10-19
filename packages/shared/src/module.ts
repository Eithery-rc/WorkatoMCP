import { type Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * What every side knows about an installed module: its id, its tools and its
 * part of the server instructions. The bridge and the extension each wrap
 * this in their own module object (bridge hooks, extension executors).
 */
export interface ToolModule {
  /** Stable id: the key in the bridge config file, the popup switch, the refusal text. */
  id: string;
  /** Display name. */
  title: string;
  /** Tool schemas, listed only while the module is on. */
  tools: Tool[];
  /** Server-instructions snippet, appended to the core snippet while the module is on. */
  instructions: string;
}

/** Refusal for a call to a tool whose module is switched off. Same wording on both sides. */
export function moduleOffMessage(module: Pick<ToolModule, 'id' | 'title'>, tool: string): string {
  return (
    `Error: ${tool} belongs to the ${module.title} module, which is switched off on this ` +
    `machine. Nothing was sent. Turn it on in the extension popup (Modules).`
  );
}
