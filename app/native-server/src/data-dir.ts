/**
 * The bridge's per-machine data directory (~/.workatomcp): the function
 * registry, the module switch config. One helper, so the directory can move
 * in one place.
 *
 * MOKUTAB_DATA_DIR (or the WORKATOMCP_DATA_DIR it replaced) overrides it
 * (the test setup points it at a temp dir, so a test never reads the
 * machine's real config).
 */

import * as os from 'os';
import * as path from 'path';
import { readEnv } from './env';

export const DATA_DIR_ENV = 'MOKUTAB_DATA_DIR';

export function dataDir(): string {
  const override = readEnv(DATA_DIR_ENV);
  return override ? path.resolve(override.trim()) : path.join(os.homedir(), '.workatomcp');
}

/** The bridge config file (module switches). */
export function configFile(): string {
  return path.join(dataDir(), 'config.json');
}
