/**
 * Drift guard: bridge-side tool names must exist in TOOL_NAMES.
 *
 * Native routing matches string literals duplicated out of packages/shared.
 * A typo, or a tool renamed in tools.ts but not here, does not fail a build:
 * the call simply falls through to the extension and comes back as
 * "Tool X not found" at runtime, from a name the caller never typed. Nothing
 * tied the two lists together until this test.
 *
 * It checks two layers: the exported name sets, and every `'workato_*'` string
 * literal in the MCP sources, so a name hardcoded at a call site is covered
 * too.
 */

import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { TOOL_NAMES } from 'workatomcp-shared';
import { READ_TOOLS, AUTO_FILE_SCHEMA_TOOLS, SCREENSHOT_TOOL } from './workato-auto-file';
import { WORKATO_RECIPE_MUTATOR_TOOLS } from './workato-recipe-engine';
import { WORKATO_CALLABLE_TOOLS } from './workato-callable-schema';
import { DATAPILL_TOOL } from './workato-datapill';
import { BRIDGE_INFO_TOOL } from './workato-bridge-info';
import { RELOAD_EXTENSION_TOOL } from './workato-reload-extension';
import { RECIPE_CALLERS_TOOL } from './workato-recipe-callers';
import { SAVE_WITH_DEPENDENTS_TOOL } from './workato-save-dependents';
import { PULL_RECIPE_TOOL, SAVE_RECIPE_CODE_TOOL, SET_PY_EVAL_CODE_TOOL } from './workato-file-io';
import {
  ADAPTER_META_TOOL,
  API_REQUEST_TOOL,
  LCAP_PAGE_CREATE_TOOL,
  LCAP_PAGE_GET_TOOL,
  LCAP_PAGE_SAVE_TOOL,
  LCAP_PAGE_VALIDATE_TOOL,
} from './workato-lcap-io';

/**
 * `workato_*` strings in the bridge that are Workato PROVIDER names (a step's
 * adapter), not MCP tool names. They can never appear in TOOL_NAMES.
 */
const PROVIDER_LITERALS = new Set([
  'workato_pub_sub',
  'workato_recipe_function',
  'workato_variable',
]);

function knownToolNames(): Set<string> {
  const names = new Set<string>();
  for (const family of Object.values(TOOL_NAMES)) {
    for (const name of Object.values(family as Record<string, string>)) names.add(name);
  }
  return names;
}

const NAME_SETS: Record<string, string[]> = {
  WORKATO_RECIPE_MUTATOR_TOOLS: Object.values(WORKATO_RECIPE_MUTATOR_TOOLS),
  WORKATO_CALLABLE_TOOLS: Object.values(WORKATO_CALLABLE_TOOLS),
  READ_TOOLS: [...READ_TOOLS],
  AUTO_FILE_SCHEMA_TOOLS: [...AUTO_FILE_SCHEMA_TOOLS],
  'workato-file-io': [PULL_RECIPE_TOOL, SAVE_RECIPE_CODE_TOOL, SET_PY_EVAL_CODE_TOOL],
  'workato-lcap-io': [
    LCAP_PAGE_GET_TOOL,
    LCAP_PAGE_SAVE_TOOL,
    LCAP_PAGE_VALIDATE_TOOL,
    LCAP_PAGE_CREATE_TOOL,
    API_REQUEST_TOOL,
    ADAPTER_META_TOOL,
  ],
  singletons: [
    DATAPILL_TOOL,
    BRIDGE_INFO_TOOL,
    RELOAD_EXTENSION_TOOL,
    RECIPE_CALLERS_TOOL,
    SAVE_WITH_DEPENDENTS_TOOL,
  ],
  screenshot: [SCREENSHOT_TOOL],
};

describe('bridge-side tool name sets match TOOL_NAMES', () => {
  const known = knownToolNames();

  for (const [label, names] of Object.entries(NAME_SETS)) {
    test(`${label} contains only names TOOL_NAMES declares`, () => {
      // A name in `unknown` is declared here but not in packages/shared/src/tools.ts.
      const unknown = names.filter((name) => !known.has(name));
      expect(unknown).toEqual([]);
      expect(names.length).toBeGreaterThan(0);
    });
  }
});

describe('hardcoded workato_* literals in the MCP sources match TOOL_NAMES', () => {
  test('no literal names a tool that does not exist', () => {
    const known = knownToolNames();
    const dir = __dirname;
    const offenders: string[] = [];

    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts') || file.endsWith('.d.ts')) continue;
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const match of source.matchAll(/'(workato_[a-z0-9_]+)'/g)) {
        const name = match[1];
        if (known.has(name) || PROVIDER_LITERALS.has(name)) continue;
        offenders.push(`${file}: ${name}`);
      }
    }

    // A literal here is either a typo or a tool name missing from tools.ts.
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
