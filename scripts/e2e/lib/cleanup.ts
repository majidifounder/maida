import { prisma } from '@restaurant/db';
import type { E2eContext } from './context.js';
import { E2E_EMAIL_DOMAIN } from './context.js';

export async function cleanupE2eData(ctx: E2eContext): Promise<void> {
  const userIds = [...ctx.userIds];
  const restaurantIds = [...ctx.restaurantIds];
  const reservationIds = [...ctx.reservationIds];

  if (reservationIds.length > 0) {
    await prisma.reservation.deleteMany({
      where: { id: { in: reservationIds } },
    });
  }

  if (restaurantIds.length > 0) {
    await prisma.reservation.deleteMany({
      where: { restaurantId: { in: restaurantIds } },
    });
    await prisma.tableCombinationMember.deleteMany({
      where: { combination: { restaurantId: { in: restaurantIds } } },
    });
    await prisma.tableCombination.deleteMany({
      where: { restaurantId: { in: restaurantIds } },
    });
    await prisma.turnTimeRule.deleteMany({
      where: { restaurantId: { in: restaurantIds } },
    });
    await prisma.diningTable.deleteMany({
      where: { restaurantId: { in: restaurantIds } },
    });
    await prisma.restaurant.deleteMany({
      where: { id: { in: restaurantIds } },
    });
  }

  if (userIds.length > 0) {
    const ownedRestaurants = await prisma.restaurant.findMany({
      where: { ownerId: { in: userIds } },
      select: { id: true },
    });
    const ownedRestIds = ownedRestaurants.map((r) => r.id);

    if (ownedRestIds.length > 0) {
      await prisma.reservation.deleteMany({
        where: { restaurantId: { in: ownedRestIds } },
      });
      await prisma.tableCombinationMember.deleteMany({
        where: { combination: { restaurantId: { in: ownedRestIds } } },
      });
      await prisma.tableCombination.deleteMany({
        where: { restaurantId: { in: ownedRestIds } },
      });
      await prisma.turnTimeRule.deleteMany({
        where: { restaurantId: { in: ownedRestIds } },
      });
      await prisma.diningTable.deleteMany({
        where: { restaurantId: { in: ownedRestIds } },
      });
      await prisma.restaurant.deleteMany({
        where: { id: { in: ownedRestIds } },
      });
    }

    await prisma.auditLog.deleteMany({
      where: { actorId: { in: userIds } },
    });
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: userIds }, entityType: 'User' },
    });
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

  // Safety net for orphaned rows from crashed runs.
  const orphanedUsers = await prisma.user.findMany({
    where: { email: { endsWith: E2E_EMAIL_DOMAIN } },
    select: { id: true },
  });
  if (orphanedUsers.length > 0) {
    const ids = orphanedUsers.map((u) => u.id);
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await prisma.reservation.deleteMany({
      where: { restaurant: { ownerId: { in: ids } } },
    });
    await prisma.restaurant.deleteMany({ where: { ownerId: { in: ids } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
    await prisma.subscription.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }

  await prisma.$disconnect();
}
