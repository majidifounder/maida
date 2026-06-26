/**
 * One-shot admin TOTP setup — completes setup server-side, then you add the secret to your phone.
 *
 * Prerequisite: totpSecret must be NULL (reset in Supabase if needed).
 * API must be running on :3001.
 *
 * Usage:
 *   pnpm admin:totp-setup -- majidi.founder@gmail.com "YourPassword"
 */

import { authenticator } from 'otplib';

const BASE = process.env.API_URL ?? 'http://localhost:3001';

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];

  if (!email || !password) {
    console.error(
      'Usage: pnpm admin:totp-setup -- email@example.com "password"',
    );
    process.exit(1);
  }

  console.log(`\nAdmin TOTP setup for ${email}\n`);

  const step1 = await fetch(`${BASE}/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).then((r) => r.json() as Promise<Record<string, unknown>>);

  if (step1.requiresTOTP === true) {
    console.error(
      'TOTP already set up. Reset in Supabase SQL:\n' +
        `UPDATE "users" SET "totpSecret" = NULL WHERE email = '${email}';\n`,
    );
    process.exit(1);
  }

  if (step1.requiresTOTPSetup !== true) {
    console.error('Unexpected login response:', step1);
    process.exit(1);
  }

  const pendingToken = step1.pendingToken as string;
  const secret = step1.totpSecret as string;
  const totpToken = authenticator.generate(secret);

  const setupRes = await fetch(`${BASE}/admin/auth/totp/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      pendingToken,
      totpToken,
    }),
  });

  const setup = await setupRes.json();

  if (!setupRes.ok) {
    console.error('Setup failed:', setup);
    process.exit(1);
  }

  console.log('TOTP setup complete. User:', setup.user);

  const stats = await fetch(`${BASE}/admin/stats`, {
    headers: { Authorization: `Bearer ${setup.accessToken}` },
  }).then((r) => r.json());

  console.log('/admin/stats OK:', stats.users?.total != null);

  console.log('\nAdd to Google Authenticator (Enter setup key):');
  console.log('  Account:', email);
  console.log('  Key    :', secret);
  console.log('  Type   : Time based');
  console.log('\nVerify (phone code should match within 30s):');
  console.log(
    `  node -e "const {authenticator}=require('otplib'); console.log(authenticator.generate('${secret}'))"`,
  );
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
