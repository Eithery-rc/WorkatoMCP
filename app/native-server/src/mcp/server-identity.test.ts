import { describe, expect, test } from '@jest/globals';
import { TOOL_NAMES, TOOL_SCHEMAS } from 'workatomcp-shared';
import { SERVER_INSTRUCTIONS, SERVER_NAME, serverVersion } from './server-identity';

/**
 * Tools the instructions name that this wave is still adding in a parallel
 * package. They are deliberately advertised ahead of their schemas so the
 * guidance ships whole; when their packages merge, they leave this list and
 * the assertion below starts covering them.
 */
const PENDING_TOOL_NAMES: string[] = [];

function toolNamesInInstructions(): string[] {
  return [...new Set(SERVER_INSTRUCTIONS.match(/workato_[a-z0-9_]+/g) ?? [])];
}

function allToolNames(): Set<string> {
  const names = new Set<string>();
  for (const family of Object.values(TOOL_NAMES)) {
    for (const name of Object.values(family as Record<string, string>)) names.add(name);
  }
  return names;
}

describe('server identity', () => {
  test('the handshake names the product, not the upstream project', () => {
    expect(SERVER_NAME).toBe('WorkatoMCP');
  });

  test('the version is the real bridge version, never the old hardcoded 1.0.0', () => {
    const version = serverVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
    expect(version).not.toBe('1.0.0');
  });
});

describe('server instructions', () => {
  test('stay under the 1500-byte budget the plan sets', () => {
    const size = Buffer.byteLength(SERVER_INSTRUCTIONS, 'utf8');
    expect(size).toBeGreaterThan(200);
    expect(size).toBeLessThan(1500);
  });

  test('every tool they name is real, apart from the ones shipping in parallel', () => {
    const known = allToolNames();
    const unknown = toolNamesInInstructions().filter(
      (name) => !known.has(name) && !PENDING_TOOL_NAMES.includes(name),
    );
    expect(unknown).toEqual([]);
  });

  test('a pending tool that has landed must be removed from the pending list', () => {
    const known = allToolNames();
    const landed = PENDING_TOOL_NAMES.filter((name) => known.has(name));
    // A name listed here that now exists must be dropped from PENDING_TOOL_NAMES.
    expect(landed).toEqual([]);
  });

  test('cover the task-to-tool routes the plan asks for', () => {
    for (const name of [
      'workato_recipe_set_input_path',
      'workato_recipe_apply',
      'workato_recipe_grep',
      'workato_job_trace',
      'workato_list_jobs',
      'workato_recipe_callers',
      'workato_recipe_connections',
      'workato_recipe_save_with_dependents',
      'workato_operation_status',
      'workato_test_recipe',
      'workato_session_context',
      'workato_bridge_info',
    ]) {
      expect(SERVER_INSTRUCTIONS).toContain(name);
    }
    expect(SERVER_INSTRUCTIONS).toContain('auto_file');
  });

  test('carry no em-dash or en-dash', () => {
    expect(SERVER_INSTRUCTIONS).not.toMatch(/[–—]/);
  });

  test('name tools that are actually served, not names alone', () => {
    const served = new Set(TOOL_SCHEMAS.map((tool) => tool.name));
    const missing = toolNamesInInstructions().filter(
      (name) => !served.has(name) && !PENDING_TOOL_NAMES.includes(name),
    );
    expect(missing).toEqual([]);
  });
});
