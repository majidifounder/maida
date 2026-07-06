#!/usr/bin/env tsx
/**
 * One-off: create or promote a user to ADMIN (dev use).
 * Usage: pnpm exec tsx scripts/promote-admin.ts <email> <password>
 */
import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

async function main(): Promise<void> {
  const email = process.argv[2];
  const password = process.argv[3];

  if (!email || !password) {
    console.error('Usage: pnpm exec tsx scripts/promote-admin.ts <email> <password>');
    process.exit(1);
  }

  const { prisma } = await import('@restaurant/db');
  const hash = await bcrypt.hash(password, 12);

  const existing = await prisma.user.findUnique({ where: { email } });

  const user = existing
    ? await prisma.user.update({
        where: { email },
        data: {
          password: hash,
          role: 'ADMIN',
          totpSecret: null,
          deletedAt: null,
        },
        select: { id: true, email: true, role: true },
      })
    : await prisma.user.create({
        data: { email, password: hash, role: 'ADMIN' },
        select: { id: true, email: true, role: true },
      });

  await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
  await prisma.$disconnect();

  console.log(existing ? 'Updated existing user to ADMIN:' : 'Created ADMIN user:');
  console.log(`  email: ${user.email}`);
  console.log(`  id:    ${user.id}`);
  console.log('\nNext: http://localhost:5175 — sign in, scan QR, enter TOTP code.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
