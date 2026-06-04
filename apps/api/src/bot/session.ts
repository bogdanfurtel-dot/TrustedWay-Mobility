type SessionData =
  | { step: 'awaiting_phone'; tripId: string; seats: number }
  | { step: 'carrier_name' }
  | { step: 'trip_from' }
  | { step: 'trip_to'; from: string }
  | { step: 'trip_date'; from: string; to: string }
  | { step: 'trip_time'; from: string; to: string; date: string }
  | { step: 'trip_price'; from: string; to: string; departureAt: string }
  | { step: 'trip_seats'; from: string; to: string; departureAt: string; price: number }
  | { step: 'trip_notes'; from: string; to: string; departureAt: string; price: number; seats: number }
  | { step: 'trip_phone'; from: string; to: string; departureAt: string; price: number; seats: number; notes?: string };

const sessions = new Map<number, SessionData>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const TTL_MS = 15 * 60 * 1000;

export function getSession(chatId: number): SessionData | undefined {
  return sessions.get(chatId);
}

export function setSession(chatId: number, data: SessionData): void {
  const existing = timers.get(chatId);
  if (existing) clearTimeout(existing);
  sessions.set(chatId, data);
  timers.set(chatId, setTimeout(() => clearSession(chatId), TTL_MS));
}

export function clearSession(chatId: number): void {
  const existing = timers.get(chatId);
  if (existing) clearTimeout(existing);
  sessions.delete(chatId);
  timers.delete(chatId);
}
