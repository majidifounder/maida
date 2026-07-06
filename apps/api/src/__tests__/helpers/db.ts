import { prisma } from '@restaurant/db';

export async function cleanupTestUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;

  await prisma.auditLog.deleteMany({
    where: { actorId: { in: userIds } },
  });

  const ownedRestaurants = await prisma.restaurant.findMany({
    where: { ownerId: { in: userIds } },
    select: { id: true },
  });
  const restaurantIds = ownedRestaurants.map((r) => r.id);

  if (restaurantIds.length > 0) {
    await prisma.reservation.deleteMany({
      where: { restaurantId: { in: restaurantIds } },
    });
    await prisma.diningTable.deleteMany({
      where: { restaurantId: { in: restaurantIds } },
    });
    await prisma.restaurant.deleteMany({
      where: { id: { in: restaurantIds } },
    });
  }

  await prisma.subscription.deleteMany({
    where: { userId: { in: userIds } },
  });

  await prisma.refreshToken.deleteMany({
    where: { userId: { in: userIds } },
  });

  await prisma.user.deleteMany({
    where: { id: { in: userIds } },
  });
}
