/**
 * The bridge's per-machine data directory (~/.workatomcp): the function
 * registry, the module switch config. One helper, so the directory can move
 * in one place.
 *
 * WORKATOMCP_DATA_DIR overrides it (the test setup points it at a temp dir,
 * so a test never reads the machine's real config).
 */

import * as os from 'os';
import * as path from 'path';

export const DATA_DIR_ENV = 'WORKATOMCP_DATA_DIR';

export function dataDir(): string {
  const override = process.env[DATA_DIR_ENV];
  return override && override.trim()
    ? path.resolve(override.trim())
    : path.join(os.homedir(), '.workatomcp');
}

/** The bridge config file (module switches). */
export function configFile(): string {
  return path.join(dataDir(), 'config.json');
}
