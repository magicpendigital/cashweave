import { sharedScriptHash } from './shared-csp.js';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
// Allowlist prevents the private source documents/ directory from being served.
const files = new Map([
  ['/next.html', ['next.html', 'text/html; charset=utf-8']],
  ['/next', ['next.html', 'text/html; charset=utf-8']],
  ['/ui/next.css', ['ui/next.css', 'text/css; charset=utf-8']],
  ['/ui/shared-view.js', ['ui/shared-view.js', 'text/javascript; charset=utf-8']],
  ['/ui/app.js', ['ui/app.js', 'text/javascript; charset=utf-8']],
  ['/ui/boot.js', ['ui/boot.js', 'text/javascript; charset=utf-8']],
  ['/ui/dom.js', ['ui/dom.js', 'text/javascript; charset=utf-8']],
  ['/ui/i18n.js', ['ui/i18n.js', 'text/javascript; charset=utf-8']],
  ['/ui/storage-failure.js', ['ui/storage-failure.js', 'text/javascript; charset=utf-8']],
  ['/ui/features.js', ['ui/features.js', 'text/javascript; charset=utf-8']],
  ['/ui/screens/welcome.js', ['ui/screens/welcome.js', 'text/javascript; charset=utf-8']],
  ['/ui/screens/home.js', ['ui/screens/home.js', 'text/javascript; charset=utf-8']],
  ['/ui/screens/ledger.js', ['ui/screens/ledger.js', 'text/javascript; charset=utf-8']],
  ['/ui/screens/plans.js', ['ui/screens/plans.js', 'text/javascript; charset=utf-8']],
  ['/ui/screens/funds.js', ['ui/screens/funds.js', 'text/javascript; charset=utf-8']],
  ['/ui/screens/more.js', ['ui/screens/more.js', 'text/javascript; charset=utf-8']],
  ['/ui/screens/assets.js', ['ui/screens/assets.js', 'text/javascript; charset=utf-8']],
  ['/core/recipes.js', ['core/recipes.js', 'text/javascript; charset=utf-8']],
  ['/core/allocation.js', ['core/allocation.js', 'text/javascript; charset=utf-8']],
  ['/core/calendar.js', ['core/calendar.js', 'text/javascript; charset=utf-8']],
  ['/core/commands.js', ['core/commands.js', 'text/javascript; charset=utf-8']],
  ['/core/identity.js', ['core/identity.js', 'text/javascript; charset=utf-8']],
  ['/core/migration.js', ['core/migration.js', 'text/javascript; charset=utf-8']],
  ['/core/model.js', ['core/model.js', 'text/javascript; charset=utf-8']],
  ['/core/money.js', ['core/money.js', 'text/javascript; charset=utf-8']],
  ['/core/reports.js', ['core/reports.js', 'text/javascript; charset=utf-8']],
  ['/core/repository.js', ['core/repository.js', 'text/javascript; charset=utf-8']],
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/couples.html', ['couples.html', 'text/html; charset=utf-8']],
  ['/couples.js', ['couples.js', 'text/javascript; charset=utf-8']],
  ['/couples-app.js', ['couples-app.js', 'text/javascript; charset=utf-8']],
  ['/couples.css', ['couples.css', 'text/css; charset=utf-8']],
  ['/shared-embed.js', ['shared-embed.js', 'text/javascript; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/ledger.js', ['ledger.js', 'text/javascript; charset=utf-8']],
  ['/budgeting.js', ['budgeting.js', 'text/javascript; charset=utf-8']],
  ['/state-schema.js', ['state-schema.js', 'text/javascript; charset=utf-8']],
  ['/storage.js', ['storage.js', 'text/javascript; charset=utf-8']],
  ['/sample.js', ['sample.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);
const port = Number(process.env.PORT || 4173);

createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const entry = files.get(pathname);
  if (!entry || request.method !== 'GET') {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Không tìm thấy tài nguyên.');
    return;
  }
  try {
    const body = await readFile(join(root, entry[0]));
    response.writeHead(200, {
      'Content-Type': entry[1],
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': `default-src 'self'; img-src 'self' data:; script-src 'self' '${sharedScriptHash}'; style-src 'self' 'unsafe-inline'; frame-src 'self'; connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
    });
    response.end(body);
  } catch {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Không đọc được tài nguyên.');
  }
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`Prototype chạy tại http://127.0.0.1:${port}\n`);
});
