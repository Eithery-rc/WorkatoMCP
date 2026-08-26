/**
 * @fileoverview Schema contract tests for the tools added alongside the
 * Workflow App work: adapter meta, save-with-dependents, the callable schema
 * pair, the datapill builder, and the lookup-row upsert.
 */

import { describe, expect, it } from 'vitest';
import { TOOL_NAMES, TOOL_SCHEMAS } from 'workatomcp-shared';

function schemaFor(name: string) {
  return TOOL_SCHEMAS.find((tool) => tool.name === name);
}

describe('new Workato tool schemas', () => {
  it('advertises workato_adapter_meta requiring only the adapter name', () => {
    expect(TOOL_NAMES.WORKATO.ADAPTER_META).toBe('workato_adapter_meta');
    const schema = schemaFor(TOOL_NAMES.WORKATO.ADAPTER_META);
    expect(schema).toBeDefined();
    expect(schema?.inputSchema.required).toEqual(['adapter']);
    const props = schema?.inputSchema.properties as Record<string, unknown>;
    for (const key of ['adapter', 'operation', 'field_grep', 'include_help', 'raw', 'out_file']) {
      expect(props[key]).toBeDefined();
    }
  });

  it('advertises workato_recipe_save_with_dependents with both discovery routes', () => {
    const schema = schemaFor(TOOL_NAMES.WORKATO.SAVE_WITH_DEPENDENTS);
    expect(schema).toBeDefined();
    expect(schema?.inputSchema.required).toEqual(['recipe_id']);
    const props = schema?.inputSchema.properties as Record<string, any>;
    expect(props.dependent_recipe_ids).toMatchObject({ type: 'array' });
    expect(props.scan_folder_id).toMatchObject({ type: 'number' });
    expect(props.code_path).toMatchObject({ type: 'string' });
    // The refusal-rather-than-guess behaviour has to be discoverable.
    expect(schema?.description).toMatch(/REFUSED/);
  });

  it('advertises the callable schema pair', () => {
    const set = schemaFor(TOOL_NAMES.WORKATO.CALLABLE_SCHEMA_SET);
    expect(set).toBeDefined();
    expect(set?.inputSchema.required).toEqual(['recipe_id']);
    const setProps = set?.inputSchema.properties as Record<string, any>;
    expect(setProps.parameters).toMatchObject({ type: 'array' });
    expect(setProps.results).toMatchObject({ type: 'array' });
    expect(set?.description).toMatch(/result: null/);

    const bind = schemaFor(TOOL_NAMES.WORKATO.CALLER_BIND);
    expect(bind).toBeDefined();
    const bindProps = bind?.inputSchema.properties as Record<string, any>;
    expect(bindProps.callee_recipe_id).toBeDefined();
    expect(bindProps.step).toBeDefined();
  });

  it('tells the calling model to keep version comments client-neutral', () => {
    for (const name of [
      TOOL_NAMES.WORKATO.SAVE_WITH_DEPENDENTS,
      TOOL_NAMES.WORKATO.CALLABLE_SCHEMA_SET,
      TOOL_NAMES.WORKATO.CALLER_BIND,
    ]) {
      const comment = (schemaFor(name)?.inputSchema.properties as Record<string, any>).comment;
      expect(comment.description).toMatch(/CLIENT-VISIBLE/);
      expect(comment.description).toMatch(/neutral/);
    }
  });

  it('advertises workato_datapill with all three payload dialects', () => {
    const schema = schemaFor(TOOL_NAMES.WORKATO.DATAPILL);
    expect(schema).toBeDefined();
    expect(schema?.inputSchema.required).toEqual([]);
    const props = schema?.inputSchema.properties as Record<string, any>;
    expect(props.kind.enum).toEqual(['recipe', 'widget', 'variable']);
    expect(props.mode.enum).toEqual(['interpolated', 'formula']);
    expect(props.widget_id).toBeDefined();
    expect(props.variable_id.description).toMatch(/page-variable/);
    expect(props.shorthand).toBeDefined();
  });

  it('advertises workato_lookup_table_row_upsert keyed by column label', () => {
    const schema = schemaFor(TOOL_NAMES.WORKATO_LOOKUP.ROW_UPSERT);
    expect(schema).toBeDefined();
    expect(schema?.inputSchema.required).toEqual(['table_id', 'key_column', 'key_value']);
    // Refusing on duplicates is the whole point; keep it in the description.
    expect(schema?.description).toMatch(/MORE THAN ONE IS REFUSED/);
  });

  it('makes the job_trace per-step untruncated mode unmissable', () => {
    const schema = schemaFor(TOOL_NAMES.WORKATO.JOB_TRACE);
    expect(schema?.description).toMatch(/detail:'full' PLUS lines/);
    expect(schema?.description).toMatch(/there is no `step` parameter/);
  });

  it('registers every new tool name exactly once', () => {
    const names = TOOL_SCHEMAS.map((t) => t.name);
    for (const name of [
      TOOL_NAMES.WORKATO.ADAPTER_META,
      TOOL_NAMES.WORKATO.SAVE_WITH_DEPENDENTS,
      TOOL_NAMES.WORKATO.CALLABLE_SCHEMA_SET,
      TOOL_NAMES.WORKATO.CALLER_BIND,
      TOOL_NAMES.WORKATO.DATAPILL,
      TOOL_NAMES.WORKATO_LOOKUP.ROW_UPSERT,
    ]) {
      expect(names.filter((n) => n === name)).toHaveLength(1);
    }
  });
});
