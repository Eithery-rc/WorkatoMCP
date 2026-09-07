/**
 * @fileoverview `workato_recipe_version_diff` matches a node across two
 * versions by identity. Nodes without an `as` used to be keyed by walk order,
 * so inserting one anonymous node near the top shifted every later anonymous
 * node's counter and the diff reported them all as removed and re-added.
 * Workato writes a `uuid` on those nodes, which survives an insertion above.
 */

import { describe, expect, it } from 'vitest';

import { collectSteps, stepHeader } from '@/entrypoints/background/tools/workato/version-diff';

/** A node without an `as`: Workato writes these for control steps. */
const anon = (uuid: string, number: number, keyword: string, over: object = {}) => ({
  number,
  keyword,
  uuid,
  ...over,
});

const named = (as: string, number: number, over: object = {}) => ({
  number,
  keyword: 'action',
  as,
  provider: 'logger',
  name: 'log_message',
  uuid: `uuid-${as}`,
  ...over,
});

/** The diff the tool runs: added / removed by key, changed by content. */
function diffKeys(from: unknown, to: unknown) {
  const fromSteps = collectSteps(from);
  const toSteps = collectSteps(to);
  const added: string[] = [];
  const removed: string[] = [];
  for (const [key] of toSteps) if (!fromSteps.has(key)) added.push(key);
  for (const [key] of fromSteps) if (!toSteps.has(key)) removed.push(key);
  return { added, removed, fromSteps, toSteps };
}

describe('collectSteps identity', () => {
  it('keys a node by its `as` when it has one', () => {
    const steps = collectSteps(named('a1b2c3d4', 0));
    expect([...steps.keys()]).toEqual(['a1b2c3d4']);
    expect(steps.get('a1b2c3d4')).toMatchObject({ as: 'a1b2c3d4', uuid: 'uuid-a1b2c3d4' });
  });

  it('keys an anonymous node by its uuid', () => {
    const steps = collectSteps(anon('11111111-2222-3333-4444-555555555555', 0, 'if'));
    expect([...steps.keys()]).toEqual(['uuid:11111111-2222-3333-4444-555555555555']);
    expect(steps.get('uuid:11111111-2222-3333-4444-555555555555')?.as).toBeUndefined();
  });

  it('falls back to walk order only when there is neither', () => {
    const tree = { number: 0, keyword: 'trigger', block: [{ number: 1, keyword: 'if' }] };
    expect([...collectSteps(tree).keys()]).toEqual(['__anon_0', '__anon_1']);
  });
});

describe('inserting an anonymous node above', () => {
  const trigger = (block: unknown[]) => ({
    number: 0,
    keyword: 'trigger',
    as: 'trig0000',
    uuid: 'uuid-trig',
    block,
  });

  const before = trigger([
    anon('uuid-if-a', 1, 'if'),
    named('deadbeef', 2),
    anon('uuid-if-b', 3, 'if'),
  ]);

  // One new anonymous node at the top; every later node is renumbered.
  const after = trigger([
    anon('uuid-if-new', 1, 'if'),
    anon('uuid-if-a', 2, 'if'),
    named('deadbeef', 3),
    anon('uuid-if-b', 4, 'if'),
  ]);

  it('reports exactly one added step and nothing removed', () => {
    const { added, removed } = diffKeys(before, after);
    expect(added).toEqual(['uuid:uuid-if-new']);
    expect(removed).toEqual([]);
  });

  it('matches the pre-existing anonymous nodes across the insertion', () => {
    const { fromSteps, toSteps } = diffKeys(before, after);
    expect(fromSteps.get('uuid:uuid-if-a')?.number).toBe(1);
    expect(toSteps.get('uuid:uuid-if-a')?.number).toBe(2);
    expect(toSteps.has('uuid:uuid-if-b')).toBe(true);
  });

  it('names the node that was actually inserted, not the last one', () => {
    const { toSteps } = diffKeys(before, after);
    // uuid keying: the added key belongs to the new node at position 1.
    expect(toSteps.get('uuid:uuid-if-new')?.number).toBe(1);

    // The regression this fixes: strip the uuids and every anonymous node
    // shifts one counter along, so the diff blames the LAST anonymous node
    // (which nobody touched) and silently re-attributes the first one's
    // content to the node that used to hold that counter.
    const strip = (node: any): any => {
      const { uuid: _drop, block, ...rest } = node;
      return block ? { ...rest, block: block.map(strip) } : rest;
    };
    const stripped = diffKeys(strip(before), strip(after));
    expect(stripped.added).toEqual(['__anon_2']);
    // __anon_2 in the new version is the UNCHANGED node at position 4.
    expect(stripped.toSteps.get('__anon_2')?.number).toBe(4);
    // And __anon_0 now means two different nodes on the two sides.
    expect(stripped.fromSteps.get('__anon_0')?.number).toBe(1);
    expect(stripped.toSteps.get('__anon_0')?.number).toBe(1);
    expect(stripped.fromSteps.get('__anon_1')?.number).toBe(3);
    expect(stripped.toSteps.get('__anon_1')?.number).toBe(2);
  });
});

describe('stepHeader', () => {
  it('names an anonymous node by the key that matched it', () => {
    const entry = collectSteps(anon('uuid-if-a', 1, 'if')).get('uuid:uuid-if-a')!;
    expect(stepHeader(entry)).toMatchObject({
      as: 'uuid:uuid-if-a',
      uuid: 'uuid-if-a',
      keyword: 'if',
      number: 1,
    });
  });

  it('still reports a named step by its own `as`', () => {
    const entry = collectSteps(named('a1b2c3d4', 4)).get('a1b2c3d4')!;
    expect(stepHeader(entry)).toMatchObject({ as: 'a1b2c3d4', number: 4, provider: 'logger' });
  });
});
