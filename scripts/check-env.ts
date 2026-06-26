/**
 * Pre-deploy environment check.
 * Run: pnpm check-env
 */
import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const REQUIRED: Record<string, string> = {
  DATABASE_URL: 'Supabase pooled connection (port 6543)',
  DIRECT_DATABASE_URL: 'Supabase direct connection (port 5432) — for migrations',
  REDIS_URL: 'Upstash Redis URL (rediss://...)',
  JWT_PRIVATE_KEY: 'RS256 PEM private key (PKCS#8)',
  JWT_PUBLIC_KEY: 'RS256 PEM public key',
  CORS_ORIGIN: 'Comma-separated list of allowed origins',
  RESEND_API_KEY: 'Resend.com API key',
  EMAIL_FROM: 'Sender address — must be verified in Resend dashboard',
  NODE_ENV: 'Must be "production" in prod deployments',
};

let hasError = false;

for (const [key, description] of Object.entries(REQUIRED)) {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    console.error(`❌  Missing: ${key.padEnd(25)} — ${description}`);
    hasError = true;
  } else {
    const preview =
      value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : '****';
    console.log(`✅  ${key.padEnd(25)} ${preview}`);
  }
}

if (process.env.NODE_ENV === 'production') {
  const origin = process.env.CORS_ORIGIN ?? '';
  if (origin.includes('localhost')) {
    console.error(
      '❌  CORS_ORIGIN contains "localhost" — must use production domains in prod',
    );
    hasError = true;
  }
  if ((process.env.JWT_PRIVATE_KEY ?? '').length < 100) {
    console.error(
      '❌  JWT_PRIVATE_KEY looks too short — check the PEM key is complete',
    );
    hasError = true;
  }
}

if (hasError) {
  console.error('\nDeploy blocked — fix the above issues first.\n');
  process.exit(1);
} else {
  console.log('\nAll required environment variables are present.\n');
}
