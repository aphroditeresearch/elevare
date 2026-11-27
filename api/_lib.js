'use strict';
// Shared helpers. Files starting with "_" are not deployed as functions.
const crypto = require('crypto');

// ---------- env ----------
function env(name, def) {
  const v = process.env[name];
  return v === undefined || v === '' ? def : v;
}
function list(name) {
  return String(env(name, '')).split(',').map(s => s.trim()).filter(Boolean);
}
const BRAND = require('../brand.js');
const SITE_NAME = () => env('SITE_NAME', BRAND.name || 'Vault');
const ACCENT = () => parseInt(String(BRAND.accent || '#a8141b').replace('#', ''), 16) || 0xA8141B;
const DISCORD_API = () => env('DISCORD_API', 'https://discord.com/api');
const VDO_API = () => env('VDOCIPHER_API', 'https://dev.vdocipher.com/api');
const REDIS_URL = () => env('KV_REST_API_URL', env('UPSTASH_REDIS_REST_URL'));
const REDIS_TOKEN = () =>
  env('KV_REST_API_TOKEN', env('UPSTASH_REDIS_REST_TOKEN'));

function configured() {
  return !!(env('DISCORD_CLIENT_ID') && env('DISCORD_CLIENT_SECRET') &&
    env('DISCORD_GUILD_ID') && env('ACCESS_ROLE_ID') &&
    String(env('SESSION_SECRET', '')).length >= 32 && REDIS_URL() && REDIS_TOKEN());
}

// Only the real site may serve members. Preview deployments share the
// production secrets, so they are refused unless ALLOW_PREVIEW=1, and when
// SITE_HOSTS is set (e.g. "elevare.example,www.elevare.example") any other host is too.
function hostOk(req) {
  if (env('VERCEL_ENV') === 'preview' && env('ALLOW_PREVIEW') !== '1') return false;
  const hosts = list('SITE_HOSTS').map(h => h.toLowerCase());
  if (!hosts.length) return true;
  const h = String(req.headers.host || '').split(':')[0].toLowerCase();
  return hosts.indexOf(h) >= 0;
}

// ---------- tiny utils ----------
function rid(bytes) { return crypto.randomBytes(bytes || 12).toString('hex'); }
function sign(value) {
  return crypto.createHmac('sha256', env('SESSION_SECRET', ''))
    .update(String(value)).digest('base64url');
}
function safeEq(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
// Client IP. Prefer the headers Vercel sets itself (a visitor can't fake
// them); a visitor-supplied X-Forwarded-For is only the last resort.
function ip(req) {
  const v = String(req.headers['x-vercel-forwarded-for'] || req.headers['x-real-ip'] || '');
  const f = String(req.headers['x-forwarded-for'] || '');
  return v.split(',')[0].trim() || f.split(',')[0].trim() ||
    (req.socket && req.socket.remoteAddress) || 'unknown';
}
function query(req) {
  const u = new URL(req.url, 'http://x');
  const o = {}; u.searchParams.forEach((v, k) => { o[k] = v; });
  return o;
}

// ---------- cookies ----------
function cookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
// maxAge null = a browser-session cookie: gone when Chrome is closed.
function setCookie(res, name, value, maxAge) {
  const c = name + '=' + encodeURIComponent(value) +
    '; Path=/; HttpOnly; Secure; SameSite=Lax' +
    (maxAge === null ? '' : '; Max-Age=' + maxAge);
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, c) : c);
}

// ---------- responses ----------
function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
function redirect(res, to) {
  res.statusCode = 302;
  res.setHeader('Location', to);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}
