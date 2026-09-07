import { describe, expect, it } from 'vitest';
import { TOOL_NAMES, TOOL_SCHEMAS } from 'workatomcp-shared';

describe('workato_recipe_callers schema', () => {
  const schema = TOOL_SCHEMAS.find((tool) => tool.name === TOOL_NAMES.WORKATO.RECIPE_CALLERS);

  it('is advertised under its own name', () => {
    expect(TOOL_NAMES.WORKATO.RECIPE_CALLERS).toBe('workato_recipe_callers');
    expect(schema).toBeDefined();
  });

  it('takes a recipe id and the scope, source and budget knobs', () => {
    expect(schema?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        recipe_id: { type: 'number' },
        sources: { type: 'array' },
        folder_ids: { type: 'array', items: { type: 'number' } },
        project_id: { type: 'string' },
        scope: { type: 'string', enum: ['folders', 'project', 'workspace'] },
        max_recipes: { type: 'number' },
        max_pages: { type: 'number' },
        include_transitive: { type: 'boolean' },
        include_callees: { type: 'boolean' },
        refresh: { type: 'boolean' },
        jobs_limit: { type: 'number' },
        timeout_ms: { type: 'number' },
        tabId: { type: 'number' },
      },
      required: ['recipe_id'],
    });
  });

  it('describes the sources and says partial means partial', () => {
    expect(schema?.description).toMatch(/graph/);
    expect(schema?.description).toMatch(/call_recipe/);
    expect(schema?.description).toMatch(/EXECUTION HISTORY/);
    expect(schema?.description).toMatch(/partial/);
  });

  it('stays inside the served description budget', () => {
    expect(Buffer.byteLength(schema?.description ?? '', 'utf8')).toBeLessThanOrEqual(1500);
  });
});

describe('workato_recipe_save_with_dependents scan scope', () => {
  const schema = TOOL_SCHEMAS.find((tool) => tool.name === TOOL_NAMES.WORKATO.SAVE_WITH_DEPENDENTS);

  it('keeps scan_folder_id and adds the wider scopes', () => {
    expect(schema?.inputSchema).toMatchObject({
      properties: {
        dependent_recipe_ids: { type: 'array' },
        scan_folder_id: { type: 'number' },
        scan_folder_ids: { type: 'array', items: { type: 'number' } },
        scan_project_id: { type: 'string' },
        scan_scope: { type: 'string', enum: ['folders', 'project', 'workspace'] },
      },
      required: ['recipe_id'],
    });
  });

  it('names the discovery tool it now delegates to', () => {
    expect(schema?.description).toMatch(/workato_recipe_callers/);
  });
});
