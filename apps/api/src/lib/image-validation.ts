const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP_RIFF = Buffer.from('RIFF');
const WEBP_MAGIC = Buffer.from('WEBP');

export type AllowedImageType = 'jpeg' | 'png' | 'webp';

export interface ValidatedImage {
  type: AllowedImageType;
  ext: 'jpg' | 'png' | 'webp';
  contentType: string;
}

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export function assertLogoSize(byteLength: number): void {
  if (byteLength > MAX_LOGO_BYTES) {
    throw new Error('Logo must be 2 MB or smaller.');
  }
  if (byteLength < 12) {
    throw new Error('File is too small to be a valid image.');
  }
}

function startsWith(buf: Buffer, prefix: Buffer): boolean {
  return buf.subarray(0, prefix.length).equals(prefix);
}

/** Detect real image type from magic bytes — never trust client MIME or extension. */
export function detectAllowedImage(buf: Buffer): ValidatedImage | null {
  if (startsWith(buf, JPEG)) {
    return { type: 'jpeg', ext: 'jpg', contentType: 'image/jpeg' };
  }
  if (startsWith(buf, PNG)) {
    return { type: 'png', ext: 'png', contentType: 'image/png' };
  }
  if (
    buf.length >= 12 &&
    startsWith(buf, WEBP_RIFF) &&
    buf.subarray(8, 12).equals(WEBP_MAGIC)
  ) {
    return { type: 'webp', ext: 'webp', contentType: 'image/webp' };
  }
  return null;
}

export function validateLogoBuffer(buf: Buffer): ValidatedImage {
  assertLogoSize(buf.length);
  const detected = detectAllowedImage(buf);
  if (!detected) {
    throw new Error(
      'Only JPEG, PNG, or WebP images are allowed. SVG and other formats are rejected.',
    );
  }
  return detected;
}

export { MAX_LOGO_BYTES };
