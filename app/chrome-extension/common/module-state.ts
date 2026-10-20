/**
 * The module switch as this browser profile last heard it from the bridge.
 *
 * The switch lives in the bridge (one per machine). The background keeps the
 * last state the bridge pushed in chrome.storage.local, so the service worker
 * (after a restart), the popup and a module's content scripts all read the
 * same value. A module the bridge never mentioned is on: that is how the
 * bridge treats it too.
 *
 * Kept free of the shared package, so a content script that imports it stays
 * small.
 */

import { STORAGE_KEYS } from './constants';

export interface StoredModuleState {
  id: string;
  title: string;
  enabled: boolean;
}

export interface StoredModulesState {
  modules: StoredModuleState[];
  /** Epoch ms the background stored it. */
  received_at: number;
}

export type ModuleStates = Record<string, boolean>;

/** The id -> on map of a stored (or pushed) state; anything malformed is skipped. */
export function moduleStatesOf(raw: unknown): ModuleStates {
  const out: ModuleStates = {};
  const modules = (raw as { modules?: unknown } | null)?.modules;
  if (!Array.isArray(modules)) return out;
  for (const entry of modules) {
    if (entry && typeof entry.id === 'string' && typeof entry.enabled === 'boolean') {
      out[entry.id] = entry.enabled;
    }
  }
  return out;
}

export function isModuleOn(states: ModuleStates, id: string): boolean {
  return states[id] ?? true;
}

export async function readStoredModulesState(): Promise<StoredModulesState | null> {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEYS.MODULES_STATE]);
    const raw = result?.[STORAGE_KEYS.MODULES_STATE];
    return raw && typeof raw === 'object' ? (raw as StoredModulesState) : null;
  } catch {
    return null;
  }
}

/** Call `listener` with the new id -> on map whenever the stored state changes. */
export function watchModuleStates(listener: (states: ModuleStates) => void): () => void {
  const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !changes[STORAGE_KEYS.MODULES_STATE]) return;
    listener(moduleStatesOf(changes[STORAGE_KEYS.MODULES_STATE].newValue));
  };
  try {
    chrome.storage.onChanged.addListener(onChanged);
  } catch {
    return () => {};
  }
  return () => {
    try {
      chrome.storage.onChanged.removeListener(onChanged);
    } catch {
      /* the context is going away */
    }
  };
}
