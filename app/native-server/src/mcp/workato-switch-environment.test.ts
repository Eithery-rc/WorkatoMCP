import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { createToolRouter } from './register-tools';
import { profileRegistry } from '../server/profile-registry';
import {
  followSwitch,
  isContextChangingTool,
  parseSwitchResult,
} from './workato-switch-environment';

/** A workato_session_context response, as the extension returns it. */
const sessionContextReply = (tabId: number) => ({
  status: 'success',
  data: {
    content: [
      {
        type: 'text',
        text:
          'tab context\n' +
          JSON.stringify({
            tab_id: tabId,
            host: 'app.workato.com',
            workspace_id: 8070978,
            workspace_name: 'Legacy',
            environment: 'Development',
            user_id: 7,
          }),
      },
    ],
    isError: false,
  },
});

/** A workato_switch_environment success, as the extension returns it. */
const switchReply = (environment: string, environmentId: number) => ({
  status: 'success',
  data: {
    content: [
      {
        type: 'text',
        text:
          'switched to workspace 8070978 "Legacy", environment ' +
          environment +
          '\n' +
          JSON.stringify({
            changed: true,
            before: { workspace_id: 8070978, workspace_name: 'Legacy', environment: 'Development' },
            after: {
              workspace_id: 8070978,
              workspace_name: 'Legacy',
              environment,
              environment_id: environmentId,
              environment_type: 'prod',
            },
            tab_id: 42,
            landed_url: 'https://app.workato.com/',
          }),
      },
    ],
    isError: false,
  },
});

describe('workato_switch_environment helpers', () => {
  test('only the switch is a context-changing tool', () => {
    expect(isContextChangingTool('workato_switch_environment')).toBe(true);
    expect(isContextChangingTool('workato_session_context')).toBe(false);
  });

  test('parses the verified after-context and ignores errors', () => {
    expect(parseSwitchResult(switchReply('Production', 8070980).data as any)).toEqual({
      workspace_id: 8070978,
      workspace_name: 'Legacy',
      environment: 'Production',
    });
    expect(
      parseSwitchResult({ content: [{ type: 'text', text: 'nope' }], isError: true }),
    ).toBeNull();
    expect(parseSwitchResult({ content: [{ type: 'text', text: 'no payload' }] })).toBeNull();
  });

  test('followSwitch keeps profile and tab and takes the new context', () => {
    const next = followSwitch(
      {
        profile: 'personal',
        tabId: 42,
        workspace_id: 1,
        environment: 'Development',
        generation: 3,
      },
      { workspace_id: 1, environment: 'Production' },
      9,
    );
    expect(next).toEqual({
      profile: 'personal',
      tabId: 42,
      workspace_id: 1,
      environment: 'Production',
      generation: 9,
    });
  });
});

describe('workato_switch_environment routing', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('is sent without expected_context and the pin follows it', async () => {
    jest.spyOn(profileRegistry, 'getConnectedProfiles').mockReturnValue(['personal']);
    jest.spyOn(profileRegistry, 'getActiveProfile').mockReturnValue('personal');
    const sendRequest = jest
      .spyOn(profileRegistry, 'sendRequest')
      .mockImplementation(async (_profile: any, payload: any) => {
        if (payload?.name === 'workato_session_context') {
          return sessionContextReply(payload.args.tabId) as any;
        }
        if (payload?.name === 'workato_switch_environment') {
          return switchReply('Production', 8070980) as any;
        }
        return { status: 'success', data: { content: [{ type: 'text', text: 'ok' }] } } as any;
      });
    const router = createToolRouter();
    await router.handleToolCall('workato_switch_profile', { profile: 'personal', tabId: 42 });

    sendRequest.mockClear();
    await router.handleToolCall('workato_switch_environment', { environment: 'prod' });
    const switchArgs = (sendRequest.mock.calls[0][1] as any).args;
    expect(switchArgs).toEqual({ environment: 'prod', tabId: 42 });

    // The next call is checked against the NEW environment, not the old pin.
    sendRequest.mockClear();
    await router.handleToolCall('workato_recipe_status', { recipe_id: 1 });
    expect((sendRequest.mock.calls[0][1] as any).args.expected_context).toEqual({
      host: 'app.workato.com',
      workspace_id: 8070978,
      environment: 'Production',
    });

    const listed = await router.handleToolCall('workato_list_profiles', {});
    expect(JSON.parse((listed.content?.[0] as any).text).session_context).toMatchObject({
      environment: 'Production',
      workspace_id: 8070978,
    });
  });

  test('a switch routed to another profile leaves the pin alone', async () => {
    jest.spyOn(profileRegistry, 'getConnectedProfiles').mockReturnValue(['personal', 'bluBanyan']);
    jest.spyOn(profileRegistry, 'getActiveProfile').mockReturnValue('personal');
    jest.spyOn(profileRegistry, 'sendRequest').mockImplementation(async (_p: any, payload: any) => {
      if (payload?.name === 'workato_session_context') {
        return sessionContextReply(payload.args.tabId) as any;
      }
      return switchReply('Production', 8070980) as any;
    });
    const router = createToolRouter();
    await router.handleToolCall('workato_switch_profile', { profile: 'personal', tabId: 42 });

    await router.handleToolCall('workato_switch_environment', {
      environment: 'prod',
      profile: 'bluBanyan',
    });

    const listed = await router.handleToolCall('workato_list_profiles', {});
    expect(JSON.parse((listed.content?.[0] as any).text).session_context).toMatchObject({
      environment: 'Development',
    });
  });
});
