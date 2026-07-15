import { describe, expect, it } from 'vitest';
import { TOOL_NAMES, TOOL_SCHEMAS } from 'workatomcp-shared';

function schemaFor(name: string) {
  return TOOL_SCHEMAS.find((tool) => tool.name === name);
}

describe('folder/project tool schemas', () => {
  it('advertises workato_list_folders with optional project filter', () => {
    expect(TOOL_NAMES.WORKATO.LIST_FOLDERS).toBe('workato_list_folders');
    const schema = schemaFor(TOOL_NAMES.WORKATO.LIST_FOLDERS);
    expect(schema).toBeDefined();
    expect(schema?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        project: { type: 'string' },
        full: { type: 'boolean' },
        tabId: { type: 'number' },
      },
      required: [],
    });
  });

  it('advertises workato_create_folder requiring name and parent_id', () => {
    expect(TOOL_NAMES.WORKATO.CREATE_FOLDER).toBe('workato_create_folder');
    const schema = schemaFor(TOOL_NAMES.WORKATO.CREATE_FOLDER);
    expect(schema?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        name: { type: 'string' },
        parent_id: { type: 'number' },
        tabId: { type: 'number' },
      },
      required: ['name', 'parent_id'],
    });
  });

  it('advertises workato_update_folder requiring only folder_id', () => {
    expect(TOOL_NAMES.WORKATO.UPDATE_FOLDER).toBe('workato_update_folder');
    const schema = schemaFor(TOOL_NAMES.WORKATO.UPDATE_FOLDER);
    expect(schema?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        folder_id: { type: 'number' },
        name: { type: 'string' },
        parent_id: { type: 'number' },
        tabId: { type: 'number' },
      },
      required: ['folder_id'],
    });
  });

  it('advertises workato_delete_folder with a force flag and cascade warning', () => {
    expect(TOOL_NAMES.WORKATO.DELETE_FOLDER).toBe('workato_delete_folder');
    const schema = schemaFor(TOOL_NAMES.WORKATO.DELETE_FOLDER);
    expect(schema?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        folder_id: { type: 'number' },
        force: { type: 'boolean' },
        tabId: { type: 'number' },
      },
      required: ['folder_id'],
    });
    expect(schema?.description).toMatch(/CASCADES/);
  });

  it('advertises workato_move_recipe requiring recipe_id and folder_id', () => {
    expect(TOOL_NAMES.WORKATO.MOVE_RECIPE).toBe('workato_move_recipe');
    const schema = schemaFor(TOOL_NAMES.WORKATO.MOVE_RECIPE);
    expect(schema?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        recipe_id: { type: 'number' },
        folder_id: { type: 'number' },
        tabId: { type: 'number' },
      },
      required: ['recipe_id', 'folder_id'],
    });
  });

  it('advertises workato_update_project requiring only the root folder_id', () => {
    expect(TOOL_NAMES.WORKATO.UPDATE_PROJECT).toBe('workato_update_project');
    const schema = schemaFor(TOOL_NAMES.WORKATO.UPDATE_PROJECT);
    expect(schema?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        folder_id: { type: 'number' },
        name: { type: 'string' },
        color: { type: 'string' },
        icon: { type: 'string' },
        tabId: { type: 'number' },
      },
      required: ['folder_id'],
    });
  });

  it('advertises workato_create_project requiring name', () => {
    expect(TOOL_NAMES.WORKATO.CREATE_PROJECT).toBe('workato_create_project');
    const schema = schemaFor(TOOL_NAMES.WORKATO.CREATE_PROJECT);
    expect(schema?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        name: { type: 'string' },
        tabId: { type: 'number' },
      },
      required: ['name'],
    });
  });
});
