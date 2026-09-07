/**
 * Runs before any module of a test file loads (jest `setupFiles`).
 *
 * The operations journal defaults to the bridge's real state directory
 * (%LOCALAPPDATA%/mcp-chrome-bridge/operations on Windows). Any test that
 * drives save_with_dependents or the operation status tool without setting
 * WORKATOMCP_OPERATIONS_DIR itself therefore wrote real journal files during
 * the suite. Point the whole run at a fresh temp directory instead: a test
 * that sets its own override still wins, because this only fills in a blank.
 */
const os = require('os');
const path = require('path');

if (!process.env.WORKATOMCP_OPERATIONS_DIR) {
  const unique = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  process.env.WORKATOMCP_OPERATIONS_DIR = path.join(
    os.tmpdir(),
    `workatomcp-jest-operations-${unique}`,
  );
}
