#!/usr/bin/env bash
set -euo pipefail

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${APP_URL:-}" ] || [ -z "${WEBHOOK_SECRET:-}" ]; then
  echo "Set TELEGRAM_BOT_TOKEN, APP_URL, WEBHOOK_SECRET first"
  exit 1
fi

curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=${APP_URL}/telegram/webhook/${WEBHOOK_SECRET}"
