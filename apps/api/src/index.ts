import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './utils/env';
import { handleTelegramUpdate } from './bot/handlers';
import { startPolling, stopPolling } from './bot/polling';
import { tripsRouter } from './routes/trips';
import { carriersRouter } from './routes/carriers';
import { adminRouter } from './routes/admin';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'trustedway-mobility-api' });
});

if (process.env.NODE_ENV !== 'development') {
  app.post('/telegram/webhook/:secret', async (req, res, next) => {
    try {
      if (req.params.secret !== env.WEBHOOK_SECRET) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      await handleTelegramUpdate(req.body);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
}

app.use('/api/trips', tripsRouter);
app.use('/api/carriers', carriersRouter);
app.use('/api/admin', adminRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  const message = error instanceof Error ? error.message : 'Internal error';
  res.status(500).json({ ok: false, error: message });
});

const server = app.listen(env.PORT, () => {
  console.log(`TrustedWay Mobility API running on port ${env.PORT}`);
  if (process.env.NODE_ENV === 'development') {
    startPolling();
  }
});

process.on('SIGINT', () => {
  stopPolling();
  server.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
  stopPolling();
  server.close(() => process.exit(0));
});
