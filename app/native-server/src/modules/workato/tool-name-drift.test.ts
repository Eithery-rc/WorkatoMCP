/**
 * Drift guard for the Workato module: its bridge-side tool names must be
 * tools the module serves.
 *
 * Native routing matches string literals duplicated out of packages/shared.
 * A typo, or a tool renamed in the shared schemas but not here, does not fail
 * a build: the call simply falls through to the extension and comes back as
 * "Tool X not found" at runtime, from a name the caller never typed.
 *
 * It checks two layers: the exported name sets, and every `'workato_*'` string
 * literal in the module sources, so a name hardcoded at a call site is covered
 * too.
 */

import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { CORE_TOOL_NAMES, WORKATO_MODULE } from '@mokuhub/mokutab-shared';
import { WORKATO_RECIPE_MUTATOR_TOOLS } from './recipe-engine';
import { WORKATO_CALLABLE_TOOLS } from './callable-schema';
import { DATAPILL_TOOL } from './datapill';
import { SWITCH_ENVIRONMENT_TOOL } from './switch-environment';
import { RECIPE_CALLERS_TOOL } from './recipe-callers';
import { SAVE_WITH_DEPENDENTS_TOOL } from './save-dependents';
import { OPERATION_STATUS_TOOL } from './operation-status';
import { STEP_SCHEMA_TOOL } from './step-schema';
import { SESSION_CONTEXT_TOOL } from './session';
import { PULL_RECIPE_TOOL, SAVE_RECIPE_CODE_TOOL, SET_PY_EVAL_CODE_TOOL } from './file-io';
import {
  ADAPTER_META_TOOL,
  API_REQUEST_TOOL,
  LCAP_PAGE_CREATE_TOOL,
  LCAP_PAGE_GET_TOOL,
  LCAP_PAGE_SAVE_TOOL,
  LCAP_PAGE_VALIDATE_TOOL,
} from './lcap-io';
import { WORKATO_READ_TOOLS, workatoModule } from '.';

/**
 * `workato_*` strings in the module that are Workato PROVIDER names (a step's
 * adapter), not MCP tool names. They can never be tool names.
 */
const PROVIDER_LITERALS = new Set([
  'workato_pub_sub',
  'workato_recipe_function',
  'workato_variable',
  'workato_template',
  'workato_webhooks',
  'workato_db_table',
  'workato_list',
  'workato_files',
]);

const MODULE_TOOLS = new Set(WORKATO_MODULE.tools.map((tool) => tool.name));
/** Core tools a module message may still name (workato_switch_profile and friends). */
const CORE_BRIDGE_TOOLS = new Set<string>(Object.values(CORE_TOOL_NAMES.BRIDGE));

const NAME_SETS: Record<string, string[]> = {
  WORKATO_RECIPE_MUTATOR_TOOLS: Object.values(WORKATO_RECIPE_MUTATOR_TOOLS),
  WORKATO_CALLABLE_TOOLS: Object.values(WORKATO_CALLABLE_TOOLS),
  WORKATO_READ_TOOLS: [...WORKATO_READ_TOOLS],
  'file-io': [PULL_RECIPE_TOOL, SAVE_RECIPE_CODE_TOOL, SET_PY_EVAL_CODE_TOOL],
  'lcap-io': [
    LCAP_PAGE_GET_TOOL,
    LCAP_PAGE_SAVE_TOOL,
    LCAP_PAGE_VALIDATE_TOOL,
    LCAP_PAGE_CREATE_TOOL,
    API_REQUEST_TOOL,
    ADAPTER_META_TOOL,
  ],
  singletons: [
    DATAPILL_TOOL,
    SWITCH_ENVIRONMENT_TOOL,
    RECIPE_CALLERS_TOOL,
    SAVE_WITH_DEPENDENTS_TOOL,
    OPERATION_STATUS_TOOL,
    STEP_SCHEMA_TOOL,
    SESSION_CONTEXT_TOOL,
  ],
};

describe('workato module tool name sets are tools the module serves', () => {
  for (const [label, names] of Object.entries(NAME_SETS)) {
    test(`${label} contains only module tools`, () => {
      // A name in `unknown` is used here but not served by WORKATO_MODULE.
      const unknown = names.filter((name) => !MODULE_TOOLS.has(name));
      expect(unknown).toEqual([]);
      expect(names.length).toBeGreaterThan(0);
    });
  }

  test('the bridge module serves exactly the shared module schemas', () => {
    expect(workatoModule.id).toBe(WORKATO_MODULE.id);
    expect(workatoModule.tools).toBe(WORKATO_MODULE.tools);
    for (const name of MODULE_TOOLS) expect(workatoModule.owns(name)).toBe(true);
    for (const name of CORE_BRIDGE_TOOLS) expect(workatoModule.owns(name)).toBe(false);
    expect(workatoModule.owns('chrome_snapshot')).toBe(false);
  });
});

function moduleSources(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('.d.ts'),
    );
}

describe("hardcoded 'workato_*' literals in the module sources name real tools", () => {
  test('no literal names a tool that does not exist', () => {
    const offenders: string[] = [];
    for (const file of moduleSources(__dirname)) {
      const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
      for (const match of source.matchAll(/'(workato_[a-z0-9_]+)'/g)) {
        const name = match[1];
        if (MODULE_TOOLS.has(name) || CORE_BRIDGE_TOOLS.has(name) || PROVIDER_LITERALS.has(name)) {
          continue;
        }
        offenders.push(`${file}: ${name}`);
      }
    }
    // A literal here is either a typo or a tool name missing from the module schemas.
    expect([...new Set(offenders)].sort()).toEqual([]);
  });

  test('the scan actually reads the sources it claims to', () => {
    const files = moduleSources(__dirname);
    expect(files.length).toBeGreaterThan(5);
    expect(files).toContain('index.ts');
  });
});
