/**
 * The Workato module's content scripts run only while the module is on.
 *
 * WXT requires content-script entrypoints at the top of entrypoints/, so
 * `workato-field-outline.content.ts` lives there, but it belongs to this
 * module: it starts through `gateWorkatoContent`, which reads the switch the
 * background stored (common/module-state.ts), and follows it when the popup
 * changes it, starting or stopping the script in an open tab.
 *
 * Imports nothing from the shared package, so the content script stays small.
 */

import {
  isModuleOn,
  moduleStatesOf,
  readStoredModulesState,
  watchModuleStates,
} from '@/common/module-state';

export const WORKATO_MODULE_ID = 'workato';

/** Whether the Workato module is on, as this profile last heard from the bridge. */
export async function workatoContentEnabled(): Promise<boolean> {
  return isModuleOn(moduleStatesOf(await readStoredModulesState()), WORKATO_MODULE_ID);
}

/**
 * Run `start` while the module is on: not at all while it is off, at once
 * when it is switched on, and its returned stop when it is switched off.
 * Resolves after the first check; the returned function stops following.
 */
export async function gateWorkatoContent(start: () => () => void): Promise<() => void> {
  let stop: (() => void) | null = null;
  const apply = (on: boolean) => {
    if (on && !stop) {
      stop = start();
    } else if (!on && stop) {
      const running = stop;
      stop = null;
      running();
    }
  };
  // A change that lands while the first read is pending is newer than that read.
  let changed = false;
  const unwatch = watchModuleStates((states) => {
    changed = true;
    apply(isModuleOn(states, WORKATO_MODULE_ID));
  });
  const initial = await workatoContentEnabled();
  if (!changed) apply(initial);
  return () => {
    unwatch();
    apply(false);
  };
}
