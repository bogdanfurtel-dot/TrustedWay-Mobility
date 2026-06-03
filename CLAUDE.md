# TrustedWay Mobility — Claude Code Guide

## Продукт
Telegram-first маркетплейс пасажирських перевезень Україна ↔ Європа.
Модель: довіра → бронювання → комісія за confirmed booking.

## ICP
- **Перевізник**: фізична особа або мале ФОП, маршрути UA↔PL/DE/CZ, возить регулярно
- **Пасажир**: українці що їдуть або повертаються, шукають в Telegram-групах

## Поточний стан (Phase 1 — Manual liquidity)
- ✅ Telegram bot webhook (Express + raw Telegram API)
- ✅ Prisma schema: User, Carrier, Vehicle, Trip, Booking, Review
- ✅ Команди: /start, /carrier, carrier, рейс, пошук, бронь
- ✅ Deep links для рейсів, share text для груп
- ✅ Health check endpoint
- ⏳ Немає: session state, phone collection, payments, admin UI

## Технічний стек
- **Runtime**: Node.js + TypeScript (tsx в dev)
- **Framework**: Express
- **ORM**: Prisma + PostgreSQL
- **Bot**: raw Telegram Bot API через axios (НЕ Telegraf)
- **Validation**: Zod
- **Security**: helmet, cors, webhook secret у URL

## Структура проекту
```
apps/api/src/
  bot/          # Telegram webhook handler + telegramClient
  routes/       # REST API: trips, carriers, admin
  services/     # Бізнес-логіка: trip, booking, user
  utils/        # env, prisma client
prisma/         # schema.prisma, seed.ts
docs/           # ROADMAP.md, PROJECT_STRUCTURE.md
.claude/        # Агенти та команди
```

## Пріоритети (наступні задачі)
1. Session state для multi-step flows (бронювання з телефоном)
2. Phone collection при бронюванні
3. Admin модерація перевізників
4. Payment placeholder (депозит)
5. Web mini landing для рейсу

## Бізнес-метрики
| Метрика | Ціль Phase 1 |
|---------|-------------|
| Активних перевізників | 30–100 |
| Бронювань/тиждень | 20+ |
| Conversion пошук→бронь | >15% |
| Churn перевізників | <10%/міс |

## Hard rules
- НЕ обіцяти автопостинг у групи без дозволу
- Використовувати manual share text + deep links для зовнішніх груп
- Carrier onboarding — максимально простий
- Будувати тільки те що збільшує бронювання або довіру
- Ніякого декоративного AI

## Агенти команди
- `orchestrator` — розбиває задачі, координує агентів
- `product-manager` — PRD, фічі, метрики, roadmap
- `architect` — DB schema, API design, рішення
- `backend-engineer` — реалізація на Express/Prisma/TypeScript
- `frontend-engineer` — Telegram bot UX, inline keyboards, flows
- `qa-engineer` — edge cases, тести, booking flows
- `devops` — Railway деплой, CI/CD, моніторинг
