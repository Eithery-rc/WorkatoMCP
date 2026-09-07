import { describe, expect, test } from '@jest/globals';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { discoverCallers, parseCallerPayload } from './workato-recipe-callers';

/** The shape workato_recipe_callers returns: a summary line, then the JSON. */
const callersResult = (payload: unknown, summary = 'callers'): CallToolResult => ({
  isError: false,
  content: [{ type: 'text', text: `${summary}\n${JSON.stringify(payload)}` }],
});

const COMPLETE_PAYLOAD = {
  recipe_id: 999,
  sources: ['graph', 'code'],
  callers: [
    {
      recipe_id: 111,
      name: 'Get Time Entries',
      running: true,
      folder_id: 30573643,
      step: { as: 'tjcall01', number: 1, async: false },
      sources: ['graph', 'code'],
    },
    {
      recipe_id: 222,
      name: 'Process time entries',
      running: false,
      folder_id: 30573643,
      step: { as: 'tjcall02', number: 1, async: true },
      sources: ['code'],
    },
  ],
  unresolved_dynamic_targets: [],
  failed_reads: [],
  scope: {
    mode: 'folders',
    folder_ids: [30573643],
    recipes_listed: 4,
    recipes_read: 4,
    pages: 1,
    complete: true,
  },
  completeness: 'complete',
  completeness_reasons: [],
};

describe('parseCallerPayload', () => {
  test('reduces the caller rows to ids, names and running state', () => {
    const parsed = parseCallerPayload(COMPLETE_PAYLOAD as any);
    expect(parsed.details).toEqual([
      {
        recipe_id: 111,
        name: 'Get Time Entries',
        running: true,
        folder_id: 30573643,
        sources: ['graph', 'code'],
      },
      {
        recipe_id: 222,
        name: 'Process time entries',
        running: false,
        folder_id: 30573643,
        sources: ['code'],
      },
    ]);
    expect(parsed.completeness).toBe('complete');
  });

  test('keeps an unknown running state as null rather than guessing false', () => {
    const parsed = parseCallerPayload({ callers: [{ recipe_id: 5 }] } as any);
    expect(parsed.details[0]).toEqual({ recipe_id: 5, running: null, sources: [] });
  });

  test('treats anything but an explicit "complete" as partial', () => {
    expect(parseCallerPayload({} as any).completeness).toBe('partial');
    expect(parseCallerPayload({ completeness: 'partial' } as any).completeness).toBe('partial');
  });

  test('skips rows with no usable recipe id', () => {
    const parsed = parseCallerPayload({
      callers: [{ recipe_id: 'not a number' }, 'nonsense', { recipe_id: 7 }],
    } as any);
    expect(parsed.details.map((d) => d.recipe_id)).toEqual([7]);
  });
});

describe('discoverCallers', () => {
  test('asks for static evidence only and reports a complete scan', async () => {
    const calls: Array<{ name: string; args: any }> = [];
    const call = async (name: string, args: any): Promise<CallToolResult> => {
      calls.push({ name, args });
      return callersResult(COMPLETE_PAYLOAD);
    };

    const discovery = await discoverCallers(call, {
      recipe_id: 999,
      folder_ids: [30573643],
      tabId: 42,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('workato_recipe_callers');
    expect(calls[0].args).toEqual({
      recipe_id: 999,
      sources: ['graph', 'code'],
      include_callees: false,
      folder_ids: [30573643],
      tabId: 42,
    });
    expect(discovery.dependent_ids).toEqual([111, 222]);
    expect(discovery.running_count).toBe(1);
    expect(discovery.completeness).toBe('complete');
    expect(discovery.discovery_text).toBe('recipe_callers:folders(30573643):complete');
  });

  test('carries the partial reasons into the discovery text', async () => {
    const call = async (): Promise<CallToolResult> =>
      callersResult({
        ...COMPLETE_PAYLOAD,
        completeness: 'partial',
        completeness_reasons: ['2 recipe(s) could not be read', 'page cap reached'],
      });

    const discovery = await discoverCallers(call, { recipe_id: 999, scope: 'workspace' });
    expect(discovery.completeness).toBe('partial');
    expect(discovery.discovery_text).toBe(
      'recipe_callers:folders(30573643):partial (2 recipe(s) could not be read; page cap reached)',
    );
    expect(discovery.reasons).toHaveLength(2);
  });

  test('passes a project scope through', async () => {
    const calls: Array<{ name: string; args: any }> = [];
    const call = async (name: string, args: any): Promise<CallToolResult> => {
      calls.push({ name, args });
      return callersResult({ ...COMPLETE_PAYLOAD, scope: { mode: 'project', folder_ids: [1, 2] } });
    };
    const discovery = await discoverCallers(call, {
      recipe_id: 999,
      project_id: '15842038',
      scope: 'project',
    });
    expect(calls[0].args.project_id).toBe('15842038');
    expect(calls[0].args.scope).toBe('project');
    expect(discovery.discovery_text).toBe('recipe_callers:project(1,2):complete');
  });

  test('a failed discovery throws rather than reporting "no callers"', async () => {
    const call = async (): Promise<CallToolResult> => ({
      isError: true,
      content: [{ type: 'text', text: 'TabNotFound: no Workato tab' }],
    });
    await expect(discoverCallers(call, { recipe_id: 999, scope: 'workspace' })).rejects.toThrow(
      /TabNotFound/,
    );
  });
});
