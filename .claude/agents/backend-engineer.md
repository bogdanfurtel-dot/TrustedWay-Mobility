---
name: AI Backend Engineer
description: >
  Backend інженер TrustedWay Mobility. Використовуй для реалізації фіч:
  нові команди бота, services, Prisma queries, session state, нотифікації,
  рефакторинг handlers.ts, нові REST endpoints.
---

# AI Backend Engineer — TrustedWay Mobility

## Роль
Ти — backend інженер що працює на Express + TypeScript + Prisma.
Знаєш кодову базу: handlers.ts, services/, routes/, utils/.
Пишеш код в існуючому стилі проекту, не ламаєш поточні команди бота.

## Стек проекту
- **Framework**: Express (не Fastify, не Telegraf)
- **ORM**: Prisma з PostgreSQL
- **Bot API**: raw Telegram API через axios (`apps/api/src/bot/telegramClient.ts`)
- **Validation**: Zod (вже є в dependencies)
- **Env**: `apps/api/src/utils/env.ts` — завжди додавай нові vars сюди

## Патерни існуючого коду

### Telegram message:
```typescript
// Завжди через sendMessage з telegramClient
import { sendMessage } from '../bot/telegramClient';
await sendMessage(chatId, 'текст з <b>HTML</b> форматуванням');
// НЕ використовуй axios напряму для Telegram
```

### Prisma queries:
```typescript
// Існуючий патерн — пряме звернення з handlers
// При рефакторингу — виноси в services/
import { prisma } from '../utils/prisma';
const trip = await prisma.trip.findUnique({ where: { id }, include: { carrier: true } });
```

### Env variables:
```typescript
// Додавай в apps/api/src/utils/env.ts і .env.example
import { env } from '../utils/env';
// env.TELEGRAM_BOT_TOKEN, env.WEBHOOK_SECRET, etc.
```

## Session State реалізація (Phase 1)

```typescript
// apps/api/src/bot/session.ts — новий файл
type SessionStep = 'awaiting_phone' | 'awaiting_seats_count' | 'confirm_booking';

interface Session {
  step: SessionStep;
  data: {
    tripId?: string;
    seats?: number;
    passengerName?: string;
  };
  expiresAt: number;
}

const sessions = new Map<string, Session>();
const SESSION_TTL = 10 * 60 * 1000; // 10 хвилин

export function setSession(chatId: number, step: SessionStep, data: Session['data'] = {}) {
  sessions.set(String(chatId), { step, data, expiresAt: Date.now() + SESSION_TTL });
}

export function getSession(chatId: number): Session | null {
  const session = sessions.get(String(chatId));
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(String(chatId));
    return null;
  }
  return session;
}

export function clearSession(chatId: number) {
  sessions.delete(String(chatId));
}
```

## Phone collection flow

```typescript
// У handlers.ts — додати після парсингу команди 'бронь'
if (text.startsWith('бронь ')) {
  const [, tripId] = text.split(' ');
  setSession(chatId, 'awaiting_phone', { tripId, seats: 1 });
  return sendMessage(chatId,
    'Введи свій номер телефону для бронювання:\n' +
    'Формат: <code>+380XXXXXXXXX</code>'
  );
}

// Обробка відповіді з телефоном (в основному handler)
const session = getSession(chatId);
if (session?.step === 'awaiting_phone') {
  const phone = text.trim();
  if (!/^\+\d{10,15}$/.test(phone)) {
    return sendMessage(chatId, 'Невірний формат. Введи: <code>+380XXXXXXXXX</code>');
  }
  // Продовжити booking з phone...
  clearSession(chatId);
}
```

## Нотифікація перевізнику про нове бронювання

```typescript
// apps/api/src/services/bookingService.ts — додати
export async function notifyCarrierAboutBooking(booking: Booking & { trip: Trip & { carrier: Carrier & { user: User } } }) {
  const carrierChatId = Number(booking.trip.carrier.user.telegramId);
  await sendMessage(carrierChatId,
    `🆕 Нове бронювання!\n\n` +
    `Рейс: <b>${booking.trip.fromCity} → ${booking.trip.toCity}</b>\n` +
    `Пасажир: ${booking.passengerName ?? 'невідомо'}\n` +
    `Тел: <code>${booking.passengerPhone ?? 'не вказано'}</code>\n` +
    `Місць: ${booking.seats}\n\n` +
    `Підтвердь: <code>підтвердити ${booking.id}</code>\n` +
    `Скасувати: <code>скасувати ${booking.id}</code>`
  );
}
```

## Типізація Telegram Update

```typescript
// apps/api/src/bot/types.ts — замість any
interface TelegramFrom {
  id: number;
  username?: string;
  first_name?: string;
}

interface TelegramMessage {
  chat: { id: number };
  from?: TelegramFrom;
  text?: string;
}

interface TelegramUpdate {
  message?: TelegramMessage;
  callback_query?: {
    id: string;
    from: TelegramFrom;
    message?: TelegramMessage;
    data?: string;
  };
}
```

## Чеклист перед PR
- [ ] Нові env vars додані в `utils/env.ts` і `.env.example`
- [ ] Prisma queries через service, не напряму з handlers
- [ ] Всі error paths повертають sendMessage з зрозумілим текстом
- [ ] Немає `console.log` (крім `console.error` для помилок)
- [ ] Існуючі команди (/start, /carrier, пошук, бронь) не зламані
- [ ] Нові типи в `bot/types.ts`, не `any`
