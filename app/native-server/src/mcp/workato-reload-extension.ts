/**
 * `workato_reload_extension`: put a freshly built extension (and bridge) live
 * without a click in chrome://extensions.
 *
 * Every connected Chrome profile loads the same unpacked dist/ and runs its
 * own copy, so a rebuild reaches a profile only when that profile reloads.
 * Profiles are reloaded one at a time: ask for the build stamp, ask for the
 * reload (the extension answers first and reloads a moment later), wait for
 * the profile's WebSocket to come back, read the stamp again.
 *
 * One profile is special. The native host that serves this bridge was started
 * by exactly one profile (the one that found the port free), and Chrome ends
 * that process when the profile's extension reloads. Its reload therefore
 * restarts the bridge, which is also how a rebuilt native-server goes live. It
 * runs last, with a longer delay so this call's reply reaches the client, and
 * is reported as scheduled: nothing in this process survives to confirm it.
 * The client's MCP session reconnects on its next call.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { NativeMessageType } from 'workatomcp-shared';

export const RELOAD_EXTENSION_TOOL = 'workato_reload_extension';

export function isWorkatoReloadExtensionTool(name: string): boolean {
  return name === RELOAD_EXTENSION_TOOL;
}

const INFO_TIMEOUT_MS = 5000;
const RELOAD_ACK_TIMEOUT_MS = 5000;
const DEFAULT_RECONNECT_TIMEOUT_MS = 20000;
const MIN_RECONNECT_TIMEOUT_MS = 3000;
const MAX_RECONNECT_TIMEOUT_MS = 60000;
const RECONNECT_POLL_MS = 200;
/** Enough for the extension's reply to reach the bridge before its worker dies. */
const RELOAD_DELAY_MS = 300;
/** The bridge owner's reload ends this process; leave time for the reply to reach the client. */
const OWNER_RELOAD_DELAY_MS = 1500;

const MANUAL_RELOAD_HINT =
  'Reload the extension in that profile by hand at chrome://extensions once; later builds ' +
  'answer this tool.';

export interface ExtensionBuildInfo {
  profile?: string;
  version?: string;
  built_at?: string | null;
  disk_built_at?: string | null;
  stale?: boolean;
  unpacked?: boolean;
  owns_bridge?: boolean;
}

export interface ReloadExtensionDeps {
  connectedProfiles(): string[];
  /** Serial of the profile's current socket; higher after a reconnect, null while gone. */
  connectionSerial(profile: string): number | null;
  defaultProfile(): string | null;
  /** Resolves with the extension's reply payload: {status, data, error}. */
  request(profile: string, type: string, payload: unknown, timeoutMs: number): Promise<any>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

interface BuildStamp {
  version: string | null;
  built_at: string | null;
  stale: boolean | null;
}

export interface ProfileReloadResult {
  profile: string;
  status: 'reloaded' | 'scheduled' | 'failed';
  owns_bridge?: boolean;
  before?: BuildStamp;
  after?: BuildStamp;
  reconnected_after_ms?: number;
  note?: string;
  error?: string;
}

function stamp(info: ExtensionBuildInfo | undefined): BuildStamp {
  return {
    version: info?.version ?? null,
    built_at: info?.built_at ?? null,
    stale: typeof info?.stale === 'boolean' ? info.stale : null,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function textResult(body: unknown, isError: boolean): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }], isError };
}

async function readBuildInfo(
  deps: ReloadExtensionDeps,
  profile: string,
): Promise<ExtensionBuildInfo> {
  let reply: any;
  try {
    reply = await deps.request(profile, NativeMessageType.DEV_EXTENSION_INFO, {}, INFO_TIMEOUT_MS);
  } catch (error) {
    const message = errorMessage(error);
    if (/timed out/i.test(message)) {
      throw new Error(
        `Profile "${profile}" did not answer the build-info request within ` +
          `${INFO_TIMEOUT_MS / 1000}s: it runs an extension build older than ` +
          `${RELOAD_EXTENSION_TOOL}, or its service worker is stuck. ${MANUAL_RELOAD_HINT}`,
      );
    }
    throw error;
  }
  if (reply?.status !== 'success') {
    throw new Error(reply?.error || `Profile "${profile}" refused the build-info request`);
  }
  return (reply.data ?? {}) as ExtensionBuildInfo;
}

async function requestReload(
  deps: ReloadExtensionDeps,
  profile: string,
  delayMs: number,
): Promise<void> {
  const reply = await deps.request(
    profile,
    NativeMessageType.DEV_RELOAD_EXTENSION,
    { delay_ms: delayMs },
    RELOAD_ACK_TIMEOUT_MS,
  );
  if (reply?.status !== 'success') {
    throw new Error(reply?.error || `Profile "${profile}" refused the reload`);
  }
}

async function waitForReconnect(
  deps: ReloadExtensionDeps,
  profile: string,
  serialBefore: number | null,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = deps.now() + timeoutMs;
  while (deps.now() < deadline) {
    await deps.sleep(RECONNECT_POLL_MS);
    const serial = deps.connectionSerial(profile);
    if (serial !== null && (serialBefore === null || serial > serialBefore)) return true;
  }
  return false;
}