async function readBody(req, max) {
  if (req.body !== undefined) {
    if (typeof req.body === 'object' && req.body !== null) return req.body;
    try { return JSON.parse(String(req.body || '{}')); } catch (e) { return {}; }
  }
  const chunks = []; let size = 0;
  for await (const ch of req) {
    size += ch.length; if (size > (max || 65536)) return {};
    chunks.push(ch);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch (e) { return {}; }
}

// ---------- request checks ----------
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return req.method === 'GET';
  try { return new URL(o).host === req.headers.host; } catch (e) { return false; }
}
function isChrome(req) {
  const ua = String(req.headers['user-agent'] || '');
  if (!/Chrome\/\d|CriOS\/\d/.test(ua)) return false;
  return !/Edg\/|EdgA\/|EdgiOS|OPR\/|Opera|SamsungBrowser|YaBrowser|Vivaldi|UCBrowser|HeadlessChrome|Electron\/|QtWebEngine|CefSharp/.test(ua);
}
// DRM downloaders usually log in through their own built-in browser: plain
// Chromium dressed up with a Chrome user agent. Real Chrome and Brave name
// themselves in the Sec-CH-UA header ("Google Chrome" / "Brave"); a bare
// Chromium build does not. (Brave can turn the header off, so a missing
// header is allowed.)
function embeddedBrowser(req) {
  const ch = String(req.headers['sec-ch-ua'] || '');
  if (!ch || !isChrome(req)) return false;
  return !/"Google Chrome"|"Brave"/.test(ch);
}
// Elevare is Chrome-only (Chrome or Brave on a computer). Safari is always
// refused; there is deliberately no setting to allow it.
function safariAllowed() { return false; }
function isSafari(req) {
  const ua = String(req.headers['user-agent'] || '');
  return /Version\/[\d.]+.*Safari\//.test(ua) &&
    !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|OPR|Android/.test(ua);
}
// Desktop only unless ALLOW_MOBILE=1 (phones and tablets are refused).
function isMobile(req) {
  if (env('ALLOW_MOBILE') === '1') return false;
  const ua = String(req.headers['user-agent'] || '');
  return req.headers['sec-ch-ua-mobile'] === '?1' ||
    /Android|iPhone|iPad|iPod|Mobile|CriOS|FxiOS|EdgiOS/i.test(ua);
}
function browserOk(req) {
  return !isMobile(req) && !embeddedBrowser(req) &&
    isChrome(req);
}

// Membership tiers: TIERS="Core:roleId,Elite:roleId"
function tiers() {
  return list('TIERS').map(x => {
    const i = x.lastIndexOf(':');
    return i > 0 ? { name: x.slice(0, i).trim(), role: x.slice(i + 1).trim() } : null;
  }).filter(Boolean);
}
function tierRole(name) {
  const t = tiers().find(x => x.name === name);
  return t ? t.role : null;
}
function hasTier(s, name) {
  if (!name || s.admin) return true;
  const role = tierRole(name);
  return !role || (s.roles || []).indexOf(role) >= 0;
}

// Common front-matter for every API function.
function guard(req, res, methods) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (methods.indexOf(req.method) < 0) { json(res, 405, { error: 'method' }); return false; }
  if (!hostOk(req)) { json(res, 403, { error: 'host' }); return false; }
  if (req.method !== 'GET' && !sameOrigin(req)) { json(res, 403, { error: 'origin' }); return false; }
  // JSON only: plain HTML forms from other sites can't send this.
  if (req.method === 'POST' &&
      !/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) {
    json(res, 415, { error: 'type' }); return false;
  }
  if (!configured()) { json(res, 503, { error: 'setup' }); return false; }
  return true;
}

