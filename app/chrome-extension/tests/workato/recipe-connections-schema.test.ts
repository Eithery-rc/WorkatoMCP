import { describe, expect, it } from 'vitest';
import { TOOL_NAMES, TOOL_SCHEMAS } from 'workatomcp-shared';

function schemaFor(name: string) {
  return TOOL_SCHEMAS.find((tool) => tool.name === name);
}

describe('workato_recipe_connections schema', () => {
  it('advertises the tool', () => {
    expect(TOOL_NAMES.WORKATO.RECIPE_CONNECTIONS).toBe('workato_recipe_connections');

    const schema = schemaFor(TOOL_NAMES.WORKATO.RECIPE_CONNECTIONS);
    expect(schema?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        recipe_id: { type: 'number' },
        tabId: { type: 'number' },
        windowId: { type: 'number' },
      },
      required: ['recipe_id'],
    });
  });

  it('describes the status values and the no-credentials rule', () => {
    const description = schemaFor(TOOL_NAMES.WORKATO.RECIPE_CONNECTIONS)?.description ?? '';
    expect(description).toContain('not_required');
    expect(description).toContain('healthy');
    expect(description).toContain('Credentials');
  });

  it('stays inside the served description budget', () => {
    for (const name of [
      TOOL_NAMES.WORKATO.RECIPE_CONNECTIONS,
      TOOL_NAMES.WORKATO.START_RECIPE,
      TOOL_NAMES.WORKATO.STOP_RECIPE,
      TOOL_NAMES.WORKATO.RECIPE_STATUS,
    ]) {
      const description = schemaFor(name)?.description ?? '';
      expect(new TextEncoder().encode(description).length).toBeLessThan(2048);
    }
  });
});

describe('lifecycle and status schemas describe the new outcome fields', () => {
  it('start describes outcome and start_error', () => {
    const description = schemaFor(TOOL_NAMES.WORKATO.START_RECIPE)?.description ?? '';
    expect(description).toContain('outcome');
    expect(description).toContain('start_error');
    expect(description).toContain('config_errors');
  });

  it('stop describes outcome without promising a start diagnosis', () => {
    const description = schemaFor(TOOL_NAMES.WORKATO.STOP_RECIPE)?.description ?? '';
    expect(description).toContain('outcome');
    expect(description).toContain('state_reached');
    expect(description).not.toContain('start_error');
  });

  it('recipe_status describes the activation record', () => {
    const description = schemaFor(TOOL_NAMES.WORKATO.RECIPE_STATUS)?.description ?? '';
    expect(description).toContain('activation');
    expect(description).toContain('error_message');
  });
});
