import { describe, expect, it } from 'vitest';
import { TOOL_NAMES, TOOL_SCHEMAS } from 'workatomcp-shared';

describe('recipe lifecycle schemas', () => {
  it('advertises start and stop recipe tools', () => {
    expect(TOOL_NAMES.WORKATO.START_RECIPE).toBe('workato_start_recipe');
    expect(TOOL_NAMES.WORKATO.STOP_RECIPE).toBe('workato_stop_recipe');

    const startSchema = TOOL_SCHEMAS.find((tool) => tool.name === TOOL_NAMES.WORKATO.START_RECIPE);
    const stopSchema = TOOL_SCHEMAS.find((tool) => tool.name === TOOL_NAMES.WORKATO.STOP_RECIPE);

    expect(startSchema?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        recipe_id: { type: 'number' },
        tabId: { type: 'number' },
      },
      required: ['recipe_id'],
    });
    expect(stopSchema?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        recipe_id: { type: 'number' },
        force: { type: 'boolean' },
        tabId: { type: 'number' },
      },
      required: ['recipe_id'],
    });
  });
});