async function reloadAndConfirm(
  deps: ReloadExtensionDeps,
  profile: string,
  before: ExtensionBuildInfo,
  timeoutMs: number,
): Promise<ProfileReloadResult> {
  const startedAt = deps.now();
  const serialBefore = deps.connectionSerial(profile);
  try {
    await requestReload(deps, profile, RELOAD_DELAY_MS);
  } catch (error) {
    return { profile, status: 'failed', before: stamp(before), error: errorMessage(error) };
  }
  if (!(await waitForReconnect(deps, profile, serialBefore, timeoutMs))) {
    return {
      profile,
      status: 'failed',
      before: stamp(before),
      error:
        `The reload was accepted but the profile did not reconnect within ${timeoutMs}ms. ` +
        'Check its service worker console at chrome://extensions for a startup error.',
    };
  }
  const reconnectedAfterMs = deps.now() - startedAt;
  try {
    const after = await readBuildInfo(deps, profile);
    const result: ProfileReloadResult = {
      profile,
      status: 'reloaded',
      before: stamp(before),
      after: stamp(after),
      reconnected_after_ms: reconnectedAfterMs,
    };
    if (after.stale) {
      result.note =
        'The dist/ on disk is still newer than what this profile runs: the build was probably ' +
        'still being written. Run the tool again.';
    } else if (before.built_at && after.built_at === before.built_at) {
      result.note = 'Same build as before: nothing new was built since the last reload.';
    }
    return result;
  } catch (error) {
    return {
      profile,
      status: 'reloaded',
      before: stamp(before),
      reconnected_after_ms: reconnectedAfterMs,
      error: `Reconnected, but reading the new build failed: ${errorMessage(error)}`,
    };
  }
}

function clampTimeout(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_RECONNECT_TIMEOUT_MS;
  return Math.min(Math.max(Math.round(value), MIN_RECONNECT_TIMEOUT_MS), MAX_RECONNECT_TIMEOUT_MS);
}

let reloadInFlight = false;

/** Test seam: the in-flight guard normally lives one bridge lifetime. */
export function resetReloadExtensionState(): void {
  reloadInFlight = false;
}

export async function handleWorkatoReloadExtensionCall(
  args: any,
  deps: ReloadExtensionDeps,
): Promise<CallToolResult> {
  const source = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const connected = deps.connectedProfiles();
  const only = typeof source.profile === 'string' ? source.profile.trim() : '';
  if (only && !connected.includes(only)) {
    return textResult(
      { error: `Profile "${only}" is not connected.`, connected_profiles: connected },
      true,
    );
  }
  const targets = only ? [only] : connected;
  if (targets.length === 0) {
    return textResult({ error: 'No Chrome profile is connected to the bridge.' }, true);
  }

  if (source.check_only === true) {
    const profiles = [];
    for (const profile of targets) {
      try {
        const info = await readBuildInfo(deps, profile);
        profiles.push({
          profile,
          version: info.version ?? null,
          built_at: info.built_at ?? null,
          disk_built_at: info.disk_built_at ?? null,
          stale: info.stale ?? null,
          owns_bridge: info.owns_bridge === true,
        });
      } catch (error) {
        profiles.push({ profile, error: errorMessage(error) });
      }
    }
    const allCurrent = profiles.every((p: any) => p.stale === false);
    return textResult(
      { all_current: allCurrent, default_profile: deps.defaultProfile(), profiles },
      profiles.some((p: any) => p.error),
    );
  }

  if (reloadInFlight) {
    return textResult(
      { error: 'A reload is already running. Wait for it to finish, then call again.' },
      true,
    );
  }
  reloadInFlight = true;
  try {
    const timeoutMs = clampTimeout(source.timeout_ms);

    // Read every stamp first: the bridge owner has to be known before anything
    // reloads, because it has to go last.
    const infos = new Map<string, ExtensionBuildInfo>();
    const results: ProfileReloadResult[] = [];
    for (const profile of targets) {
      try {
        infos.set(profile, await readBuildInfo(deps, profile));
      } catch (error) {
        results.push({ profile, status: 'failed', error: errorMessage(error) });
      }
    }
    const reachable = targets.filter((profile) => infos.has(profile));
    const owners = reachable.filter((profile) => infos.get(profile)?.owns_bridge === true);
    const others = reachable.filter((profile) => !owners.includes(profile));

    for (const profile of others) {
      results.push(await reloadAndConfirm(deps, profile, infos.get(profile)!, timeoutMs));
    }
    for (const profile of owners) {
      const before = infos.get(profile)!;
      try {
        await requestReload(deps, profile, OWNER_RELOAD_DELAY_MS);
        results.push({
          profile,
          status: 'scheduled',
          owns_bridge: true,
          before: stamp(before),
          note:
            'This profile runs the bridge: its reload restarts the bridge in about ' +
            `${OWNER_RELOAD_DELAY_MS / 1000}s, which also loads a rebuilt native-server. The ` +
            'bridge is then down for 5-10s and a call in that window fails with ECONNREFUSED: ' +
            'wait about 10s, then confirm with check_only:true. The MCP session reconnects by itself.',
        });
      } catch (error) {
        results.push({
          profile,
          status: 'failed',
          owns_bridge: true,
          before: stamp(before),
          error: errorMessage(error),
        });
      }
    }

    const failed = results.some((r) => r.status === 'failed' || r.error);
    const bridgeRestarting = results.some((r) => r.status === 'scheduled');
    return textResult(
      {
        reloaded: !failed,
        bridge_restarting: bridgeRestarting,
        default_profile: deps.defaultProfile(),
        // In the order things happened: unreachable profiles, then reloads.
        profiles: results,
        ...(bridgeRestarting
          ? {}
          : {
              note:
                'The bridge process was not restarted (no reloaded profile owns it), so a ' +
                'rebuilt native-server is not live yet.',
            }),
      },
      failed,
    );
  } finally {
    reloadInFlight = false;
  }
}
