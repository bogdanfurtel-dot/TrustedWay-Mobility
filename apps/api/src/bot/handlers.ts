import { env } from '../utils/env';
import { prisma } from '../utils/prisma';
import { sendMessage, answerCallbackQuery } from './telegramClient';
import { upsertTelegramUser } from '../services/userService';
import { buildTelegramShareText, buildTripDeepLink, searchTrips } from '../services/tripService';
import { createBooking } from '../services/bookingService';
import { getSession, setSession, clearSession } from './session';

// ─── UI helpers ────────────────────────────────────────────────────────────

function parseStartPayload(text?: string) {
  if (!text?.startsWith('/start')) return null;
  const [, payload] = text.split(' ');
  return payload ?? null;
}

function looksLikePhone(text: string): boolean {
  return /^\+?[\d\s\-()]{7,15}$/.test(text);
}

function fmtDate(d: Date) {
  return d.toLocaleString('uk-UA', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

async function sendCarrierMenu(chatId: number) {
  return sendMessage(chatId, 'Кабінет перевізника 🚐\nОбери дію:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '➕ Створити рейс', callback_data: 'ccreate' }],
        [
          { text: '📋 Мої рейси', callback_data: 'ctrips' },
          { text: '👥 Пасажири',  callback_data: 'cpass'  },
        ],
        [
          { text: '📢 Поділитись рейсом', callback_data: 'cshare'  },
          { text: '⭐ Мій рейтинг',       callback_data: 'crating' },
        ],
      ],
    },
  });
}

async function sendCarrierTrips(chatId: number, userId: string) {
  const carrier = await prisma.carrier.findUnique({
    where: { userId },
    include: {
      trips: {
        where: { status: { in: ['ACTIVE', 'FULL'] } },
        include: { _count: { select: { bookings: true } } },
        orderBy: { departureAt: 'asc' },
        take: 10,
      },
    },
  });
  if (!carrier) return sendMessage(chatId, 'У тебе ще немає профілю перевізника.');
  if (!carrier.trips.length) {
    return sendMessage(chatId, 'Активних рейсів немає.', {
      reply_markup: { inline_keyboard: [[{ text: '➕ Створити рейс', callback_data: 'ccreate' }]] },
    });
  }
  const list = carrier.trips.map(t =>
    `🚐 <b>${t.fromCity} → ${t.toCity}</b>\n📅 ${fmtDate(t.departureAt)}\n💺 ${t.availableSeats}/${t.totalSeats} вільно · 📋 ${t._count.bookings} бронь`
  ).join('\n\n');
  return sendMessage(chatId, `Твої активні рейси (${carrier.trips.length}):\n\n${list}`, {
    reply_markup: { inline_keyboard: [[{ text: '➕ Створити рейс', callback_data: 'ccreate' }]] },
  });
}

