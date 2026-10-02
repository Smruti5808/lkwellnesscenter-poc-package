// Clinic-local time helpers. The clinic runs on IST (UTC+05:30, no daylight saving); timestamps are stored in UTC.
const IST_OFFSET_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;

/** Clinic-local calendar date (YYYY-MM-DD) of a moment, shifted by whole days. */
export function istDate(moment: Date | string = new Date(), offsetDays = 0): string {
  return new Date(new Date(moment).getTime() + IST_OFFSET_MS + offsetDays * DAY_MS).toISOString().slice(0, 10);
}
/** UTC ISO timestamp for a clinic-local date and HH:MM time. */
export const istAt = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`).toISOString();
/** Day of week (0 = Sunday) of a clinic-local date. */
export const istWeekday = (date: string) => new Date(`${date}T12:00:00+05:30`).getUTCDay();
export const addMinutes = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60_000).toISOString();
export const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

export function ageOn(dateOfBirth: string, today = istDate()): number {
  const [y, m, d] = dateOfBirth.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
}

const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ...options });
const dateOnly = (value: string) => (value.length === 10 ? `${value}T06:30:00.000Z` : value);
export const formatDate = (value?: string) => (value ? fmt({ day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(dateOnly(value))) : '—');
export const formatTime = (value?: string) => (value ? fmt({ hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(value)) : '—');
export const formatDateTime = (value?: string) => (value ? `${formatDate(value)}, ${formatTime(value)}` : '—');
export const formatMonth = (value: string) => fmt({ month: 'long', year: 'numeric' }).format(new Date(dateOnly(value)));
export const formatWeekday =(date: string) => fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(dateOnly(date)));
export const formatMoney = (amount: number) => `₹${amount.toLocaleString('en-IN')}`;
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
