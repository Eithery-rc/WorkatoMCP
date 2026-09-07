/**
 * Router-level wiring for the generic out_file / auto-file post-processor and
 * for image content. Kept out of register-tools.test.ts so the two files can
 * grow independently.
 */
import { afterEach, describe, expect, jest, test } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { createToolRouter } from './register-tools';
import { profileRegistry } from '../server/profile-registry';

const PIXEL = 'AAECAwQFBgcICQoLDA0ODw==';

function stubResponse(data: unknown) {
  jest.spyOn(profileRegistry, 'getConnectedProfiles').mockReturnValue(['centium']);
  return jest
    .spyOn(profileRegistry, 'sendRequest')
    .mockResolvedValue({ status: 'success', data } as any);
}

/** Pin a profile so every call takes the WebSocket path, as the router tests do. */
async function pinnedRouter() {
  const router = createToolRouter();
  await router.handleToolCall('workato_switch_profile', { profile: 'centium' });
  return router;
}

describe('register-tools image and auto-file wiring', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('passes an image block through to the client unchanged', async () => {
    stubResponse({
      content: [
        { type: 'image', data: PIXEL, mimeType: 'image/jpeg' },
        { type: 'text', text: JSON.stringify({ name: 'shot', width: 800, height: 600 }) },
      ],
      isError: false,
    });
    const router = await pinnedRouter();

    const result = await router.handleToolCall('chrome_screenshot', { storeBase64: true });

    expect(result.content).toEqual([
      { type: 'image', data: PIXEL, mimeType: 'image/jpeg' },
      { type: 'text', text: JSON.stringify({ name: 'shot', width: 800, height: 600 }) },
    ]);
  });

  test('writes the screenshot image to out_file and strips the file params from the call', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'router-autofile-'));
    const outFile = path.join(tmpDir, 'shot.jpg');
    const sendRequest = stubResponse({
      content: [
        { type: 'image', data: PIXEL, mimeType: 'image/jpeg' },
        { type: 'text', text: JSON.stringify({ name: 'shot' }) },
      ],
      isError: false,
    });
    const router = await pinnedRouter();

    const result: any = await router.handleToolCall('chrome_screenshot', {
      storeBase64: true,
      out_file: outFile,
    });

    expect((sendRequest.mock.calls[0] as any[])[1]).toEqual({
      name: 'chrome_screenshot',
      args: { storeBase64: true },
    });
    expect(fs.readFileSync(outFile)).toEqual(Buffer.from(PIXEL, 'base64'));
    expect(result.content[0].type).toBe('image');
    const summary = JSON.parse(result.content[1].text);
    expect(summary).toMatchObject({ saved_to: outFile, bytes: 16, content_type: 'image/jpeg' });

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('spills an oversized read result and returns a summary', async () => {
    // Comfortably past the 60,000 character default threshold.
    const payload = { jobs: new Array(500).fill({ id: 1, title: 'x'.repeat(200) }) };
    stubResponse({ content: [{ type: 'text', text: JSON.stringify(payload) }], isError: false });
    const router = await pinnedRouter();

    const result: any = await router.handleToolCall('workato_list_jobs', { recipe_id: 55 });
    const summary = JSON.parse(result.content[0].text);

    expect(summary.mode).toBe('auto_file');
    expect(summary.item_counts).toEqual({ jobs: 500 });
    expect(JSON.parse(fs.readFileSync(summary.saved_to, 'utf8'))).toEqual(payload);
    fs.rmSync(summary.saved_to, { force: true });
  });

  test('leaves a normal-sized read result inline', async () => {
    const payload = { jobs: [{ id: 1 }] };
    stubResponse({ content: [{ type: 'text', text: JSON.stringify(payload) }], isError: false });
    const router = await pinnedRouter();

    const result: any = await router.handleToolCall('workato_list_jobs', { recipe_id: 55 });
    expect(JSON.parse(result.content[0].text)).toEqual(payload);
  });

  test('serves out_file and auto_file on read tools, not on write tools', async () => {
    // The flow listing gets a response with no `items`, so no dynamic tools.
    stubResponse({ content: [] });
    const router = await pinnedRouter();

    const { tools } = await router.listTools();
    const trace = tools.find((tool) => tool.name === 'workato_job_trace');
    const shot = tools.find((tool) => tool.name === 'chrome_screenshot');
    const rename = tools.find((tool) => tool.name === 'workato_rename_recipe');
    const pull = tools.find((tool) => tool.name === 'workato_pull_recipe');

    expect((trace?.inputSchema.properties as any).out_file).toMatchObject({ type: 'string' });
    expect((trace?.inputSchema.properties as any).auto_file).toMatchObject({ type: 'boolean' });
    expect((trace?.inputSchema.properties as any).auto_file_threshold_chars).toMatchObject({
      type: 'number',
    });
    expect((shot?.inputSchema.properties as any).out_file.description).toMatch(/absolute path/i);
    expect((shot?.inputSchema.properties as any).profile).toBeDefined();
    expect((rename?.inputSchema.properties as any).out_file).toBeUndefined();
    // The pull tool keeps the out_file description it declares itself.
    expect((pull?.inputSchema.properties as any).auto_file).toBeUndefined();
  });
});
