import { describe, expect, test } from '@jest/globals';
import { COMMAND_NAME, PACKAGE_NAME } from './scripts/constant';

const pkg = require('../package.json') as { name: string; bin: Record<string, string> };

const CLI = './dist/cli.js';
const STDIO = './dist/mcp/mcp-server-stdio.js';

describe('package bins', () => {
  test('the package and its commands carry the MokuTab names', () => {
    expect(pkg.name).toBe(PACKAGE_NAME);
    expect(pkg.bin[COMMAND_NAME]).toBe(CLI);
    expect(pkg.bin['mokutab-stdio']).toBe(STDIO);
  });

  // Scripts, MCP registrations and docs on other machines call these; they
  // stay until 3.0.
  test('every 1.x command name is still an alias of the same entry point', () => {
    expect(pkg.bin['workatomcp-bridge']).toBe(CLI);
    expect(pkg.bin['workatomcp-stdio']).toBe(STDIO);
    expect(pkg.bin['mcp-chrome-bridge']).toBe(CLI);
    expect(pkg.bin['chrome-mcp-bridge']).toBe(CLI);
    expect(pkg.bin['mcp-chrome-stdio']).toBe(STDIO);
  });
});
