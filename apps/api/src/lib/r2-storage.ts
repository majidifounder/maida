import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../env.js';
import type { ValidatedImage } from './image-validation.js';

export function isR2Configured(): boolean {
  return Boolean(
    env.R2_ACCOUNT_ID &&
      env.R2_ACCESS_KEY_ID &&
      env.R2_SECRET_ACCESS_KEY &&
      env.R2_BUCKET_NAME &&
      env.R2_PUBLIC_URL,
  );
}

/** Local disk fallback for dev/test when R2 credentials are not set. */
export function canUseLocalLogoStorage(): boolean {
  return env.NODE_ENV !== 'production';
}

export function isLogoUploadAvailable(): boolean {
  return isR2Configured() || canUseLocalLogoStorage();
}

export function getLocalLogosRoot(): string {
  return join(process.cwd(), 'uploads', 'logos');
}

export function localLogoPublicBaseUrl(): string {
  const host = env.NODE_ENV === 'test' ? '127.0.0.1' : 'localhost';
  return `http://${host}:${env.PORT}`;
}

let client: S3Client | null = null;

function getR2Client(): S3Client {
  if (!isR2Configured()) {
    throw new Error('Object storage is not configured');
  }
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return client;
}

async function uploadRestaurantLogoLocal(
  restaurantId: string,
  body: Buffer,
  image: ValidatedImage,
): Promise<string> {
  const filename = `${randomUUID()}.${image.ext}`;
  const dir = join(getLocalLogosRoot(), restaurantId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), body);

  return `${localLogoPublicBaseUrl()}/uploads/logos/${restaurantId}/${filename}`;
}

export async function uploadRestaurantLogo(
  restaurantId: string,
  body: Buffer,
  image: ValidatedImage,
): Promise<string> {
  if (isR2Configured()) {
    const key = `logos/${restaurantId}/${randomUUID()}.${image.ext}`;
    const s3 = getR2Client();

    await s3.send(
      new PutObjectCommand({
        Bucket: env.R2_BUCKET_NAME!,
        Key: key,
        Body: body,
        ContentType: image.contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    const base = env.R2_PUBLIC_URL!.replace(/\/$/, '');
    return `${base}/${key}`;
  }

  if (canUseLocalLogoStorage()) {
    return uploadRestaurantLogoLocal(restaurantId, body, image);
  }

  throw new Error('Object storage is not configured');
}

const LOGO_FILENAME_RE = /^[0-9a-f-]{36}\.(jpg|png|webp)$/i;

export async function openLocalLogoFile(
  restaurantId: string,
  filename: string,
): Promise<{ stream: ReturnType<typeof createReadStream>; contentType: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(restaurantId) || !LOGO_FILENAME_RE.test(filename)) {
    return null;
  }

  const root = resolve(getLocalLogosRoot());
  const filePath = resolve(root, restaurantId, filename);
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!filePath.startsWith(rootPrefix)) {
    return null;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) return null;
  } catch {
    return null;
  }

  const ext = filename.split('.').pop()!.toLowerCase();
  const contentType =
    ext === 'jpg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : 'image/webp';

  return { stream: createReadStream(filePath), contentType };
}
