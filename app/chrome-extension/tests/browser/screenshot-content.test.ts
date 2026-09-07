import { describe, expect, it } from 'vitest';
import {
  base64ByteLength,
  buildScreenshotContent,
} from '../../entrypoints/background/tools/browser/screenshot';

// One pixel of JPEG is enough: the point is the envelope, not the image.
const PIXEL = 'AAECAwQFBgcICQoLDA0ODw==';

describe('base64ByteLength', () => {
  it('counts decoded bytes without decoding', () => {
    expect(base64ByteLength(PIXEL)).toBe(16);
    expect(base64ByteLength('')).toBe(0);
  });
});

describe('buildScreenshotContent', () => {
  it('returns the capture as an image block and keeps base64 out of the text', () => {
    const content = buildScreenshotContent({
      name: 'shot',
      tabId: 7,
      url: 'https://app.workato.com/recipes/1',
      width: 1280,
      height: 720,
      base64: PIXEL,
      mimeType: 'image/jpeg',
    });

    expect(content[0]).toEqual({ type: 'image', data: PIXEL, mimeType: 'image/jpeg' });
    expect(content[1].type).toBe('text');

    const text = (content[1] as { text: string }).text;
    expect(text).not.toContain(PIXEL);
    expect(JSON.parse(text)).toMatchObject({
      success: true,
      tabId: 7,
      url: 'https://app.workato.com/recipes/1',
      name: 'shot',
      width: 1280,
      height: 720,
      mimeType: 'image/jpeg',
      bytes: 16,
      image_returned: true,
      fileSaved: false,
    });
  });

  it('reports the saved file alongside the image when both were asked for', () => {
    const content = buildScreenshotContent({
      name: 'shot',
      base64: PIXEL,
      mimeType: 'image/jpeg',
      fileSaved: true,
      filename: 'shot.png',
      fullPath: 'C:/Users/me/Downloads/shot.png',
      downloadId: 12,
    });

    expect(content).toHaveLength(2);
    expect(content[0].type).toBe('image');
    expect(JSON.parse((content[1] as { text: string }).text)).toMatchObject({
      image_returned: true,
      fileSaved: true,
      filename: 'shot.png',
      fullPath: 'C:/Users/me/Downloads/shot.png',
      downloadId: 12,
    });
  });

  it('returns metadata only when no image was requested', () => {
    const content = buildScreenshotContent({
      name: 'shot',
      fileSaved: true,
      fullPath: 'C:/Users/me/Downloads/shot.png',
      saveError: undefined,
    });

    expect(content).toHaveLength(1);
    expect(content[0].type).toBe('text');
    const payload = JSON.parse((content[0] as { text: string }).text);
    expect(payload.image_returned).toBe(false);
    expect(payload.mimeType).toBeUndefined();
    expect(payload.bytes).toBeUndefined();
    expect(payload.fileSaved).toBe(true);
  });

  it('keeps a save failure visible', () => {
    const content = buildScreenshotContent({
      name: 'shot',
      base64: PIXEL,
      fileSaved: false,
      saveError: 'Download blocked',
    });

    const payload = JSON.parse((content[1] as { text: string }).text);
    expect(payload.fileSaved).toBe(false);
    expect(payload.saveError).toBe('Download blocked');
  });
});
