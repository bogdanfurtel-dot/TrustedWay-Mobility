# TrustedWay Mobility

**TrustedWay Mobility** — Telegram-first marketplace для перевірених пасажирських перевезень Україна ↔ Європа.

Ідея: не боротися з хаотичним ринком, а дати перевізникам більше бронювань, менше no-show і простий інструмент для публікації рейсів у Telegram-групи через share/deep links.

## Що вже є в шаблоні

- Express API
- Telegram webhook handler
- Passenger flow: пошук маршруту, перегляд рейсу, бронювання
- Carrier flow: створення рейсу, місця, ціна, deep link
- Share-ready текст оголошення для Telegram-груп
- Prisma schema: users, carriers, vehicles, trips, bookings, reviews
- Claude Code команди в `.claude/commands`
- MVP roadmap у `docs/ROADMAP.md`

## Швидкий старт

```bash
cp .env.example .env
npm install
npm run prisma:generate
npm run dev
```

Webhook endpoint:

```txt
POST /telegram/webhook/:secret
```

Health check:

```txt
GET /health
```

## Важливо

Це MVP-скелет. Він не є юридичною системою легалізації перевізників. На старті логіка така:

1. soft verification;
2. рейтинг і історія поїздок;
3. verified tiers;
4. поступова формалізація через вигоду.
