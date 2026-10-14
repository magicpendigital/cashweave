// Build the legacy personal-first review from current local source only.
// The reviewed shared document is already generated; do not rewrite source files.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sharedScriptHash } from '../shared-csp.js';
import { reviewOutputDirectory } from './review-output.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const names = ['ledger.js', 'sample.js', 'budgeting.js', 'state-schema.js', 'storage.js', 'shared-embed.js', 'app.js'];
const modules = [];
for (const name of names) {
  let code = await readFile(resolve(root, name), 'utf8');
  const exports = [...code.matchAll(/^export (?:async )?(?:function|const|class) (\w+)/gm)].map(match => match[1]);
  code = code.replace(/^import \{([^}]+)\} from ['"]\.\/([^'"]+)['"];?/gm,
    (_, symbols, dependency) => 'const {' + symbols + '} = modules[' + JSON.stringify(dependency) + '];');
  code = code.replace(/^export ((?:async )?function|const|class) /gm, '$1 ');
  if (/^(?:import|export)\s/m.test(code)) throw new Error('Unsupported module syntax: ' + name);
  modules.push('modules[' + JSON.stringify(name) + '] = (() => {\n' + code + '\nreturn {' + exports.join(',') + '};\n})();');
}
const script = ("'use strict';\nconst modules = {};\n" + modules.join('\n')).replace(/<\/script/g, '<\\/script');
const scriptHash = 'sha256-' + createHash('sha256').update(script).digest('base64');
let html = await readFile(resolve(root, 'index.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="./styles.css" />', '<style>' + await readFile(resolve(root, 'styles.css'), 'utf8') + '</style>');
// A callback preserves literal $ sequences inside embedded source text.
html = html.replace('<script type="module" src="./app.js"></script>', () => '<script>' + script + '</script>');
const policy = `default-src 'none'; script-src '${scriptHash}' '${sharedScriptHash}'; style-src 'unsafe-inline'; img-src data:; frame-src 'self'; connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'`;
html = html.replace('<head>', '<head>\n  <meta http-equiv="Content-Security-Policy" content="' + policy + '">');
const output = reviewOutputDirectory();
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'financial-assistant-couples-demo.html'), html);
await writeFile(resolve(output, 'standalone-syntax.mjs'), script);
console.log(JSON.stringify({ status: 'PASS', scope: 'local deterministic legacy review only', output, htmlSha256: createHash('sha256').update(html).digest('hex') }));
