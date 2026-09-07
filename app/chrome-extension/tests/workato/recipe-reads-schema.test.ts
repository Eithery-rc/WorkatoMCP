import { describe, expect, it } from 'vitest';
import { TOOL_NAMES, TOOL_SCHEMAS } from 'workatomcp-shared';

const schemaFor = (name: string) => TOOL_SCHEMAS.find((tool) => tool.name === name);

describe('workato_pull_recipe schema', () => {
  it('advertises the projection params', () => {
    const schema = schemaFor(TOOL_NAMES.WORKATO.PULL_RECIPE);
    expect(schema?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        recipe_id: { type: 'number' },
        view: { type: 'string', enum: ['compact', 'outline', 'full'] },
        step: { type: 'string' },
        steps: { type: 'array', items: { type: 'string' } },
        include: { type: 'array' },
        paths: { type: 'array', items: { type: 'string' } },
        fields: { type: 'string' },
        field_query: { type: 'string' },
        max_items: { type: 'number', minimum: 1, maximum: 500 },
        budget_chars: { type: 'number' },
        cursor: { type: 'string' },
        if_version: { type: 'number' },
        out_file: { type: 'string' },
        tabId: { type: 'number' },
      },
      required: ['recipe_id'],
    });
  });

  it('keeps the include enum in step with the handler', () => {
    const schema = schemaFor(TOOL_NAMES.WORKATO.PULL_RECIPE);
    const include = (schema?.inputSchema as any).properties.include;
    expect(include.items.enum).toEqual(['mappings', 'fields', 'datapills', 'schemas', 'code']);
  });

  it('no longer claims field_query lifts the item cap', () => {
    const schema = schemaFor(TOOL_NAMES.WORKATO.PULL_RECIPE);
    const props = (schema?.inputSchema as any).properties;
    expect(props.fields.description).toContain('does NOT lift [max_items]');
    expect(JSON.stringify(props.field_query.description)).not.toContain('Lifts');
  });
});

describe('workato_recipe_grep schema', () => {
  it('is registered with the documented params', () => {
    expect(TOOL_NAMES.WORKATO.RECIPE_GREP).toBe('workato_recipe_grep');
    const schema = schemaFor(TOOL_NAMES.WORKATO.RECIPE_GREP);
    expect(schema?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        recipe_id: { type: 'number' },
        query: { type: 'string' },
        match: { type: 'string', enum: ['substring', 'word', 'regex'] },
        scope: { type: 'string', enum: ['input', 'all'] },
        max_matches: { type: 'number', minimum: 1, maximum: 500 },
        cursor: { type: 'string' },
        snippet_chars: { type: 'number', minimum: 20, maximum: 2000 },
        tabId: { type: 'number' },
        windowId: { type: 'number' },
      },
      required: ['recipe_id', 'query'],
    });
  });
});

describe('read-tool descriptions stay within the served limit', () => {
  it('keeps each description under 1500 bytes', () => {
    for (const name of [TOOL_NAMES.WORKATO.PULL_RECIPE, TOOL_NAMES.WORKATO.RECIPE_GREP]) {
      const description = schemaFor(name)?.description ?? '';
      expect(new TextEncoder().encode(description).length).toBeLessThan(1500);
    }
  });
});
