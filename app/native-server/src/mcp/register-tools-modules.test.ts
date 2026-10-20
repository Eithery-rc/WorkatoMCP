import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { CORE_TOOL_SCHEMAS, TOOL_SCHEMAS } from '@mokuhub/mokutab-shared';
import { INSTALLED_MODULES } from '../modules';
import { profileRegistry } from '../server/profile-registry';
import { createToolRouter } from './register-tools';

/** A module switch held in memory: everything on unless listed. */
function memorySwitch(off: string[] = []) {
  const disabled = new Set(off);
  return {
    isEnabled: (id: string) => !disabled.has(id),
    turn: (id: string, on: boolean) => (on ? disabled.delete(id) : disabled.add(id)),
  };
}

const text = (result: any) => (result.content?.[0]?.text ?? '') as string;

afterEach(() => {
  jest.restoreAllMocks();
});

describe('tools/list follows the module switch', () => {
  test('Workato on: core plus every Workato tool, as before the split', async () => {
    const { tools } = await createToolRouter({ switch: memorySwitch() }).listTools();
    const workato = INSTALLED_MODULES.find((module) => module.id === 'workato')!;
    expect(tools).toHaveLength(CORE_TOOL_SCHEMAS.length + workato.tools.length);
    expect(tools).toHaveLength(TOOL_SCHEMAS.length);
    expect(new Set(tools.map((tool) => tool.name))).toEqual(
      new Set(TOOL_SCHEMAS.map((tool) => tool.name)),
    );
  });

  test('Workato off: the core tools only', async () => {
    const { tools } = await createToolRouter({ switch: memorySwitch(['workato']) }).listTools();
    expect(tools).toHaveLength(CORE_TOOL_SCHEMAS.length);
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      CORE_TOOL_SCHEMAS.map((tool) => tool.name).sort(),
    );
    // The four profile/bridge tools are core and stay.
    for (const name of [
      'workato_list_profiles',
      'workato_switch_profile',
      'workato_bridge_info',
      'workato_reload_extension',
    ]) {
      expect(tools.some((tool) => tool.name === name)).toBe(true);
    }
  });

  test('a switch flipped mid-session changes the next listing', async () => {
    const switches = memorySwitch();
    const router = createToolRouter({ switch: switches });
    expect((await router.listTools()).tools).toHaveLength(TOOL_SCHEMAS.length);
    switches.turn('workato', false);
    expect((await router.listTools()).tools).toHaveLength(CORE_TOOL_SCHEMAS.length);
    switches.turn('workato', true);
    expect((await router.listTools()).tools).toHaveLength(TOOL_SCHEMAS.length);
  });
});

describe('a switched-off module refuses its tools', () => {
  test('names the module and the popup, never "Tool not found", and sends nothing', async () => {
    jest.spyOn(profileRegistry, 'getConnectedProfiles').mockReturnValue(['personal']);
    jest.spyOn(profileRegistry, 'getActiveProfile').mockReturnValue('personal');
    const sendRequest = jest.spyOn(profileRegistry, 'sendRequest');
    const router = createToolRouter({ switch: memorySwitch(['workato']) });

    for (const name of ['workato_pull_recipe', 'workato_datapill', 'workato_recipe_apply']) {
      const result = await router.handleToolCall(name, { recipe_id: 1 });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain(name);
      expect(text(result)).toContain('Workato module');
      expect(text(result)).toContain('MokuTab popup (Modules)');
      expect(text(result)).not.toMatch(/not found/i);
    }
    expect(sendRequest).not.toHaveBeenCalled();
  });

  test('core tools keep working while Workato is off', async () => {
    jest.spyOn(profileRegistry, 'getConnectedProfiles').mockReturnValue(['personal']);
    jest.spyOn(profileRegistry, 'getActiveProfile').mockReturnValue('personal');
    const sendRequest = jest.spyOn(profileRegistry, 'sendRequest').mockResolvedValue({
      status: 'success',
      data: { content: [{ type: 'text', text: 'ok' }] },
    });
    const router = createToolRouter({ switch: memorySwitch(['workato']) });

    const result = await router.handleToolCall('get_windows_and_tabs', {});
    expect(result.isError).toBeFalsy();
    expect(sendRequest).toHaveBeenCalledTimes(1);
  });

  test('a pin made while Workato is off is profile + tab only, with no workspace probe', async () => {
    jest.spyOn(profileRegistry, 'getConnectedProfiles').mockReturnValue(['personal']);
    const sendRequest = jest.spyOn(profileRegistry, 'sendRequest');
    const router = createToolRouter({ switch: memorySwitch(['workato']) });

    const result = await router.handleToolCall('workato_switch_profile', {
      profile: 'personal',
      tabId: 5,
    });
    expect(sendRequest).not.toHaveBeenCalled();
    expect(text(result)).toContain('profile context: "personal" and tab ID: 5');
    const summary = JSON.parse(text(result).split('\n')[1]).session_context;
    expect(Object.keys(summary)).toEqual(['profile', 'tab_id', 'pinned_at']);
  });

  test('workato_bridge_info counts the catalogue that is actually served', async () => {
    const off = await createToolRouter({ switch: memorySwitch(['workato']) }).handleToolCall(
      'workato_bridge_info',
      {},
    );
    const on = await createToolRouter({ switch: memorySwitch() }).handleToolCall(
      'workato_bridge_info',
      {},
    );
    const offInfo = JSON.parse(text(off));
    const onInfo = JSON.parse(text(on));
    expect(offInfo.tool_count).toBe(CORE_TOOL_SCHEMAS.length);
    expect(onInfo.tool_count).toBe(TOOL_SCHEMAS.length);
    expect(offInfo.schema_revision).not.toBe(onInfo.schema_revision);
  });
});
