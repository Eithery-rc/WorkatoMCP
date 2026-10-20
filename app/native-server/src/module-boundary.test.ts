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
});
