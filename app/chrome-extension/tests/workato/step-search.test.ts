/**
 * @fileoverview Tests for workato_recipe_step_search's tree walk — the part
 * that decides what counts as a matching step.
 *
 * The walk is deliberately generic over nesting because control-flow blocks
 * use different key names, and a step buried inside an if/repeat_each is
 * exactly the example worth finding.
 */

import { describe, expect, it } from 'vitest';

import {
  collectMatchingSteps,
  hitsForCandidate,
} from '@/entrypoints/background/tools/workato/step-search';

/** Shaped like a real /recipes/<id>/code.json body: trigger at the root, steps in `block`. */
const CODE_TREE = {
  number: 0,
  provider: 'workato_workflow_task',
  name: 'new_task',
  as: 'aa11bb22',
  keyword: 'trigger',
  input: { task_type: 'form' },
  block: [
    {
      number: 1,
      keyword: 'action',
      provider: 'email',
      name: 'send_mail',
      as: 'c0a385ab',
      description: 'Notify the requester',
      input: {
        to: '#{_dp(\'{"pill_type":"output","provider":"workato_workflow_task"}\')}',
        subject: 'Request received',
        email_type: 'html',
      },
      extended_output_schema: [{ name: 'remaining_calls', type: 'integer' }],
    },
    {
      number: 2,
      keyword: 'if',
      // A condition can name a provider inside `input`; that is data, not a step.
      input: { conditions: [{ provider: 'email', operand: 'present' }] },
      block: [
        {
          number: 3,
          keyword: 'action',
          provider: 'email',
          name: 'send_mail',
          as: 'd4e5f6a7',
          input: { to: 'ops@example.com', subject: 'Escalation', bcc: 'audit@example.com' },
        },
        {
          number: 4,
          keyword: 'action',
          provider: 'salesforce',
          name: 'create_object',
          as: 'b8c9d0e1',
          input: { sobject_name: 'Case' },
        },
      ],
    },
  ],
};

describe('collectMatchingSteps', () => {
  it('finds steps at every depth, including inside an if block', () => {
    const hits = collectMatchingSteps(CODE_TREE, 'email', null);
    expect(hits.map((h) => h.step_number)).toEqual([1, 3]);
  });

  it('does not mistake a provider named inside `input` for a step', () => {
    // Step 2's condition mentions provider "email" but is not an email step.
    const hits = collectMatchingSteps(CODE_TREE, 'email', null);
    expect(hits.every((h) => h.keyword === 'action')).toBe(true);
    expect(hits).toHaveLength(2);
  });

  it('filters by action name, case-insensitively', () => {
    expect(collectMatchingSteps(CODE_TREE, 'salesforce', 'CREATE_OBJECT')).toHaveLength(1);
    expect(collectMatchingSteps(CODE_TREE, 'salesforce', 'update_object')).toHaveLength(0);
  });

  it('returns the whole input block, which is the template being looked for', () => {
    const hit = collectMatchingSteps(CODE_TREE, 'email', 'send_mail')[0];
    expect(hit.input).toMatchObject({ subject: 'Request received', email_type: 'html' });
    expect(hit.as).toBe('c0a385ab');
    expect(hit.description).toBe('Notify the requester');
  });

  it('flags a step that carries its own schema', () => {
    const [first, second] = collectMatchingSteps(CODE_TREE, 'email', 'send_mail');
    expect(first.has_extended_schema).toBe(true);
    expect(second.has_extended_schema).toBeUndefined();
  });

  it('matches the trigger too, since a trigger is a step with keyword "trigger"', () => {
    const hits = collectMatchingSteps(CODE_TREE, 'workato_workflow_task', null);
    expect(hits).toEqual([
      expect.objectContaining({ step_number: 0, keyword: 'trigger', name: 'new_task' }),
    ]);
  });

  it('strips connection secrets out of the returned input', () => {
    const tree = {
      number: 1,
      keyword: 'action',
      provider: 'http',
      name: 'get',
      input: { url: 'https://example.com', access_token: 'abc123', label: 'keep me' },
    };
    const hit = collectMatchingSteps(tree, 'http', null)[0];
    expect(hit.input).toEqual({ url: 'https://example.com', label: 'keep me' });
  });

  it('returns nothing for an unused provider rather than throwing', () => {
    expect(collectMatchingSteps(CODE_TREE, 'slack', null)).toEqual([]);
    expect(collectMatchingSteps(null, 'slack', null)).toEqual([]);
    expect(collectMatchingSteps('not a tree', 'slack', null)).toEqual([]);
  });
});

describe('hitsForCandidate', () => {
  const candidate = {
    recipe_id: 76887741,
    recipe_name: 'Get Time Entries',
    folder_id: 30573643,
    code: JSON.stringify(CODE_TREE),
  };

  it('attaches the recipe identity to every hit, so an example can be opened', () => {
    const hits = hitsForCandidate(candidate, 'email', 'send_mail');
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({
      recipe_id: 76887741,
      recipe_name: 'Get Time Entries',
      folder_id: 30573643,
      step_number: 1,
    });
  });

  it('drops a candidate whose code does not parse instead of failing the search', () => {
    expect(hitsForCandidate({ ...candidate, code: '{not json' }, 'email', null)).toEqual([]);
  });
});

describe('secret handling in step inputs', () => {
  it('keeps a step url, which a connection response would have dropped', () => {
    const tree = {
      number: 1,
      keyword: 'action',
      provider: 'http',
      name: 'get',
      input: { url: 'https://api.example.com/v2/orders', method: 'GET' },
    };
    // The endpoint is the whole point of reading an HTTP step as an example.
    expect(collectMatchingSteps(tree, 'http', null)[0].input).toEqual({
      url: 'https://api.example.com/v2/orders',
      method: 'GET',
    });
  });

  it('redacts credentials embedded in a kept url', () => {
    const tree = {
      keyword: 'action',
      provider: 'http',
      name: 'get',
      input: { url: 'https://admin:hunter2@api.example.com/v2/orders' },
    };
    expect(collectMatchingSteps(tree, 'http', null)[0].input).toEqual({
      url: 'https://[redacted]@api.example.com/v2/orders',
    });
  });
});
