import axios from 'axios';
import { env } from '../utils/env';

const baseUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

export async function sendMessage(chatId: number | string, text: string, extra?: Record<string, unknown>) {
  await axios.post(`${baseUrl}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  await axios.post(`${baseUrl}/answerCallbackQuery`, {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}
