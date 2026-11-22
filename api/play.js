'use strict';
const L = require('./_lib');

const DEVICE_TTL = 120; // seconds; client heartbeats every 60 s

// Subtle watermark (default). Nothing jumps around: a tiny, faint code in
// the corner, a near-invisible ID mid-frame that shows up when a recording's
// brightness/contrast is pushed, and "ghost" marks that flash for about a
// second at a random spot, then hide for 20-45 seconds. Each member's corner
// position and flash timing are derived from their ID, so even a cropped or
// blurred copy carries a pattern that points back to one account.
// WATERMARK_MODE=bold brings back the old, obvious layout.
function subtle(code, handle, uid, psid, stamp, color) {
  let n = 0;
  for (const ch of String(uid)) n = (n * 31 + ch.charCodeAt(0)) % 100003;
  const at = (text, x, y, size, alpha) => ({ type: 'text', text: text, color: color,
    size: String(size), alpha: String(alpha), x: String(x), y: String(y) });
  const ghost = (text, size, alpha, show, hide) => ({ type: 'rtext', text: text, color: color,
    size: String(size), alpha: String(alpha), interval: String(show), skip: String(hide) });
  return [
    at(code, 10 + (n % 9) * 5, 8 + (n % 7) * 4, 11, 0.22),
    at(String(uid), 180 + (n % 13) * 15, 120 + (n % 11) * 12, 10, 0.08),
    ghost(code, 15, 0.30, 1200, 21000 + (n % 9) * 1000),
    ghost('@' + handle, 13, 0.26, 1200, 29000 + (n % 7) * 1000),
    ghost('S-' + psid + ' \u00b7 ' + stamp, 11, 0.24, 1500, 37000 + (n % 5) * 1000),
    ghost(code, 20, 0.07, 30000, 1000)
  ];
}

