import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3001),
  APP_URL: z.string().default('http://localhost:3001'),
  WEBHOOK_SECRET: z.string().min(3),
  TELEGRAM_BOT_TOKEN: z.string().min(5),
  TELEGRAM_BOT_USERNAME: z.string().default('TrustedWayBot'),
  DATABASE_URL: z.string().optional(),
});

export const env = EnvSchema.parse(process.env);
