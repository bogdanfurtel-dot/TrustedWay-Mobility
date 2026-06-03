import { Router } from 'express';
import { prisma } from '../utils/prisma';

export const adminRouter = Router();

adminRouter.get('/dashboard', async (_req, res, next) => {
  try {
    const [users, carriers, trips, bookings] = await Promise.all([
      prisma.user.count(),
      prisma.carrier.count(),
      prisma.trip.count(),
      prisma.booking.count(),
    ]);
    res.json({ ok: true, metrics: { users, carriers, trips, bookings } });
  } catch (error) {
    next(error);
  }
});
