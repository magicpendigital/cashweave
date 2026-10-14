export const id = () => globalThis.crypto.randomUUID();
export const clone = value => structuredClone(value);
export function canonical(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('INVALID_CANONICAL_VALUE');
    if (['undefined', 'function', 'bigint'].includes(typeof value)) throw new Error('INVALID_CANONICAL_VALUE');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
export async function digest(value) {
  const raw = typeof value === 'string' ? value : canonical(value);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))), n => n.toString(16).padStart(2, '0')).join('');
}
