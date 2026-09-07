import { describe, expect, it } from 'vitest';
import { TOOL_NAMES, TOOL_SCHEMAS } from 'workatomcp-shared';

const schemaFor = (name: string) => TOOL_SCHEMAS.find((tool) => tool.name === name);
const propsOf = (name: string): Record<string, any> =>
  (schemaFor(name)?.inputSchema as any)?.properties ?? {};

describe('workato_recipe_validate schema', () => {
  it('is advertised with the three sources and no required argument', () => {
    expect(TOOL_NAMES.WORKATO_RECIPE.VALIDATE).toBe('workato_recipe_validate');
    const schema = schemaFor(TOOL_NAMES.WORKATO_RECIPE.VALIDATE);
    expect(schema).toBeDefined();
    expect((schema?.inputSchema as any).required).toBeUndefined();
    const props = propsOf(TOOL_NAMES.WORKATO_RECIPE.VALIDATE);
    for (const key of ['recipe_id', 'code_path', 'code', 'config', 'tabId', 'windowId']) {
      expect(props[key], `missing property ${key}`).toBeDefined();
    }
    expect(props.code.type).toBe('object');
    expect(props.config.type).toBe('array');
  });

  it('states what it does not cover and that Workato has no validate endpoint', () => {
    const description = schemaFor(TOOL_NAMES.WORKATO_RECIPE.VALIDATE)?.description ?? '';
    expect(description).toContain('WITHOUT saving');
    expect(description).toContain('no validate-without-save endpoint');
    expect(description).toContain('formulas are Ruby and are not parsed');
    expect(description).toContain('nothing is executed');
    expect(description).toContain('Never writes');
  });
});

describe('auto_schema on the mutation tools', () => {
  it('is offered, and defaults to true, on apply, add_step and set_step_input', () => {
    for (const name of [
      TOOL_NAMES.WORKATO_RECIPE.APPLY,
      TOOL_NAMES.WORKATO_RECIPE.ADD_STEP,
      TOOL_NAMES.WORKATO_RECIPE.SET_STEP_INPUT,
    ]) {
      const autoSchema = propsOf(name).auto_schema;
      expect(autoSchema, `${name} is missing auto_schema`).toBeDefined();
      expect(autoSchema.type).toBe('boolean');
      expect(autoSchema.default).toBe(true);
      expect(autoSchema.description).toContain('Variables');
    }
  });

  it('the batch tool advertises the derive_schema operation', () => {
    const items = propsOf(TOOL_NAMES.WORKATO_RECIPE.APPLY).changes.items;
    expect(items.properties.op.enum).toContain('derive_schema');
    expect(schemaFor(TOOL_NAMES.WORKATO_RECIPE.APPLY)?.description).toContain('derive_schema');
  });
});
