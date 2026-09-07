/**
 * Router dispatch for workato_operation_status.
 *
 * The point of this tool is that a client whose save timed out can still ask
 * what happened, so its read path must not depend on the browser being there
 * at all. These tests assert exactly that: a status read reaches no extension,
 * while refresh does.
 */

import { afterEach, describe, expect, jest, test } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const journalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wops-router-'));
process.env.WORKATOMCP_OPERATIONS_DIR = journalDir;

import { createToolRouter } from './register-tools';
import { profileRegistry } from '../server/profile-registry';
import {
  finishOperation,
  resetOperationsDirCache,
  startOperation,
  upsertRecipe,
} from './workato-operations';

resetOperationsDirCache();

const parse = (result: any): any =>
  JSON.parse((result.content[0] as any).text.split('\n').slice(-1)[0]);

function journalledOperation(): string {
  const record = startOperation({
    context: { tab_id: 42, host: 'app.workato.com', workspace_id: 5150 },
    args: { recipe_id: 999, code_path: '/tmp/r.json' },
  });
  upsertRecipe(record, {
    recipe_id: 999,
    role: 'callee',
    initial: { running: false, version_no: 7 },
  });
  upsertRecipe(record, {
    recipe_id: 111,
    role: 'caller',
    initial: { running: true, version_no: 3 },
  });
  finishOperation(record, { status: 'done', result: { ok: true } });
  return record.operation_id;
}

describe('register-tools dispatch for workato_operation_status', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    try {
      fs.rmSync(journalDir, { recursive: true, force: true });
      fs.mkdirSync(journalDir, { recursive: true });
    } catch {
      /* best effort */
    }
  });

  test('a journal read is answered locally, with no extension round trip', async () => {
    jest.spyOn(profileRegistry, 'getConnectedProfiles').mockReturnValue(['centium']);
    const sendRequest = jest.spyOn(profileRegistry, 'sendRequest').mockResolvedValue({
      status: 'success',
      data: { content: [{ type: 'text', text: 'ok' }] },
    } as any);
    const operationId = journalledOperation();
    const router = createToolRouter();

    const result = await router.handleToolCall('workato_operation_status', {
      operation_id: operationId,
    });

    expect(result.isError).toBeFalsy();
    expect(parse(result).operation.operation_id).toBe(operationId);
    expect(sendRequest).not.toHaveBeenCalled();
  });

  test('list works with no Chrome profile connected at all', async () => {
    jest.spyOn(profileRegistry, 'getConnectedProfiles').mockReturnValue([]);
    jest.spyOn(profileRegistry, 'getActiveProfile').mockReturnValue(null as any);
    const sendRequest = jest.spyOn(profileRegistry, 'sendRequest');
    journalledOperation();
    const router = createToolRouter();

    const result = await router.handleToolCall('workato_operation_status', { list: true });

    expect(result.isError).toBeFalsy();
    expect(parse(result).operations).toHaveLength(1);
    expect(sendRequest).not.toHaveBeenCalled();
  });

  test('refresh goes through the same nested caller as the other orchestrators', async () => {
    jest.spyOn(profileRegistry, 'getConnectedProfiles').mockReturnValue(['centium']);
    jest.spyOn(profileRegistry, 'getActiveProfile').mockReturnValue('centium');
    const sendRequest = jest
      .spyOn(profileRegistry, 'sendRequest')
      .mockImplementation(async (_profile: any, payload: any) => {
        if (payload?.name === 'workato_session_context') {
          return {
            status: 'success',
            data: {
              content: [
                {
                  type: 'text',
                  text: `ctx\n${JSON.stringify({
                    tab_id: payload.args.tabId,
                    host: 'app.workato.com',
                    workspace_id: 5150,
                    environment: 'production',
                  })}`,
                },
              ],
              isError: false,
            },
          } as any;
        }
        return {
          status: 'success',
          data: {
            content: [
              {
                type: 'text',
                text: `status\n${JSON.stringify({
                  recipe_id: payload.args.recipe_id,
                  running: false,
                  state: 'stopped',
                  version_no: 7,
                })}`,
              },
            ],
            isError: false,
          },
        } as any;
      });

    const operationId = journalledOperation();
    const router = createToolRouter();
    await router.handleToolCall('workato_switch_profile', { profile: 'centium', tabId: 42 });
    sendRequest.mockClear();

    const result = await router.handleToolCall('workato_operation_status', {
      operation_id: operationId,
      refresh: true,
    });

    const statusCalls = sendRequest.mock.calls.filter(
      (call: any) => call[1]?.name === 'workato_recipe_status',
    );
    expect(statusCalls).toHaveLength(2);
    // The session tab is injected into the nested calls, same as every other
    // orchestrator: a refresh must not read a different workspace.
    expect((statusCalls[0] as any)[1].args.tabId).toBe(42);
    expect(parse(result).live).toHaveLength(2);
  });
});
