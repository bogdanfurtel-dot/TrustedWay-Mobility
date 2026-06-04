# Marketplace Flow Module — TrustedWay Mobility

You are working on TrustedWay Mobility — Telegram-first trusted mobility marketplace for Ukraine ↔ Europe passenger transport.

## Goal

Build the first real end-to-end marketplace flow:

Carrier creates trip → carrier shares deep link → passenger opens trip → passenger books seat → carrier receives booking.

## Strict rules

- Do NOT build mobile app.
- Do NOT build complex frontend.
- Do NOT add payments yet.
- Do NOT add AI yet.
- Do NOT overengineer auth.
- Keep everything Telegram-first.
- Keep code simple, production-ready, typed, and easy to extend.
- Use existing Prisma schema where possible.
- If schema is missing fields, add minimal migration.
- Preserve existing `/health`, `/search`, `/book`, `/carrier` behavior.

## Required implementation

### 1. Carrier menu

Command:

```text
/carrier