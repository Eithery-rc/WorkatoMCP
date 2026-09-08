import { describe, expect, it } from 'vitest';
import { TOOL_NAMES, TOOL_SCHEMAS } from 'workatomcp-shared';

function schemaFor(name: string) {
  return TOOL_SCHEMAS.find((tool) => tool.name === name);
}

describe('workato_properties schema', () => {
  const schema = schemaFor(TOOL_NAMES.WORKATO.PROPERTIES);

  it('is registered under the expected name', () => {
    expect(TOOL_NAMES.WORKATO.PROPERTIES).toBe('workato_properties');
    expect(schema).toBeDefined();
  });

  it('advertises every argument and requires none', () => {
    expect(schema?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'set', 'delete'], default: 'list' },
        scope: { type: 'string', enum: ['account', 'project'], default: 'account' },
        project_id: { type: 'number' },
        name: { type: 'string' },
        value: { type: 'string' },
        rename_to: { type: 'string' },
        expected_version_no: { type: 'string' },
        id: { type: 'number' },
        reveal: { type: 'boolean', default: false },
        tabId: { type: 'number' },
      },
      required: [],
    });
  });

  it('says what the write does, how values are masked, and which id project_id wants', () => {
    const description = schema?.description ?? '';
    expect(description).toMatch(/WRITE workspace configuration/);
    expect(description).toMatch(/job start/);
    expect(description).toMatch(/CLEAR/);
    expect(description).toMatch(/reveal:true/);
    expect(description).toMatch(/PROJECT id/);
    expect(description).toMatch(/NOT the/);
  });

  it('fits the tool description budget with room to spare', () => {
    expect(Buffer.byteLength(schema?.description ?? '', 'utf8')).toBeLessThan(1500);
  });

  it('carries no em-dash or en-dash anywhere', () => {
    expect(/[–—]/.test(JSON.stringify(schema))).toBe(false);
  });
});
