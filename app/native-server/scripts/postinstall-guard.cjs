#!/usr/bin/env node
/**
 * postinstall guard.
 *
 * In the published npm package `dist/` is always present, so this delegates to
 * the real postinstall (native-messaging registration). In a source checkout
 * `pnpm install` runs before anything is built, so `dist/` does not exist yet —
 * without this guard the whole workspace install fails with MODULE_NOT_FOUND.
 */
const { existsSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

const target = join(__dirname, '..', 'dist', 'scripts', 'postinstall.js');

if (!existsSync(target)) {
  console.log('[workatomcp-bridge] dist/ not built yet — skipping native-messaging registration.');
  console.log('[workatomcp-bridge] Run `pnpm build` first, then `workatomcp-bridge register`.');
  process.exit(0);
}

execFileSync(process.execPath, [target], { stdio: 'inherit' });
