import { PrismaClient, Role, CuisineType, ReservationStatus } from '@prisma/client';
import { faker } from '@faker-js/faker';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/** Shared dev login for all seeded users — printed again at end of seed. */
export const DEV_PASSWORD = 'password123';

const DEV_PASSWORD_HASH = bcrypt.hashSync(DEV_PASSWORD, 12);

async function main(): Promise<void> {
  console.log('🌱 Seeding database...');

  // Seeded accounts are pre-verified so demo diners/owners can book and create
  // restaurants immediately (the R7b verification gate would otherwise block
  // them — seed data is meant to be usable out of the box).
  const now = new Date();

  const owners = await Promise.all(
    ['alice@example.com', 'bob@example.com'].map((email) =>
      prisma.user.upsert({
        where: { email },
        update: { emailVerifiedAt: now },
        create: {
          email,
          password: DEV_PASSWORD_HASH,
          role: Role.OWNER,
          emailVerifiedAt: now,
        },
      }),
    ),
  );

  const diners = await Promise.all(
    Array.from({ length: 10 }, (_, i) => `diner${i + 1}@example.com`).map(
      (email) =>
        prisma.user.upsert({
          where: { email },
          update: { emailVerifiedAt: now },
          create: {
            email,
            password: DEV_PASSWORD_HASH,
            role: Role.DINER,
            emailVerifiedAt: now,
          },
        }),
    ),
  );

  const restaurantDefs = [
    {
      name: 'Bistro Parisien',
      cuisine: CuisineType.FRENCH,
      city: 'Paris',
      timezone: 'Europe/Paris',
      owner: owners[0]!,
      tables: [
        { name: 'Table 1', minPartySize: 1, maxPartySize: 2 },
        { name: 'Table 2', minPartySize: 1, maxPartySize: 2 },
        { name: 'Booth A', minPartySize: 2, maxPartySize: 4 },
        { name: 'Booth B', minPartySize: 2, maxPartySize: 6 },
      ],
    },
    {
      name: 'Sakura Garden',
      cuisine: CuisineType.JAPANESE,
      city: 'Tokyo',
      timezone: 'Asia/Tokyo',
      owner: owners[0]!,
      tables: [
        { name: 'Tatami 1', minPartySize: 1, maxPartySize: 4 },
        { name: 'Tatami 2', minPartySize: 1, maxPartySize: 4 },
      ],
    },
    {
      name: 'Casa del Sole',
      cuisine: CuisineType.ITALIAN,
      city: 'Rome',
      timezone: 'Europe/Rome',
      owner: owners[1]!,
      tables: [
        { name: 'Patio 1', minPartySize: 2, maxPartySize: 4 },
        { name: 'Patio 2', minPartySize: 2, maxPartySize: 4 },
        { name: 'Indoor 1', minPartySize: 1, maxPartySize: 6 },
      ],
    },
    {
      name: 'Spice of India',
      cuisine: CuisineType.INDIAN,
      city: 'Mumbai',
      timezone: 'Asia/Kolkata',
      owner: owners[1]!,
      seatingMode: 'FLEXIBLE' as const,
      tables: [
        { name: 'Table 1', minPartySize: 2, maxPartySize: 4 },
        { name: 'Table 2', minPartySize: 2, maxPartySize: 4 },
        { name: 'Table 3', minPartySize: 2, maxPartySize: 4 },
      ],
    },
  ];

  const restaurants = [];
  for (const r of restaurantDefs) {
    const restaurant = await prisma.restaurant.upsert({
      where: { slug: r.name.toLowerCase().replace(/\s+/g, '-') },
      update: {},
      create: {
        ownerId: r.owner.id,
        name: r.name,
        slug: r.name.toLowerCase().replace(/\s+/g, '-'),
        cuisine: r.cuisine,
        description: faker.lorem.paragraph(),
        address: faker.location.streetAddress(),
        city: r.city,
        timezone: 'timezone' in r ? r.timezone : 'UTC',
        seatingMode: 'seatingMode' in r ? r.seatingMode : 'LOCKED',
        defaultDurationMins: 90,
        openMinutes: 660,
        closeMinutes: 1380,
      },
    });
    restaurants.push({ ...restaurant, tableDefs: r.tables });
  }

  for (const restaurant of restaurants) {
    for (const t of restaurant.tableDefs) {
      await prisma.diningTable.upsert({
        where: {
          restaurantId_name: { restaurantId: restaurant.id, name: t.name },
        },
        update: {},
        create: {
          restaurantId: restaurant.id,
          name: t.name,
          minPartySize: t.minPartySize,
          maxPartySize: t.maxPartySize,
        },
      });
    }
  }

  const statusMix: ReservationStatus[] = [
    ReservationStatus.SCHEDULED,
    ReservationStatus.SCHEDULED,
    ReservationStatus.SEATED,
    ReservationStatus.CANCELLED,
    ReservationStatus.NO_SHOW,
  ];

  let reservationCount = 0;
  for (const diner of diners.slice(0, 6)) {
    for (let i = 0; i < 2; i++) {
      const restaurant = restaurants[reservationCount % restaurants.length]!;
      const tables = await prisma.diningTable.findMany({
        where: { restaurantId: restaurant.id, isActive: true },
        orderBy: { maxPartySize: 'asc' },
      });
      if (tables.length === 0) continue;

      const table = tables[reservationCount % tables.length]!;
      const startsAt = new Date();
      startsAt.setDate(startsAt.getDate() + 1 + (reservationCount % 5));
      startsAt.setUTCHours(12 + (reservationCount % 4) * 2, 0, 0, 0);
      const endsAt = new Date(startsAt.getTime() + 90 * 60_000);
      const status = statusMix[reservationCount % statusMix.length]!;
      const partySize = Math.min(2, table.maxPartySize);

      const reservation = await prisma.reservation.create({
        data: {
          restaurantId: restaurant.id,
          dinerId: diner.id,
          partySize,
          startsAt,
          endsAt,
          status,
          reservationType: 'STANDARD',
          source: 'ONLINE',
          ...(status === 'CANCELLED' && { cancelledAt: new Date() }),
          ...(status === 'NO_SHOW' && { noShowAt: new Date() }),
          ...(status === 'SEATED' && { seatedAt: new Date() }),
        },
      });

      if (status === 'SCHEDULED' || status === 'SEATED' || status === 'COMPLETED') {
        await prisma.reservationTable.create({
          data: {
            reservationId: reservation.id,
            tableId: table.id,
            startsAt,
            endsAt,
          },
        });
      }

      reservationCount++;
    }
  }

  console.log(`✅ Seeded ${owners.length} owners, ${diners.length} diners`);
  console.log(`✅ Seeded ${restaurants.length} restaurants with dining tables`);
  console.log(`✅ Seeded ${reservationCount} reservations`);
  console.log(`\n🔑 Dev login — all seed users share password: ${DEV_PASSWORD}`);
  console.log('   Owners: alice@example.com, bob@example.com');
  console.log('   Diners: diner1@example.com … diner10@example.com');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
