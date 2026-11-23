'use strict';
// In-memory stand-ins for Discord, VdoCipher and Upstash, for local dev/tests.
const http = require('http');

const ACCESS = 'role_access';
const users = {
  '100000000000000001': { username: 'mentor', roles: [ACCESS] },        // admin
  '100000000000000002': { username: 'member', roles: [ACCESS] },
  '100000000000000003': { username: 'outsider', roles: [] },
  '100000000000000004': { username: 'stranger', roles: null },         // not in guild
  '100000000000000008': { username: 'second', roles: ['role_access2'] }, // 2nd student role
  '100000000000000009': { username: 'newbie', roles: ['role_access'] },
  '100000000000000010': { username: 'nomfa', roles: ['role_owner', 'role_access'], mfa: false },
  // a Discord account made 3 days ago (for the new-account check)
  [String(BigInt(Date.now() - 1420070400000 - 3 * 86400000) << 22n)]: { username: 'fresh', roles: ['role_access'] }
};
const videos = {}; const deleted = []; const otps = []; const hooks = [];
const store = new Map(); const exp = new Map();

function alive(k) {
  if (exp.has(k) && exp.get(k) < Date.now()) { store.delete(k); exp.delete(k); }
  return store.has(k);
}
function redis(c) {
  const [cmd, k] = [String(c[0]).toUpperCase(), c[1]];
  const has = alive(k);
  switch (cmd) {
    case 'GET': return has ? store.get(k) : null;
    case 'SET': {
      const opts = c.slice(3).map(x => String(x).toUpperCase());
      if (opts.indexOf('NX') >= 0 && has) return null;
      store.set(k, c[2]); exp.delete(k);
      const ei = opts.indexOf('EX');
      if (ei >= 0) exp.set(k, Date.now() + c[3 + ei + 1] * 1000);
      return 'OK';
    }
    case 'DEL': { const n = has ? 1 : 0; store.delete(k); exp.delete(k); return n; }
    case 'INCR': { const n = (has ? +store.get(k) : 0) + 1; store.set(k, String(n)); return n; }
    case 'EXPIRE': if (has) exp.set(k, Date.now() + c[2] * 1000); return has ? 1 : 0;
    case 'TTL': if (!has) return -2; return exp.has(k) ? Math.ceil((exp.get(k) - Date.now()) / 1000) : -1;
    case 'SADD': case 'SREM': case 'SISMEMBER': case 'SMEMBERS': case 'SCARD': {
      const s = has ? store.get(k) : new Set(); store.set(k, s);
      if (cmd === 'SADD') { let n = 0; c.slice(2).forEach(v => { if (!s.has(v)) { n++; s.add(v); } }); return n; }
      if (cmd === 'SREM') return s.delete(c[2]) ? 1 : 0;
      if (cmd === 'SISMEMBER') return s.has(c[2]) ? 1 : 0;
      if (cmd === 'SCARD') return s.size;
      return Array.from(s);
    }
    case 'LPUSH': { const l = has ? store.get(k) : []; l.unshift(c[2]); store.set(k, l); return l.length; }
    case 'LTRIM': if (has) store.set(k, store.get(k).slice(+c[2], +c[3] + 1)); return 'OK';
    case 'LRANGE': return has ? store.get(k).slice(+c[2], +c[3] + 1) : [];
    case 'HSET': { const h = has ? store.get(k) : {}; h[c[2]] = c[3]; store.set(k, h); return 1; }
    case 'HGET': { const h = has ? store.get(k) : {}; return h[c[2]] === undefined ? null : h[c[2]]; }
    case 'HDEL': { const h = has ? store.get(k) : {}; const n = h[c[2]] === undefined ? 0 : 1; delete h[c[2]]; return n; }
    case 'HKEYS': { const h = has ? store.get(k) : {}; return Object.keys(h); }
    case 'HGETALL': { const h = has ? store.get(k) : {}; return [].concat.apply([], Object.keys(h).map(x => [x, h[x]])); }
    default: throw new Error('mock redis: unsupported ' + cmd);
  }
}

