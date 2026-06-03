import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';

export async function createBooking(input: {
  tripId: string;
  userId: string;
  seats: number;
  passengerName?: string;
  passengerPhone?: string;
}) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const trip = await tx.trip.findUnique({ where: { id: input.tripId } });
    if (!trip || trip.status !== 'ACTIVE') throw new Error('Trip is not available');
    if (trip.availableSeats < input.seats) throw new Error('Not enough seats');

    const booking = await tx.booking.create({
      data: {
        tripId: input.tripId,
        userId: input.userId,
        seats: input.seats,
        passengerName: input.passengerName,
        passengerPhone: input.passengerPhone,
        status: 'PENDING',
      },
    });

    await tx.trip.update({
      where: { id: input.tripId },
      data: { availableSeats: trip.availableSeats - input.seats },
    });

    return booking;
  });
}
