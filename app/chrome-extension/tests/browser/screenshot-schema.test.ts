import { describe, expect, it } from 'vitest';
import { TOOL_NAMES, TOOL_SCHEMAS } from 'workatomcp-shared';

const schema = TOOL_SCHEMAS.find((tool) => tool.name === TOOL_NAMES.BROWSER.SCREENSHOT);

describe('chrome_screenshot schema', () => {
  it('describes the image block instead of a base64 text field', () => {
    expect(schema?.description).toMatch(/MCP image block/);
    expect(schema?.description).toMatch(/never the base64 payload/);
  });

  it('says storeBase64 and savePng are independent', () => {
    expect(schema?.description).toMatch(/independent flags/);
    const props = schema?.inputSchema.properties as Record<string, any>;
    expect(props.savePng.description).toMatch(/Independent of storeBase64/);
  });

  it('matches the handler default for fullPage', () => {
    const props = schema?.inputSchema.properties as Record<string, any>;
    expect(props.fullPage.description).toMatch(/default: false/);
  });

  it('offers a bridge-side out_file with an inline opt-out', () => {
    const props = schema?.inputSchema.properties as Record<string, any>;
    expect(props.out_file).toMatchObject({ type: 'string' });
    expect(props.no_inline).toMatchObject({ type: 'boolean' });
  });

  it('stays inside the served description budget', () => {
    expect(Buffer.byteLength(schema?.description ?? '', 'utf8')).toBeLessThan(1500);
  });
});
