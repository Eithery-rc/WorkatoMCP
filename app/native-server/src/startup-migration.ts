/**
 * What a bridge start does before anything reads the data dir: move
 * ~/.workatomcp to ~/.mokutab (the first 2.x start), and keep on the modules
 * a machine upgraded from 1.x used. Runs in the bridge process only
 * (index.ts); doctor and the stdio proxy read whichever directory holds the
 * data (data-dir.ts).
 */

import * as path from 'path';
import {
  migrateDataDir,
  recordDataDirMove,
  type DataDirMove,
  type MigrateDataDirOptions,
} from './data-dir';
import type { BridgeModule } from './mcp/module-api';
import { seedUpgradeModules } from './mcp/module-switch';
import { INSTALLED_MODULES } from './modules';

export interface StartupMigrationOptions extends MigrateDataDirOptions {
  modules?: readonly Pick<BridgeModule, 'id' | 'onAfterUpgrade'>[];
  /** Where a failed move is recorded for doctor (default: the bridge state dir). */
  stateDir?: string;
}

export function migrateOnStart(options: StartupMigrationOptions = {}): DataDirMove {
  const move = migrateDataDir(options);
  recordDataDirMove(move, options.stateDir);
  // The data came from ~/.workatomcp (moved now, or still there because the
  // move failed): a 1.x machine. A fresh install, an override, or a
  // ~/.mokutab that already existed get nothing written.
  if (move.outcome === 'moved' || move.outcome === 'move_failed') {
    const ids = (options.modules ?? INSTALLED_MODULES)
      .filter((module) => module.onAfterUpgrade)
      .map((module) => module.id);
    if (ids.length > 0) seedUpgradeModules(path.join(move.dir, 'config.json'), ids, options.log);
  }
  return move;
}
