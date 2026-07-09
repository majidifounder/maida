import { describe, it, expect } from 'vitest';
import { detectAllowedImage, validateLogoBuffer } from '../lib/image-validation.js';

describe('image-validation', () => {
  it('accepts PNG magic bytes', () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
    ]);
    expect(detectAllowedImage(png)?.type).toBe('png');
    expect(() => validateLogoBuffer(png)).not.toThrow();
  });

  it('accepts JPEG magic bytes', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    expect(detectAllowedImage(jpeg)?.type).toBe('jpeg');
  });

  it('rejects SVG content', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(detectAllowedImage(svg)).toBeNull();
    expect(() => validateLogoBuffer(svg)).toThrow(/JPEG, PNG, or WebP/);
  });

  it('rejects files over 2 MB', () => {
    const big = Buffer.alloc(2 * 1024 * 1024 + 1, 0xff);
    big[0] = 0xff;
    big[1] = 0xd8;
    big[2] = 0xff;
    expect(() => validateLogoBuffer(big)).toThrow(/2 MB/);
  });
});