module.exports = async function (req, res) {
  if (!L.guard(req, res, ['POST'])) return;
  try {
    const b = await L.readBody(req);
    // Heartbeats use the cached role check; anything that grants or records
    // playback re-checks Discord roles right now.
    const s = await L.requireMember(req, res, { fresh: !b.beat });
    if (!s) return;
    if (!s.admin) {
      const ag = await L.agreement(s.uid);
      const rv = L.rulesOf(await L.loadContent()).v;
      if (!ag || ag.v !== rv) return L.json(res, 403, { error: 'agree' });
    }
    if (!L.browserOk(req)) {
      if (L.embeddedBrowser(req)) {
        await L.alert('embedded-browser', s, String(req.headers['sec-ch-ua'] || '').slice(0, 120), req);
      } else await L.alert('browser', s, 'play from non-Chrome UA', req);
      return L.json(res, 403, { error: 'browser' });
    }

    // ---- mark a lecture completed ----
    if (b.action === 'complete') {
      if (!(await L.rateLimit('done:' + s.uid, 60, 600))) return L.json(res, 429, { error: 'slow' });
      const c0 = await L.loadContent();
      const it0 = c0.items.find(x => x.id === b.id);
      if (!it0 || it0.kind !== 'lecture' || it0.status !== 'ready') {
        return L.json(res, 404, { error: 'not_found' });
      }
      const dk0 = L.K('done:' + s.uid);
      const done0 = (await L.kv('SMEMBERS', dk0)) || [];
      const free = s.admin || await L.isUnlocked(s.uid);
      if (!free && !L.lectureOpen(c0, it0.id, done0)) return L.json(res, 403, { error: 'locked' });
      const started = Number(await L.kv('GET', L.K('start:' + s.uid + ':' + it0.id)));
      if (!started) return L.json(res, 409, { error: 'not_started' });
      // must have had the lecture open for most of its running time
      const need = Math.max(60, Math.round((it0.length || 0) * 0.85)) * 1000;
      const left = started + need - Date.now();
      if (left > 0 && !free) {
        return L.json(res, 409, { error: 'too_soon', wait: Math.ceil(left / 1000) });
      }
      await L.kv('SADD', dk0, it0.id);
      return L.json(res, 200, { ok: true, done: (await L.kv('SMEMBERS', dk0)) || [] });
    }

    const device = String(b.device || '');
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(device)) return L.json(res, 400, { error: 'device' });

    // ---- one device at a time ----
    const dk = L.K('dev:' + s.uid);
    const cur = await L.kv('GET', dk);
    if (b.beat) {
      if (!(await L.rateLimit('beat:' + s.uid, 30, 600))) return L.json(res, 429, { error: 'slow' });
      if (cur && cur !== device) return L.json(res, 409, { error: 'taken' });
      await L.kv('SET', dk, device, 'EX', DEVICE_TTL);
      try {
        const lv = JSON.parse(await L.kv('HGET', L.K('live'), s.uid) || 'null');
        if (lv) { lv.t = Date.now(); await L.kv('HSET', L.K('live'), s.uid, JSON.stringify(lv)); }
      } catch (e) { /* ignore */ }
      return L.json(res, 200, { ok: true });
    }
    if (!(await L.rateLimit('play:' + s.uid, 40, 600))) {
      await L.alert('rate-limit', s, 'too many plays', req);
      return L.json(res, 429, { error: 'slow' });
    }
    if (cur && cur !== device && !b.take) return L.json(res, 409, { error: 'other_device' });
    if (cur && cur !== device && b.take) await L.alert('device-takeover', s, 'switched device', req);

    const c = await L.loadContent();
    const it = c.items.find(x => x.id === b.id);
    if (!it || it.status !== 'ready' || !it.videoId) {
      await L.authFail(s, 'unknown lesson', req);
      return L.json(res, 404, { error: 'not_found' });
    }
    if (!L.hasTier(s, it.tier)) {
      await L.authFail(s, 'tier', req);
      await L.alert('tier-probe', s, 'tried to play a ' + it.tier + ' lesson', req);
      return L.json(res, 403, { error: 'tier', tier: it.tier });
    }
    if (it.kind === 'lecture' && !s.admin && !(await L.isUnlocked(s.uid))) {
      const done = (await L.kv('SMEMBERS', L.K('done:' + s.uid))) || [];
      if (!L.lectureOpen(c, it.id, done)) {
        await L.authFail(s, 'locked lecture', req);
        await L.alert('locked-probe', s, 'tried to play a locked lecture', req);
        return L.json(res, 403, { error: 'locked' });
      }
    }

    // Authorised browsers: each member may use DEVICE_LIMIT browsers
    // (default 3) within 30 days. A new one past the limit is refused.
    const lim = parseInt(L.env('DEVICE_LIMIT', '3'), 10);
    const dvs = L.K('devs:' + s.uid);
    const flat = (await L.kv('HGETALL', dvs)) || [];
    const known = {};
    for (let i = 0; i + 1 < flat.length; i += 2) {
      let r = null; try { r = JSON.parse(flat[i + 1]); } catch (e) { r = null; }
      if (r && Date.now() - r.last < 30 * 86400000) known[flat[i]] = r;
      else await L.kv('HDEL', dvs, flat[i]);
    }
    if (!known[device] && lim > 0 && !s.admin && Object.keys(known).length >= lim) {
      await L.alert('device-limit', s, 'new browser refused (' + lim + ' already in use)', req);
      return L.json(res, 403, { error: 'device_limit', limit: lim });
    }
    await L.kv('HSET', dvs, device, JSON.stringify({
      first: known[device] ? known[device].first : Date.now(), last: Date.now(),
      ip: L.ip(req), ua: String(req.headers['user-agent'] || '').slice(0, 160) }));

    await L.kv('SET', dk, device, 'EX', DEVICE_TTL);

    // Per-play watermark, drawn by VdoCipher's player: the member's short
    // viewer code repeated at several sizes, their @handle in an accent
    // colour, and a playback session id + time. All move to random spots.
    const psid = L.rid(4).toUpperCase();
    const pick = (name, def) => '0x' + ((String(L.env(name, def)).replace(/^#|^0x/i, '')
      .match(/^[0-9a-f]{6}$/i) || [def])[0].toUpperCase());
    const grey = pick('WATERMARK_COLOR', '5A5A5A');   // main marks
    const blue = pick('WATERMARK_ACCENT', '3D6FB6');  // handle + one code
    const hex = grey.slice(2);
    const code = L.memberCode(s.uid);
    const handle = s.username || s.name;
    const stamp = new Date().toISOString().slice(11, 16) + ' UTC';
    const mark = (text, color, size, alpha, interval) =>
      ({ type: 'rtext', text: text, color: color, size: String(size),
        alpha: String(alpha), interval: String(interval) });
    // Only play on our own domain(s) (VdoCipher whitelist; covers subdomains).
    const domains = L.env('PLAYBACK_DOMAINS') || (L.env('SITE_HOSTS') ?
      L.env('SITE_HOSTS').split(',')[0].trim().replace(/^www\./, '') :
      String(req.headers.host || '').split(':')[0]);
    const otp = await L.vdo('POST', '/videos/' + encodeURIComponent(it.videoId) + '/otp', {
      ttl: 300,
      userId: s.uid,               // VdoCipher viewer analytics / sharing detection
      whitelisthref: domains,
      // LOCK_OTP_IP=1: the key only works from the member's own IPv4 address
      ...(L.env('LOCK_OTP_IP') === '1' && /^\d{1,3}(\.\d{1,3}){3}$/.test(L.ip(req)) ?
        { ipGeo: { allow: [L.ip(req)] } } : {}),
      annotate: JSON.stringify(L.env('WATERMARK_MODE') === 'bold' ? [
        mark(code, grey, 30, 0.55, 5000),
        mark(code, grey, 22, 0.40, 7000),
        mark(code, grey, 26, 0.32, 9000),
        mark(code, blue, 40, 0.60, 6000),
        mark(handle, blue, 26, 0.65, 8000),
        mark('S-' + psid + ' \u00b7 ' + stamp + ' \u00b7 ' + s.uid, grey, 16, 0.45, 10000)
      ] : subtle(code, handle, s.uid, psid, stamp, L.env('WATERMARK_COLOR') ? grey : '0x8A8A8A'))
    });
    await L.kv('SADD', L.K('seen:' + s.uid), it.id);
    // first time this lecture was opened: the completion clock starts here
    await L.kv('SET', L.K('start:' + s.uid + ':' + it.id), String(Date.now()),
      'NX', 'EX', 90 * 86400);

    // Leak tracing: who played what, when, from where.
    const ip = L.ip(req);
    await L.kv('LPUSH', L.K('plays'), JSON.stringify({
      t: Date.now(), sid: 'S-' + psid, code: code, uid: s.uid, name: s.name, item: it.id, title: it.title,
      ip: ip, ua: String(req.headers['user-agent'] || '').slice(0, 160),
      country: String(req.headers['x-vercel-ip-country'] || '').slice(0, 4),
      city: decodeURIComponent(String(req.headers['x-vercel-ip-city'] || '')).slice(0, 40)
    }));
    await L.kv('LTRIM', L.K('plays'), 0, 19999);
    await L.noteNet(s, req, 'watching ' + it.title);
    await L.kv('HSET', L.K('live'), s.uid, JSON.stringify({ t: Date.now(), t0: Date.now(),
      name: s.name, code: code, item: it.id, title: it.title, device: device, ip: ip,
      sid: 'S-' + psid, country: String(req.headers['x-vercel-ip-country'] || '').slice(0, 4) }));
    await L.hist(s.uid, { type: 'play', t: Date.now(), sid: 'S-' + psid, item: it.id, title: it.title,
      ip: ip, device: device, country: String(req.headers['x-vercel-ip-country'] || '').slice(0, 4),
      city: decodeURIComponent(String(req.headers['x-vercel-ip-city'] || '')).slice(0, 40),
      ua: String(req.headers['user-agent'] || '').slice(0, 160) });
    // same browser used by two different accounts = account sharing
    const dvk = L.K('dvu:' + device);
    await L.kv('SADD', dvk, s.uid);
    await L.kv('EXPIRE', dvk, 90 * 86400);
    const dOthers = ((await L.kv('SMEMBERS', dvk)) || []).filter(x => x !== s.uid);
    if (dOthers.length && !s.admin) {
      await L.alert('shared-device', s, 'same browser as ' + dOthers.slice(0, 5).join(', '), req);
    }
    // Sharing check: one account playing from 3+ networks in a day.
    const day = new Date().toISOString().slice(0, 10);
    const ik = L.K('ips:' + s.uid + ':' + day);
    if ((await L.kv('SADD', ik, ip)) === 1) {
      await L.kv('EXPIRE', ik, 172800);
      const n = await L.kv('SCARD', ik);
      if (n >= 3) await L.alert('ip-anomaly', s, n + ' different networks today', req);
    }
    // Country hopping (VPN switching / shared account): 2+ countries in a day.
    const country = String(req.headers['x-vercel-ip-country'] || '').slice(0, 4);
    if (country) {
      const ck = L.K('cc:' + s.uid + ':' + day);
      if ((await L.kv('SADD', ck, country)) === 1) {
        await L.kv('EXPIRE', ck, 172800);
        const nc = await L.kv('SCARD', ck);
        if (nc >= 2) {
          const all = ((await L.kv('SMEMBERS', ck)) || []).join(', ');
          await L.alert('geo-anomaly', s, 'played from ' + nc + ' countries today: ' + all, req);
        }
      }
    }
    // Binge pattern typical of ripping: 8+ different videos started in 20 min.
    const bk = L.K('binge:' + s.uid);
    if ((await L.kv('SADD', bk, it.id)) === 1) {
      const nb = await L.kv('SCARD', bk);
      if (nb === 1) await L.kv('EXPIRE', bk, 1200);
      if (nb === 8) await L.alert('binge', s, '8 different videos started within 20 minutes', req);
    }
    L.json(res, 200, { otp: otp.otp, playbackInfo: otp.playbackInfo, session: 'S-' + psid,
      wm: '#' + hex, code: code });
  } catch (e) {
    console.error('play', e);
    L.json(res, 502, { error: 'player' });
  }
};
