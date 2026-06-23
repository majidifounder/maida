import { PrismaClient } from '@prisma/client';

// Singleton pattern — prevents connection pool exhaustion in dev with hot reloads
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
    errorFormat: 'minimal',
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Set app.user_id in every transaction — used with optional self-hosted RLS (see packages/db/sql/rls_self_hosted_optional.sql).
// On Supabase, Prisma uses the direct connection; authorization is enforced in the API (JWT + RBAC).
export async function withUserContext<T>(
  userId: string,
  fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  });
}

export * from '@prisma/client';
