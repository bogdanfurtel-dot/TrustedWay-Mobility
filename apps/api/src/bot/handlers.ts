import { env } from '../utils/env';
import { prisma } from '../utils/prisma';
import { sendMessage, answerCallbackQuery } from './telegramClient';
import { upsertTelegramUser } from '../services/userService';
import { buildTelegramShareText, buildTripDeepLink, searchTrips } from '../services/tripService';
import { createBooking } from '../services/bookingService';
import { getSession, setSession, clearSession } from './session';

function parseStartPayload(text?: string) {
  if (!text?.startsWith('/start')) return null;
  const [, payload] = text.split(' ');
  return payload ?? null;
}

function looksLikePhone(text: string): boolean {
  return /^\+?[\d\s\-()]{7,15}$/.test(text);
}

async function handleCallbackQuery(cq: any) {
  const { id, data, from, message } = cq;
  if (!data) return answerCallbackQuery(id);

  const parts = data.split('_');
  const action = parts[0];

  if (action === 'book') {
    const tripId = parts[1];
    const seats = Number(parts[2] ?? 1);
    const chatId: number | undefined = message?.chat?.id;
    if (!chatId) return answerCallbackQuery(id);

    const trip = await prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip || trip.status !== 'ACTIVE' || trip.availableSeats < seats) {
      return answerCallbackQuery(id, 'Місць вже немає або рейс неактивний.');
    }

    setSession(chatId, { step: 'awaiting_phone', tripId, seats });
    await answerCallbackQuery(id);
    return sendMessage(chatId,
      `Рейс ${trip.fromCity} → ${trip.toCity}, ${seats} місць.\n\nНадішли свій номер телефону, щоб перевізник міг зв'язатись з тобою:`,
      {
        reply_markup: {
          keyboard: [[{ text: '📱 Поділитись номером', request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      }
    );
  }

  const bookingId = parts.slice(1).join('_');
  if (action !== 'confirm' && action !== 'reject') return answerCallbackQuery(id);

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { trip: true, user: true },
  });

  if (!booking || booking.status !== 'PENDING') {
    return answerCallbackQuery(id, 'Це бронювання вже оброблено.');
  }

  if (action === 'confirm') {
    await prisma.booking.update({ where: { id: bookingId }, data: { status: 'CONFIRMED' } });
    await answerCallbackQuery(id, 'Підтверджено ✅');
    await sendMessage(
      Number(from.id),
      `✅ Бронювання <code>${bookingId}</code> підтверджено.`
    );
    if (booking.user.telegramId) {
      await sendMessage(
        Number(booking.user.telegramId),
        `✅ Перевізник підтвердив ваше бронювання!\n` +
        `🗺 ${booking.trip.fromCity} → ${booking.trip.toCity}\n` +
        `Зв'яжіться з перевізником для уточнення деталей.`
      );
    }
  } else {
    await prisma.$transaction([
      prisma.booking.update({ where: { id: bookingId }, data: { status: 'CANCELLED' } }),
      prisma.trip.update({ where: { id: booking.tripId }, data: { availableSeats: { increment: booking.seats } } }),
    ]);
    await answerCallbackQuery(id, 'Відхилено');
    await sendMessage(
      Number(from.id),
      `❌ Бронювання <code>${bookingId}</code> відхилено. Місця повернено.`
    );
    if (booking.user.telegramId) {
      await sendMessage(
        Number(booking.user.telegramId),
        `❌ Перевізник відхилив ваше бронювання.\n` +
        `Рейс: ${booking.trip.fromCity} → ${booking.trip.toCity}\n` +
        `Місця звільнено. Пошукай інший рейс: <code>пошук Місто1 Місто2</code>`
      );
    }
  }
}

export async function handleTelegramUpdate(update: any) {
  if (update.callback_query) {
    return handleCallbackQuery(update.callback_query);
  }

  const message = update.message;
  if (!message?.chat?.id) return;

  const chatId = message.chat.id;
  const text = String(message.text ?? '').trim();
  const from = message.from;

  const user = await upsertTelegramUser({
    telegramId: String(from.id),
    username: from.username,
    firstName: from.first_name,
  });

  // Phone collection — handles both contact button and text phone input
  const contactPhone: string | undefined = message.contact?.phone_number;
  const session = getSession(chatId);

  if (session?.step === 'awaiting_phone' && (contactPhone || looksLikePhone(text))) {
    const phone = contactPhone ?? text;
    const { tripId, seats } = session;

    try {
      const booking = await createBooking({
        tripId,
        userId: user.id,
        seats,
        passengerPhone: phone,
        passengerName: from.first_name,
      });

      clearSession(chatId);

      await sendMessage(chatId,
        `Заявку надіслано ✅\nID: <code>${booking.id}</code>\nОчікуй підтвердження від перевізника.`,
        { reply_markup: { remove_keyboard: true } }
      );

      const carrierRecord = await prisma.carrier.findFirst({
        where: { trips: { some: { id: tripId } } },
        include: { user: true },
      });

      if (carrierRecord?.user?.telegramId) {
        await sendMessage(
          Number(carrierRecord.user.telegramId),
          `📋 Нове бронювання!\n` +
          `🧑 Ім'я: ${from.first_name ?? '—'}\n` +
          `📞 Телефон: ${phone}\n` +
          `💺 Місць: ${seats}\n` +
          `🗺 Рейс: <code>${tripId}</code>`,
          {
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Підтвердити', callback_data: `confirm_${booking.id}` },
                { text: '❌ Відхилити', callback_data: `reject_${booking.id}` },
              ]],
            },
          }
        );
      }
    } catch (err: any) {
      clearSession(chatId);
      await sendMessage(chatId,
        `Помилка при бронюванні: ${err.message ?? 'спробуй ще раз'}`,
        { reply_markup: { remove_keyboard: true } }
      );
    }
    return;
  }

  const payload = parseStartPayload(text);
  if (payload?.startsWith('trip_')) {
    const tripId = payload.split('_')[1];
    const trip = await prisma.trip.findUnique({ where: { id: tripId }, include: { carrier: true } });
    if (!trip || trip.status !== 'ACTIVE') return sendMessage(chatId, 'Рейс не знайдено або він вже неактивний.');
    const date = trip.departureAt.toLocaleString('uk-UA', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    return sendMessage(chatId,
      `🚐 <b>${trip.fromCity} → ${trip.toCity}</b>\n` +
      `📅 ${date}\n` +
      `💶 ${trip.price} ${trip.currency}\n` +
      `💺 Вільних місць: ${trip.availableSeats}\n` +
      `🚗 Перевізник: ${trip.carrier.publicName}`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: `🎫 Забронювати 1 місце`, callback_data: `book_${trip.id}_1` },
          ]],
        },
      }
    );
  }

  if (text === '/start') {
    return sendMessage(chatId,
      'Вітаю в TrustedWay Mobility 🚐\n\n' +
      'Знайди перевірене перевезення Україна ↔ Європа.\n\n' +
      '🔎 <code>пошук Львів Варшава</code>\n' +
      '📋 <code>мої бронювання</code>\n' +
      '🚐 <code>/carrier</code> — кабінет перевізника'
    );
  }

  if (text === '/carrier') {
    return sendMessage(chatId,
      'Кабінет перевізника 🚐\n\n' +
      '1) Реєстрація: <code>carrier Назва</code>\n' +
      '2) Новий рейс: <code>рейс Місто1 Місто2 2026-06-10T08:00 ціна місць</code>\n' +
      '3) Мої рейси: <code>мої рейси</code>\n\n' +
      'Після створення рейсу отримаєш текст для Telegram-груп і deep link.'
    );
  }

  if (text.startsWith('carrier ')) {
    const publicName = text.replace('carrier ', '').trim();
    const carrier = await prisma.carrier.upsert({
      where: { userId: user.id },
      update: { publicName },
      create: { userId: user.id, publicName, phone: user.phone, tier: 'COMMUNITY' },
    });
    return sendMessage(chatId, `Готово. Перевізник створений: <b>${carrier.publicName}</b>`);
  }

  if (text.startsWith('рейс ')) {
    const parts = text.split(' ');
    if (parts.length < 6) {
      return sendMessage(chatId, 'Формат: <code>рейс Місто1 Місто2 2026-06-10T08:00 ціна кількість_місць</code>');
    }
    const [, fromCity, toCity, dateRaw, priceRaw, seatsRaw] = parts;
    const departureAt = new Date(dateRaw);
    const price = Number(priceRaw);
    const seats = Number(seatsRaw);
    if (isNaN(departureAt.getTime())) return sendMessage(chatId, 'Невірна дата. Формат: <code>2026-06-10T08:00</code>');
    if (departureAt <= new Date()) return sendMessage(chatId, 'Дата відʼїзду вже минула.');
    if (isNaN(price) || price <= 0) return sendMessage(chatId, 'Невірна ціна. Введи число > 0.');
    if (isNaN(seats) || seats < 1 || seats > 100) return sendMessage(chatId, 'Кількість місць: від 1 до 100.');

    const carrier = await prisma.carrier.findUnique({ where: { userId: user.id } });
    if (!carrier) return sendMessage(chatId, 'Спочатку створи перевізника: <code>carrier Назва</code>');

    const trip = await prisma.trip.create({
      data: {
        carrierId: carrier.id,
        fromCity,
        toCity,
        departureAt,
        price,
        totalSeats: seats,
        availableSeats: seats,
        currency: 'EUR',
        status: 'ACTIVE',
      },
    });

    const deepLink = buildTripDeepLink(env.TELEGRAM_BOT_USERNAME, trip.id, carrier.id);
    const shareText = buildTelegramShareText({
      fromCity, toCity, departureAt: trip.departureAt, price: trip.price, currency: trip.currency,
      availableSeats: trip.availableSeats, deepLink,
    });

    return sendMessage(chatId, `Рейс створено ✅\n\nСкопіюй цей текст і кидай у групи:\n\n${shareText}`);
  }

  if (text === 'мої рейси') {
    const carrier = await prisma.carrier.findUnique({
      where: { userId: user.id },
      include: {
        trips: {
          where: { status: { in: ['ACTIVE', 'FULL'] } },
          include: { _count: { select: { bookings: true } } },
          orderBy: { departureAt: 'asc' },
          take: 10,
        },
      },
    });
    if (!carrier) return sendMessage(chatId, 'У тебе ще немає профілю перевізника. Напиши: <code>carrier Назва</code>');
    if (!carrier.trips.length) return sendMessage(chatId,
      'Активних рейсів немає.\n\nДодай: <code>рейс Місто1 Місто2 2026-06-10T08:00 ціна місць</code>'
    );
    const list = carrier.trips.map(t => {
      const date = t.departureAt.toLocaleString('uk-UA', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
      return `🚐 <b>${t.fromCity} → ${t.toCity}</b>\n📅 ${date}\n💺 ${t.availableSeats}/${t.totalSeats} вільно · 📋 ${t._count.bookings} бронь`;
    }).join('\n\n');
    return sendMessage(chatId, `Твої активні рейси (${carrier.trips.length}):\n\n${list}`);
  }

  if (text === 'мої бронювання') {
    const bookings = await prisma.booking.findMany({
      where: { userId: user.id, status: { in: ['PENDING', 'CONFIRMED'] } },
      include: { trip: { include: { carrier: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    if (!bookings.length) return sendMessage(chatId, 'Активних бронювань немає.\n\nЗнайди рейс: <code>пошук Місто1 Місто2</code>');
    const statusLabel: Record<string, string> = { PENDING: '⏳ Очікує', CONFIRMED: '✅ Підтверджено' };
    const list = bookings.map(b => {
      const date = b.trip.departureAt.toLocaleString('uk-UA', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
      return `${statusLabel[b.status] ?? b.status}\n🚐 ${b.trip.fromCity} → ${b.trip.toCity}\n📅 ${date}\n💺 ${b.seats} місць · ${b.trip.carrier.publicName}`;
    }).join('\n\n');
    return sendMessage(chatId, `Твої бронювання:\n\n${list}`);
  }

  if (text.startsWith('пошук ')) {
    const [, fromCity, toCity] = text.split(' ');
    const trips = await searchTrips(fromCity, toCity);
    if (!trips.length) return sendMessage(chatId, 'Поки немає активних рейсів за цим напрямком.');
    return sendMessage(chatId, trips.map((t: (typeof trips)[number]) =>
      `🚐 <b>${t.fromCity} → ${t.toCity}</b>\n` +
      `💶 ${t.price} ${t.currency} · 💺 ${t.availableSeats}\n` +
      `⭐ ${t.carrier.publicName} · tier: ${t.carrier.tier}\n` +
      `Бронь: <code>бронь ${t.id} 1</code>`
    ).join('\n\n'));
  }

  if (text.startsWith('бронь ')) {
    const [, tripId, seatsRaw] = text.split(' ');
    const seats = Number(seatsRaw || 1);
    const trip = await prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip || trip.availableSeats < seats) return sendMessage(chatId, 'Місць вже немає або рейс неактивний.');

    setSession(chatId, { step: 'awaiting_phone', tripId, seats });

    return sendMessage(chatId,
      `Рейс ${trip.fromCity} → ${trip.toCity}, ${seats} місць.\n\nНадішли свій номер телефону, щоб перевізник міг зв'язатись з тобою:`,
      {
        reply_markup: {
          keyboard: [[{ text: '📱 Поділитись номером', request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      }
    );
  }

  return sendMessage(chatId, 'Не зрозумів команду. Напиши /start');
}
