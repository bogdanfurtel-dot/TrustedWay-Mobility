type SessionData = { step: 'awaiting_phone'; tripId: string; seats: number };

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
