export const CURRENCY_TABLE_VERSION = '2026-mvp-1';
export const EXPONENTS = Object.freeze({ VND: 0, USD: 2, JPY: 0, KWD: 3, EUR: 2, GBP: 2, CAD: 2, AUD: 2 });
export const INT64_MIN = -(2n ** 63n), INT64_MAX = 2n ** 63n - 1n;
export function minor(value) {
  if (typeof value !== 'string' || !/^-?(0|[1-9]\d*)$/.test(value) || value === '-0') throw new Error('INVALID_MINOR_AMOUNT');
  const n = BigInt(value);
  if (n < INT64_MIN || n > INT64_MAX) throw new Error('MONEY_OUT_OF_RANGE');
  return n;
}
export function money(currencyCode, amountMinor) {
  if (!Object.hasOwn(EXPONENTS, currencyCode)) throw new Error('UNSUPPORTED_CURRENCY');
  minor(amountMinor);
  return { currencyCode, amountMinor, currencyExponent: EXPONENTS[currencyCode] };
}
export const checked = n => minor(n.toString()).toString();
export const sum = values => checked(values.reduce((n, value) => n + minor(value), 0n));
export function positive(value) { const n = minor(value); if (n <= 0n) throw new Error('AMOUNT_MUST_BE_POSITIVE'); return n; }
export function parseMoney(text, currencyCode, locale = 'vi-VN') {
  money(currencyCode, '0');
  if (typeof text !== 'string' || text.trim() !== text || !text) throw new Error('INVALID_MONEY_INPUT');
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  const group = parts.find(p => p.type === 'group')?.value, decimal = parts.find(p => p.type === 'decimal')?.value;
  const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const unsigned = group ? `(?:\\d+|\\d{1,3}(?:${escape(group)}\\d{3})+)` : '\\d+';
  if (!new RegExp(`^-?${unsigned}(?:${escape(decimal)}\\d+)?$`).test(text)) throw new Error('AMBIGUOUS_MONEY_INPUT');
  const normalized = group ? text.split(group).join('') : text;
  const [whole, fraction = ''] = normalized.split(decimal), exponent = EXPONENTS[currencyCode];
  if (fraction.length > exponent) throw new Error('CURRENCY_FRACTION_NOT_ALLOWED');
  const negative = whole.startsWith('-');
  const n = BigInt(whole.replace('-', '')) * 10n ** BigInt(exponent) + BigInt(fraction.padEnd(exponent, '0') || '0');
  return money(currencyCode, checked(negative ? -n : n));
}
export function formatMinor(amountMinor, currencyCode, locale = 'vi-VN') {
  const { currencyExponent: exponent } = money(currencyCode, amountMinor);
  const n = minor(amountMinor), abs = n < 0n ? -n : n, scale = 10n ** BigInt(exponent);
  const fraction = (abs % scale).toString().padStart(exponent, '0');
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode, minimumFractionDigits: exponent, maximumFractionDigits: exponent });
  // BigInt preserves grouping for amounts beyond Number.MAX_SAFE_INTEGER.
  const parts = formatter.formatToParts(n < 0n ? -(abs / scale) : abs / scale);
  let result = parts.map(p => p.type === 'fraction' ? fraction : p.value).join('');
  if (n < 0n && abs / scale === 0n) result = formatter.formatToParts(-1n).map(p => p.type === 'integer' ? '0' : p.type === 'fraction' ? fraction : p.value).join('');
  return result;
}
