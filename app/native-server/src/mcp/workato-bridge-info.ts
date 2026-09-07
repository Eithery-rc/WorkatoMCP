/**
 * `workato_bridge_info`: which build is answering these calls.
 *
 * Until now the MCP handshake said "ChromeMcpServer 1.0.0", a name and a
 * version that were never true of any release, so a client had no way to tell
 * a current bridge from one that had not been reloaded after an upgrade. Every
 * "that tool does not exist" and "that parameter is rejected" then looked like
 * a bug in the tool rather than deployment drift.
 *
 * This module answers that question locally: it reads the versions off the
 * package manifests that ship with the build, counts the served tools and
 * hashes the served catalogue into a short revision string. No browser round
 * trip, so it still answers when the extension is disconnected.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_SCHEMAS } from 'workatomcp-shared';
import { withOutFileToolSchemas } from './workato-auto-file';

export const BRIDGE_INFO_TOOL = 'workato_bridge_info';

/** Reported when a manifest could not be read; never an invented version. */
export const UNKNOWN_VERSION = 'unknown';

export function isWorkatoBridgeInfoTool(name: string): boolean {
  return name === BRIDGE_INFO_TOOL;
}

export interface VersionRead {
  version: string;
  /** Absolute path the version came from, or null when every candidate failed. */
  source: string | null;
}

/**
 * Read `version` from the first readable package.json in `candidates`.
 *
 * A missing or malformed manifest is not an error worth failing a diagnostic
 * call over: it becomes `unknown` with a null source, which reads as "could
 * not be determined" rather than as a version anyone should trust.
 */
export function readPackageVersion(candidates: string[]): VersionRead {
  for (const candidate of candidates) {
    try {
      const raw = fs.readFileSync(candidate, 'utf8');
      const parsed = JSON.parse(raw) as { version?: unknown };
      if (typeof parsed.version === 'string' && parsed.version.trim() !== '') {
        return { version: parsed.version, source: candidate };
      }
    } catch {
      // Try the next candidate.
    }
  }
  return { version: UNKNOWN_VERSION, source: null };
}

/**
 * Where the bridge's own package.json sits, in both layouts.
 *
 * Compiled: dist/mcp/workato-bridge-info.js -> ../../package.json.
 * Under ts-jest the sources run in place: src/mcp -> ../../package.json.
 * Both resolve to the package root, so one candidate covers both; the second
 * is the belt-and-braces case of a flatter build layout.
 */
export function bridgePackageCandidates(dir: string = __dirname): string[] {
  return [path.join(dir, '..', '..', 'package.json'), path.join(dir, '..', 'package.json')];
}

/** Where `workatomcp-shared`'s package.json sits, resolved through Node. */
export function sharedPackageCandidates(): string[] {
  const candidates: string[] = [];
  try {
    // The package's "exports" map does not publish ./package.json, so resolve
    // the entry point and walk up from dist/ instead of asking for the
    // manifest by subpath (which throws ERR_PACKAGE_PATH_NOT_EXPORTED).
    const entry = require.resolve('workatomcp-shared');
    candidates.push(path.join(path.dirname(entry), '..', 'package.json'));
    candidates.push(path.join(path.dirname(entry), 'package.json'));
  } catch {
    // Not resolvable (a partial install): fall through to the workspace path.
  }
  candidates.push(
    path.join(__dirname, '..', '..', '..', '..', 'packages', 'shared', 'package.json'),
  );
  return candidates;
}

/**
 * A stable fingerprint of the served tool catalogue.
 *
 * Canonicalized before hashing (tools sorted by name, object keys sorted) so
 * the revision changes when a name, a description or an input schema changes
 * and NOT when the array order or a key order happens to move. Two sessions
 * reporting different revisions are running different catalogues, which is the
 * one question a client cannot otherwise answer.
 */
export function computeSchemaRevision(tools: Tool[]): string {
  const canonical = [...tools]
    .map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: tool.inputSchema ?? null,
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return crypto.createHash('sha256').update(stableStringify(canonical)).digest('hex').slice(0, 12);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export interface BridgeInfoContext {
  /** Chrome profiles currently connected to this bridge. */
  connected_profiles: string[];
  /** The pinned profile/tab/workspace tuple, or null when nothing is pinned. */
  session_context: unknown;
  /** The bridge's default profile when this session pinned nothing. */
  default_profile?: string | null;
}

export interface BridgeInfo {
  bridge_version: string;
  shared_version: string;
  tool_count: number;
  schema_revision: string;
  connected_profiles: string[];
  session_context: unknown;
  default_profile: string | null;
  node_version: string;
  platform: string;
  versions_read: { bridge: string | null; shared: string | null };
}

export interface BuildBridgeInfoOptions {
  /** Overridable for tests; defaults to the catalogue this bridge serves. */
  tools?: Tool[];
  bridgeVersion?: VersionRead;
  sharedVersion?: VersionRead;
  nodeVersion?: string;
  platform?: string;
}

/** The catalogue as listTools serves it, minus the per-profile flow tools. */
export function servedToolSchemas(): Tool[] {
  return withOutFileToolSchemas(TOOL_SCHEMAS as Tool[]);
}

export function buildBridgeInfo(
  context: BridgeInfoContext,
  options: BuildBridgeInfoOptions = {},
): BridgeInfo {
  const tools = options.tools ?? servedToolSchemas();
  const bridge = options.bridgeVersion ?? readPackageVersion(bridgePackageCandidates());
  const shared = options.sharedVersion ?? readPackageVersion(sharedPackageCandidates());
  return {
    bridge_version: bridge.version,
    shared_version: shared.version,
    tool_count: tools.length,
    schema_revision: computeSchemaRevision(tools),
    connected_profiles: context.connected_profiles,
    session_context: context.session_context ?? null,
    default_profile: context.default_profile ?? null,
    node_version: options.nodeVersion ?? process.version,
    platform: options.platform ?? `${process.platform}-${process.arch}`,
    versions_read: { bridge: bridge.source, shared: shared.source },
  };
}

/**
 * Cached because the answer only changes when the process is replaced, and a
 * drift check should not pay two file reads and a catalogue hash every call.
 */
let cachedStatic: {
  bridge: VersionRead;
  shared: VersionRead;
  tools: Tool[];
} | null = null;

function staticParts() {
  if (!cachedStatic) {
    cachedStatic = {
      bridge: readPackageVersion(bridgePackageCandidates()),
      shared: readPackageVersion(sharedPackageCandidates()),
      tools: servedToolSchemas(),
    };
  }
  return cachedStatic;
}

/** Test seam: drop the memoized versions and catalogue. */
export function resetBridgeInfoCache(): void {
  cachedStatic = null;
}

export function handleWorkatoBridgeInfoCall(context: BridgeInfoContext): CallToolResult {
  const parts = staticParts();
  const info = buildBridgeInfo(context, {
    tools: parts.tools,
    bridgeVersion: parts.bridge,
    sharedVersion: parts.shared,
  });
  return {
    content: [{ type: 'text', text: JSON.stringify(info, null, 2) }],
    isError: false,
  };
}
