'use strict';
// Repo conventions: index.html is pure ASCII with short lines, and every
// inline <script> parses.
const fs = require('fs'); const path = require('path');
const { execFileSync } = require('child_process'); const os = require('os');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let bad = 0;
html.split('\n').forEach((l, i) => {
  if (/[^\x09\x0a\x0d\x20-\x7e]/.test(l)) { console.log('non-ASCII on line ' + (i + 1)); bad++; }
  if (l.length > 100) { console.log('line ' + (i + 1) + ' is ' + l.length + ' chars'); bad++; }
});
const brand = fs.readFileSync(path.join(__dirname, '..', 'brand.js'), 'utf8');
if (/[^\x09\x0a\x0d\x20-\x7e]/.test(brand)) { console.log('brand.js must be plain ASCII'); bad++; }
try { require('../brand.js'); } catch (e) { console.log('brand.js has an error: ' + e.message); bad++; }
const re = /<script>([\s\S]*?)<\/script>/g; let m, n = 0;
while ((m = re.exec(html))) {
  const f = path.join(os.tmpdir(), 'lvr-script-' + (n++) + '.js');
  fs.writeFileSync(f, m[1]);
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { console.log('script ' + n + ' fails node --check:\n' + e.stderr); bad++; }
}
// Secret scan: no keys, tokens or webhook URLs may ever be committed.
const SECRET = [
  [/discord(app)?\.com\/api\/webhooks\/\d+\/[\w-]{20,}/i, 'Discord webhook URL'],
  [/[MN][A-Za-z\d]{23,25}\.[\w-]{6}\.[\w-]{27,}/, 'Discord bot token'],
  [/Apisecret\s+[A-Za-z0-9]{32,}/, 'VdoCipher API secret'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/(SESSION_SECRET|CLIENT_SECRET|REST_TOKEN|API_SECRET)\s*[=:]\s*['"][A-Za-z0-9_\-]{24,}['"]/, 'hard-coded secret']
];
function walk(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    if (e.name === '.git' || e.name === 'node_modules' || e.name === 'dist') return;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) return walk(f);
    if (!/\.(js|json|html|md|yml|yaml|txt|env.*)$/i.test(e.name) && !/^\.env/.test(e.name)) return;
    const t = fs.readFileSync(f, 'utf8');
    SECRET.forEach(([re, what]) => {
      const m = t.match(re);
      if (m && !/['"](dev|test)-/.test(m[0])) { console.log('possible ' + what + ' in ' + path.relative(path.join(__dirname, '..'), f)); bad++; }
    });
  });
}
walk(path.join(__dirname, '..'));
console.log(bad ? bad + ' problem(s)' : 'index.html: ASCII, short lines, ' + n + ' script(s) parse; no secrets found');
process.exitCode = bad ? 1 : 0;
