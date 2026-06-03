import { prisma } from '../utils/prisma';

export async function upsertTelegramUser(input: {
  telegramId: string;
  username?: string;
  firstName?: string;
}) {
  return prisma.user.upsert({
    where: { telegramId: input.telegramId },
    update: { username: input.username, firstName: input.firstName },
    create: {
      telegramId: input.telegramId,
      username: input.username,
      firstName: input.firstName,
      role: 'PASSENGER',
    },
  });
}
