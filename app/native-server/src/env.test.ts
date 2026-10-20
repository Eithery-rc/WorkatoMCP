import { describe, expect, test } from '@jest/globals';
import { legacyEnvName, readEnv } from './env';

describe('readEnv', () => {
  test('reads the MOKUTAB_ name first', () => {
    const env = { MOKUTAB_FN_DIR: '/new', WORKATOMCP_FN_DIR: '/old' };
    expect(readEnv('MOKUTAB_FN_DIR', env)).toBe('/new');
  });

  test('falls back to the WORKATOMCP_ name it replaced', () => {
    expect(readEnv('MOKUTAB_FN_DIR', { WORKATOMCP_FN_DIR: '/old' })).toBe('/old');
    // A blank new value counts as unset.
    expect(readEnv('MOKUTAB_FN_DIR', { MOKUTAB_FN_DIR: '  ', WORKATOMCP_FN_DIR: '/old' })).toBe(
      '/old',
    );
  });

  test('is undefined when neither holds a value', () => {
    expect(readEnv('MOKUTAB_FN_DIR', {})).toBeUndefined();
    expect(
      readEnv('MOKUTAB_FN_DIR', { MOKUTAB_FN_DIR: '', WORKATOMCP_FN_DIR: ' ' }),
    ).toBeUndefined();
  });

  test('an explicit new value wins even when it turns a flag off', () => {
    const env = { MOKUTAB_STRICT_TABS: '0', WORKATOMCP_STRICT_TABS: '1' };
    expect(readEnv('MOKUTAB_STRICT_TABS', env)).toBe('0');
  });

  test('only MOKUTAB_ names have a legacy name', () => {
    expect(legacyEnvName('MOKUTAB_DATA_DIR')).toBe('WORKATOMCP_DATA_DIR');
    expect(legacyEnvName('CHROME_MCP_NODE_PATH')).toBeNull();
    expect(readEnv('CHROME_MCP_NODE_PATH', { CHROME_MCP_NODE_PATH: '/node' })).toBe('/node');
  });
});
