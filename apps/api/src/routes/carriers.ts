import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma';

export const carriersRouter = Router();

carriersRouter.get('/', async (_req, res, next) => {
  try {
    const carriers = await prisma.carrier.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    res.json({ ok: true, carriers });
  } catch (error) {
    next(error);
  }
});

carriersRouter.patch('/:id/tier', async (req, res, next) => {
  try {
    const schema = z.object({ tier: z.enum(['COMMUNITY', 'VERIFIED', 'PROFESSIONAL']) });
    const body = schema.parse(req.body);
    const carrier = await prisma.carrier.update({ where: { id: req.params.id }, data: { tier: body.tier } });
    res.json({ ok: true, carrier });
  } catch (error) {
    next(error);
  }
});
