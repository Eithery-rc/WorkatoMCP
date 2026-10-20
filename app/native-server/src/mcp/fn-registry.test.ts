import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FnRegistry, SaveRefused, execGit } from './fn-registry';
import type { FnDefinition } from './fn-definition';

// These tests drive a real git repository (init, add, commit, log, show). Each
// call spawns a process, and under the parallel suite on a busy machine a test
// can take longer than jest's 5 s default.
jest.setTimeout(30_000);

function readDef(description = 'Read a case'): FnDefinition {
  return {
    name: 'acme.case.read',
    description,
    kind: 'read',
    params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    target: { url: 'https://acme.example.com/case?id={id}' },
    steps: [{ id: 'read', type: 'js', code: 'return document.title;\n// line two' }],
  };
}

let dir: string;
let registry: FnRegistry;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fn-registry-'));
  registry = new FnRegistry(dir);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('FnRegistry', () => {
  test('a first save creates the repo, the file and version 1', async () => {
    const saved = await registry.save(readDef(), { changelog: 'first cut', caller: 'tester' });
    expect(saved.version).toBe(1);
    expect(saved.previous_version).toBeNull();
    expect(saved.file).toBe(path.join(dir, 'acme', 'case.read.yaml'));
    const text = fs.readFileSync(saved.file, 'utf8');
    expect(text).toMatch(/^# MokuTab browser function/);
    // Multi-line code is a literal block, readable in a diff.
    expect(text).toContain('code: |-\n');
    const log = await execGit(['log', '--format=%s%n%b', '-1'], dir);
    expect(log).toContain('acme.case.read v1: first cut');
    expect(log).toContain('Saved-By: tester');
  });

  test('a save on a stale or missing base_version is refused', async () => {
    await registry.save(readDef(), { changelog: 'v1' });
    await expect(registry.save(readDef('x'), { changelog: 'no base' })).rejects.toThrow(
      /is at version 1; this save was built on nothing/,
    );
    await registry.save(readDef('second'), { changelog: 'v2', base_version: 1 });
    await expect(
      registry.save(readDef('third'), { changelog: 'stale', base_version: 1 }),
    ).rejects.toThrow(SaveRefused);
    expect((registry.get('acme.case.read')?.definition as FnDefinition).version).toBe(2);
  });

  test('history and old versions come from git', async () => {
    await registry.save(readDef('one'), { changelog: 'v1' });
    await registry.save(readDef('two'), {
      changelog: 'better',
      base_version: 1,
      caller: 'agent-b',
    });
    const history = await registry.history('acme.case.read');
    expect(history.map((h) => h.version)).toEqual([2, 1]);
    expect(history[0].saved_by).toBe('agent-b');
    const old = (await registry.getVersion('acme.case.read', 1)) as FnDefinition;
    expect(old.description).toBe('one');
  });

  test('a file with uncommitted edits is never overwritten', async () => {
    const saved = await registry.save(readDef(), { changelog: 'v1' });
    fs.appendFileSync(saved.file, '# hand edit\n');
    expect(await registry.isClean('acme.case.read')).toBe(false);
    await expect(registry.save(readDef('x'), { changelog: 'v2', base_version: 1 })).rejects.toThrow(
      /not committed/,
    );
  });

  test('an invalid definition is refused with its problems listed', async () => {
    await expect(
      registry.save({ ...readDef(), kind: 'write' } as FnDefinition, { changelog: 'bad' }),
    ).rejects.toThrow(/mark the step that changes data/);
    expect(fs.existsSync(path.join(dir, 'acme'))).toBe(false);
  });

  test('helpers save and load; list reports broken files', async () => {
    await registry.save(
      { name: '_helpers.dom', description: 'DOM helpers', code: 'h.text = (s) => s.trim();' },
      { changelog: 'add dom helpers' },
    );
    expect(registry.helpers(['dom'])).toEqual([{ name: 'dom', code: 'h.text = (s) => s.trim();' }]);
    expect(() => registry.helpers(['nope'])).toThrow(/helper "nope" is missing/);
    fs.mkdirSync(path.join(dir, 'broken'));
    fs.writeFileSync(path.join(dir, 'broken', 'thing.yaml'), 'name: other.name\n');
    const list = registry.list();
    expect(list.map((e) => e.name)).toEqual(['_helpers.dom', 'broken.thing']);
    expect(list[1].error).toMatch(/must be "broken.thing"/);
  });
});
