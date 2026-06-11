import { describe, expect, it } from 'vitest';
import { TOOL_NAMES, TOOL_SCHEMAS } from 'workatomcp-shared';

describe('workato_set_version_comment schema', () => {
  it('advertises recipe id, version, and comment as required parameters', () => {
    expect(TOOL_NAMES.WORKATO.SET_VERSION_COMMENT).toBe('workato_set_version_comment');

    const schema = TOOL_SCHEMAS.find(
      (tool) => tool.name === TOOL_NAMES.WORKATO.SET_VERSION_COMMENT,
    );
    expect(schema).toBeDefined();
    expect(schema?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        recipe_id: { type: 'number' },
        version: { type: 'number' },
        comment: { type: 'string' },
        tabId: { type: 'number' },
      },
      required: ['recipe_id', 'version', 'comment'],
    });
  });
});
