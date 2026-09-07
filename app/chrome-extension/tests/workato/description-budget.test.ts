/**
 * @fileoverview The served tool catalogue has to fit inside a client's budget,
 * and the Workato families have to read in this project's house style.
 *
 * A description is the only documentation a model gets before its first call,
 * so it is worth writing at length; the MCP client documentation caps a tool
 * description at 2 KB, and one tool (workato_apps_list, 2245 bytes on
 * 2026-09-07) had already crossed it. This test measures the SERVED size, the
 * one a client actually receives, and holds the whole Workato surface to it.
 *
 * The second half enforces the writing rule: no em-dash or en-dash anywhere in
 * a Workato tool description or property description. A dash is also how a
 * numeric range ("10000-110000") gets typed by accident, and an en-dash there
 * is a different character from the hyphen every other range uses.
 */

import { describe, expect, it } from 'vitest';
import { TOOL_NAMES, TOOL_SCHEMAS } from 'workatomcp-shared';

/** The documented per-description limit for an MCP tool. */
const DESCRIPTION_LIMIT_BYTES = 2048;

/**
 * Properties the BRIDGE injects into the served schema, copied verbatim from
 * app/native-server/src/mcp/register-tools.ts (PROFILE_ROUTING_PROPERTY) and
 * workato-auto-file.ts (OUT_FILE / AUTO_FILE / AUTO_FILE_THRESHOLD), read
 * 2026-09-07. The extension package cannot import the bridge, so they are
 * replicated here: they change the served SCHEMA, and their own descriptions
 * are part of what a client is charged for.
 */
const BRIDGE_INJECTED_PROPERTY_DESCRIPTIONS = {
  profile:
    'Optional connected Chrome profile name for this call only. Overrides this MCP session profile without changing it.',
  out_file:
    'Absolute path to write the full result to (its directory must exist). The response becomes a compact summary: saved_to, bytes, top-level keys and item counts.',
  auto_file:
    'Spill an oversized result to a temp file and return the same summary instead of the full payload. Default: true for Workato read tools, false for chrome_screenshot. Set false to always get the result inline.',
  auto_file_threshold_chars:
    'Character count above which auto_file spills the result to a file (default: 60000).',
};

/** Tools the bridge does NOT give a `profile` property (PROFILE_MANAGEMENT_TOOLS). */
const PROFILE_MANAGEMENT_TOOLS = new Set<string>([
  TOOL_NAMES.WORKATO.LIST_PROFILES,
  TOOL_NAMES.WORKATO.SWITCH_PROFILE,
]);

const DASH = /[–—]/;

interface SchemaLike {
  name: string;
  description?: string;
  inputSchema?: { type?: string; properties?: Record<string, { description?: string }> };
}

function workatoToolNames(): Set<string> {
  const names = new Set<string>();
  for (const [family, entries] of Object.entries(TOOL_NAMES)) {
    if (!family.startsWith('WORKATO')) continue;
    for (const name of Object.values(entries as Record<string, string>)) names.add(name);
  }
  return names;
}

/**
 * The catalogue as the bridge serves it: the shared schemas plus the injected
 * routing and file properties. Descriptions are untouched by the injection,
 * which is exactly what this asserts.
 */
function servedSchemas(): SchemaLike[] {
  return (TOOL_SCHEMAS as SchemaLike[]).map((tool) => {
    const inputSchema = tool.inputSchema ?? { type: 'object' };
    if (inputSchema.type !== 'object') return tool;
    const properties: Record<string, { description?: string }> = {
      ...(inputSchema.properties ?? {}),
    };
    if (!PROFILE_MANAGEMENT_TOOLS.has(tool.name) && !properties.profile) {
      properties.profile = { description: BRIDGE_INJECTED_PROPERTY_DESCRIPTIONS.profile };
    }
    return { ...tool, inputSchema: { ...inputSchema, properties } };
  });
}

function bytes(text: string | undefined): number {
  return Buffer.byteLength(text ?? '', 'utf8');
}

describe('served tool descriptions stay inside the client budget', () => {
  it('keeps every served description under 2048 bytes', () => {
    const over = servedSchemas()
      .map((tool) => ({ name: tool.name, size: bytes(tool.description) }))
      .filter((row) => row.size >= DESCRIPTION_LIMIT_BYTES);
    expect(over).toEqual([]);
  });

  it('keeps workato_apps_list, the one tool that crossed the limit, under it', () => {
    const appsList = TOOL_SCHEMAS.find((tool) => tool.name === TOOL_NAMES.WORKATO.APPS_LIST);
    expect(appsList).toBeDefined();
    expect(bytes(appsList?.description)).toBeLessThan(DESCRIPTION_LIMIT_BYTES);
    // The guidance that makes the tool usable has to survive the trim.
    expect(appsList?.description).toMatch(/NO CONNECTION MEANS STOP AND ASK THE USER/);
    expect(appsList?.description).toMatch(/workato_pub_sub/);
    expect(appsList?.description).toMatch(/not_found/);
  });

  it('injecting the bridge properties does not change any description', () => {
    const served = new Map(servedSchemas().map((tool) => [tool.name, tool.description]));
    for (const tool of TOOL_SCHEMAS) {
      expect(served.get(tool.name)).toBe(tool.description);
    }
  });

  it('keeps the injected property descriptions small', () => {
    for (const [name, description] of Object.entries(BRIDGE_INJECTED_PROPERTY_DESCRIPTIONS)) {
      expect(bytes(description), name).toBeLessThan(400);
      expect(description, name).not.toMatch(DASH);
    }
  });

  it('reports the current headroom so a regression is visible in the run', () => {
    const largest = (TOOL_SCHEMAS as SchemaLike[])
      .map((tool) => ({ name: tool.name, size: bytes(tool.description) }))
      .sort((a, b) => b.size - a.size)[0];
    expect(largest.size).toBeLessThan(DESCRIPTION_LIMIT_BYTES);
  });
});

describe('Workato tool text carries no em-dash or en-dash', () => {
  const workato = workatoToolNames();

  it('no Workato tool description contains one', () => {
    const offenders = (TOOL_SCHEMAS as SchemaLike[])
      .filter((tool) => workato.has(tool.name) && DASH.test(tool.description ?? ''))
      .map((tool) => tool.name);
    expect(offenders).toEqual([]);
  });

  it('no Workato property description contains one', () => {
    const offenders: string[] = [];
    for (const tool of TOOL_SCHEMAS as SchemaLike[]) {
      if (!workato.has(tool.name)) continue;
      for (const [key, prop] of Object.entries(tool.inputSchema?.properties ?? {})) {
        if (DASH.test(prop?.description ?? '')) offenders.push(`${tool.name}.${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('covers the whole Workato surface, not an empty set', () => {
    const covered = (TOOL_SCHEMAS as SchemaLike[]).filter((tool) => workato.has(tool.name));
    expect(covered.length).toBeGreaterThan(80);
    expect(workato.size).toBeGreaterThan(80);
  });
});
