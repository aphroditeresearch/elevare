'use strict';
// Local dev server: serves the static site and runs api/*.js like Vercel.
// `npm run dev` uses mocks for Discord, VdoCipher and Upstash unless
// MOCK=0 is set (then real env vars from your shell are used).
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.mp4': 'video/mp4',
  '.svg': 'image/svg+xml', '.js': 'text/javascript', '.woff2': 'font/woff2' };
const STATIC = ['/index.html', '/brand.js', '/logo.png', '/favicon.png', '/apple-touch-icon.png',
  '/fonts/anton.woff2'];

function mockEnv(mockPort, port) {
  Object.assign(process.env, {
    DISCORD_CLIENT_ID: 'cid', DISCORD_CLIENT_SECRET: 'csecret',
    DISCORD_GUILD_ID: 'guild1', ACCESS_ROLE_ID: 'role_access,role_access2',
    ADMIN_IDS: '100000000000000001', TIERS: 'Elite:role_elite',
    ADMIN_ROLE_ID: 'role_owner', ALERT_WEBHOOK: 'http://127.0.0.1:' + mockPort + '/hook', SESSION_SECRET: 'dev-session-secret-0123456789-abcdefghijk',
    VDOCIPHER_API_SECRET: 'test-secret',
    KV_REST_API_URL: 'http://127.0.0.1:' + mockPort + '/redis', KV_REST_API_TOKEN: 't',
    DISCORD_API: 'http://127.0.0.1:' + mockPort + '/discord',
    VDOCIPHER_API: 'http://127.0.0.1:' + mockPort + '/vdo',
    IPINFO_TOKEN: 'dev', IPINFO_API: 'http://127.0.0.1:' + mockPort + '/ipinfo',
    NEWS_API: 'http://127.0.0.1:' + mockPort + '/news',
    DISCORD_REDIRECT_URI: 'http://localhost:' + port + '/api/callback'
  });
}

const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Dev-only: /__dev/login?as=admin|member signs in through the mocked OAuth.
async function devLogin(port, as, res) {
  const uid = as === 'admin' ? '100000000000000001' : '100000000000000002';
  const base = 'http://localhost:' + port;
  const a = await fetch(base + '/api/login', { redirect: 'manual',
    headers: { 'User-Agent': CHROME_UA } });
  const state = new URL(a.headers.get('location')).searchParams.get('state');
  const sc = a.headers.getSetCookie()[0].split(';')[0];
  const b = await fetch(base + '/api/callback?code=' + uid + '&state=' +
    encodeURIComponent(state), { redirect: 'manual',
    headers: { 'User-Agent': CHROME_UA, Cookie: sc } });
  res.statusCode = 302;
  res.setHeader('Set-Cookie', b.headers.getSetCookie());
  res.setHeader('Location', '/');
  res.end();
}

function start(port) {
  const srv = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    if (p === '/__dev/login' && process.env.DEV_LOGIN === '1') {
      return devLogin(port, new URL(req.url, 'http://x').searchParams.get('as'), res);
    }
    const m = /^\/api\/([a-z]+)$/.exec(p);
    if (m && fs.existsSync(path.join(ROOT, 'api', m[1] + '.js'))) {
      const h = require(path.join(ROOT, 'api', m[1] + '.js'));
      return Promise.resolve(h(req, res)).catch(e => {
        console.error(e); res.statusCode = 500; res.end('error');
      });
    }
    if (p === '/' || p === '/index.html') {
      return Promise.resolve(require(path.join(ROOT, 'api', 'page.js'))(req, res))
        .catch(e => { console.error(e); res.statusCode = 500; res.end('error'); });
    }
    const f = p;
    const asset = /^\/(media|fonts)\/[\w.-]+$/.test(f) && fs.existsSync(path.join(ROOT, f));
    if (STATIC.indexOf(f) < 0 && !asset) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(f)] || 'application/octet-stream');
    fs.createReadStream(path.join(ROOT, f)).pipe(res);
  });
  return new Promise(r => srv.listen(port, () => r(srv)));
}

module.exports = { start, mockEnv };

if (require.main === module) {
  const port = +(process.env.PORT || 3000);
  (async () => {
    if (process.env.MOCK !== '0') {
      const mocks = require('./mocks');
      await mocks.start(port + 1);
      mockEnv(port + 1, port);
      process.env.DEV_LOGIN = '1';
      require('./seed')(mocks);
      console.log('Mocks on :' + (port + 1) + ' with placeholder content. Sign in with:');
      console.log('  http://localhost:' + port + '/__dev/login?as=admin');
      console.log('  http://localhost:' + port + '/__dev/login?as=member');
    }
    await start(port);
    console.log('Elevare dev server: http://localhost:' + port);
  })();
}
