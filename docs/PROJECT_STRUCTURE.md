# Project Structure

```txt
apps/api/src
  bot/              Telegram webhook + message handlers
  routes/           API endpoints
  services/         business logic
  utils/            env and prisma
prisma/
  schema.prisma     database models
  seed.ts           demo data
.claude/commands    Claude Code working commands
docs/               roadmap and product notes
```

## Core product logic

1. Carrier creates trip.
2. System generates deep link.
3. Carrier shares post manually in Telegram groups.
4. Passenger opens bot from deep link.
5. Passenger books seat.
6. Platform collects trust/reputation data.