async function sendCarrierPassengers(chatId: number, userId: string) {
  const carrier = await prisma.carrier.findUnique({
    where: { userId },
    include: {
      trips: {
        where: { status: { in: ['ACTIVE', 'FULL'] } },
        include: {
          bookings: {
            where: { status: { in: ['PENDING', 'CONFIRMED'] } },
            include: { user: true },
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { departureAt: 'asc' },
        take: 5,
      },
    },
  });
  if (!carrier) return sendMessage(chatId, 'Профіль перевізника не знайдено.');
  const active = carrier.trips.filter(t => t.bookings.length > 0);
  if (!active.length) return sendMessage(chatId, 'Поки немає пасажирів на твоїх рейсах.');
  const list = active.map(t => {
    const bList = t.bookings.map(b => {
      const icon = b.status === 'CONFIRMED' ? '✅' : '⏳';
      const name = b.passengerName ?? b.user.firstName ?? '—';
      const phone = b.passengerPhone ?? '—';
      return `  ${icon} ${name} · ${phone} · ${b.seats} місць`;
    }).join('\n');
    return `🚐 <b>${t.fromCity} → ${t.toCity}</b> ${fmtDate(t.departureAt)}\n${bList}`;
  }).join('\n\n');
  return sendMessage(chatId, `👥 Пасажири:\n\n${list}`);
}

async function sendCarrierRating(chatId: number, userId: string) {
  const carrier = await prisma.carrier.findUnique({
    where: { userId },
    include: { _count: { select: { trips: true } } },
  });
  if (!carrier) return sendMessage(chatId, 'Профіль перевізника не знайдено.');
  const confirmed = await prisma.booking.count({
    where: { trip: { carrierId: carrier.id }, status: { in: ['CONFIRMED', 'COMPLETED'] } },
  });
  const ratingStr = carrier.rating > 0 ? `⭐ ${carrier.rating.toFixed(1)} / 5.0` : 'Оцінок ще немає';
  return sendMessage(chatId,
    `📊 <b>${carrier.publicName}</b>\n\n${ratingStr}\n🚐 Рейсів: ${carrier._count.trips}\n📋 Підтверджено бронювань: ${confirmed}\n🏅 Tier: ${carrier.tier}`
  );
}

async function finishTripCreation(chatId: number, userId: string, data: {
  from: string; to: string; departureAt: string;
  price: number; seats: number; notes?: string; phone?: string;
}) {
  clearSession(chatId);
  const carrier = await prisma.carrier.findUnique({ where: { userId } });
  if (!carrier) return sendMessage(chatId, 'Помилка: профіль перевізника не знайдено.');

  if (data.phone) {
    await prisma.carrier.update({ where: { id: carrier.id }, data: { phone: data.phone } });
  }

  const trip = await prisma.trip.create({
    data: {
      carrierId: carrier.id,
      fromCity: data.from,
      toCity: data.to,
      departureAt: new Date(data.departureAt),
      price: data.price,
      totalSeats: data.seats,
      availableSeats: data.seats,
      currency: 'EUR',
      status: 'ACTIVE',
      notes: data.notes,
    },
  });

  const deepLink = buildTripDeepLink(env.TELEGRAM_BOT_USERNAME, trip.id, carrier.id);
  const shareText = buildTelegramShareText({
    fromCity: data.from, toCity: data.to, departureAt: trip.departureAt,
    price: trip.price, currency: trip.currency, availableSeats: trip.availableSeats, deepLink,
  });

  return sendMessage(chatId,
    `✅ Рейс створено!\n\n🚐 <b>${data.from} → ${data.to}</b>\n📅 ${fmtDate(trip.departureAt)}\n💶 ${data.price} EUR · 💺 ${data.seats} місць\n\nТекст для груп:\n\n${shareText}`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📢 Поділитись', callback_data: `tshare_${trip.id}` }],
          [{ text: '📋 Мої рейси', callback_data: 'ctrips' }],
        ],
      },
    }
  );
}

// ─── callback query ────────────────────────────────────────────────────────

