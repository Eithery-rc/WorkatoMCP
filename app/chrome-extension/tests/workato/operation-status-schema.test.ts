import { describe, expect, it } from 'vitest';
import { TOOL_NAMES, TOOL_SCHEMAS } from 'workatomcp-shared';

function schemaFor(name: string) {
  return TOOL_SCHEMAS.find((tool) => tool.name === name);
}

describe('workato_operation_status schema', () => {
  it('advertises the tool with no required argument', () => {
    expect(TOOL_NAMES.WORKATO.OPERATION_STATUS).toBe('workato_operation_status');

    const schema = schemaFor(TOOL_NAMES.WORKATO.OPERATION_STATUS);
    expect(schema?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        operation_id: { type: 'string' },
        list: { type: 'boolean' },
        limit: { type: 'number' },
        refresh: { type: 'boolean' },
        resume: { type: 'boolean' },
        tabId: { type: 'number' },
      },
      required: [],
    });
  });

  it('says what resume will and will not do', () => {
    const description = schemaFor(TOOL_NAMES.WORKATO.OPERATION_STATUS)?.description ?? '';
    expect(description).toContain('already_applied');
    expect(description).toContain('leaves previously stopped recipes stopped');
    expect(description).toContain('never rolls back');
    // resume writes; the argument that turns it on has to say so out loud.
    const resume = (schemaFor(TOOL_NAMES.WORKATO.OPERATION_STATUS)?.inputSchema as any)?.properties
      ?.resume?.description;
    expect(resume).toContain('WRITES');
  });

  it('the list path is bounded', () => {
    const limit = (schemaFor(TOOL_NAMES.WORKATO.OPERATION_STATUS)?.inputSchema as any)?.properties
      ?.limit?.description;
    expect(limit).toMatch(/Default 10, max 50/);
  });
});

describe('workato_recipe_save_with_dependents schema', () => {
  it('advertises async, the connection preflight and the operation_id', () => {
    const schema = schemaFor(TOOL_NAMES.WORKATO.SAVE_WITH_DEPENDENTS);
    expect(schema?.inputSchema).toMatchObject({
      properties: {
        async: { type: 'boolean' },
        preflight_connections: { type: 'boolean' },
      },
    });
    const description = schema?.description ?? '';
    expect(description).toContain('operation_id');
    expect(description).toContain('workato_operation_status');
    expect(description).toContain('INCOMPLETE');
  });

  it("documents that the version lock defaults to the callee's current version", () => {
    const lock = (schemaFor(TOOL_NAMES.WORKATO.SAVE_WITH_DEPENDENTS)?.inputSchema as any)
      ?.properties?.expected_base_version_no?.description;
    expect(lock).toMatch(/Defaults to the callee's current version/);
    expect(lock).toMatch(/cannot create a second version/);
  });
});

describe('description budget', () => {
  it('stays inside the served limit', () => {
    for (const name of [
      TOOL_NAMES.WORKATO.OPERATION_STATUS,
      TOOL_NAMES.WORKATO.SAVE_WITH_DEPENDENTS,
    ]) {
      const description = schemaFor(name)?.description ?? '';
      expect(new TextEncoder().encode(description).length).toBeLessThan(1500);
    }
  });
});
