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
  LEMON_SQUEEZY_WEBHOOK_SECRET: 'Lemon Squeezy webhook signing secret',
  LEMON_SQUEEZY_API_KEY: 'Lemon Squeezy REST API key',
  LEMON_SQUEEZY_STORE_ID: 'Lemon Squeezy store ID',
  LS_VARIANT_STARTER: 'LS variant ID for STARTER plan',
  LS_VARIANT_PRO: 'LS variant ID for PRO plan',
  LS_VARIANT_PREMIUM: 'LS variant ID for PREMIUM plan',
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

  // Rate limits, lockouts, and threat bans key on the client IP. Without the
  // origin secret, anyone who reaches the origin directly can forge
  // CF-Connecting-IP per request and rotate identities at will.
  if (!process.env.CF_ORIGIN_SECRET || process.env.CF_ORIGIN_SECRET.length < 32) {
    console.error(
      '❌  CF_ORIGIN_SECRET missing or under 32 chars — required in production. ' +
        'Set the same value in the Cloudflare Transform Rule (x-cf-origin-secret).',
    );
    hasError = true;
  }

  // Prisma + a transaction pooler (Supabase port 6543) WITHOUT pgbouncer=true
  // fails under concurrency with "prepared statement s0 already exists" —
  // invisible in single-user dev, guaranteed in production.
  const dbUrl = process.env.DATABASE_URL ?? '';
  if (dbUrl.includes(':6543') && !/[?&]pgbouncer=true/.test(dbUrl)) {
    console.error(
      '❌  DATABASE_URL uses the transaction pooler (6543) without pgbouncer=true — ' +
        'append ?pgbouncer=true&connection_limit=10 (Prisma prepared statements break otherwise)',
    );
    hasError = true;
  }
}

async function checkRedisEvictionPolicy(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return; // Already caught by required var check above.

  try {
    // Parse Upstash REST endpoint from the rediss:// URL.
    // Format: rediss://:<password>@<host>:<port>
    const url = new URL(redisUrl.replace(/^redis(s?):\/\//, 'https://'));
    const token = url.password;
    const host = url.hostname;

    if (!token || !host) {
      console.warn('⚠️  Could not parse REDIS_URL for eviction policy check — verify manually in Upstash console');
      return;
    }

    const response = await fetch(`https://${host}/config/get/maxmemory-policy`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      console.warn(`⚠️  Could not verify Redis eviction policy (HTTP ${response.status}) — check manually in Upstash console`);
      return;
    }

    const data = await response.json() as { result: string[] };
    const policy = data.result?.[1];

    if (policy === 'noeviction') {
      console.log('✅  Redis eviction policy: noeviction');
    } else if (policy) {
      console.warn(`⚠️  WARNING: Redis eviction policy is "${policy}". ` +
        'Set to "noeviction" in Upstash console — otherwise rate-limit counters and JTI deny-list entries can be silently evicted.');
      hasError = true;
    } else {
      console.warn('⚠️  Could not read Redis eviction policy from response — check manually in Upstash console');
    }
  } catch {
    console.warn('⚠️  Could not verify Redis eviction policy — check manually in Upstash console');
  }
}

await checkRedisEvictionPolicy();

if (hasError) {
  console.error('\nDeploy blocked — fix the above issues first.\n');
  process.exit(1);
} else {
  console.log('\nAll required environment variables are present.\n');
}
