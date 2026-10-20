import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { createToolRouter } from './register-tools';
import { profileRegistry } from '../server/profile-registry';
import {
  FETCH_TO_FILE_TOOL,
  filenameFromDisposition,
  finishFetchToFile,
  isFetchToFileTool,
  prepareFetchToFileCall,
  printableMagic,
} from './chrome-fetch-to-file';
import { isAutoFileEligible } from './auto-file';

const PDF_BYTES = Buffer.from('%PDF-1.7\n\x00\x01\x02binary tail', 'latin1');

const reply = (payload: Record<string, unknown>, isError = false) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  isError,
});

const okReply = (data: Buffer, extra: Record<string, unknown> = {}) =>
  reply({
    tabId: 7,
    ok: true,
    status: 200,
    statusText: 'OK',
    final_url: 'https://example.com/app/print.nl?id=1&form=2',
    content_type: 'application/pdf',
    content_disposition: 'attachment; filename="INV-1001.pdf"',
    bytes: data.length,
    base64: data.toString('base64'),
    ...extra,
  });

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-to-file-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('prepareFetchToFileCall', () => {
  test('strips out_file and marks the call as owned by the file writer', () => {
    const target = path.join(tmpDir, 'out.pdf');
    const prepared = prepareFetchToFileCall({ url: '/x', out_file: target, tabId: 3 });
    expect(prepared.outFile).toBe(path.resolve(target));
    expect(prepared.args).toEqual({ url: '/x', tabId: 3, __to_file: true });
  });

  test('refuses a missing, relative or dangling out_file before any browser work', () => {
    expect(() => prepareFetchToFileCall({ url: '/x' })).toThrow(/out_file is required/);
    expect(() => prepareFetchToFileCall({ url: '/x', out_file: 'rel/out.pdf' })).toThrow(
      /absolute path/,
    );
    expect(() =>
      prepareFetchToFileCall({ url: '/x', out_file: path.join(tmpDir, 'nope', 'out.pdf') }),
    ).toThrow(/directory does not exist/);
    expect(() => prepareFetchToFileCall({ url: '/x', out_file: tmpDir })).toThrow(/is a directory/);
  });
});

describe('finishFetchToFile', () => {
  test('writes the decoded bytes and returns a summary without the body', () => {
    const target = path.join(tmpDir, 'out.pdf');
    const result = finishFetchToFile(target, okReply(PDF_BYTES));

    expect(result.isError).toBe(false);
    expect(fs.readFileSync(target).equals(PDF_BYTES)).toBe(true);
    const text = (result.content[0] as any).text as string;
    expect(text).not.toContain(PDF_BYTES.toString('base64'));
    expect(text).not.toContain('base64');
    const summary = JSON.parse(text);
    expect(summary).toEqual({
      tool: FETCH_TO_FILE_TOOL,
      saved_to: target,
      bytes: PDF_BYTES.length,
      sha256: crypto.createHash('sha256').update(PDF_BYTES).digest('hex'),
      status: 200,
      ok: true,
      content_type: 'application/pdf',
      filename: 'INV-1001.pdf',
      final_url: 'https://example.com/app/print.nl?id=1&form=2',
      magic: '%PDF-1.7',
      tabId: 7,
    });
  });

  test('a non-2xx body is still written, and the result is an error with its status', () => {
    const target = path.join(tmpDir, 'err.html');
    const html = Buffer.from('<html>Session expired</html>');
    const result = finishFetchToFile(
      target,
      okReply(html, { ok: false, status: 403, statusText: 'Forbidden', content_type: 'text/html' }),
    );
    expect(result.isError).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe('<html>Session expired</html>');
    const summary = JSON.parse((result.content[0] as any).text);
    expect(summary.status).toBe(403);
    expect(summary.ok).toBe(false);
    expect(summary.note).toMatch(/HTTP 403 Forbidden/);
  });

  test('an empty body writes an empty file', () => {
    const target = path.join(tmpDir, 'empty.bin');
    const result = finishFetchToFile(target, okReply(Buffer.alloc(0)));
    expect(result.isError).toBe(false);
    expect(fs.statSync(target).size).toBe(0);
    expect(JSON.parse((result.content[0] as any).text).magic).toBeUndefined();
  });

  test('an extension error passes through and writes nothing', () => {
    const target = path.join(tmpDir, 'never.pdf');
    const error = {
      content: [{ type: 'text' as const, text: 'The body is 99 bytes, over max_bytes (10).' }],
      isError: true,
    };
    expect(finishFetchToFile(target, error)).toBe(error);
    expect(fs.existsSync(target)).toBe(false);
  });

  test('an unparseable or bodiless reply never echoes what it got', () => {
    const target = path.join(tmpDir, 'never.pdf');
    const secret = 'A'.repeat(200);
    const garbled = { content: [{ type: 'text' as const, text: `{"base64":"${secret}` }] };
    const result = finishFetchToFile(target, garbled as any);
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secret);

    const noBody = finishFetchToFile(target, reply({ ok: true, status: 200 }));
    expect(noBody.isError).toBe(true);
    expect(fs.existsSync(target)).toBe(false);
  });

  test('a byte count that disagrees with the decoded body writes nothing', () => {
    const target = path.join(tmpDir, 'short.pdf');
    const result = finishFetchToFile(target, okReply(PDF_BYTES, { bytes: PDF_BYTES.length + 5 }));
    expect(result.isError).toBe(true);
    expect(fs.existsSync(target)).toBe(false);
  });
});

