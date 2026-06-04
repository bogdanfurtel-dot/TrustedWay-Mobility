import axios from 'axios';
import { env } from '../utils/env';
import { handleTelegramUpdate } from './handlers';

const baseUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

let running = false;

async function deleteWebhook() {
  await axios.post(`${baseUrl}/deleteWebhook`, { drop_pending_updates: false });
}

export async function startPolling() {
  await deleteWebhook();
  running = true;
  let offset = 0;

  console.log('Bot polling started');

  while (running) {
    try {
      const response = await axios.get(`${baseUrl}/getUpdates`, {
        params: { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] },
        timeout: 35000,
      });

      const updates = response.data.result as Array<{ update_id: number }>;
      for (const update of updates) {
        offset = update.update_id + 1;
        handleTelegramUpdate(update).catch(console.error);
      }
    } catch (error) {
      if (running) {
        console.error('Polling error:', error instanceof Error ? error.message : error);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }
}

export function stopPolling() {
  running = false;
}
