// Formatting configuration is injected; no persistence/schema decisions here.
export function createMoneyFormatter({ locale = 'vi-VN', currency = 'VND' } = {}) {
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency, useGrouping: true });
  return amount => {
    if (typeof amount !== 'number' || !Number.isFinite(amount)) throw new Error('Invalid money amount');
    return formatter.format(amount);
  };
}
