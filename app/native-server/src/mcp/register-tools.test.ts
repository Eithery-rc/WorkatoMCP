import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { NativeMessageType } from 'workatomcp-shared';
import {
  createToolRouter,
  PROFILE_ROUTING_ARG,
  withProfileRoutingToolSchemas,
} from './register-tools';
import { profileRegistry } from '../server/profile-registry';

describe('register-tools profile routing', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('keeps workato_switch_profile scoped to each MCP router instance', async () => {
    jest.spyOn(profileRegistry, 'getConnectedProfiles').mockReturnValue(['centium', 'bluBanyan']);
    const sendRequest = jest.spyOn(profileRegistry, 'sendRequest').mockResolvedValue({
      status: 'success',
      data: { content: [{ type: 'text', text: 'ok' }] },
    });
    const firstRouter = createToolRouter();
    const secondRouter = createToolRouter();

    await firstRouter.handleToolCall('workato_switch_profile', { profile: 'centium' });
    await secondRouter.handleToolCall('workato_switch_profile', { profile: 'bluBanyan' });

    await firstRouter.handleToolCall('get_windows_and_tabs', {});
    await secondRouter.handleToolCall('get_windows_and_tabs', {});

    expect(sendRequest.mock.calls.map((call) => call[0])).toEqual(['centium', 'bluBanyan']);
  });

  test('routes a single tool call to args.profile without mutating session profile or forwarded args', async () => {
    jest.spyOn(profileRegistry, 'getConnectedProfiles').mockReturnValue(['centium', 'bluBanyan']);
    const sendRequest = jest.spyOn(profileRegistry, 'sendRequest').mockResolvedValue({
      status: 'success',
      data: { content: [{ type: 'text', text: 'ok' }] },
    });
    const router = createToolRouter();

    await router.handleToolCall('workato_switch_profile', { profile: 'bluBanyan' });
    await router.handleToolCall('get_windows_and_tabs', { profile: 'centium' });
    await router.handleToolCall('get_windows_and_tabs', {});

    expect(sendRequest.mock.calls.map((call) => call[0])).toEqual(['centium', 'bluBanyan']);
    expect(sendRequest.mock.calls[0]).toEqual([
      'centium',
      { name: 'get_windows_and_tabs', args: {} },
      NativeMessageType.CALL_TOOL,
      120000,
    ]);
  });

  test('pins a session tab id for subsequent Workato tool calls only', async () => {
    jest.spyOn(profileRegistry, 'getConnectedProfiles').mockReturnValue(['centium']);
    const sendRequest = jest.spyOn(profileRegistry, 'sendRequest').mockResolvedValue({
      status: 'success',
      data: { content: [{ type: 'text', text: 'ok' }] },
    });
    const router = createToolRouter();

    await router.handleToolCall('workato_switch_profile', { profile: 'centium', tabId: 42 });
    await router.handleToolCall('workato_whoami', {});
    await router.handleToolCall('get_windows_and_tabs', {});

    expect(sendRequest.mock.calls[0]).toEqual([
      'centium',
      { name: 'workato_whoami', args: { tabId: 42 } },
      NativeMessageType.CALL_TOOL,
      120000,
    ]);
    expect(sendRequest.mock.calls[1]).toEqual([
      'centium',
      { name: 'get_windows_and_tabs', args: {} },
      NativeMessageType.CALL_TOOL,
      120000,
    ]);
  });

  test('lets explicit tab or window targets override a pinned session tab id', async () => {
    jest.spyOn(profileRegistry, 'getConnectedProfiles').mockReturnValue(['centium']);
    const sendRequest = jest.spyOn(profileRegistry, 'sendRequest').mockResolvedValue({
      status: 'success',
      data: { content: [{ type: 'text', text: 'ok' }] },
    });
    const router = createToolRouter();

    await router.handleToolCall('workato_switch_profile', { profile: 'centium', tabId: 42 });
    await router.handleToolCall('workato_whoami', { tabId: 7 });
    await router.handleToolCall('workato_ui_list_steps', { windowId: 3 });

    expect(sendRequest.mock.calls[0]).toEqual([
      'centium',
      { name: 'workato_whoami', args: { tabId: 7 } },
      NativeMessageType.CALL_TOOL,
      120000,
    ]);
    expect(sendRequest.mock.calls[1]).toEqual([
      'centium',
      { name: 'workato_ui_list_steps', args: { windowId: 3 } },
      NativeMessageType.CALL_TOOL,
      120000,
    ]);
  });

  test('reports the session tab id in the profile listing', async () => {
    jest.spyOn(profileRegistry, 'getConnectedProfiles').mockReturnValue(['centium']);
    jest.spyOn(profileRegistry, 'getActiveProfile').mockReturnValue('default');
    const router = createToolRouter();

    await router.handleToolCall('workato_switch_profile', { profile: 'centium', tabId: 42 });
    const result = await router.handleToolCall('workato_list_profiles', {});
    const first = result.content[0];
    expect(first.type).toBe('text');
    if (first.type !== 'text') throw new Error('expected text result');
    const payload = JSON.parse(first.text);

    expect(payload).toMatchObject({
      active_profile: 'centium',
      session_profile: 'centium',
      session_tab_id: 42,
    });
  });

  test('adds optional profile routing argument to proxied tool schemas only', () => {
    const schemas = withProfileRoutingToolSchemas([
      {
        name: 'get_windows_and_tabs',
        description: 'Get tabs',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'workato_switch_profile',
        description: 'Switch profile',
        inputSchema: {
          type: 'object',
          properties: { profile: { type: 'string' } },
          required: ['profile'],
        },
      },
    ]);

    expect((schemas[0].inputSchema as any).properties[PROFILE_ROUTING_ARG]).toMatchObject({
      type: 'string',
    });
    expect((schemas[0].inputSchema as any).required).toEqual([]);
    expect((schemas[1].inputSchema as any).required).toEqual(['profile']);
  });
});
