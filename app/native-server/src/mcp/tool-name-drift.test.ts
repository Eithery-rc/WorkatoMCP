/**
 * Drift guard: core bridge-side tool names must be core tools.
 *
 * Native routing matches string literals duplicated out of packages/shared.
 * A typo, or a tool renamed in the shared schemas but not here, does not fail
 * a build: the call simply falls through to the extension and comes back as
 * "Tool X not found" at runtime, from a name the caller never typed. Nothing
 * tied the two lists together until this test.
 *
 * It checks two layers: the exported name sets, and every `'workato_*'` string
 * literal in the core MCP sources, so a name hardcoded at a call site is
 * covered too. Core may name only its own workato_* tools (the four
 * profile/bridge tools); a module tool name in core is a boundary leak. The
 * Workato module has its own drift test in src/modules/workato.
 */

import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { CORE_TOOL_NAMES, CORE_TOOL_SCHEMAS } from '@mokuhub/mokutab-shared';
import { CORE_AUTO_FILE_RULES, CORE_READ_TOOLS, SCREENSHOT_TOOL } from './workato-auto-file';
import { BRIDGE_INFO_TOOL } from './workato-bridge-info';
import { RELOAD_EXTENSION_TOOL } from './workato-reload-extension';
import { LEASE_TAB_TOOL, RELEASE_TAB_TOOL } from './tab-leases';
import {
  FN_GET_TOOL,
  FN_LIST_TOOL,
  FN_RUN_TOOL,
  FN_RUNS_TOOL,
  FN_SAVE_TOOL,
} from './browser-functions';

function knownCoreNames(): Set<string> {
  const names = new Set<string>();
  for (const family of Object.values(CORE_TOOL_NAMES)) {
    for (const name of Object.values(family as Record<string, string>)) names.add(name);
  }
  return names;
}

const NAME_SETS: Record<string, string[]> = {
  CORE_READ_TOOLS: [...CORE_READ_TOOLS],
  'CORE_AUTO_FILE_RULES.advertised': [...(CORE_AUTO_FILE_RULES.advertised ?? [])],
  singletons: [BRIDGE_INFO_TOOL, RELOAD_EXTENSION_TOOL, LEASE_TAB_TOOL, RELEASE_TAB_TOOL],
  screenshot: [SCREENSHOT_TOOL],
  'browser-functions': [FN_LIST_TOOL, FN_GET_TOOL, FN_RUN_TOOL, FN_SAVE_TOOL, FN_RUNS_TOOL],
};

describe('core bridge-side tool name sets match CORE_TOOL_NAMES', () => {
  const known = knownCoreNames();

  for (const [label, names] of Object.entries(NAME_SETS)) {
    test(`${label} contains only names CORE_TOOL_NAMES declares`, () => {
      // A name in `unknown` is declared here but not in packages/shared/src/tools.ts.
      const unknown = names.filter((name) => !known.has(name));
      expect(unknown).toEqual([]);
      expect(names.length).toBeGreaterThan(0);
    });
  }

  test('every core schema name is a CORE_TOOL_NAMES entry', () => {
    const missing = CORE_TOOL_SCHEMAS.map((tool) => tool.name).filter((name) => !known.has(name));
    expect(missing).toEqual([]);
  });
});

describe("hardcoded 'workato_*' literals in the core MCP sources are core tools", () => {
  test('no literal names a module tool or a tool that does not exist', () => {
    const known = knownCoreNames();
    const dir = __dirname;
    const offenders: string[] = [];

    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts') || file.endsWith('.d.ts')) continue;
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const match of source.matchAll(/'(workato_[a-z0-9_]+)'/g)) {
        const name = match[1];
        if (known.has(name)) continue;
        offenders.push(`${file}: ${name}`);
      }
    }

    // A literal here is a typo, or Workato knowledge that belongs in the module.
    expect([...new Set(offenders)].sort()).toEqual([]);
  });

  test('the scan actually reads the sources it claims to', () => {
    const files = fs
      .readdirSync(__dirname)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThan(5);
    expect(files).toContain('register-tools.ts');
  });
});
