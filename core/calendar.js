import { isValidDate, addDays } from '../ledger.js';
export { isValidDate, addDays };
// Validity is a pure function of the string; remembering accepted dates keeps O(n) validation cheap.
const validDates = new Set();
export function requireDate(value) { if (validDates.has(value)) return value; if (!isValidDate(value)) throw new Error('INVALID_LOCAL_DATE'); if (validDates.size > 20000) validDates.clear(); validDates.add(value); return value; }
export function requireTimezone(value) { try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); } catch { throw new Error('INVALID_TIMEZONE'); } return value; }
export function todayInTimezone(timezoneId, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: requireTimezone(timezoneId), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function daysInRange(start, endExclusive) {
  requireDate(start); requireDate(endExclusive);
  if (start >= endExclusive) throw new Error('INVALID_PERIOD');
  const result = [];
  for (let date = start; date < endExclusive; date = addDays(date, 1)) {
    if (result.length >= 3660) throw new Error('PERIOD_TOO_LARGE');
    result.push(date);
  }
  return result;
}
export function monthlyDate(monthKey, monthDay) {
  if (!/^\d{4}-\d{2}$/.test(monthKey) || !Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31) throw new Error('INVALID_MONTHLY_RULE');
  const [y, m] = monthKey.split('-').map(Number);
  if (m < 1 || m > 12) throw new Error('INVALID_MONTHLY_RULE');
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return requireDate(`${monthKey}-${String(Math.min(last, monthDay)).padStart(2, '0')}`);
}
