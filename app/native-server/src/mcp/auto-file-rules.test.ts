import { describe, expect, test } from '@jest/globals';
import {
  combineAutoFileRules,
  CORE_AUTO_FILE_RULES,
  isAutoFileEligible,
  prepareAutoFileCall,
  withOutFileToolSchemas,
  type AutoFileRules,
} from './auto-file';

/**
 * Core auto-file knows only core tools; a module brings its own read tools
 * (the Workato rules are tested in modules/workato/auto-file.test.ts).
 */
describe('core auto-file rules', () => {
  test('know the browser reads and the screenshot, and no module tool', () => {
    expect(isAutoFileEligible('chrome_snapshot')).toBe(true);
    expect(isAutoFileEligible('chrome_screenshot')).toBe(true);
    expect(isAutoFileEligible('workato_job_trace')).toBe(false);
    expect(isAutoFileEligible('chrome_bridge_info')).toBe(false);
  });

  test('a module tool keeps its args untouched under core rules alone', () => {
    const args = { recipe_id: 1, out_file: '/nowhere/x.json' };
    expect(prepareAutoFileCall('workato_job_trace', args)).toEqual({ args });
  });
});

describe('combineAutoFileRules', () => {
  const moduleRules: AutoFileRules = {
    readTools: new Set(['mod_read']),
    accepts: (name) => name === 'mod_write',
    fileStem: (name) => (name.startsWith('mod_') ? name.slice(4) : undefined),
  };
  const rules = combineAutoFileRules([CORE_AUTO_FILE_RULES, moduleRules]);

  test('unions the read tools and the accepted tools', () => {
    expect(isAutoFileEligible('mod_read', rules)).toBe(true);
    expect(isAutoFileEligible('mod_write', rules)).toBe(true);
    expect(isAutoFileEligible('chrome_snapshot', rules)).toBe(true);
    expect(isAutoFileEligible('mod_other', rules)).toBe(false);
  });

  test('advertises the file params on read tools only', () => {
    const served = withOutFileToolSchemas(
      [
        { name: 'mod_read', inputSchema: { type: 'object', properties: {} } },
        { name: 'mod_write', inputSchema: { type: 'object', properties: {} } },
      ],
      rules,
    );
    expect((served[0].inputSchema.properties as any).out_file).toBeDefined();
    expect((served[1].inputSchema.properties as any).out_file).toBeUndefined();
  });

  test('a module stem names its spilled files; core tools keep their name', () => {
    expect(prepareAutoFileCall('mod_read', {}, rules).plan?.fileStem).toBe('read');
    expect(prepareAutoFileCall('chrome_snapshot', {}, rules).plan?.fileStem).toBeUndefined();
  });
});
