import { describe, expect, it } from 'vitest';
import { TOOL_NAMES, TOOL_SCHEMAS } from 'workatomcp-shared';

function schemaFor(name: string) {
  return TOOL_SCHEMAS.find((tool) => tool.name === name);
}

describe('copy/delete recipe tool schemas', () => {
  it('advertises workato_copy_recipe requiring recipe_id and folder_id', () => {
    expect(TOOL_NAMES.WORKATO.COPY_RECIPE).toBe('workato_copy_recipe');
    const schema = schemaFor(TOOL_NAMES.WORKATO.COPY_RECIPE);
    expect(schema).toBeDefined();
    expect(schema?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        recipe_id: { type: 'number' },
        folder_id: { type: 'number' },
        tabId: { type: 'number' },
      },
      required: ['recipe_id', 'folder_id'],
    });
    expect(schema?.description).toMatch(/copy\.json/);
  });

  it('advertises workato_delete_recipe requiring only recipe_id, with a no-undo warning', () => {
    expect(TOOL_NAMES.WORKATO.DELETE_RECIPE).toBe('workato_delete_recipe');
    const schema = schemaFor(TOOL_NAMES.WORKATO.DELETE_RECIPE);
    expect(schema).toBeDefined();
    expect(schema?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        recipe_id: { type: 'number' },
        tabId: { type: 'number' },
      },
      required: ['recipe_id'],
    });
    expect(schema?.description).toMatch(/no undo/i);
    expect(schema?.description).toMatch(/workato_stop_recipe/);
  });
});
