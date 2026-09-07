import { describe, expect, test, beforeAll, afterAll } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { isWorkatoFileTool, prepareWorkatoCall, writePulledRecipe } from './workato-file-io';

const sampleCode = {
  number: 0,
  provider: 'clock',
  name: 'scheduled_event',
  as: 'trigger0',
  keyword: 'trigger',
  block: [
    { number: 1, keyword: 'action', name: 'log', as: 'aaaa1111', provider: 'logger' },
    {
      number: 2,
      keyword: 'if',
      as: 'bbbb2222',
      block: [{ number: 3, keyword: 'action', name: 'send', as: 'cccc3333', provider: 'email' }],
    },
  ],
};

/** A successful workato_pull_recipe(view:"full") result, as the extension returns it. */
const fullPullResult = (): CallToolResult => ({
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        recipe_id: 4242,
        code: sampleCode,
        version: {
          version_no: 7,
          name: 'My Recipe',
          config: JSON.stringify([{ provider: 'logger' }]),
        },
      }),
    },
  ],
  isError: false,
});

let tmpDir: string;
const parseText = (r: CallToolResult) => JSON.parse((r.content[0] as { text: string }).text);

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfio-'));
});
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('isWorkatoFileTool', () => {
  test('matches file-aware Workato tools only', () => {
    expect(isWorkatoFileTool('workato_pull_recipe')).toBe(true);
    expect(isWorkatoFileTool('workato_ui_save_recipe_code')).toBe(true);
    expect(isWorkatoFileTool('workato_recipe_set_py_eval_code')).toBe(true);
    expect(isWorkatoFileTool('workato_recipe_add_step')).toBe(false);
  });
});

describe('prepareWorkatoCall — pull with out_file', () => {
  test('forces full view, strips file/step params, returns pullOutFile', () => {
    const out = path.join(tmpDir, 'r.json');
    const prepared = prepareWorkatoCall('workato_pull_recipe', {
      recipe_id: 1,
      out_file: out,
      step: '3',
      field_query: 'x',
    });
    expect(prepared.pullOutFile).toBe(path.resolve(out));
    expect(prepared.args).toEqual({ recipe_id: 1, view: 'full' });
  });

  test('without out_file the call passes through untouched', () => {
    const prepared = prepareWorkatoCall('workato_pull_recipe', { recipe_id: 1, view: 'compact' });
    expect(prepared.pullOutFile).toBeUndefined();
    expect(prepared.args).toEqual({ recipe_id: 1, view: 'compact' });
  });

  test('throws when the out_file directory is missing', () => {
    expect(() =>
      prepareWorkatoCall('workato_pull_recipe', {
        recipe_id: 1,
        out_file: path.join(tmpDir, 'no-such-dir', 'r.json'),
      }),
    ).toThrow(/directory does not exist/);
  });
});

describe('writePulledRecipe', () => {
  test('writes an envelope file and returns a compact summary', () => {
    const out = path.join(tmpDir, 'pulled.json');
    const summary = parseText(writePulledRecipe(out, fullPullResult()));

    expect(summary.saved_to).toBe(out);
    expect(summary.recipe_id).toBe(4242);
    expect(summary.version_no).toBe(7);
    expect(summary.step_count).toBe(4);
    expect(summary.steps.map((s: { n: number }) => s.n)).toEqual([0, 1, 2, 3]);

    const file = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(file.code).toEqual(sampleCode);
    expect(file.config).toEqual([{ provider: 'logger' }]); // stringified config parsed back
    expect(fs.existsSync(out + '.tmp')).toBe(false); // temp file cleaned up by rename
  });

  test('passes an upstream error result through untouched, writes nothing', () => {
    const out = path.join(tmpDir, 'should-not-exist.json');
    const errResult: CallToolResult = {
      content: [{ type: 'text', text: 'WorkatoApiError: bad id' }],
      isError: true,
    };
    expect(writePulledRecipe(out, errResult)).toBe(errResult);
    expect(fs.existsSync(out)).toBe(false);
  });
});

describe('prepareWorkatoCall — save with code_path', () => {
  test('round-trips: a file written by writePulledRecipe loads back into save args', () => {
    const out = path.join(tmpDir, 'roundtrip.json');
    writePulledRecipe(out, fullPullResult());

    const prepared = prepareWorkatoCall('workato_ui_save_recipe_code', { code_path: out });
    expect(prepared.args.recipe_id).toBe(4242);
    expect(prepared.args.code).toEqual(sampleCode);
    expect(prepared.args.config).toEqual([{ provider: 'logger' }]);
    expect(prepared.args.code_path).toBeUndefined();
  });

  test('accepts a bare code tree file when recipe_id is passed explicitly', () => {
    const bare = path.join(tmpDir, 'bare.json');
    fs.writeFileSync(bare, JSON.stringify(sampleCode));
    const prepared = prepareWorkatoCall('workato_ui_save_recipe_code', {
      recipe_id: 99,
      code_path: bare,
    });
    expect(prepared.args.recipe_id).toBe(99);
    expect(prepared.args.code).toEqual(sampleCode);
  });

  test('throws when the file is missing', () => {
    expect(() =>
      prepareWorkatoCall('workato_ui_save_recipe_code', {
        code_path: path.join(tmpDir, 'missing.json'),
      }),
    ).toThrow(/not found/);
  });

  test('throws on invalid JSON', () => {
    const bad = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(bad, '{ not json');
    expect(() => prepareWorkatoCall('workato_ui_save_recipe_code', { code_path: bad })).toThrow(
      /not valid JSON/,
    );
  });

  test('throws when recipe_id is absent from both the file and the args', () => {
    const noId = path.join(tmpDir, 'no-id.json');
    fs.writeFileSync(noId, JSON.stringify({ code: sampleCode }));
    expect(() => prepareWorkatoCall('workato_ui_save_recipe_code', { code_path: noId })).toThrow(
      /recipe_id is required/,
    );
  });
});

