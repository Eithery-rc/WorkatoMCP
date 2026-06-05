import { describe, expect, it } from 'vitest';
import { TOOL_NAMES, TOOL_SCHEMAS } from 'workatomcp-shared';

describe('workato_rename_recipe schema', () => {
  it('advertises recipe id and new name as required parameters', () => {
    expect(TOOL_NAMES.WORKATO.RENAME_RECIPE).toBe('workato_rename_recipe');

    const schema = TOOL_SCHEMAS.find((tool) => tool.name === TOOL_NAMES.WORKATO.RENAME_RECIPE);
    expect(schema).toBeDefined();
    expect(schema?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        recipe_id: { type: 'number' },
        name: { type: 'string' },
        tabId: { type: 'number' },
      },
      required: ['recipe_id', 'name'],
    });
  });
});