// ---------- redis (Upstash REST) ----------
async function kv() {
  const args = Array.prototype.slice.call(arguments).map(String);
  const r = await fetch(REDIS_URL(), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REDIS_TOKEN(), 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error('redis: ' + (d.error || r.status));
  return d.result;
}
// Every key starts with REDIS_PREFIX (default "elevare"), so two brands can
// even share one database without mixing data. A separate database per brand
// is still the cleanest setup.
const K = s => (env('REDIS_PREFIX', 'elevare').replace(/[^a-z0-9_-]/gi, '') || 'elevare') + ':' + s;

async function rateLimit(key, max, windowSec) {
  const k = K('rl:' + key);
  const n = await kv('INCR', k);
  if (n === 1) await kv('EXPIRE', k, windowSec);
  return n <= max;
}

async function loadContent() {
  const raw = await kv('GET', K('content'));
  let c = null; try { c = raw ? JSON.parse(raw) : null; } catch (e) { c = null; }
  if (!c || !Array.isArray(c.sections) || !Array.isArray(c.items)) c = { sections: [], items: [] };
  if (!c.announcement) c.announcement = null;
  return c;
}
async function saveContent(c) { await kv('SET', K('content'), JSON.stringify(c)); }

async function isBlocked(uid) { return (await kv('SISMEMBER', K('blocked'), uid)) === 1; }

// ---------- security log ----------
// Everything goes to the Admin security log. Only events that show intent to
// copy or rip content also go to the Discord alert channel, with a ping.
const RIP_KINDS = {
  'devtools': 'Opened developer tools (page shut)',
  'printscreen': 'Pressed PrintScreen',
  'screenshot-keys': 'Used the screenshot keys',
  'automation': 'Automated/bot browser',
  'session-mismatch': 'Login cookie used from another browser (possible account sharing or theft)',
  'auth-failures': 'Repeatedly tried lessons they can’t access',
  'locked-probe': 'Tried to force-play a locked lecture',
  'tier-probe': 'Tried to force-play a lesson for another tier',
  'admin-probe': 'Tried to use the admin tools',
  'rate-limit': 'Requested videos at a scraping rate',
  'geo-anomaly': 'Played from different countries the same day (VPN hopping or shared account)',
  'binge': 'Started many different videos in a short time (typical of ripping)',
  'timeout': 'Timed out for 10 minutes after repeated developer tools use',
  'shared-device': 'Two different accounts used the same browser (account sharing)',
  'device-limit': 'Tried to watch on more browsers than allowed (account sharing)',
  'recorder-extension': 'A screen recorder extension added its controls to the page while watching',
  'no-gpu': 'Turned off hardware acceleration (the usual first step to record protected video)',
  'embedded-browser': 'Used a built-in app browser posing as Chrome (how DRM downloaders sign in)',
  'vm': 'Tried to watch inside a virtual machine (lets the real computer record it)',
  'keys-no-watch': 'Took video keys again and again without playing them (how DRM downloaders work)',
  'daily-limit': 'Hit the daily limit of different videos (bulk ripping pattern)'
};
const RIP_ACTIONS = /^(Save page|View page source|Developer tools shortcut|Print)/;
function ripIntent(kind, detail) {
  if (RIP_KINDS[kind]) return RIP_KINDS[kind];
  if (kind === 'blocked-action' && RIP_ACTIONS.test(String(detail || ''))) {
    return 'Tried: ' + detail;
  }
  return null;
}
// Who to ping: ALERT_PING = role or user id(s); default the admin role,
// else the admin user ids. "none" = no ping.
function pingLine() {
  const v = env('ALERT_PING', '');
  if (v === 'none') return { text: '', roles: [], users: [] };
  if (v) {
    const ids = v.split(',').map(x => x.trim()).filter(Boolean);
    const roles = [], users = [];
    ids.forEach(x => { if (/^user:/.test(x)) users.push(x.slice(5)); else roles.push(x.replace(/^role:/, '')); });
    return { roles, users, text: roles.map(r => '<@&' + r + '>').concat(users.map(u => '<@' + u + '>')).join(' ') };
  }
  const ar = env('ADMIN_ROLE_ID');
  if (ar) return { roles: [ar], users: [], text: '<@&' + ar + '>' };
  const us = list('ADMIN_IDS');
  return { roles: [], users: us, text: us.map(u => '<@' + u + '>').join(' ') };
}

async function alert(kind, who, detail, req) {
  const entry = {
    t: Date.now(), kind: String(kind).slice(0, 40),
    uid: who && who.uid || null, name: who && who.name || null,
    detail: detail ? String(detail).slice(0, 300) : '',
    ip: req ? ip(req) : null,
    ua: req ? String(req.headers['user-agent'] || '').slice(0, 200) : null
  };
  try {
    await kv('LPUSH', K('alerts'), JSON.stringify(entry));
    await kv('LTRIM', K('alerts'), 0, 1999);
    await hist(entry.uid, Object.assign({ type: 'alert' }, entry));
  } catch (e) { /* never break the request because logging failed */ }
  const hook = env('ALERT_WEBHOOK');
  const why = ripIntent(entry.kind, entry.detail);
  if (!hook || !why) return;
  // one Discord alert per member per kind every 10 minutes (no spam)
  try {
    const first = await kv('SET', K('hook:' + (entry.uid || entry.ip) + ':' + entry.kind), '1', 'NX', 'EX', 600);
    if (first !== 'OK') return;
  } catch (e) { /* if Redis fails, still alert */ }
  const ping = pingLine();
  const site = SITE_NAME();
  const body = {
    username: site + ' Security',
    content: (ping.text ? ping.text + ' ' : '') + '⚠️ Possible content ripping on ' + site,
    allowed_mentions: { parse: [], roles: ping.roles, users: ping.users },
    embeds: [{
      title: why,
      color: ACCENT(),
      fields: [
        { name: 'Member', value: (entry.name || 'Unknown') + (entry.uid ? ' (<@' + entry.uid + '>)' : ''), inline: true },
        { name: 'Discord ID', value: entry.uid || 'not signed in', inline: true },
        { name: 'Network', value: entry.ip || 'unknown', inline: true },
        { name: 'Detail', value: (entry.detail || entry.kind).slice(0, 300) },
        { name: 'Browser', value: (entry.ua || 'unknown').slice(0, 200) }
      ],
      footer: { text: 'Event: ' + entry.kind + ' · Admin > Security log has the full history' },
      timestamp: new Date(entry.t).toISOString()
    }]
  };
  try {
    await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body) });
  } catch (e) { /* ignore */ }
}

