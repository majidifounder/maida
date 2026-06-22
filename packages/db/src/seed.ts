import { PrismaClient, Role, CuisineType, BookingStatus } from '@prisma/client';
import { faker } from '@faker-js/faker';
import { createHash } from 'crypto';

const prisma = new PrismaClient();

// In dev only — a real bcrypt hash of "Password123!"
// Generated with: bcrypt.hash("Password123!", 12)
const DEV_PASSWORD_HASH =
  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LdmvwBJp9VG0GXrCy';

async function main(): Promise<void> {
  console.log('🌱 Seeding database...');

  // ── Owners ─────────────────────────────────────────────────────────────────
  const owners = await Promise.all(
    ['alice@example.com', 'bob@example.com'].map((email) =>
      prisma.user.upsert({
        where: { email },
        update: {},
        create: { email, password: DEV_PASSWORD_HASH, role: Role.OWNER },
      })
    )
  );

  // ── Diners ─────────────────────────────────────────────────────────────────
  const diners = await Promise.all(
    Array.from({ length: 10 }, (_, i) => `diner${i + 1}@example.com`).map((email) =>
      prisma.user.upsert({
        where: { email },
        update: {},
        create: { email, password: DEV_PASSWORD_HASH, role: Role.DINER },
      })
    )
  );

  // ── Restaurants ─────────────────────────────────────────────────────────────
  const restaurantDefs = [
    { name: 'Bistro Parisien',    cuisine: CuisineType.FRENCH,    city: 'Paris',      maxCapacity: 8,  owner: owners[0]! },
    { name: 'Sakura Garden',      cuisine: CuisineType.JAPANESE,  city: 'Tokyo',      maxCapacity: 6,  owner: owners[0]! },
    { name: 'Casa del Sole',      cuisine: CuisineType.ITALIAN,   city: 'Rome',       maxCapacity: 10, owner: owners[1]! },
    { name: 'Spice of India',     cuisine: CuisineType.INDIAN,    city: 'Mumbai',     maxCapacity: 12, owner: owners[1]! },
  ];

  const restaurants = await Promise.all(
    restaurantDefs.map((r) =>
      prisma.restaurant.upsert({
        where: { slug: r.name.toLowerCase().replace(/\s+/g, '-') },
        update: {},
        create: {
          ownerId:     r.owner.id,
          name:        r.name,
          slug:        r.name.toLowerCase().replace(/\s+/g, '-'),
          cuisine:     r.cuisine,
          description: faker.lorem.paragraph(),
          address:     faker.location.streetAddress(),
          city:        r.city,
          maxCapacity: r.maxCapacity,
        },
      })
    )
  );

  // ── Time Slots (next 7 days, 4 slots/day per restaurant) ──────────────────
  const slots = [];
  for (const restaurant of restaurants) {
    for (let day = 1; day <= 7; day++) {
      for (const hour of [12, 14, 19, 21]) {
        const startsAt = new Date();
        startsAt.setDate(startsAt.getDate() + day);
        startsAt.setHours(hour, 0, 0, 0);

        const slot = await prisma.timeSlot.upsert({
          where: { restaurantId_startsAt: { restaurantId: restaurant.id, startsAt } },
          update: {},
          create: {
            restaurantId: restaurant.id,
            startsAt,
            capacity: restaurant.maxCapacity,
            durationMins: 90,
          },
        });
        slots.push(slot);
      }
    }
  }

  // ── Bookings (mix of statuses — covers edge cases) ──────────────────────────
  const statusMix: BookingStatus[] = [
    BookingStatus.CONFIRMED, BookingStatus.CONFIRMED, BookingStatus.CONFIRMED,
    BookingStatus.PENDING,   BookingStatus.PENDING,
    BookingStatus.CANCELLED,
  ];

  let bookingCount = 0;
  for (const diner of diners.slice(0, 6)) {
    for (let i = 0; i < 2; i++) {
      const slot = slots[Math.floor(Math.random() * slots.length)]!;
      const status = statusMix[bookingCount % statusMix.length]!;
      const partySize = Math.min(2, slot.capacity - slot.booked);
      if (partySize < 1) continue;

      await prisma.booking.create({
        data: {
          restaurantId: slot.restaurantId,
          dinerId:      diner.id,
          slotId:       slot.id,
          partySize,
          status,
        },
      });

      if (status !== BookingStatus.CANCELLED) {
        await prisma.timeSlot.update({
          where: { id: slot.id },
          data:  { booked: { increment: partySize } },
        });
      }
      bookingCount++;
    }
  }

  // ── Fully booked slot (for testing 409 conflict) ──────────────────────────
  const fullSlot = slots[0]!;
  await prisma.timeSlot.update({
    where: { id: fullSlot.id },
    data:  { booked: fullSlot.capacity },
  });

  console.log(`✅ Seed complete:
  - ${owners.length} owners
  - ${diners.length} diners
  - ${restaurants.length} restaurants
  - ${slots.length} time slots (next 7 days, 4 slots/day)
  - ${bookingCount} bookings (mix of CONFIRMED/PENDING/CANCELLED)
  - 1 fully-booked slot for 409 testing (slot id: ${fullSlot.id})
  `);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
