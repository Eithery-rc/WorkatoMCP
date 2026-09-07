import { afterEach, describe, expect, jest, test, beforeEach } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAMES, TOOL_SCHEMAS } from 'workatomcp-shared';
import { createToolRouter } from './register-tools';
import { profileRegistry } from '../server/profile-registry';
import {
  BRIDGE_INFO_TOOL,
  UNKNOWN_VERSION,
  buildBridgeInfo,
  bridgePackageCandidates,
  computeSchemaRevision,
  handleWorkatoBridgeInfoCall,
  isWorkatoBridgeInfoTool,
  readPackageVersion,
  resetBridgeInfoCache,
  servedToolSchemas,
  sharedPackageCandidates,
} from './workato-bridge-info';

const CONTEXT = {
  connected_profiles: ['personal'],
  session_context: { profile: 'personal', tab_id: 7 },
  default_profile: 'personal',
};

function tmpFile(name: string, contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-info-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents, 'utf8');
  return file;
}

describe('workato_bridge_info tool identity', () => {
  test('the schema is registered exactly once under the name the router matches', () => {
    expect(TOOL_NAMES.WORKATO.BRIDGE_INFO).toBe(BRIDGE_INFO_TOOL);
    const matches = TOOL_SCHEMAS.filter((tool) => tool.name === BRIDGE_INFO_TOOL);
    expect(matches).toHaveLength(1);
    expect(matches[0].inputSchema.required ?? []).toEqual([]);
    expect(isWorkatoBridgeInfoTool(BRIDGE_INFO_TOOL)).toBe(true);
    expect(isWorkatoBridgeInfoTool('workato_pull_recipe')).toBe(false);
  });
});

