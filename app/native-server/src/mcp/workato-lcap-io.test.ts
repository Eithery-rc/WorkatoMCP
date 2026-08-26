import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  isWorkatoLcapFileTool,
  loadContentFile,
  prepareLcapCall,
  writeLcapOutFile,
} from './workato-lcap-io';

const CONTENT = {
  type: 'common',
  maxWidth: 'fixed',
  spacing: 'standard',
  background: { style: 'color', color: '#fafbfc' },
  variables: [],
  handlers: { pageLoad: null },
  layout: [1, [{ id: 'aa11bb22', type: 'text', x: 0, width: 12, visible: true, text: 'hi' }, 0]],
};

const textResult = (payload: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  isError: false,
});

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcapio-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('isWorkatoLcapFileTool', () => {
  test('claims the page and escape-hatch tools, ignores the rest', () => {
    expect(isWorkatoLcapFileTool('workato_lcap_page_get')).toBe(true);
    expect(isWorkatoLcapFileTool('workato_lcap_page_save')).toBe(true);
    expect(isWorkatoLcapFileTool('workato_api_request')).toBe(true);
    expect(isWorkatoLcapFileTool('workato_adapter_meta')).toBe(true);
    expect(isWorkatoLcapFileTool('workato_pull_recipe')).toBe(false);
    expect(isWorkatoLcapFileTool('workato_lcap_page_delete')).toBe(false);
  });
});

describe('loadContentFile', () => {
  test('reads a bare content tree', () => {
    const file = path.join(tmpDir, 'bare.json');
    fs.writeFileSync(file, JSON.stringify(CONTENT), 'utf8');
    expect(loadContentFile(file)).toEqual(CONTENT);
  });

  test('unwraps the envelope page_get writes', () => {
    const file = path.join(tmpDir, 'envelope.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ page_id: 61604, updated_at: 'x', content: CONTENT }),
      'utf8',
    );
    expect(loadContentFile(file)).toEqual(CONTENT);
  });

  test('refuses a file that is not a page tree, naming what was expected', () => {
    const file = path.join(tmpDir, 'wrong.json');
    fs.writeFileSync(file, JSON.stringify({ hello: 'world' }), 'utf8');
    expect(() => loadContentFile(file)).toThrow(/does not hold a page tree/);
  });

  test('refuses a missing file and invalid JSON', () => {
    expect(() => loadContentFile(path.join(tmpDir, 'nope.json'))).toThrow(/not found/);
    const bad = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(bad, '{oops', 'utf8');
    expect(() => loadContentFile(bad)).toThrow(/not valid JSON/);
  });
});

describe('prepareLcapCall', () => {
  test('page_get(out_file) asks the extension for the full tree and hides the param', () => {
    const prepared = prepareLcapCall('workato_lcap_page_get', {
      page_id: 61604,
      out_file: path.join(tmpDir, 'page.json'),
    });
    expect(prepared.args.view).toBe('full');
    expect(prepared.args.out_file).toBeUndefined();
    expect(prepared.outFile).toEqual({ path: path.join(tmpDir, 'page.json'), kind: 'page' });
  });

  test('page_get without out_file is passed through untouched', () => {
    const args = { page_id: 61604 };
    expect(prepareLcapCall('workato_lcap_page_get', args).args).toBe(args);
  });

  test('page_save(content_path) is turned into an inline content tree', () => {
    const file = path.join(tmpDir, 'tree.json');
    fs.writeFileSync(file, JSON.stringify({ content: CONTENT }), 'utf8');
    const prepared = prepareLcapCall('workato_lcap_page_save', {
      page_id: 61604,
      content_path: file,
    });
    expect(prepared.args.content).toEqual(CONTENT);
    expect(prepared.args.content_path).toBeUndefined();
  });

  test('api_request(out_file) lifts the byte cap, since the body goes to disk', () => {
    const prepared = prepareLcapCall('workato_api_request', {
      path: '/web_api/lcap/apps.json',
      out_file: path.join(tmpDir, 'body.json'),
      max_bytes: 100,
    });
    expect(prepared.args.max_bytes).toBe(200_000);
    expect(prepared.outFile?.kind).toBe('api');
  });

  test('adapter_meta(out_file) switches the tool into raw mode', () => {
    const prepared = prepareLcapCall('workato_adapter_meta', {
      adapter: 'salesforce',
      out_file: path.join(tmpDir, 'meta.json'),
    });
    expect(prepared.args.raw).toBe(true);
    expect(prepared.outFile?.kind).toBe('meta');
  });

  test('rejects an out_file whose directory does not exist', () => {
    expect(() =>
      prepareLcapCall('workato_lcap_page_get', {
        page_id: 1,
        out_file: path.join(tmpDir, 'nested', 'deep', 'page.json'),
      }),
    ).toThrow(/directory does not exist/);
  });
});

describe('writeLcapOutFile', () => {
  test('writes the page envelope and strips the tree from the response', () => {
    const target = path.join(tmpDir, 'page.json');
    const result = writeLcapOutFile(
      { path: target, kind: 'page' },
      textResult({
        page_id: 61604,
        name: 'Form',
        updated_at: '2026-08-26T07:45:48.965-07:00',
        widget_count: 1,
        widgets: [{ id: 'aa11bb22', type: 'text', row: 0, container: 'root' }],
        content: CONTENT,
      }),
    );
    const written = JSON.parse(fs.readFileSync(target, 'utf8'));
    expect(written.content).toEqual(CONTENT);
    expect(written.page_id).toBe(61604);

    const payload = JSON.parse((result.content as any)[0].text);
    expect(payload.content).toBeUndefined();
    expect(payload.widget_count).toBe(1);
    expect(payload.saved_to).toBe(target);
  });

  test('writes a raw api_request body and reports its size', () => {
    const target = path.join(tmpDir, 'body.json');
    const result = writeLcapOutFile(
      { path: target, kind: 'api' },
      textResult({ status: 200, total_bytes: 12, body: { result: 'ok' } }),
    );
    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual({ result: 'ok' });
    const payload = JSON.parse((result.content as any)[0].text);
    expect(payload.body).toBeUndefined();
    expect(payload.bytes_written).toBeGreaterThan(0);
  });

  test('passes an upstream error straight through', () => {
    const failure = { content: [{ type: 'text' as const, text: 'boom' }], isError: true };
    expect(writeLcapOutFile({ path: path.join(tmpDir, 'x.json'), kind: 'page' }, failure)).toBe(
      failure,
    );
  });

  test('passes a response with no content key through rather than writing a stub', () => {
    const original = textResult({ page_id: 1, widgets: [] });
    expect(writeLcapOutFile({ path: path.join(tmpDir, 'y.json'), kind: 'page' }, original)).toBe(
      original,
    );
    expect(fs.existsSync(path.join(tmpDir, 'y.json'))).toBe(false);
  });
});
