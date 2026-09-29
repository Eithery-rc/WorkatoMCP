/**
 * Developer reload of the unpacked extension, driven by the bridge
 * (workato_reload_extension), so a rebuilt dist/ goes live without anyone
 * clicking reload in chrome://extensions.
 *
 * Every Chrome profile loads the same unpacked dist/, and each runs its own
 * copy: a rebuild reaches a profile only when that profile reloads. The bridge
 * asks each one for its build info, reloads them one at a time, and compares
 * the stamps.
 *
 * `chrome.runtime.reload()` kills this service worker, so the reply has to go
 * out first: the reload is scheduled after `delayMs`, never run inline.
 */

import { STORAGE_KEYS } from '@/common/constants';

/** Enough for the reply to reach the bridge before the worker dies. */
export const DEV_RELOAD_DEFAULT_DELAY_MS = 300;
const DEV_RELOAD_MAX_DELAY_MS = 5000;
const BUILD_INFO_FILE = 'build-info.json';

export interface ExtensionBuildInfo {
  profile: string;
  version: string;
  /** Stamp of the code this worker is running. */
  built_at: string | null;
  /** Stamp of the dist/ on disk right now; differs from built_at after a rebuild. */
  disk_built_at: string | null;
  /** True when the dist/ on disk is newer than what is running: reload needed. */
  stale: boolean;
  unpacked: boolean;
  /** This profile started the native host that serves the bridge on its port. */
  owns_bridge: boolean;
}

// Per worker lifetime: the reload itself clears it.
let reloadScheduled = false;

function runningBuildTime(): string | null {
  return typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : null;
}

/**
 * An unpacked extension serves its files straight from disk, so fetching our
 * own build-info.json reads the dist/ as it is now, not as it was loaded.
 */
async function diskBuildTime(): Promise<string | null> {
  try {
    const response = await fetch(`${chrome.runtime.getURL(BUILD_INFO_FILE)}?t=${Date.now()}`, {
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { built_at?: unknown };
    return typeof body.built_at === 'string' ? body.built_at : null;
  } catch {
    return null;
  }
}

async function profileName(): Promise<string> {
  try {
    const stored = await chrome.storage.local.get([STORAGE_KEYS.PROFILE_NAME]);
    const name = stored[STORAGE_KEYS.PROFILE_NAME];
    return typeof name === 'string' && name ? name : 'default';
  } catch {
    return 'default';
  }
}

export async function getExtensionBuildInfo(ownsBridge: boolean): Promise<ExtensionBuildInfo> {
  const builtAt = runningBuildTime();
  const diskBuiltAt = await diskBuildTime();
  return {
    profile: await profileName(),
    version: chrome.runtime.getManifest().version,
    built_at: builtAt,
    disk_built_at: diskBuiltAt,
    stale: diskBuiltAt !== null && diskBuiltAt !== builtAt,
    // A Web Store or policy install carries update_url; an unpacked one does not.
    unpacked: !('update_url' in chrome.runtime.getManifest()),
    owns_bridge: ownsBridge,
  };
}

/**
 * Schedule `chrome.runtime.reload()` and return at once, so the caller can
 * still answer the request. A second call before the reload lands is refused.
 */
export function scheduleExtensionReload(delayMs: unknown): { reload_in_ms: number } {
  if (reloadScheduled) {
    throw new Error('A reload is already scheduled in this profile.');
  }
  const delay =
    typeof delayMs === 'number' && Number.isFinite(delayMs)
      ? Math.min(Math.max(Math.round(delayMs), 0), DEV_RELOAD_MAX_DELAY_MS)
      : DEV_RELOAD_DEFAULT_DELAY_MS;
  reloadScheduled = true;
  setTimeout(() => chrome.runtime.reload(), delay);
  return { reload_in_ms: delay };
}