describe('version reads fall back instead of inventing a version', () => {
  test('reads the version from the first readable manifest', () => {
    const file = tmpFile('package.json', JSON.stringify({ name: 'x', version: '9.9.9' }));
    const read = readPackageVersion([path.join(path.dirname(file), 'missing.json'), file]);
    expect(read.version).toBe('9.9.9');
    expect(read.source).toBe(file);
  });

  test('a missing manifest reads as unknown with a null source', () => {
    const read = readPackageVersion([path.join(os.tmpdir(), 'no-such-package-12345.json')]);
    expect(read).toEqual({ version: UNKNOWN_VERSION, source: null });
  });

  test('malformed JSON and a missing version field both fall through', () => {
    const broken = tmpFile('package.json', '{ not json');
    const versionless = tmpFile('package.json', JSON.stringify({ name: 'x' }));
    const good = tmpFile('package.json', JSON.stringify({ version: '2.0.0' }));
    expect(readPackageVersion([broken, versionless, good]).version).toBe('2.0.0');
    expect(readPackageVersion([broken, versionless]).version).toBe(UNKNOWN_VERSION);
  });

  test('an empty version string is not accepted as a version', () => {
    const blank = tmpFile('package.json', JSON.stringify({ version: '   ' }));
    expect(readPackageVersion([blank]).version).toBe(UNKNOWN_VERSION);
  });

  test('the real bridge and shared manifests resolve in this layout', () => {
    const bridge = readPackageVersion(bridgePackageCandidates());
    const shared = readPackageVersion(sharedPackageCandidates());
    expect(bridge.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(shared.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(bridge.source).not.toBeNull();
    expect(shared.source).not.toBeNull();
  });
});

describe('schema revision is stable and sensitive to real changes', () => {
  const a: Tool = { name: 'b', description: 'B', inputSchema: { type: 'object', properties: {} } };
  const b: Tool = { name: 'a', description: 'A', inputSchema: { type: 'object', properties: {} } };

  test('same catalogue, same revision', () => {
    expect(computeSchemaRevision([a, b])).toBe(computeSchemaRevision([a, b]));
  });

  test('array order does not move the revision', () => {
    expect(computeSchemaRevision([a, b])).toBe(computeSchemaRevision([b, a]));
  });

  test('a changed description moves the revision', () => {
    const changed: Tool = { ...a, description: 'B.' };
    expect(computeSchemaRevision([changed, b])).not.toBe(computeSchemaRevision([a, b]));
  });

  test('a changed input schema moves the revision', () => {
    const changed: Tool = {
      ...a,
      inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
    };
    expect(computeSchemaRevision([changed, b])).not.toBe(computeSchemaRevision([a, b]));
  });

  test('an added tool moves the revision', () => {
    const extra: Tool = { name: 'c', description: 'C', inputSchema: { type: 'object' } };
    expect(computeSchemaRevision([a, b, extra])).not.toBe(computeSchemaRevision([a, b]));
  });

  test('it is a short lowercase hex string', () => {
    expect(computeSchemaRevision(servedToolSchemas())).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('buildBridgeInfo', () => {
  beforeEach(() => resetBridgeInfoCache());

  test('reports every field a drift check needs', () => {
    const info = buildBridgeInfo(CONTEXT, {
      tools: servedToolSchemas(),
      bridgeVersion: { version: '1.5.0', source: '/pkg/package.json' },
      sharedVersion: { version: '1.2.0', source: '/shared/package.json' },
      nodeVersion: 'v20.0.0',
      platform: 'linux-x64',
    });
    expect(info).toMatchObject({
      bridge_version: '1.5.0',
      shared_version: '1.2.0',
      tool_count: TOOL_SCHEMAS.length,
      connected_profiles: ['personal'],
      default_profile: 'personal',
      node_version: 'v20.0.0',
      platform: 'linux-x64',
      versions_read: { bridge: '/pkg/package.json', shared: '/shared/package.json' },
    });
    expect(info.session_context).toEqual({ profile: 'personal', tab_id: 7 });
    expect(info.schema_revision).toMatch(/^[0-9a-f]{12}$/);
  });

  test('a null session context stays null rather than becoming undefined', () => {
    const info = buildBridgeInfo({ connected_profiles: [], session_context: null });
    expect(info.session_context).toBeNull();
    expect(info.default_profile).toBeNull();
    expect(info.connected_profiles).toEqual([]);
  });

  test('tool_count counts the served catalogue, which includes bridge_info', () => {
    const info = buildBridgeInfo(CONTEXT);
    expect(info.tool_count).toBe(TOOL_SCHEMAS.length);
    expect(servedToolSchemas().some((tool) => tool.name === BRIDGE_INFO_TOOL)).toBe(true);
  });
});

describe('handleWorkatoBridgeInfoCall', () => {
  beforeEach(() => resetBridgeInfoCache());

  test('answers with parseable JSON and never an error', () => {
    const result = handleWorkatoBridgeInfoCall(CONTEXT);
    expect(result.isError).toBe(false);
    const block = result.content[0] as { type: string; text: string };
    expect(block.type).toBe('text');
    const parsed = JSON.parse(block.text);
    expect(parsed.bridge_version).toMatch(/^\d+\.\d+\.\d+/);
    expect(parsed.shared_version).toMatch(/^\d+\.\d+\.\d+/);
    expect(parsed.tool_count).toBe(TOOL_SCHEMAS.length);
    expect(parsed.schema_revision).toMatch(/^[0-9a-f]{12}$/);
  });

  test('two calls in one process report the same revision', () => {
    const first = JSON.parse((handleWorkatoBridgeInfoCall(CONTEXT).content[0] as any).text);
    const second = JSON.parse((handleWorkatoBridgeInfoCall(CONTEXT).content[0] as any).text);
    expect(second.schema_revision).toBe(first.schema_revision);
    expect(second.bridge_version).toBe(first.bridge_version);
  });
});

describe('the router answers workato_bridge_info without a browser', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('no extension request is sent, even with no profile connected', async () => {
    jest.spyOn(profileRegistry, 'getConnectedProfiles').mockReturnValue([]);
    jest.spyOn(profileRegistry, 'getActiveProfile').mockReturnValue(null as any);
    const sendRequest = jest.spyOn(profileRegistry, 'sendRequest');

    const result = await createToolRouter().handleToolCall(BRIDGE_INFO_TOOL, {});

    expect(sendRequest).not.toHaveBeenCalled();
    expect(result.isError).toBe(false);
    const parsed = JSON.parse((result.content[0] as any).text);
    expect(parsed.connected_profiles).toEqual([]);
    expect(parsed.session_context).toBeNull();
    expect(parsed.bridge_version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
