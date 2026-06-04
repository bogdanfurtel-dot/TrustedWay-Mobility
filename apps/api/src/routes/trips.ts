import { Router } from 'express';
import { z } from 'zod';
import { env } from '../utils/env';
import { prisma } from '../utils/prisma';
import { buildTelegramShareText, buildTripDeepLink, searchTrips } from '../services/tripService';

export const tripsRouter = Router();

tripsRouter.get('/search', async (req, res, next) => {
  try {
    const schema = z.object({ from: z.string(), to: z.string() });
    const query = schema.parse(req.query);
    const trips = await searchTrips(query.from, query.to);
    res.json({ ok: true, trips });
  } catch (error) {
    next(error);
  }
});

tripsRouter.get('/:id/share', async (req, res, next) => {
  try {
    const trip = await prisma.trip.findUnique({ where: { id: req.params.id }, include: { carrier: true } });
    if (!trip) return res.status(404).json({ ok: false, error: 'Trip not found' });
    const deepLink = trip.shortCode
      ? buildTripDeepLink(env.TELEGRAM_BOT_USERNAME, trip.shortCode)
      : `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=trip_${trip.id}`;
    const text = buildTelegramShareText({
      fromCity: trip.fromCity,
      toCity: trip.toCity,
      departureAt: trip.departureAt,
      price: trip.price,
      currency: trip.currency,
      availableSeats: trip.availableSeats,
      deepLink,
    });
    res.json({ ok: true, deepLink, text });
  } catch (error) {
    next(error);
  }
});
