import test from 'node:test';
import assert from 'node:assert/strict';
import { loadState, saveState } from '../storage.js';

async function withStorage(run) {
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (_name, _options, action) => action() } } });
  const previous = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  try { return await run(values); }
  finally {
    if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator;
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
}

test('khởi động lần đầu với dữ liệu giả lập được đánh dấu rõ', () => withStorage(async () => {
  const initial = loadState();
  assert.equal(initial.demo, true);
  assert.equal(initial.version, 2);
  assert.ok(initial.accounts.length > 0);
  assert.ok(initial.transactions.length > 0);
}));

test('lưu rồi tải lại giao dịch giữ nguyên các giá trị và không sửa bản gốc', () => withStorage(async () => {
  const initial = loadState();
  const edited = {
    ...initial,
    transactions: [...initial.transactions, {
      id: 'qa-fake', date: '2026-09-30', kind: 'expense', amount: 123_000,
      accountId: 'bank-main', category: 'Thử nghiệm', note: 'Dữ liệu giả',
    }],
  };
  await saveState(edited);
  const reloaded = loadState();
  assert.deepEqual(reloaded, edited);
  assert.equal(initial.transactions.some((tx) => tx.id === 'qa-fake'), false);
}));

test('dữ liệu trình duyệt hỏng được báo lỗi thay vì âm thầm đặt lại', () => withStorage(async (values) => {
  await saveState(loadState());
  const key = [...values.keys()][0];
  values.set(key, '{not-json');
  assert.throws(() => loadState(), /không đọc được/);
  values.set(key, JSON.stringify({ version: 1, accounts: [] }));
  assert.throws(() => loadState(), /không đúng định dạng/);
}));