describe('prepareWorkatoCall — py_eval code with code_path', () => {
  test('loads a Python file into code and strips code_path', () => {
    const py = path.join(tmpDir, 'parser.py');
    fs.writeFileSync(py, 'def main(input):\n    return {"ok": True}\n', 'utf8');

    const prepared = prepareWorkatoCall('workato_recipe_set_py_eval_code', {
      recipe_id: 42,
      step: '11111111',
      code_path: py,
    });

    expect(prepared.args).toEqual({
      recipe_id: 42,
      step: '11111111',
      code: 'def main(input):\n    return {"ok": True}\n',
    });
  });
});

describe('prepareWorkatoCall: file version lock and origin', () => {
  test('defaults the optimistic lock to the version the file was pulled from', () => {
    const out = path.join(tmpDir, 'lock.json');
    writePulledRecipe(out, fullPullResult());

    const prepared = prepareWorkatoCall('workato_ui_save_recipe_code', { code_path: out });
    expect(prepared.args.expected_base_version_no).toBe(7);
  });

  test('an explicit expected_base_version_no wins over the file', () => {
    const out = path.join(tmpDir, 'lock-explicit.json');
    writePulledRecipe(out, fullPullResult());

    const prepared = prepareWorkatoCall('workato_ui_save_recipe_code', {
      code_path: out,
      expected_base_version_no: 3,
    });
    expect(prepared.args.expected_base_version_no).toBe(3);
  });

  test('ignore_file_version drops the lock and never reaches the extension', () => {
    const out = path.join(tmpDir, 'lock-ignored.json');
    writePulledRecipe(out, fullPullResult());

    const prepared = prepareWorkatoCall('workato_ui_save_recipe_code', {
      code_path: out,
      ignore_file_version: true,
    });
    expect(prepared.args.expected_base_version_no).toBeUndefined();
    expect(prepared.args.ignore_file_version).toBeUndefined();
  });

  test('refuses a file whose recipe_id is not the one being saved', () => {
    const out = path.join(tmpDir, 'other-recipe.json');
    writePulledRecipe(out, fullPullResult());

    expect(() =>
      prepareWorkatoCall('workato_ui_save_recipe_code', { code_path: out, recipe_id: 99 }),
    ).toThrow(/recipe_id mismatch/);
  });

  test('round-trips origin metadata and turns it into an expected_context', () => {
    const out = path.join(tmpDir, 'origin.json');
    const summary = parseText(
      writePulledRecipe(out, fullPullResult(), {
        profile: 'centium',
        tab_id: 42,
        host: 'app.workato.com',
        workspace_id: 5150,
        workspace_name: 'Acme prod',
        environment: 'production',
      }),
    );

    expect(summary.origin).toMatchObject({
      profile: 'centium',
      tab_id: 42,
      host: 'app.workato.com',
      workspace_id: 5150,
      environment: 'production',
    });
    expect(typeof summary.origin.pulled_at).toBe('string');

    const file = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(file.origin.workspace_id).toBe(5150);

    const prepared = prepareWorkatoCall('workato_ui_save_recipe_code', { code_path: out });
    expect(prepared.args.expected_context).toEqual({
      host: 'app.workato.com',
      workspace_id: 5150,
      environment: 'production',
    });
  });

  test('allow_context_mismatch drops the origin check and the flag', () => {
    const out = path.join(tmpDir, 'origin-override.json');
    writePulledRecipe(out, fullPullResult(), { host: 'app.workato.com', workspace_id: 5150 });

    const prepared = prepareWorkatoCall('workato_ui_save_recipe_code', {
      code_path: out,
      allow_context_mismatch: true,
    });
    expect(prepared.args.expected_context).toBeUndefined();
    expect(prepared.args.allow_context_mismatch).toBeUndefined();
  });

  test('refuses a file pulled from a workspace other than the pinned one', () => {
    const out = path.join(tmpDir, 'origin-clash.json');
    writePulledRecipe(out, fullPullResult(), { host: 'app.workato.com', workspace_id: 5150 });

    expect(() =>
      prepareWorkatoCall('workato_ui_save_recipe_code', {
        code_path: out,
        expected_context: { host: 'app.workato.com', workspace_id: 9999 },
      }),
    ).toThrow(/context mismatch/);
  });

  test('an inline save carries no file flags to the extension', () => {
    const prepared = prepareWorkatoCall('workato_ui_save_recipe_code', {
      recipe_id: 4242,
      code: sampleCode,
      ignore_file_version: true,
      allow_context_mismatch: true,
      expected_context: { workspace_id: 5150 },
    });
    expect(prepared.args.ignore_file_version).toBeUndefined();
    expect(prepared.args.allow_context_mismatch).toBeUndefined();
    expect(prepared.args.expected_context).toBeUndefined();
  });
});

describe('writePulledRecipe: origin folder', () => {
  test('records the recipe folder from the pull payload', () => {
    const out = path.join(tmpDir, 'origin-folder.json');
    const result: CallToolResult = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            recipe_id: 4242,
            code: sampleCode,
            version: { version_no: 7, name: 'My Recipe', folder_id: 771 },
          }),
        },
      ],
      isError: false,
    };
    writePulledRecipe(out, result, { profile: 'centium' });
    const file = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(file.origin.folder_id).toBe(771);
    expect(file.origin.profile).toBe('centium');
  });
});
