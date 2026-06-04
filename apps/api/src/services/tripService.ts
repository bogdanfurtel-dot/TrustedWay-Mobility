import { randomBytes } from 'crypto';
import { prisma } from '../utils/prisma';

export function generateShortCode(): string {
  return randomBytes(4).toString('hex'); // 8 hex chars, e.g. "a3f2b1c4"
}

export async function searchTrips(fromCity: string, toCity: string) {
  return prisma.trip.findMany({
    where: {
      fromCity: { contains: fromCity, mode: 'insensitive' },
      toCity: { contains: toCity, mode: 'insensitive' },
      status: 'ACTIVE',
      availableSeats: { gt: 0 },
    },
    include: { carrier: true, vehicle: true },
    orderBy: { departureAt: 'asc' },
    take: 10,
  });
}

export async function createTrip(input: {
  carrierId: string;
  fromCity: string;
  toCity: string;
  departureAt: Date;
  price: number;
  currency?: string;
  totalSeats: number;
  notes?: string;
}) {
  return prisma.trip.create({
    data: {
      ...input,
      currency: input.currency ?? 'EUR',
      availableSeats: input.totalSeats,
      status: 'ACTIVE',
    },
  });
}

export function buildTripDeepLink(botUsername: string, shortCode: string): string {
  return `https://t.me/${botUsername}?start=t_${shortCode}`;
}

export function buildTelegramShareText(args: {
  fromCity: string;
  toCity: string;
  departureAt: Date;
  price: number;
  currency: string;
  availableSeats: number;
  deepLink: string;
  notes?: string;
}) {
  const date = args.departureAt.toLocaleString('uk-UA', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const lines = [
    `🚐 ${args.fromCity} → ${args.toCity}`,
    `📅 Виїзд: ${date}`,
    `💶 Ціна: ${args.price} ${args.currency}`,
    `💺 Вільних місць: ${args.availableSeats}`,
  ];

  if (args.notes) lines.push(`📝 Опис: ${args.notes}`);

  lines.push(
    '',
    `<a href="${args.deepLink}">✅ Бронювання через TrustedWay</a>`,
    '🔒 Перевізник проходить перевірку та збирає рейтинг',
  );

  return lines.join('\n');
}
