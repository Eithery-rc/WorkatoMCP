import { beforeEach, describe, expect, test } from '@jest/globals';
import { NativeMessageType } from 'workatomcp-shared';
import {
  handleWorkatoReloadExtensionCall,
  resetReloadExtensionState,
  type ExtensionBuildInfo,
  type ReloadExtensionDeps,
} from './workato-reload-extension';

interface FakeProfile {
  info: ExtensionBuildInfo;
  /** What built_at becomes after a reload. */
  nextBuild?: string;
  /** Virtual ms until the profile reconnects after a reload; null never reconnects. */
  reconnectAfterMs?: number | null;
  /** Never answers the build-info request (a build older than the tool). */
  silent?: boolean;
}

function harness(profiles: Record<string, FakeProfile>) {
  let clock = 0;
  const serials = new Map<string, number>();
  let serial = 0;
  for (const name of Object.keys(profiles)) serials.set(name, ++serial);
  const reconnectAt = new Map<string, number>();
  const calls: Array<{ profile: string; type: string; payload: any }> = [];

  const deps: ReloadExtensionDeps = {
    connectedProfiles: () => Object.keys(profiles),
    connectionSerial: (profile) => {
      const due = reconnectAt.get(profile);
      if (due !== undefined && clock >= due) {
        reconnectAt.delete(profile);
        serials.set(profile, ++serial);
      }
      return serials.get(profile) ?? null;
    },
    defaultProfile: () => 'personal',
    request: async (profile, type, payload, timeoutMs) => {
      calls.push({ profile, type, payload });
      const fake = profiles[profile];
      if (type === NativeMessageType.DEV_EXTENSION_INFO) {
        if (fake.silent) {
          throw new Error(`Request to profile "${profile}" timed out after ${timeoutMs}ms`);
        }
        return { status: 'success', data: { ...fake.info } };
      }
      if (type === NativeMessageType.DEV_RELOAD_EXTENSION) {
        const after = fake.reconnectAfterMs === undefined ? 1500 : fake.reconnectAfterMs;
        if (after !== null) {
          reconnectAt.set(profile, clock + after);
          if (fake.nextBuild) fake.info = { ...fake.info, built_at: fake.nextBuild, stale: false };
        }
        serials.delete(profile);
        return { status: 'success', data: { reload_in_ms: (payload as any).delay_ms } };
      }
      throw new Error(`unexpected ${type}`);
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
  return { deps, calls };
}

function parse(result: any): any {
  return JSON.parse(result.content[0].text);
}

describe('workato_reload_extension', () => {
  beforeEach(() => resetReloadExtensionState());

  test('reloads the bridge owner last and reports it as scheduled', async () => {
    const { deps, calls } = harness({
      personal: { info: { built_at: 'A', owns_bridge: true }, nextBuild: 'B' },
      bluBanyan: { info: { built_at: 'A', owns_bridge: false }, nextBuild: 'B' },
      centium: { info: { built_at: 'A', owns_bridge: false }, nextBuild: 'B' },
    });

    const result = await handleWorkatoReloadExtensionCall({}, deps);
    const body = parse(result);

    expect(result.isError).toBe(false);
    expect(body.reloaded).toBe(true);
    expect(body.bridge_restarting).toBe(true);
    expect(body.profiles.map((p: any) => [p.profile, p.status])).toEqual([
      ['bluBanyan', 'reloaded'],
      ['centium', 'reloaded'],
      ['personal', 'scheduled'],
    ]);
    expect(body.profiles[0].before.built_at).toBe('A');
    expect(body.profiles[0].after.built_at).toBe('B');

    const reloads = calls.filter((c) => c.type === NativeMessageType.DEV_RELOAD_EXTENSION);
    expect(reloads.map((c) => c.profile)).toEqual(['bluBanyan', 'centium', 'personal']);
    // The owner's reload waits longer so this reply reaches the client first.
    expect(reloads[2].payload.delay_ms).toBeGreaterThan(reloads[0].payload.delay_ms);
  });

  test('does not start the next profile before the previous one reconnected', async () => {
    const { deps, calls } = harness({
      bluBanyan: { info: { built_at: 'A' }, reconnectAfterMs: 4000 },
      centium: { info: { built_at: 'A' } },
    });

    await handleWorkatoReloadExtensionCall({}, deps);

    const sequence = calls.map((c) => `${c.profile}:${c.type}`);
    const firstAfterInfo = sequence.indexOf(`bluBanyan:${NativeMessageType.DEV_EXTENSION_INFO}`, 2);
    const secondReload = sequence.indexOf(`centium:${NativeMessageType.DEV_RELOAD_EXTENSION}`);
    expect(firstAfterInfo).toBeGreaterThan(-1);
    expect(firstAfterInfo).toBeLessThan(secondReload);
  });

  test('a profile that never reconnects fails with a pointer to its console', async () => {
    const { deps } = harness({
      bluBanyan: { info: { built_at: 'A' }, reconnectAfterMs: null },
    });

    const result = await handleWorkatoReloadExtensionCall({ timeout_ms: 3000 }, deps);
    const body = parse(result);

    expect(result.isError).toBe(true);
    expect(body.profiles[0].status).toBe('failed');
    expect(body.profiles[0].error).toContain('did not reconnect within 3000ms');
  });

  test('an old build that ignores the request is named, and nothing else is skipped', async () => {
    const { deps } = harness({
      personal: { info: {}, silent: true },
      bluBanyan: { info: { built_at: 'A' }, nextBuild: 'B' },
    });

    const result = await handleWorkatoReloadExtensionCall({}, deps);
    const body = parse(result);

    expect(result.isError).toBe(true);
    const personal = body.profiles.find((p: any) => p.profile === 'personal');
    expect(personal.status).toBe('failed');
    expect(personal.error).toContain('older than workato_reload_extension');
    expect(body.profiles.find((p: any) => p.profile === 'bluBanyan').status).toBe('reloaded');
  });

  test('profile limits the reload to one connected profile', async () => {
    const { deps, calls } = harness({
      personal: { info: { built_at: 'A', owns_bridge: true } },
      bluBanyan: { info: { built_at: 'A' } },
    });

    const body = parse(await handleWorkatoReloadExtensionCall({ profile: 'bluBanyan' }, deps));

    expect(body.profiles.map((p: any) => p.profile)).toEqual(['bluBanyan']);
    expect(body.bridge_restarting).toBe(false);
    expect(calls.every((c) => c.profile === 'bluBanyan')).toBe(true);
  });

  test('an unknown profile is refused before anything reloads', async () => {
    const { deps, calls } = harness({ personal: { info: {} } });

    const result = await handleWorkatoReloadExtensionCall({ profile: 'nope' }, deps);

    expect(result.isError).toBe(true);
    expect(parse(result).error).toContain('"nope" is not connected');
    expect(calls).toEqual([]);
  });

  test('check_only reports stale builds and reloads nothing', async () => {
    const { deps, calls } = harness({
      personal: { info: { built_at: 'A', disk_built_at: 'B', stale: true, owns_bridge: true } },
      bluBanyan: { info: { built_at: 'B', disk_built_at: 'B', stale: false } },
    });

    const body = parse(await handleWorkatoReloadExtensionCall({ check_only: true }, deps));

    expect(body.all_current).toBe(false);
    expect(body.profiles.find((p: any) => p.profile === 'personal')).toMatchObject({
      stale: true,
      owns_bridge: true,
    });
    expect(calls.some((c) => c.type === NativeMessageType.DEV_RELOAD_EXTENSION)).toBe(false);
  });
});