function body(req) {
  return new Promise(r => { let s = ''; req.on('data', d => s += d); req.on('end', () => r(s)); });
}
function send(res, st, obj) {
  res.writeHead(st, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function start(port) {
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); const p = u.pathname; const raw = await body(req);
    try {
      // ---- Upstash ----
      if (p === '/redis') return send(res, 200, { result: redis(JSON.parse(raw)) });
      if (p === '/hook') { hooks.push(JSON.parse(raw)); res.writeHead(204); return res.end(); }
      // ---- IPinfo Lite ----
      if (p.indexOf('/ipinfo/lite/') === 0) {
        const ip = decodeURIComponent(p.slice(13));
        return send(res, 200, /^146\.70\./.test(ip) ?
          { ip, asn: 'AS9009', as_name: 'M247 Europe SRL', as_domain: 'm247.com', country_code: 'JP' } :
          { ip, asn: 'AS7922', as_name: 'Comcast Cable Communications, LLC', as_domain: 'comcast.com', country_code: 'US' });
      }
      // ---- Discord ----
      if (p === '/discord/oauth2/token') {
        const code = new URLSearchParams(raw).get('code');
        if (!users[code]) return send(res, 400, { error: 'invalid_grant' });
        return send(res, 200, { access_token: 'tok_' + code });
      }
      if (p === '/discord/users/@me') {
        const uid = String(req.headers.authorization || '').replace('Bearer tok_', '');
        if (!users[uid]) return send(res, 401, {});
        return send(res, 200, { id: uid, username: users[uid].username, global_name: users[uid].username,
          email: users[uid].username + '@example.com', verified: true,
          mfa_enabled: users[uid].mfa !== false,
          avatar: null, banner: null, accent_color: 0x7a1d22 });
      }
      let m = /^\/discord\/users\/@me\/guilds\/[^/]+\/member$/.exec(p);
      if (m) {
        const uid = String(req.headers.authorization || '').replace('Bearer tok_', '');
        const usr = users[uid];
        if (!usr) return send(res, 401, {});
        if (!usr.roles) return send(res, 404, { code: 10004 });
        return send(res, 200, { roles: usr.roles, nick: null, joined_at: '2025-03-14T18:00:00.000Z',
          user: { id: uid, username: usr.username, global_name: usr.username, avatar: null } });
      }
      // ---- VdoCipher ----
      if (p.indexOf('/vdo') === 0 && p !== '/vdo/upload' && p.indexOf('/vdo/poster/') !== 0 &&
          req.headers.authorization !== 'Apisecret test-secret') return send(res, 401, { message: 'auth' });
      if (req.method === 'PUT' && p === '/vdo/videos') {
        const id = 'vid' + Math.random().toString(36).slice(2, 10);
        videos[id] = { status: 'PRE-Upload', title: u.searchParams.get('title') };
        return send(res, 200, { videoId: id, clientPayload: {
          policy: 'p', key: 'k', 'x-amz-signature': 's', 'x-amz-algorithm': 'a',
          'x-amz-date': 'd', 'x-amz-credential': 'c',
          uploadLink: 'http://127.0.0.1:' + port + '/vdo/upload' } });
      }
      if (p.indexOf('/vdo/poster/') === 0) {
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        return res.end(require('fs').readFileSync(require('path').join(__dirname, 'poster-sample.jpg')));
      }
      if (p === '/vdo/upload') {
        res.writeHead(req.method === 'OPTIONS' ? 204 : 201, {
          'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST' });
        return res.end();
      }
      if (req.method === 'DELETE' && p === '/vdo/videos') {
        u.searchParams.get('videos').split(',').forEach(id => { deleted.push(id); delete videos[id]; });
        return send(res, 200, { message: 'deleted' });
      }
      // captions: list / upload (multipart, ?language=xx) / delete
      let fm = /^\/vdo\/videos\/([^/]+)\/files\/?(\d+)?$/.exec(p);
      if (fm) {
        const v = videos[fm[1]]; if (!v) return send(res, 404, { message: 'nf' });
        v.files = v.files || [];
        if (req.method === 'GET') return send(res, 200, v.files);
        if (req.method === 'POST') {
          if (!/^multipart\/form-data/.test(req.headers['content-type'] || '') || raw.indexOf('WEBVTT') < 0) {
            return send(res, 400, { message: 'bad caption' });
          }
          const f = { id: Math.floor(Math.random() * 1e8), time: new Date().toISOString(),
            size: Math.ceil(raw.length / 1024) + ' kB', lang: u.searchParams.get('language') };
          v.files.push(f); return send(res, 200, f);
        }
        if (req.method === 'DELETE') {
          v.files = v.files.filter(f => String(f.id) !== fm[2]); return send(res, 200, { message: 'deleted' });
        }
      }
      m = /^\/vdo\/videos\/([^/]+)(\/otp)?$/.exec(p);
      if (m && !m[2] && req.method === 'GET') {
        const v = videos[m[1]]; if (!v) return send(res, 404, { message: 'nf' });
        return send(res, 200, { id: m[1], status: v.status, length: v.length || 0,
          posters: [{ width: 480, height: 270, posterUrl: 'http://127.0.0.1:' + port + '/vdo/poster/' + m[1] + '.jpg' }] });
      }
      if (m && m[2] && req.method === 'POST') {
        if (!videos[m[1]]) return send(res, 404, { message: 'nf' });
        const b = JSON.parse(raw); otps.push({ video: m[1], body: b });
        return send(res, 200, { otp: 'otp_' + m[1], playbackInfo: 'pi_' + m[1] });
      }
      send(res, 404, { message: 'mock: no route ' + req.method + ' ' + p });
    } catch (e) { send(res, 500, { error: String(e.message) }); }
  });
  return new Promise(r => srv.listen(port, '127.0.0.1', () => r(srv)));
}

module.exports = { start, users, videos, deleted, otps, hooks, store, ACCESS };