async function handleCallbackQuery(cq: any) {
  const { id, data, from, message } = cq;
  if (!data) return answerCallbackQuery(id);

  const parts = (data as string).split('_');
  const action = parts[0];
  const chatId: number | undefined = message?.chat?.id;

  // ── carrier menu ──
  if (['ccreate', 'ctrips', 'cpass', 'cshare', 'crating'].includes(action)) {
    if (!chatId) return answerCallbackQuery(id);
    const user = await upsertTelegramUser({ telegramId: String(from.id), username: from.username, firstName: from.first_name });
    await answerCallbackQuery(id);

    if (action === 'ctrips')  return sendCarrierTrips(chatId, user.id);
    if (action === 'cpass')   return sendCarrierPassengers(chatId, user.id);
    if (action === 'crating') return sendCarrierRating(chatId, user.id);

    if (action === 'cshare') {
      const carrier = await prisma.carrier.findUnique({
        where: { userId: user.id },
        include: { trips: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' }, take: 1 } },
      });
      if (!carrier?.trips.length) {
        return sendMessage(chatId, 'Немає активних рейсів.', {
          reply_markup: { inline_keyboard: [[{ text: '➕ Створити рейс', callback_data: 'ccreate' }]] },
        });
      }
      const trip = carrier.trips[0];
      const deepLink = buildTripDeepLink(env.TELEGRAM_BOT_USERNAME, trip.id, carrier.id);
      const shareText = buildTelegramShareText({
        fromCity: trip.fromCity, toCity: trip.toCity, departureAt: trip.departureAt,
        price: trip.price, currency: trip.currency, availableSeats: trip.availableSeats, deepLink,
      });
      return sendMessage(chatId, `📢 Текст для Telegram-груп:\n\n${shareText}`);
    }

    // ccreate
    const carrier = await prisma.carrier.findUnique({ where: { userId: user.id } });
    if (!carrier) {
      setSession(chatId, { step: 'carrier_name' });
      return sendMessage(chatId, '🚐 Як називається твоє перевезення?\n\nНаприклад: "Іван Перевезення" або "SwiftTrans"');
    }
    setSession(chatId, { step: 'trip_from' });
    return sendMessage(chatId, '📍 Місто відправлення:');
  }

  // ── trip flow helpers ──
  if (['tskipnotes', 'tskipphone', 'tshare'].includes(action)) {
    if (!chatId) return answerCallbackQuery(id);

    if (action === 'tshare') {
      const tripId = parts[1];
      const trip = await prisma.trip.findUnique({ where: { id: tripId }, include: { carrier: true } });
      if (!trip) return answerCallbackQuery(id, 'Рейс не знайдено.');
      const deepLink = buildTripDeepLink(env.TELEGRAM_BOT_USERNAME, trip.id, trip.carrierId);
      const shareText = buildTelegramShareText({
        fromCity: trip.fromCity, toCity: trip.toCity, departureAt: trip.departureAt,
        price: trip.price, currency: trip.currency, availableSeats: trip.availableSeats, deepLink,
      });
      await answerCallbackQuery(id);
      return sendMessage(chatId, `📢 Текст для Telegram-груп:\n\n${shareText}`);
    }

    const session = getSession(chatId);
    const user = await upsertTelegramUser({ telegramId: String(from.id), username: from.username, firstName: from.first_name });
    await answerCallbackQuery(id);

    if (action === 'tskipnotes' && session?.step === 'trip_notes') {
      const { from: fc, to, departureAt, price, seats } = session;
      const carrier = await prisma.carrier.findUnique({ where: { userId: user.id } });
      if (carrier?.phone) {
        return finishTripCreation(chatId, user.id, { from: fc, to, departureAt, price, seats });
      }
      setSession(chatId, { step: 'trip_phone', from: fc, to, departureAt, price, seats });
      return sendMessage(chatId, '📞 Твій номер телефону для пасажирів:', {
        reply_markup: {
          keyboard: [
            [{ text: '📱 Поділитись номером', request_contact: true }],
            [{ text: 'Пропустити' }],
          ],
          resize_keyboard: true, one_time_keyboard: true,
        },
      });
    }

    if (action === 'tskipphone' && session?.step === 'trip_phone') {
      const { from: fc, to, departureAt, price, seats, notes } = session;
      return finishTripCreation(chatId, user.id, { from: fc, to, departureAt, price, seats, notes });
    }

    return;
  }

  // ── book (passenger) ──
  if (action === 'book') {
    if (!chatId) return answerCallbackQuery(id);
    const tripId = parts[1];
    const seats = Number(parts[2] ?? 1);
    const trip = await prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip || trip.status !== 'ACTIVE' || trip.availableSeats < seats) {
      return answerCallbackQuery(id, 'Місць вже немає або рейс неактивний.');
    }
    setSession(chatId, { step: 'awaiting_phone', tripId, seats });
    await answerCallbackQuery(id);
    return sendMessage(chatId,
      `Рейс ${trip.fromCity} → ${trip.toCity}, ${seats} місць.\n\nНадішли свій номер телефону:`,
      { reply_markup: { keyboard: [[{ text: '📱 Поділитись номером', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } }
    );
  }

  // ── confirm / reject booking ──
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
    await sendMessage(Number(from.id), `✅ Бронювання <code>${bookingId}</code> підтверджено.`);
    if (booking.user.telegramId) {
      await sendMessage(Number(booking.user.telegramId),
        `✅ Перевізник підтвердив ваше бронювання!\n🗺 ${booking.trip.fromCity} → ${booking.trip.toCity}\nЗв'яжіться з перевізником для уточнення деталей.`
      );
    }
  } else {
    await prisma.$transaction([
      prisma.booking.update({ where: { id: bookingId }, data: { status: 'CANCELLED' } }),
      prisma.trip.update({ where: { id: booking.tripId }, data: { availableSeats: { increment: booking.seats } } }),
    ]);
    await answerCallbackQuery(id, 'Відхилено');
    await sendMessage(Number(from.id), `❌ Бронювання <code>${bookingId}</code> відхилено. Місця повернено.`);
    if (booking.user.telegramId) {
      await sendMessage(Number(booking.user.telegramId),
        `❌ Перевізник відхилив ваше бронювання.\nРейс: ${booking.trip.fromCity} → ${booking.trip.toCity}\nПошукай інший рейс: <code>пошук Місто1 Місто2</code>`
      );
    }
  }
}

// ─── main handler ──────────────────────────────────────────────────────────

export async function handleTelegramUpdate(update: any) {
  if (update.callback_query) {
    return handleCallbackQuery(update.callback_query);
  }

  const message = update.message;
  if (!message?.chat?.id) return;

  const chatId: number = message.chat.id;
  const text = String(message.text ?? '').trim();
  const from = message.from;
  const contactPhone: string | undefined = message.contact?.phone_number;

  const user = await upsertTelegramUser({
    telegramId: String(from.id),
    username: from.username,
    firstName: from.first_name,
  });

  const session = getSession(chatId);

  // slash commands interrupt any active trip-creation flow
  if (text.startsWith('/') && session?.step !== 'awaiting_phone') {
    clearSession(chatId);
  }

  // ── awaiting_phone (passenger booking) ──────────────────────────────────
  if (session?.step === 'awaiting_phone' && (contactPhone || looksLikePhone(text))) {
    const phone = contactPhone ?? text;
    const { tripId, seats } = session;
    try {
      const booking = await createBooking({ tripId, userId: user.id, seats, passengerPhone: phone, passengerName: from.first_name });
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
        await sendMessage(Number(carrierRecord.user.telegramId),
          `📋 Нове бронювання!\n🧑 ${from.first_name ?? '—'}\n📞 ${phone}\n💺 ${seats} місць\n🗺 <code>${tripId}</code>`,
          {
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Підтвердити', callback_data: `confirm_${booking.id}` },
                { text: '❌ Відхилити',  callback_data: `reject_${booking.id}` },
              ]],
            },
          }
        );
      }
    } catch (err: any) {
      clearSession(chatId);
      await sendMessage(chatId, `Помилка: ${err.message ?? 'спробуй ще раз'}`, { reply_markup: { remove_keyboard: true } });
    }
    return;
  }

  // ── carrier_name ─────────────────────────────────────────────────────────
  if (session?.step === 'carrier_name') {
    const name = text.trim();
    if (name.length < 2) return sendMessage(chatId, 'Назва занадто коротка. Введи ще раз:');
    await prisma.carrier.upsert({
      where: { userId: user.id },
      update: { publicName: name },
      create: { userId: user.id, publicName: name, tier: 'COMMUNITY' },
    });
    setSession(chatId, { step: 'trip_from' });
    return sendMessage(chatId, `✅ "${name}" зареєстровано!\n\n📍 Місто відправлення:`);
  }

  // ── trip_from ─────────────────────────────────────────────────────────────
  if (session?.step === 'trip_from') {
    const city = text.trim();
    if (city.length < 2) return sendMessage(chatId, 'Введи назву міста:');
    setSession(chatId, { step: 'trip_to', from: city });
    return sendMessage(chatId, '📍 Місто прибуття:');
  }

  // ── trip_to ───────────────────────────────────────────────────────────────
  if (session?.step === 'trip_to') {
    const city = text.trim();
    if (city.length < 2) return sendMessage(chatId, 'Введи назву міста:');
    setSession(chatId, { step: 'trip_date', from: session.from, to: city });
    return sendMessage(chatId, '📅 Дата відправлення:\n\nФормат: РРРР-ММ-ДД\nНаприклад: 2026-07-10');
  }

  // ── trip_date ─────────────────────────────────────────────────────────────
  if (session?.step === 'trip_date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text.trim())) {
      return sendMessage(chatId, 'Невірний формат. Введи дату РРРР-ММ-ДД\nНаприклад: 2026-07-10');
    }
    setSession(chatId, { step: 'trip_time', from: session.from, to: session.to, date: text.trim() });
    return sendMessage(chatId, '⏰ Час відправлення:\n\nФормат: ГГ:ХХ\nНаприклад: 08:00');
  }

  // ── trip_time ─────────────────────────────────────────────────────────────
  if (session?.step === 'trip_time') {
    if (!/^\d{2}:\d{2}$/.test(text.trim())) {
      return sendMessage(chatId, 'Невірний формат. Введи час ГГ:ХХ\nНаприклад: 08:00');
    }
    const departureAt = `${session.date}T${text.trim()}:00`;
    if (isNaN(new Date(departureAt).getTime()) || new Date(departureAt) <= new Date()) {
      return sendMessage(chatId, 'Дата/час в минулому або невалідні. Введи коректний час:');
    }
    setSession(chatId, { step: 'trip_price', from: session.from, to: session.to, departureAt });
    return sendMessage(chatId, '💶 Ціна (EUR):\n\nНаприклад: 80');
  }

  // ── trip_price ────────────────────────────────────────────────────────────
  if (session?.step === 'trip_price') {
    const price = Number(text.trim().replace(',', '.'));
    if (isNaN(price) || price <= 0) return sendMessage(chatId, 'Введи ціну — ціле або дробове число > 0:');
    setSession(chatId, { step: 'trip_seats', from: session.from, to: session.to, departureAt: session.departureAt, price });
    return sendMessage(chatId, '💺 Кількість місць (1–100):');
  }

  // ── trip_seats ────────────────────────────────────────────────────────────
  if (session?.step === 'trip_seats') {
    const seats = Number(text.trim());
    if (isNaN(seats) || seats < 1 || seats > 100) return sendMessage(chatId, 'Введи число від 1 до 100:');
    setSession(chatId, { step: 'trip_notes', from: session.from, to: session.to, departureAt: session.departureAt, price: session.price, seats });
    return sendMessage(chatId,
      `📝 Опис рейсу (необов'язково):\n\nЗупинки, умови, контакт — що важливо знати пасажирам?`,
      { reply_markup: { inline_keyboard: [[{ text: '⏭ Пропустити', callback_data: 'tskipnotes' }]] } }
    );
  }

  // ── trip_notes (text) ─────────────────────────────────────────────────────
  if (session?.step === 'trip_notes') {
    const notes = text.trim() || undefined;
    const { from: fc, to, departureAt, price, seats } = session;
    const carrier = await prisma.carrier.findUnique({ where: { userId: user.id } });
    if (carrier?.phone) {
      return finishTripCreation(chatId, user.id, { from: fc, to, departureAt, price, seats, notes });
    }
    setSession(chatId, { step: 'trip_phone', from: fc, to, departureAt, price, seats, notes });
    return sendMessage(chatId, '📞 Твій номер телефону для пасажирів:', {
      reply_markup: {
        keyboard: [
          [{ text: '📱 Поділитись номером', request_contact: true }],
          [{ text: 'Пропустити' }],
        ],
        resize_keyboard: true, one_time_keyboard: true,
      },
    });
  }

  // ── trip_phone ────────────────────────────────────────────────────────────
  if (session?.step === 'trip_phone') {
    const { from: fc, to, departureAt, price, seats, notes } = session;
    if (text === 'Пропустити') {
      return finishTripCreation(chatId, user.id, { from: fc, to, departureAt, price, seats, notes });
    }
    const phone = contactPhone ?? (looksLikePhone(text) ? text : undefined);
    if (!phone) return sendMessage(chatId, 'Введи номер телефону або натисни "Пропустити":');
    return finishTripCreation(chatId, user.id, { from: fc, to, departureAt, price, seats, notes, phone });
  }

  // ── /start trip deep link ─────────────────────────────────────────────────
  const payload = parseStartPayload(text);
  if (payload?.startsWith('trip_')) {
    const tripId = payload.split('_')[1];
    const trip = await prisma.trip.findUnique({ where: { id: tripId }, include: { carrier: true } });
    if (!trip || trip.status !== 'ACTIVE') return sendMessage(chatId, 'Рейс не знайдено або він вже неактивний.');
    return sendMessage(chatId,
      `🚐 <b>${trip.fromCity} → ${trip.toCity}</b>\n📅 ${fmtDate(trip.departureAt)}\n💶 ${trip.price} ${trip.currency}\n💺 Вільних місць: ${trip.availableSeats}\n🚗 Перевізник: ${trip.carrier.publicName}`,
      { reply_markup: { inline_keyboard: [[{ text: '🎫 Забронювати 1 місце', callback_data: `book_${trip.id}_1` }]] } }
    );
  }

  // ── /start ────────────────────────────────────────────────────────────────
  if (text === '/start') {
    return sendMessage(chatId,
      'Вітаю в TrustedWay Mobility 🚐\n\nЗнайди перевірене перевезення Україна ↔ Європа.\n\n' +
      '🔎 <code>пошук Львів Варшава</code>\n📋 <code>мої бронювання</code>\n🚐 /carrier — кабінет перевізника'
    );
  }

  // ── /carrier ──────────────────────────────────────────────────────────────
  if (text === '/carrier') {
    return sendCarrierMenu(chatId);
  }

  // ── legacy text commands ──────────────────────────────────────────────────
  if (text.startsWith('carrier ')) {
    const publicName = text.replace('carrier ', '').trim();
    const carrier = await prisma.carrier.upsert({
      where: { userId: user.id },
      update: { publicName },
      create: { userId: user.id, publicName, phone: user.phone, tier: 'COMMUNITY' },
    });
    return sendMessage(chatId, `Перевізник: <b>${carrier.publicName}</b>`, {
      reply_markup: { inline_keyboard: [[{ text: '➕ Створити рейс', callback_data: 'ccreate' }]] },
    });
  }

  if (text.startsWith('рейс ')) {
    const parts = text.split(' ');
    if (parts.length < 6) return sendMessage(chatId, 'Формат: <code>рейс Місто1 Місто2 2026-06-10T08:00 ціна місць</code>');
    const [, fromCity, toCity, dateRaw, priceRaw, seatsRaw] = parts;
    const departureAt = new Date(dateRaw);
    const price = Number(priceRaw);
    const seats = Number(seatsRaw);
    if (isNaN(departureAt.getTime())) return sendMessage(chatId, 'Невірна дата. Формат: <code>2026-06-10T08:00</code>');
    if (departureAt <= new Date()) return sendMessage(chatId, 'Дата відʼїзду вже минула.');
    if (isNaN(price) || price <= 0) return sendMessage(chatId, 'Невірна ціна.');
    if (isNaN(seats) || seats < 1 || seats > 100) return sendMessage(chatId, 'Місць: 1–100.');
    const carrier = await prisma.carrier.findUnique({ where: { userId: user.id } });
    if (!carrier) return sendMessage(chatId, 'Спочатку відкрий /carrier і зареєструйся.');
    const trip = await prisma.trip.create({
      data: { carrierId: carrier.id, fromCity, toCity, departureAt, price, totalSeats: seats, availableSeats: seats, currency: 'EUR', status: 'ACTIVE' },
    });
    const deepLink = buildTripDeepLink(env.TELEGRAM_BOT_USERNAME, trip.id, carrier.id);
    const shareText = buildTelegramShareText({ fromCity, toCity, departureAt: trip.departureAt, price: trip.price, currency: trip.currency, availableSeats: trip.availableSeats, deepLink });
    return sendMessage(chatId, `Рейс створено ✅\n\n${shareText}`);
  }

  if (text === 'мої рейси') return sendCarrierTrips(chatId, user.id);

  if (text === 'мої бронювання') {
    const bookings = await prisma.booking.findMany({
      where: { userId: user.id, status: { in: ['PENDING', 'CONFIRMED'] } },
      include: { trip: { include: { carrier: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    if (!bookings.length) return sendMessage(chatId, 'Активних бронювань немає.\n\nЗнайди рейс: <code>пошук Місто1 Місто2</code>');
    const statusLabel: Record<string, string> = { PENDING: '⏳ Очікує', CONFIRMED: '✅ Підтверджено' };
    const list = bookings.map(b =>
      `${statusLabel[b.status] ?? b.status}\n🚐 ${b.trip.fromCity} → ${b.trip.toCity}\n📅 ${fmtDate(b.trip.departureAt)}\n💺 ${b.seats} місць · ${b.trip.carrier.publicName}`
    ).join('\n\n');
    return sendMessage(chatId, `Твої бронювання:\n\n${list}`);
  }

  if (text.startsWith('пошук ')) {
    const [, fromCity, toCity] = text.split(' ');
    const trips = await searchTrips(fromCity, toCity);
    if (!trips.length) return sendMessage(chatId, 'Немає активних рейсів за цим напрямком.');
    return sendMessage(chatId, trips.map((t: (typeof trips)[number]) =>
      `🚐 <b>${t.fromCity} → ${t.toCity}</b>\n💶 ${t.price} ${t.currency} · 💺 ${t.availableSeats}\n⭐ ${t.carrier.publicName}\nБронь: <code>бронь ${t.id} 1</code>`
    ).join('\n\n'));
  }

  if (text.startsWith('бронь ')) {
    const [, tripId, seatsRaw] = text.split(' ');
    const seats = Number(seatsRaw || 1);
    const trip = await prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip || trip.availableSeats < seats) return sendMessage(chatId, 'Місць немає або рейс неактивний.');
    setSession(chatId, { step: 'awaiting_phone', tripId, seats });
    return sendMessage(chatId,
      `Рейс ${trip.fromCity} → ${trip.toCity}, ${seats} місць.\n\nНадішли номер телефону:`,
      { reply_markup: { keyboard: [[{ text: '📱 Поділитись номером', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } }
    );
  }

  return sendMessage(chatId, 'Не зрозумів команду. Напиши /start');
}
