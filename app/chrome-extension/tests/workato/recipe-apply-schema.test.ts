import { describe, expect, it } from 'vitest';
import { TOOL_NAMES, TOOL_SCHEMAS } from 'workatomcp-shared';

const schemaFor = (name: string) => TOOL_SCHEMAS.find((tool) => tool.name === name);
const propsOf = (name: string): Record<string, any> =>
  (schemaFor(name)?.inputSchema as any)?.properties ?? {};

describe('workato_recipe_apply schema', () => {
  it('is advertised with a bounded changes array', () => {
    expect(TOOL_NAMES.WORKATO_RECIPE.APPLY).toBe('workato_recipe_apply');
    const schema = schemaFor(TOOL_NAMES.WORKATO_RECIPE.APPLY);
    expect(schema).toBeDefined();
    expect(schema?.inputSchema).toMatchObject({
      type: 'object',
      required: ['recipe_id', 'changes'],
    });
    const changes = propsOf(TOOL_NAMES.WORKATO_RECIPE.APPLY).changes;
    expect(changes).toMatchObject({ type: 'array', minItems: 1, maxItems: 50 });
    expect(changes.items.required).toEqual(['op']);
    expect(changes.items.properties.op.enum).toEqual([
      'set_input',
      'delete_input',
      'set_extended_schema',
      'set_py_eval_code',
      'map_datapill',
      'insert_step',
      'remove_step',
      'move_step',
      'set_loop_source',
      'bind_connection',
    ]);
  });

  it('carries the save modifiers and the batch controls', () => {
    const props = propsOf(TOOL_NAMES.WORKATO_RECIPE.APPLY);
    for (const key of [
      'expected_base_version_no',
      'dry_run',
      'idempotency_key',
      'comment',
      'restart_if_running',
      'ensure_running',
      'verify_readback',
      'tabId',
      'windowId',
    ]) {
      expect(props[key], `missing property ${key}`).toBeDefined();
    }
  });

  it('addresses a step by number, anchor, or uuid', () => {
    const items = propsOf(TOOL_NAMES.WORKATO_RECIPE.APPLY).changes.items;
    expect(items.properties.step.oneOf).toEqual([{ type: 'string' }, { type: 'number' }]);
    expect(items.properties.anchor.properties.mode.enum).toEqual(['after', 'before', 'into']);
    expect(items.properties.anchor.properties.position.enum).toEqual(['first', 'last']);
  });
});

describe('legacy mutator schemas after the reroute', () => {
  it('add_step advertises the code-tree keywords, not repeat_each or return_result', () => {
    const props = propsOf(TOOL_NAMES.WORKATO_RECIPE.ADD_STEP);
    expect(props.keyword.enum).toEqual(['action', 'if', 'foreach', 'repeat', 'try', 'stop']);
    expect(props.anchor).toBeDefined();
    expect(props.connection_id).toBeDefined();
    expect(props.after_step.oneOf).toEqual([{ type: 'number' }, { type: 'string' }]);
    expect((schemaFor(TOOL_NAMES.WORKATO_RECIPE.ADD_STEP)?.inputSchema as any).required).toEqual([
      'recipe_id',
    ]);
  });

  it('add_step no longer claims it deduplicates the config array', () => {
    const description = schemaFor(TOOL_NAMES.WORKATO_RECIPE.ADD_STEP)?.description ?? '';
    expect(description).not.toContain('deduplicates');
    expect(description).toContain('MERGED');
  });

  it('the three legacy names carry the guarded-engine save modifiers', () => {
    for (const name of [
      TOOL_NAMES.WORKATO_RECIPE.ADD_STEP,
      TOOL_NAMES.WORKATO_RECIPE.SET_STEP_INPUT,
      TOOL_NAMES.WORKATO_RECIPE.MAP_DATAPILL,
    ]) {
      const props = propsOf(name);
      for (const key of ['expected_base_version_no', 'comment', 'verify_readback', 'dry_run']) {
        expect(props[key], `${name} is missing ${key}`).toBeDefined();
      }
    }
  });
});

describe('surgical mutator schemas', () => {
  it('delete_input_path, set_py_eval_code and set_extended_schema advertise the forwarded save modifiers', () => {
    for (const name of [
      TOOL_NAMES.WORKATO_RECIPE.DELETE_INPUT_PATH,
      TOOL_NAMES.WORKATO_RECIPE.SET_PY_EVAL_CODE,
      TOOL_NAMES.WORKATO_RECIPE.SET_EXTENDED_SCHEMA,
    ]) {
      const props = propsOf(name);
      for (const key of [
        'restart_if_running',
        'ensure_running',
        'comment',
        'expected_base_version_no',
        'verify_readback',
      ]) {
        expect(props[key], `${name} is missing ${key}`).toBeDefined();
      }
    }
  });
});

describe('recipe tool descriptions stay inside the served budget', () => {
  it('keeps every workato_recipe_* description under 1500 bytes', () => {
    for (const tool of TOOL_SCHEMAS) {
      if (!tool.name.startsWith('workato_recipe_')) continue;
      const size = Buffer.byteLength(tool.description ?? '', 'utf8');
      expect(size, `${tool.name} description is ${size} bytes`).toBeLessThanOrEqual(1500);
    }
  });
});
