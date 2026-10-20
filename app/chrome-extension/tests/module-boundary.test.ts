/**
 * Boundary guard: core never imports a module.
 *
 * Core reaches modules in one place only, entrypoints/background/modules/
 * index.ts (the installed modules), and uses them through the ExtensionModule
 * interface. A core file importing modules/workato/... directly is a Workato
 * dependency the module switch cannot turn off. Modules may import core,
 * never each other. The bridge has the same test (src/module-boundary.test.ts).
 *
 * WXT requires content-script entrypoints at the top of entrypoints/, so a
 * module's content script lives there; MODULE_ENTRYPOINTS names which module
 * each one belongs to, and it may import that module only.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULES_DIR = path.join(ROOT, 'entrypoints', 'background', 'modules');
const SCANNED = ['entrypoints', 'common', 'utils', 'shared'];

/** Entry points outside the module folder that belong to a module. */
const MODULE_ENTRYPOINTS: Record<string, string> = {
  'entrypoints/workato-field-outline.content.ts': 'workato',
};

const IMPORT_PATTERN =
  /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)(['"])((?:\.{1,2}|@|~)\/[^'"]*)\1/gm;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|vue|js|mjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const posix = (p: string) => p.split(path.sep).join('/');

function resolveSpec(file: string, spec: string): string {
  if (spec.startsWith('@/') || spec.startsWith('~/')) return path.join(ROOT, spec.slice(2));
  return path.resolve(path.dirname(file), spec);
}

/** `modules/<id>` a path lies in, or null (modules/index is not a module). */
function moduleOf(target: string): string | null {
  const rel = path.relative(MODULES_DIR, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const [first] = rel.split(path.sep);
  if (!first || first === 'index' || /\.[a-z]+$/.test(first)) return null;
  return first;
}

function offenders(): string[] {
  const out: string[] = [];
  for (const dir of SCANNED) {
    for (const file of walk(path.join(ROOT, dir))) {
      const rel = posix(path.relative(ROOT, file));
      // modules/index.ts is the wiring point: it may import every module.
      if (path.dirname(file) === MODULES_DIR) continue;
      const fromModule = moduleOf(file) ?? MODULE_ENTRYPOINTS[rel] ?? null;
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(IMPORT_PATTERN)) {
        const toModule = moduleOf(resolveSpec(file, match[2]));
        if (toModule !== null && toModule !== fromModule) out.push(`${rel} -> ${match[2]}`);
      }
    }
  }
  return out.sort();
}

describe('core never imports a module', () => {
  test('only modules/index.ts is imported from outside the module folders', () => {
    expect(offenders()).toEqual([]);
  });

  test('the scan sees the wiring imports it allows', () => {
    const tools = readFileSync(
      path.join(ROOT, 'entrypoints', 'background', 'tools', 'index.ts'),
      'utf8',
    );
    expect(tools).toMatch(/from '\.\.\/modules'/);
    expect(moduleOf(path.join(MODULES_DIR, 'workato', 'index.ts'))).toBe('workato');
    expect(moduleOf(path.join(MODULES_DIR, 'index.ts'))).toBeNull();
  });

  test('every module entry point exists and starts through its module gate', () => {
    for (const rel of Object.keys(MODULE_ENTRYPOINTS)) {
      const source = readFileSync(path.join(ROOT, rel), 'utf8');
      expect(source).toMatch(/gateWorkatoContent\(/);
    }
  });
});
