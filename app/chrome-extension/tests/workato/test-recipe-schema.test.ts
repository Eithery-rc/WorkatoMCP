import { describe, expect, it } from 'vitest';
import { TOOL_NAMES, TOOL_SCHEMAS } from 'workatomcp-shared';

function schemaFor(name: string) {
  return TOOL_SCHEMAS.find((tool) => tool.name === name);
}

describe('workato_test_recipe schema', () => {
  it('advertises the tool with recipe_id as its only required param', () => {
    expect(TOOL_NAMES.WORKATO.TEST_RECIPE).toBe('workato_test_recipe');
    const schema = schemaFor(TOOL_NAMES.WORKATO.TEST_RECIPE);
    expect(schema).toBeDefined();
    expect(schema?.inputSchema.required).toEqual(['recipe_id']);

    const props = schema?.inputSchema.properties as Record<string, any>;
    expect(props.action).toMatchObject({ type: 'string', enum: ['run', 'stop', 'status'] });
    expect(props.trigger_input).toMatchObject({ type: 'object' });
    expect(props.allow_writes).toMatchObject({ type: 'boolean', default: false });
    expect(props.wait).toMatchObject({ type: 'boolean', default: true });
    expect(props.wait_timeout_ms).toMatchObject({ type: 'number', maximum: 110000 });
    expect(props.tabId).toMatchObject({ type: 'number' });
  });

  it('states the write gate, the pending-on-timeout behaviour and the pub_sub publish path', () => {
    const description = schemaFor(TOOL_NAMES.WORKATO.TEST_RECIPE)?.description ?? '';
    expect(description).toMatch(/allow_writes:true is required/);
    expect(description).toMatch(/"pending"/);
    expect(description).toMatch(/publish_to_topic/);
    expect(description).toMatch(/workato_job_trace/);
    // The description is all the agent sees; keep it under the served limit.
    expect(Buffer.byteLength(description, 'utf8')).toBeLessThan(1500);
  });

  it('tells call_action callers that an adapter name is not a connection id', () => {
    const description = schemaFor(TOOL_NAMES.WORKATO.CALL_ACTION)?.description ?? '';
    expect(description).toMatch(/workato_test_recipe/);
  });
});
