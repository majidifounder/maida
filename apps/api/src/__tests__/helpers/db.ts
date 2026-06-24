import { prisma } from '@restaurant/db';

export async function cleanupTestUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;

  await prisma.auditLog.deleteMany({
    where: { actorId: { in: userIds } },
  });

  await prisma.refreshToken.deleteMany({
    where: { userId: { in: userIds } },
  });

  await prisma.user.deleteMany({
    where: { id: { in: userIds } },
  });
}
