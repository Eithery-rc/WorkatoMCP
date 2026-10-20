/**
 * Boundary guard: core never imports a module.
 *
 * Core reaches modules in one place only, `modules/index.ts` (the list of
 * installed modules), and talks to them through the BridgeModule interface.
 * A core file that imports `modules/workato/...` directly has grown a
 * dependency on Workato that the module switch cannot turn off, and the split
 * quietly stops being one. Modules may import core, never each other.
 *
 * Checked for the bridge sources and for packages/shared/src; the extension
 * has the same test (tests/module-boundary.test.ts).
 */

import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

const IMPORT_PATTERN =
  /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)(['"])(\.{1,2}\/[^'"]*)\1/gm;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** The module folder a path lies in (`modules/<id>`), or null. */
function moduleOf(modulesDir: string, file: string): string | null {
  const rel = path.relative(modulesDir, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const [first] = rel.split(path.sep);
  if (!first || first === 'index' || /\.[a-z]+$/.test(first)) return null;
  return first;
}

function isModulesIndex(modulesDir: string, target: string): boolean {
  const rel = path.relative(modulesDir, target).replace(/\\/g, '/');
  return rel === '' || rel === 'index' || rel === 'index.ts' || rel === 'index.js';
}

/**
 * Every import that crosses the boundary: from outside `modulesDir` into a
 * module folder (anything but modules/index), or from one module into another.
 */
export function boundaryOffenders(root: string, modulesDir: string): string[] {
  const offenders: string[] = [];
  for (const file of walk(root)) {
    // This file's own fixtures would match.
    if (file === __filename) continue;
    const source = fs.readFileSync(file, 'utf8');
    const fromModule = moduleOf(modulesDir, file);
    const inModulesDir = !path.relative(modulesDir, file).startsWith('..');
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const target = path.resolve(path.dirname(file), match[2]);
      const toModule = moduleOf(modulesDir, target);
      const where = `${path.relative(root, file).replace(/\\/g, '/')} -> ${match[2]}`;
      if (!inModulesDir) {
        if (
          toModule !== null ||
          (!isModulesIndex(modulesDir, target) && isInside(modulesDir, target))
        ) {
          offenders.push(where);
        }
      } else if (fromModule !== null && toModule !== null && toModule !== fromModule) {
        offenders.push(where);
      }
    }
  }
  return offenders.sort();
}

function isInside(dir: string, target: string): boolean {
  const rel = path.relative(dir, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Exports of @mokuhub/mokutab-shared that carry module knowledge: the whole
 * catalogue and the module list. Core gets its tool lists from
 * mcp/catalogue.ts (core schemas plus the installed modules, through the
 * registry) instead, so a module that is not installed cannot leak in.
 */
const AGGREGATE_EXPORT = /^(?:TOOL_SCHEMAS|TOOL_NAMES|MODULES|moduleOfTool|WORKATO_\w+)$/;

const SHARED = `['"]@mokuhub/mokutab-shared['"]`;

/** `import|export [type] {names} | * [as x] from '@mokuhub/mokutab-shared'` */
const STATIC_FORM = new RegExp(
  `\\b(import|export)\\s+(?:type\\s+)?(\\{[^}]*\\}|\\*(?:\\s+as\\s+\\w+)?)\\s*from\\s*${SHARED}`,
  'g',
);

/** `const|let|var {names} = [await] require|import('@mokuhub/mokutab-shared')` */
const DESTRUCTURED_CALL = new RegExp(
  `\\b(?:const|let|var)\\s+(\\{[^}]*\\})\\s*=\\s*(?:await\\s+)?(?:require|import)\\s*\\(\\s*${SHARED}\\s*\\)`,
  'g',
);

/** Any other `require('@mokuhub/mokutab-shared')` / `import('@mokuhub/mokutab-shared')`: the whole package. */
const WHOLE_CALL = new RegExp(`\\b(require|import)\\s*\\(\\s*${SHARED}\\s*\\)`, 'g');

/** The names a `{ ... }` list binds, with comments, `type` and aliases dropped. */
function namesIn(braces: string): string[] {
  return braces
    .slice(1, -1)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .split(',')
    .map((part) =>
      part
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+|\s*:\s*/)[0]
        .trim(),
    )
    .filter(Boolean);
}

/** Every aggregate shared export one source file reaches, as `file: name` lines. */
export function aggregateUses(rel: string, source: string): string[] {
  const out: string[] = [];
  let rest = source;
  for (const match of source.matchAll(STATIC_FORM)) {
    if (match[2].startsWith('*')) {
      out.push(`${rel}: ${match[1]} * (whole package)`);
      continue;
    }
    for (const name of namesIn(match[2]))
      if (AGGREGATE_EXPORT.test(name)) out.push(`${rel}: ${name}`);
  }
  for (const match of source.matchAll(DESTRUCTURED_CALL)) {
    for (const name of namesIn(match[1]))
      if (AGGREGATE_EXPORT.test(name)) out.push(`${rel}: ${name}`);
    rest = rest.replace(match[0], '');
  }
  for (const match of rest.matchAll(WHOLE_CALL)) {
    out.push(`${rel}: ${match[1]}() (whole package)`);
  }
  return out;
}

/** Non-test files outside `modulesDir` that reach an aggregate shared export. */
export function aggregateImports(root: string, modulesDir: string): string[] {
  const offenders: string[] = [];
  for (const file of walk(root)) {
    if (file === __filename || /\.test\.ts$/.test(file)) continue;
    if (!path.relative(modulesDir, file).startsWith('..')) continue;
    const rel = path.relative(root, file).replace(/\\/g, '/');
    offenders.push(...aggregateUses(rel, fs.readFileSync(file, 'utf8')));
  }
  return offenders.sort();
}

const BRIDGE_SRC = __dirname;
const SHARED_SRC = path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'src');

describe('core never imports a module', () => {
  test('bridge: only modules/index.ts is imported from outside src/modules', () => {
    expect(boundaryOffenders(BRIDGE_SRC, path.join(BRIDGE_SRC, 'modules'))).toEqual([]);
  });

  test('shared: only modules/index.ts is imported from outside src/modules', () => {
    expect(fs.existsSync(path.join(SHARED_SRC, 'modules', 'workato'))).toBe(true);
    expect(boundaryOffenders(SHARED_SRC, path.join(SHARED_SRC, 'modules'))).toEqual([]);
  });

  test('the scan sees the wiring imports it allows', () => {
    // register-tools reaches the installed modules through the index.
    const router = fs.readFileSync(path.join(BRIDGE_SRC, 'mcp', 'register-tools.ts'), 'utf8');
    expect(router).toMatch(/from '\.\.\/modules'/);
  });

  test('bridge core imports no aggregate catalogue or module list from the shared package', () => {
    expect(aggregateImports(BRIDGE_SRC, path.join(BRIDGE_SRC, 'modules'))).toEqual([]);
  });
});

describe('the checker itself', () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'boundary-'));
  const write = (rel: string, body: string) => {
    const file = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  };
  write('core.ts', "import { a } from './modules';\nimport { b } from './modules/index';\n");
  write('leak.ts', "import { c } from './modules/alpha/thing';\n");
  write('lazy.ts', "const d = require('./modules/alpha');\n");
  write('modules/index.ts', "export * from './alpha';\nexport * from './beta';\n");
  write('modules/alpha/index.ts', "import { e } from '../../core';\nexport const thing = 1;\n");
  write('modules/alpha/thing.ts', 'export const c = 1;\n');
  write('modules/beta/index.ts', "import { thing } from '../alpha';\n");

  test('flags deep imports, lazy requires and cross-module imports, and nothing else', () => {
    expect(boundaryOffenders(tmp, path.join(tmp, 'modules'))).toEqual([
      'lazy.ts -> ./modules/alpha',
      'leak.ts -> ./modules/alpha/thing',
      'modules/beta/index.ts -> ../alpha',
    ]);
  });

  test('flags aggregate shared imports in core, not core names or module files', () => {
    const shared = fs.mkdtempSync(path.join(require('os').tmpdir(), 'boundary-shared-'));
    const put = (rel: string, body: string) => {
      const file = path.join(shared, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
    };
    put('ok.ts', "import { CORE_TOOL_NAMES, type ToolModule } from '@mokuhub/mokutab-shared';\n");
    put(
      'all.ts',
      "import {\n  NativeMessageType,\n  TOOL_SCHEMAS,\n} from '@mokuhub/mokutab-shared';\n",
    );
    put('alias.ts', "import { WORKATO_TOOL_NAMES as W } from '@mokuhub/mokutab-shared';\n");
    put('star.ts', "import * as shared from '@mokuhub/mokutab-shared';\n");
    put('reexport.ts', "export { MODULES as installed } from '@mokuhub/mokutab-shared';\n");
    put('reexport-all.ts', 'export * from "@mokuhub/mokutab-shared";\n');
    put(
      'commented.ts',
      "import {\n  CORE_TOOL_NAMES, // core\n  /* sneaky */ TOOL_NAMES,\n} from '@mokuhub/mokutab-shared';\n",
    );
    put(
      'required.ts',
      "const { moduleOfTool, CORE_TOOL_NAMES: C } = require('@mokuhub/mokutab-shared');\n",
    );
    put('required-ok.ts', "const { CORE_TOOL_SCHEMAS } = require('@mokuhub/mokutab-shared');\n");
    put('required-whole.ts', "const shared = require('@mokuhub/mokutab-shared');\n");
    put('dynamic.ts', "const { TOOL_SCHEMAS } = await import('@mokuhub/mokutab-shared');\n");
    put('dynamic-whole.ts', "void import('@mokuhub/mokutab-shared').then((m) => m);\n");
    put('resolve-ok.ts', "const entry = require.resolve('@mokuhub/mokutab-shared');\n");
    put('modules/alpha/index.ts', "import { TOOL_NAMES } from '@mokuhub/mokutab-shared';\n");
    put('core.test.ts', "import { TOOL_SCHEMAS } from '@mokuhub/mokutab-shared';\n");
    expect(aggregateImports(shared, path.join(shared, 'modules'))).toEqual([
      'alias.ts: WORKATO_TOOL_NAMES',
      'all.ts: TOOL_SCHEMAS',
      'commented.ts: TOOL_NAMES',
      'dynamic-whole.ts: import() (whole package)',
      'dynamic.ts: TOOL_SCHEMAS',
      'reexport-all.ts: export * (whole package)',
      'reexport.ts: MODULES',
      'required-whole.ts: require() (whole package)',
      'required.ts: moduleOfTool',
      'star.ts: import * (whole package)',
    ]);
  });
});
