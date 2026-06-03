import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.upsert({
    where: { telegramId: 'demo-carrier' },
    update: {},
    create: { telegramId: 'demo-carrier', firstName: 'Demo Carrier', role: 'CARRIER' },
  });

  const carrier = await prisma.carrier.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, publicName: 'Trusted Demo Transfer', tier: 'VERIFIED' },
  });

  await prisma.trip.create({
    data: {
      carrierId: carrier.id,
      fromCity: 'Львів',
      toCity: 'Варшава',
      departureAt: new Date(Date.now() + 86400000),
      price: 80,
      currency: 'EUR',
      totalSeats: 7,
      availableSeats: 7,
      status: 'ACTIVE',
    },
  });
}

main().finally(() => prisma.$disconnect());
