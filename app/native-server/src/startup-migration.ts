/**
 * What a bridge start does before anything reads the data dir: move
 * ~/.workatomcp to ~/.mokutab (the first 2.x start), and decide, once,
 * whether this machine is a fresh install or an upgrade from 1.x. Runs in the
 * bridge process only (index.ts); doctor and the stdio proxy read whichever
 * directory holds the data (data-dir.ts).
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  homeDataDirs,
  migrateDataDir,
  recordDataDirMove,
  type DataDirMove,
  type MigrateDataDirOptions,
} from './data-dir';
import type { BridgeModule } from './mcp/module-api';
import { recordModuleDefaults } from './mcp/module-switch';
import { INSTALLED_MODULES } from './modules';
import { updateStateDir } from './update-checker';

export interface StartupMigrationOptions extends MigrateDataDirOptions {
  modules?: readonly Pick<BridgeModule, 'id' | 'onAfterUpgrade'>[];
  /** The bridge state dir (default: the one the bridge uses, updateStateDir). */
  stateDir?: string;
}

/**
 * What says this machine ran 1.x: its data dir (~/.workatomcp), or its state
 * dir (%LOCALAPPDATA%\mcp-chrome-bridge on Windows; every 1.x start created
 * it, while ~/.workatomcp exists only once a browser function was saved).
 * Read before this process writes anything: 2.x keeps its own state in that
 * same dir (update flag, default profile, watches), so a look after any of
 * that would call every fresh install an upgrade.
 *
 * Accepted edge: the upstream mcp-chrome-bridge uses the same state dir, so a
 * machine that had it counts as an upgrade and gets Workato on. Harmless:
 * one switch in the popup turns it off.
 */
function upgradeEvidence(legacyDataDir: string, stateDir: string): string | null {
  if (fs.existsSync(legacyDataDir)) return `${legacyDataDir} exists`;
  if (fs.existsSync(stateDir)) return `${stateDir} exists`;
  return null;
}

export function migrateOnStart(options: StartupMigrationOptions = {}): DataDirMove {
  const stateDir = options.stateDir ?? updateStateDir();
  const evidence = upgradeEvidence(homeDataDirs(options.home).legacy, stateDir);

  const move = migrateDataDir(options);
  recordDataDirMove(move, stateDir);

  // Record the decision as explicit values the first time it is made: a
  // fresh install's own first start creates the state dir, so its second
  // start would otherwise look like an upgrade. An explicit value, the
  // person's or an earlier start's, is never rewritten. An override dir is
  // somebody's deliberate setup and is left alone.
  if (move.outcome !== 'override') {
    const ids = (options.modules ?? INSTALLED_MODULES)
      .filter((module) => module.onAfterUpgrade)
      .map((module) => module.id);
    if (ids.length > 0) {
      recordModuleDefaults(
        path.join(move.dir, 'config.json'),
        ids,
        evidence !== null,
        evidence ? `this machine ran 1.x (${evidence})` : 'a fresh install',
        options.log,
      );
    }
  }
  return move;
}
