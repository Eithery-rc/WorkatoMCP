import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FnRegistry, MACHINE_IDENTITIES, SaveRefused, execGit } from './fn-registry';
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

/**
 * The vault gate after the 2.0 rename: chrome_fn_save commits as mokutab
 * now and committed as workatomcp in 1.x. A function last committed by
 * either is machine-made and must not reach the vault; only a person's
 * commit opens the gate.
 */
describe('the vault gate: who counts as a machine author', () => {
  const NAME = 'acme.case.read';
  const rel = path.join('acme', 'case.read.yaml');

  /** Replace the function file with version `version` and commit it as `who`. */
  async function commitAs(
    who: { name: string; email: string },
    version: number,
    extra: string[] = [],
  ): Promise<void> {
    const text = fs.readFileSync(path.join(dir, rel), 'utf8');
    fs.writeFileSync(path.join(dir, rel), text.replace(/^version: \d+$/m, `version: ${version}`));
    await execGit(['add', '--', rel], dir);
    await execGit(
      [
        '-c',
        `user.name=${who.name}`,
        '-c',
        `user.email=${who.email}`,
        'commit',
        '-q',
        '-m',
        `${NAME} v${version}: by ${who.name}`,
        ...extra,
      ],
      dir,
    );
  }

  async function lastIdentity(): Promise<string> {
    return (await execGit(['log', '-1', '--format=%an <%ae> / %cn <%ce>', '--', rel], dir)).trim();
  }

  beforeEach(async () => {
    await registry.save(readDef(), { changelog: 'v1' });
  });

  test('chrome_fn_save now commits as mokutab, and that is not hand-committed', async () => {
    expect(await lastIdentity()).toBe('mokutab <mokutab@localhost> / mokutab <mokutab@localhost>');
    expect(await registry.handCommitted(NAME)).toMatch(/made by chrome_fn_save, not by a person/);
  });

  test('a file last committed by the 1.x identity (workatomcp) is not hand-committed', async () => {
    await commitAs({ name: 'workatomcp', email: 'workatomcp@localhost' }, 2);
    expect(await lastIdentity()).toBe(
      'workatomcp <workatomcp@localhost> / workatomcp <workatomcp@localhost>',
    );
    expect(await registry.isClean(NAME)).toBe(true);
    expect(await registry.handCommitted(NAME)).toMatch(/made by chrome_fn_save, not by a person/);
  });

  test('a file a person committed is hand-committed', async () => {
    await commitAs({ name: 'Roman Chikalenko', email: 'roman@example.com' }, 2);
    expect(await registry.handCommitted(NAME)).toBeNull();
  });

  test('either identity anywhere in the commit keeps it machine-made', async () => {
    const person = { name: 'Roman Chikalenko', email: 'roman@example.com' };
    // A person committing a 1.x-authored change (an amend or a cherry-pick keeps the author).
    await commitAs(person, 2, ['--author', 'workatomcp <workatomcp@localhost>']);
    expect(await registry.handCommitted(NAME)).not.toBeNull();
    // The machine committing a change authored by a person.
    await commitAs({ name: 'mokutab', email: 'mokutab@localhost' }, 3, [
      '--author',
      'Roman Chikalenko <roman@example.com>',
    ]);
    expect(await registry.handCommitted(NAME)).not.toBeNull();
    // Only the email gives the 1.x machine away.
    await commitAs({ name: 'someone', email: 'workatomcp@localhost' }, 4);
    expect(await registry.handCommitted(NAME)).not.toBeNull();
    // A person again: open.
    await commitAs(person, 5);
    expect(await registry.handCommitted(NAME)).toBeNull();
  });

  test('every identity chrome_fn_save ever used stays a machine identity', () => {
    for (const id of ['mokutab', 'mokutab@localhost', 'workatomcp', 'workatomcp@localhost']) {
      expect(MACHINE_IDENTITIES.has(id)).toBe(true);
    }
  });
});
