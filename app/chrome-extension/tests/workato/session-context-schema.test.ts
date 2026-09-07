import { describe, expect, it } from 'vitest';
import { TOOL_NAMES, TOOL_SCHEMAS } from 'workatomcp-shared';

const schema = (name: string) => TOOL_SCHEMAS.find((tool) => tool.name === name);
const props = (name: string) =>
  ((schema(name)?.inputSchema as { properties?: Record<string, unknown> })?.properties ??
    {}) as Record<string, { type?: string; description?: string }>;

describe('workato_session_context schema', () => {
  it('is advertised with the cheap-identity arguments', () => {
    expect(TOOL_NAMES.WORKATO_SESSION.SESSION_CONTEXT).toBe('workato_session_context');
    expect(schema(TOOL_NAMES.WORKATO_SESSION.SESSION_CONTEXT)?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        tabId: { type: 'number' },
        max_age_ms: { type: 'number' },
        refresh: { type: 'boolean' },
      },
    });
  });

  it('says how it differs from whoami and stays inside the description budget', () => {
    const description = schema(TOOL_NAMES.WORKATO_SESSION.SESSION_CONTEXT)?.description ?? '';
    expect(description).toMatch(/workato_whoami/);
    expect(description).toMatch(/workspace/);
    expect(new TextEncoder().encode(description).length).toBeLessThanOrEqual(1500);
  });

  it('sits next to whoami in the catalogue', () => {
    const names = TOOL_SCHEMAS.map((tool) => tool.name);
    expect(names.indexOf(TOOL_NAMES.WORKATO_SESSION.SESSION_CONTEXT)).toBe(
      names.indexOf(TOOL_NAMES.WORKATO_SESSION.WHOAMI) + 1,
    );
  });
});

describe('file round-trip overrides', () => {
  it('save_recipe_code documents both overrides', () => {
    const saveProps = props(TOOL_NAMES.WORKATO_UI.SAVE_RECIPE_CODE);
    expect(saveProps.ignore_file_version).toMatchObject({ type: 'boolean' });
    expect(saveProps.allow_context_mismatch).toMatchObject({ type: 'boolean' });
    expect(saveProps.expected_base_version_no?.description).toMatch(/code_path/);
  });

  it('set_py_eval_code documents both overrides', () => {
    const pyProps = props(TOOL_NAMES.WORKATO_RECIPE.SET_PY_EVAL_CODE);
    expect(pyProps.ignore_file_version).toMatchObject({ type: 'boolean' });
    expect(pyProps.allow_context_mismatch).toMatchObject({ type: 'boolean' });
  });

  it('pull_recipe out_file explains the origin block', () => {
    const outFile = props(TOOL_NAMES.WORKATO.PULL_RECIPE).out_file;
    expect(outFile?.description).toMatch(/origin/);
    expect(outFile?.description).toMatch(/workspace/);
  });
});

describe('profile routing descriptions', () => {
  it('switch_profile explains the pinned workspace and the no-fallback rule', () => {
    const description = schema(TOOL_NAMES.WORKATO.SWITCH_PROFILE)?.description ?? '';
    expect(description).toMatch(/workspace/);
    expect(description).toMatch(/never|not/i);
    expect(new TextEncoder().encode(description).length).toBeLessThanOrEqual(1500);
  });

  it('list_profiles advertises session_context', () => {
    const description = schema(TOOL_NAMES.WORKATO.LIST_PROFILES)?.description ?? '';
    expect(description).toMatch(/session_context/);
  });
});