// ---------- roles ----------
function isAdminOf(uid, roles) {
  if (list('ADMIN_IDS').indexOf(String(uid)) >= 0) return true;
  const ar = env('ADMIN_ROLE_ID');
  return !!(ar && (roles || []).indexOf(ar) >= 0);
}
// Admin powers also need two-factor on the Discord account (turn off with
// REQUIRE_ADMIN_MFA=0). Without it, a would-be admin is treated as a member.
function adminOk(uid, roles, mfa) {
  return isAdminOf(uid, roles) && (mfa === true || env('REQUIRE_ADMIN_MFA') === '0');
}
function hasAccess(uid, roles) {
  // ACCESS_ROLE_ID may list several roles, comma-separated
  return isAdminOf(uid, roles) ||
    list('ACCESS_ROLE_ID').some(r => (roles || []).indexOf(r) >= 0);
}

// ---------- discord ----------
async function discordMember(token) {
  const r = await fetch(DISCORD_API() + '/users/@me/guilds/' +
    env('DISCORD_GUILD_ID') + '/member', { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 401) return { status: 'token' };
  if (r.status === 404) return { status: 'not_member' };
  if (!r.ok) return { status: 'error', code: r.status };
  return { status: 'ok', member: await r.json() };
}
// The member's own Discord profile (banner, accent colour, avatar).
async function discordUser(token) {
  try {
    const r = await fetch(DISCORD_API() + '/users/@me', { headers: { Authorization: 'Bearer ' + token } });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}
const HASH = /^(a_)?[a-f0-9]{16,64}$/i;
function profileBits(m, u) {
  u = u || {};
  return {
    avatar: HASH.test(String(u.avatar || (m.user && m.user.avatar) || '')) ? (u.avatar || m.user.avatar) : null,
    gavatar: HASH.test(String(m.avatar || '')) ? m.avatar : null,
    banner: HASH.test(String(u.banner || '')) ? u.banner : null,
    accent: typeof u.accent_color === 'number' ? u.accent_color : null
  };
}
function displayName(m) {
  const u = m.user || {};
  return String(m.nick || u.global_name || u.username || 'member').slice(0, 40);
}

// ---------- sessions (signed sid cookie -> redis record) ----------
const SESSION_COOKIE = 'elevare_session';
const SESSION_TTL = 7 * 24 * 3600;
const RECHECK_MS = 5 * 60 * 1000;

// A coarse browser fingerprint (OS + browser family, no version numbers) so a
// copied cookie doesn't work from a different kind of device or browser.
function fingerprint(req) {
  const ua = String(req.headers['user-agent'] || '').replace(/[\d._]+/g, '');
  return crypto.createHash('sha256').update(ua).digest('base64url').slice(0, 16);
}

async function createSession(res, data, req) {
  const sid = rid(24);
  const s = Object.assign({ sid: sid, chk: Date.now(), t0: Date.now(),
    fp: req ? fingerprint(req) : null }, data);
  await kv('SET', K('sess:' + sid), JSON.stringify(s), 'EX', SESSION_TTL);
  // one active session per account: a new sign-in replaces the old one
  // (the old session is refused on its next request with "elsewhere")
  await kv('SET', K('active:' + s.uid), sid, 'EX', SESSION_TTL);
  await sessLog('signin', s, req);
  setCookie(res, SESSION_COOKIE, sid + '.' + sign(sid), null);
  return s;
}
async function getSession(req) {
  const raw = cookies(req)[SESSION_COOKIE];
  if (!raw) return null;
  const i = raw.lastIndexOf('.');
  if (i < 1) return null;
  const sid = raw.slice(0, i);
  if (!safeEq(raw.slice(i + 1), sign(sid))) return null;
  const v = await kv('GET', K('sess:' + sid));
  if (!v) return null;
  try { return JSON.parse(v); } catch (e) { return null; }
}
// Read-only check for serving the members' version of the page: a valid,
// current session that isn't blocked. Changes nothing; the APIs still run
// the full requireMember() checks on every request.
async function pageAccess(req) {
  if (!configured()) return false;
  const s = await getSession(req);
  if (!s) return false;
  if (await isBlocked(s.uid)) return false;
  if (s.fp && s.fp !== fingerprint(req)) return false;
  const idle = Math.max(5, Number(env('SESSION_IDLE_MINUTES', '30')) || 30) * 60000;
  if (s.seen && Date.now() - s.seen > idle) return false;
  return (await kv('GET', K('active:' + s.uid))) === s.sid;
}
async function saveSession(s) {
  await kv('SET', K('sess:' + s.sid), JSON.stringify(s), 'EX', SESSION_TTL);
}
async function destroySession(res, s) {
  if (s) await kv('DEL', K('sess:' + s.sid));
  setCookie(res, SESSION_COOKIE, '', 0);
}

// Sign-in / sign-out history for admins.
async function sessLog(event, s, req) {
  try {
    const e = { t: Date.now(), event: event, uid: s && s.uid, name: s && s.name,
      ip: req ? ip(req) : null };
    await kv('LPUSH', K('sessions'), JSON.stringify(e));
    await kv('LTRIM', K('sessions'), 0, 4999);
    await hist(e.uid, Object.assign({ type: 'session',
      ua: req ? String(req.headers['user-agent'] || '').slice(0, 160) : null,
      country: req ? String(req.headers['x-vercel-ip-country'] || '').slice(0, 4) : null,
      city: req ? decodeURIComponent(String(req.headers['x-vercel-ip-city'] || '')).slice(0, 40) : null
    }, e));
  } catch (e) { /* ignore */ }
}

// Repeated access failures (locked/forbidden/unknown lessons) raise an alert.
async function authFail(s, what, req) {
  const k = K('rl:fail:' + s.uid);
  const n = await kv('INCR', k);
  if (n === 1) await kv('EXPIRE', k, 600);
  if (n === 5) await alert('auth-failures', s, '5 refused requests in 10 min (last: ' + what + ')', req);
}

// Re-checks Discord roles every 5 minutes (or right now when fresh is set,
// e.g. before every play). Returns the session, or null if the person has lost
// access (session is destroyed).
async function refresh(s, req, res, fresh) {
  if (!fresh && Date.now() - (s.chk || 0) < RECHECK_MS) return s;
  const r = await discordMember(s.tok);
  if (r.status === 'error') {
    if (fresh) return null; // can't confirm access: refuse this play
    return s; // Discord hiccup on page loads: don't lock people out
  }
  if (r.status !== 'ok' || !hasAccess(s.uid, r.member.roles)) {
    await alert('role-removed', s, r.status === 'ok' ? 'access role gone' : r.status, req);
    await destroySession(res, s);
    return null;
  }
  s.roles = r.member.roles;
  const du = await discordUser(s.tok);
  if (du && typeof du.mfa_enabled === 'boolean') s.mfa = du.mfa_enabled;
  s.admin = adminOk(s.uid, s.roles, s.mfa);
  s.name = displayName(r.member);
  Object.assign(s, profileBits(r.member, du));
  if (r.member.joined_at) s.joinedAt = r.member.joined_at;
  s.chk = Date.now();
  await saveSession(s);
  return s;
}

// Session + role refresh + block check in one go. Responds on failure.
async function requireMember(req, res, opts) {
  let s = await getSession(req);
  if (!s) { json(res, 401, { error: 'signin', safari: safariAllowed() }); return null; }
  if (await isBlocked(s.uid)) {
    await destroySession(res, s);
    json(res, 403, { error: 'blocked' });
    return null;
  }
  // 10-minute timeout after repeated developer-tools use
  const tl = await kv('TTL', K('timeout:' + s.uid));
  if (tl > 0) { json(res, 403, { error: 'timeout', wait: tl }); return null; }
  if (s.fp && s.fp !== fingerprint(req)) {
    await alert('session-mismatch', s, 'session cookie used from a different browser', req);
    await destroySession(res, s);
    json(res, 401, { error: 'expired' }); return null;
  }
  // signed out after a stretch of no activity (a playing video counts)
  const idle = Math.max(5, Number(env('SESSION_IDLE_MINUTES', '30')) || 30) * 60000;
  if (s.seen && Date.now() - s.seen > idle) {
    await destroySession(res, s);
    json(res, 401, { error: 'idle' }); return null;
  }
  if ((await kv('GET', K('active:' + s.uid))) !== s.sid) {
    await alert('session-replaced', s, 'old session used after a newer sign-in', req);
    await sessLog('replaced', s, req);
    await destroySession(res, s);
    json(res, 401, { error: 'elsewhere' }); return null;
  }
  if (!(await rateLimit('req:' + s.uid, 600, 600))) {
    await alert('rate-limit', s, 'too many requests', req);
    json(res, 429, { error: 'slow' }); return null;
  }
  if (!s.seen || Date.now() - s.seen > 60000) {
    s.seen = Date.now();
    await saveSession(s);
  }
  const fresh = !!(opts && opts.fresh);
  s = await refresh(s, req, res, fresh);
  if (!s) {
    json(res, fresh ? 403 : 401, { error: 'no_access' }); return null;
  }
  return s;
}

// ---------- VdoCipher ----------
// ---------- network lookup (IPinfo Lite, free; flag only) ----------
// Tells a VPN / hosting network apart from a home or mobile provider by the
// network's owner. Needs IPINFO_TOKEN; without it nothing is looked up.
// IP data by IPinfo (https://ipinfo.io), CC BY-SA 4.0.
const VPN_NET = new RegExp('m247|datacamp|cdn77|packethub|tefincom|proton|mullvad|' +
  '31173|nord|express ?vpn|surfshark|private internet|kape|windscribe|tunnelbear|' +
  'ipvanish|hide\\.me|cyberghost|purevpn|digitalocean|ovh|hetzner|linode|akamai|vultr|' +
  'choopa|leaseweb|amazon|aws|google|microsoft|azure|oracle|alibaba|tencent|contabo|' +
  'clouvider|zenlayer|hosting|datacenter|data center|g-core|gcore|ionos|scaleway|' +
  'quadranet|psychz|hostwinds|cloudflare|servers|colocation|vpn', 'i');
async function netInfo(addr) {
  const token = env('IPINFO_TOKEN');
  if (!token || !addr || /^(127\.|10\.|192\.168\.|::1$)/.test(addr)) return null;
  const ck = K('net:' + addr);
  try { const hit = await kv('GET', ck); if (hit) return JSON.parse(hit); } catch (e) { /* lookup */ }
  try {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch(env('IPINFO_API', 'https://api.ipinfo.io') + '/lite/' +
      encodeURIComponent(addr) + '?token=' + encodeURIComponent(token), { signal: ctl.signal });
    clearTimeout(tm);
    if (!r.ok) return null;
    const d = await r.json();
    const org = String(d.as_name || '').slice(0, 80);
    const info = { asn: String(d.asn || '').slice(0, 12), org: org,
      vpn: VPN_NET.test(org + ' ' + (d.as_domain || '')) && !/google fiber/i.test(org) };
    await kv('SET', ck, JSON.stringify(info), 'EX', 7 * 86400);
    return info;
  } catch (e) { return null; }
}
// Log (never ping, never block) a VPN / hosting network, once a day per member.
// Members the owner trusts to use a VPN (e.g. watching from a country where
// a VPN is required): no VPN / network / country-hopping alerts for them.
// Every other check (sharing, downloaders, recorders, limits) still applies.
async function vpnTrusted(uid) {
  return !!uid && !!(await kv('SISMEMBER', K('vpnok'), String(uid)));
}
async function noteNet(who, req, where) {
  const n = await netInfo(ip(req));
  if (n && n.vpn && who && who.uid && !(await vpnTrusted(who.uid))) {
    const first = await kv('SET', K('vpnseen:' + who.uid + ':' + n.asn), '1', 'NX', 'EX', 86400);
    if (first === 'OK') await alert('vpn', who, where + ' via ' + n.asn + ' ' + n.org, req);
  }
  return n;
}

async function vdo(method, path, body) {
  const opts = {
    method: method,
    headers: {
      Authorization: 'Apisecret ' + env('VDOCIPHER_API_SECRET', ''),
      Accept: 'application/json'
    }
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(VDO_API() + path, opts);
  const text = await r.text();
  let d; try { d = JSON.parse(text); } catch (e) { d = { raw: text }; }
  if (!r.ok) {
    const err = new Error('vdocipher ' + r.status + ': ' + (d.message || text).slice(0, 200));
    err.status = r.status; throw err;
  }
  return d;
}

// ---------- captions (VdoCipher video files API) ----------
// Caption tracks show in the player's CC menu, one per language.
// SRT is converted to WebVTT (the format VdoCipher takes).
function toVtt(text) {
  let t = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (/^WEBVTT/.test(t)) return t + '\n';
  t = t.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return 'WEBVTT\n\n' + t + '\n';
}
async function captionList(videoId) {
  const d = await vdo('GET', '/videos/' + encodeURIComponent(videoId) + '/files/');
  const rows = Array.isArray(d) ? d : (d.rows || d.files || d.data || []);
  return rows.filter(f => f && f.lang).map(f => ({
    id: f.id, lang: String(f.lang).slice(0, 8), size: f.size || '', time: f.time || ''
  }));
}
async function captionUpload(videoId, lang, text) {
  const form = new FormData();
  form.append('file', new Blob([toVtt(text)], { type: 'text/vtt' }), lang + '.vtt');
  const r = await fetch(VDO_API() + '/videos/' + encodeURIComponent(videoId) +
    '/files/?language=' + encodeURIComponent(lang), {
    method: 'POST', body: form,
    headers: { Authorization: 'Apisecret ' + env('VDOCIPHER_API_SECRET', ''), Accept: 'application/json' }
  });
  const body = await r.text();
  if (!r.ok) {
    const err = new Error('vdocipher ' + r.status + ': ' + body.slice(0, 200));
    err.status = r.status; throw err;
  }
  try { return JSON.parse(body); } catch (e) { return {}; }
}
async function captionDelete(videoId, fileId) {
  return vdo('DELETE', '/videos/' + encodeURIComponent(videoId) + '/files/' + encodeURIComponent(fileId));
}

// Lectures in the order members take them (section order, then item order).
function lectureOrder(c) {
  const out = [];
  c.sections.filter(x => x.kind === 'lecture').forEach(sec => {
    c.items.forEach(it => {
      if (it.sectionId === sec.id && it.status === 'ready') out.push(it);
    });
  });
  return out;
}
// A lecture is open if it's already completed or every earlier one is.
// ---------- watch progress ----------
// The player reports which 30-second parts of a lecture actually played
// (any speed). A lecture completes when 80% of its parts were watched, so
// 1.5x/2x viewers complete normally and skipping ahead doesn't count.
const PART = 30;
async function recordWatched(uid, it, parts) {
  if (!it || !Array.isArray(parts) || !parts.length) return;
  const max = Math.ceil((it.length || 36000) / PART) + 1;
  const ok = parts.slice(0, 400).map(Number)
    .filter(n => Number.isInteger(n) && n >= 0 && n <= max);
  if (!ok.length) return;
  const k = K('wp:' + uid + ':' + it.id);
  await kv('SADD', k, ...ok.map(String));
  await kv('EXPIRE', k, 180 * 86400);
}
async function watchedEnough(uid, it) {
  if (!it || !(it.length > 0)) return false;
  const total = Math.ceil(it.length / PART);
  const have = Number(await kv('SCARD', K('wp:' + uid + ':' + it.id))) || 0;
  return have >= Math.max(1, Math.ceil(total * 0.8));
}
// One-time repair (Nov 2026): members who finished lectures before watch
// progress was tracked, mostly at 1.5x/2x, had completion rejected. Any
// lecture they opened before the fix, long enough ago that the old rule
// was met, is marked complete, in order, once per member.
const HEAL_BEFORE = Date.parse('2026-11-23T01:00:00Z');
async function healCompletions(uid, c) {
  const flagKey = K('heal1:' + uid);
  if (await kv('GET', flagKey)) return null;
  const done = (await kv('SMEMBERS', K('done:' + uid))) || [];
  const added = [];
  for (const it of lectureOrder(c)) {
    if (done.indexOf(it.id) >= 0) continue;
    const st = Number(await kv('GET', K('start:' + uid + ':' + it.id)));
    const need = Math.max(60, Math.round((it.length || 0) * 0.85)) * 1000;
    if (!st || st >= HEAL_BEFORE) break;
    // opened before the fix but not long enough ago yet: try again later
    if (Date.now() - st < need) return added;
    await kv('SADD', K('done:' + uid), it.id);
    done.push(it.id); added.push(it.id);
  }
  await kv('SET', flagKey, String(Date.now()));
  return added;
}

function lectureOpen(c, id, done) {
  const list = lectureOrder(c);
  const i = list.findIndex(x => x.id === id);
  if (i < 0) return false;
  if (done.indexOf(id) >= 0) return true;
  for (let j = 0; j < i; j++) if (done.indexOf(list[j].id) < 0) return false;
  return true;
}

// Short viewer code (e.g. GV69DJ) unique to each member, for watermarks:
// easy to read off a leaked clip, then look up in Admin > Members / Plays.
function memberCode(uid) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const h = crypto.createHmac('sha256', env('SESSION_SECRET', '') + ':code')
    .update(String(uid)).digest();
  let out = '';
  for (let i = 0; i < 6; i++) out += A[h[i] % A.length];
  return out;
}

// Best poster image URL from a VdoCipher video object.
function posterOf(v) {
  v = v || {};
  let url = typeof v.poster === 'string' ? v.poster : null;
  const list = Array.isArray(v.posters) ? v.posters.slice() : [];
  list.sort((a, b) => (b.width || 0) - (a.width || 0));
  const big = list.find(p => (p.width || 0) <= 1280) || list[0];
  if (big) url = big.posterUrl || big.url || url;
  const httpOk = /^http:\/\//.test(VDO_API()); // local mocks only
  return url && (/^https:\/\//.test(url) || (httpOk && /^http:\/\//.test(url))) ? url : null;
}

// ---------- community rules (members agree before entering) ----------
const DEFAULT_RULES = [
  'What you see here stays here. Do not record, screenshot, download, share, resell or re-upload any lesson, in full or in part.',
  'Your account is yours alone. Do not share your login, and do not show lessons to others on your screen, in person or in calls.',
  'Every video is watermarked with your viewer code {CODE} and every view is logged with your account, time and network.',
  'Breaking these rules means a permanent ban from ' + (BRAND.name || 'this community') +
    ' and its Discord, and the owner may take further action.',
  'Respect the community: what is shared here stays here.',
  'Sign-ins, network, device and viewing activity are logged for security and may be used as evidence if these rules are broken.'
].join('\n');
function rulesOf(c) {
  return c && c.rules && c.rules.text ? c.rules : { v: 2, text: DEFAULT_RULES };
}

// ---------- per-member evidence trail (kept until the member is purged) ----------
async function hist(uid, entry) {
  if (!uid) return;
  try {
    await kv('LPUSH', K('hist:' + uid), JSON.stringify(entry));
    await kv('LTRIM', K('hist:' + uid), 0, 2999);
  } catch (e) { /* ignore */ }
}
// When a Discord account was created (from its ID).
function createdAt(uid) {
  try { return Number((BigInt(uid) >> 22n) + 1420070400000n); } catch (e) { return null; }
}
async function agreement(uid) {
  const v = await kv('HGET', K('agreements'), uid);
  try { return v ? JSON.parse(v) : null; } catch (e) { return null; }
}

// Members the owner has unlocked everything for (skip lecture order).
async function isUnlocked(uid) { return (await kv('SISMEMBER', K('unlocked'), uid)) === 1; }

module.exports = {
  posterOf, memberCode, isUnlocked, rulesOf, agreement, hist, createdAt, hostOk, adminOk,
  netInfo, noteNet, toVtt, captionList, captionUpload, captionDelete,
  recordWatched, watchedEnough, healCompletions, vpnTrusted,
  lectureOrder, lectureOpen,
  env, list, SITE_NAME, ACCENT, BRAND, DISCORD_API, configured, rid, sign, safeEq, ip, query,
  cookies, setCookie, json, redirect, readBody, sameOrigin, isChrome, guard,
  kv, K, rateLimit, loadContent, saveContent, isBlocked, alert, ripIntent, pingLine,
  isAdminOf, hasAccess, discordMember, displayName,
  discordUser, profileBits,
  createSession, getSession, pageAccess, fingerprint, sessLog, authFail,
  safariAllowed, isSafari, browserOk, isMobile, embeddedBrowser, tiers, tierRole, hasTier, saveSession, destroySession, refresh, requireMember,
  vdo
};