describe('helpers', () => {
  test('filenameFromDisposition reads filename* before filename', () => {
    expect(filenameFromDisposition('attachment; filename="a b.pdf"')).toBe('a b.pdf');
    expect(filenameFromDisposition('inline; filename=report.csv')).toBe('report.csv');
    expect(
      filenameFromDisposition(
        'attachment; filename="fallback.pdf"; filename*=UTF-8\'\'%D0%A1%D1%87%D0%B5%D1%82.pdf',
      ),
    ).toBe('Счет.pdf');
    expect(filenameFromDisposition('inline')).toBeUndefined();
    expect(filenameFromDisposition(undefined)).toBeUndefined();
  });

  test('printableMagic only reports printable leading bytes', () => {
    expect(printableMagic(Buffer.from('%PDF-1.4 rest'))).toBe('%PDF-1.4');
    expect(printableMagic(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeUndefined();
    expect(printableMagic(Buffer.from('PK'))).toBe('PK');
  });

  test('the generic auto-file pipeline leaves this tool alone', () => {
    expect(isFetchToFileTool('chrome_fetch_to_file')).toBe(true);
    expect(isAutoFileEligible('chrome_fetch_to_file')).toBe(false);
  });
});

describe('router wiring', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function stubResponse(data: unknown) {
    jest.spyOn(profileRegistry, 'getConnectedProfiles').mockReturnValue(['centium']);
    return jest
      .spyOn(profileRegistry, 'sendRequest')
      .mockResolvedValue({ status: 'success', data } as any);
  }

  async function pinnedRouter() {
    const router = createToolRouter();
    await router.handleToolCall('chrome_switch_profile', { profile: 'centium' });
    return router;
  }

  test('sends the call without out_file, writes the body, answers with the summary only', async () => {
    const target = path.join(tmpDir, 'print.pdf');
    const sendRequest = stubResponse(okReply(PDF_BYTES));
    const router = await pinnedRouter();

    const result: any = await router.handleToolCall('chrome_fetch_to_file', {
      url: '/app/accounting/print/hotprint.nl?id=1',
      out_file: target,
      tabId: 7,
    });

    const sent = (sendRequest.mock.calls as any[]).find(
      (call) => call[1]?.name === 'chrome_fetch_to_file',
    );
    expect(sent[1].args).toEqual({
      url: '/app/accounting/print/hotprint.nl?id=1',
      tabId: 7,
      __to_file: true,
    });
    expect(fs.readFileSync(target).equals(PDF_BYTES)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(PDF_BYTES.toString('base64'));
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      saved_to: target,
      bytes: PDF_BYTES.length,
      magic: '%PDF-1.7',
    });
  });

  test('a bad out_file fails before anything is sent', async () => {
    const sendRequest = stubResponse(okReply(PDF_BYTES));
    const router = await pinnedRouter();
    const before = sendRequest.mock.calls.length;

    const result: any = await router.handleToolCall('chrome_fetch_to_file', {
      url: '/x',
      out_file: path.join(tmpDir, 'missing', 'x.pdf'),
      tabId: 7,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/directory does not exist/);
    expect(sendRequest.mock.calls.length).toBe(before);
  });
});
