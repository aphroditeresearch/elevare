'use strict';
const L = require('./_lib');
const { redirectUri } = require('./login');

function stateOk(req, state) {
  const parts = String(state || '').split('.');
  if (parts.length !== 3) return false;
  const body = parts[0] + '.' + parts[1];
  if (!L.safeEq(parts[2], L.sign('state:' + body))) return false;
  if (Date.now() - parseInt(parts[1], 36) > 10 * 60 * 1000) return false;
  return L.safeEq(L.cookies(req).elevare_state || '', parts[0]);
}

module.exports = async function (req, res) {
  if (req.method !== 'GET') return L.json(res, 405, { error: 'method' });
  if (!L.configured()) return L.redirect(res, '/?e=setup');
  if (!L.hostOk(req)) return L.json(res, 403, { error: 'host' });
  if (L.isMobile(req)) return L.redirect(res, '/?e=mobile');
  if (!L.browserOk(req)) return L.redirect(res, '/?e=browser');
  const q = L.query(req);
  L.setCookie(res, 'elevare_state', '', 0);
  if (q.error) return L.redirect(res, '/?e=denied');
  if (!q.code || !stateOk(req, q.state)) return L.redirect(res, '/?e=expired');

  try {
    const tr = await fetch(L.DISCORD_API() + '/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: L.env('DISCORD_CLIENT_ID'),
        client_secret: L.env('DISCORD_CLIENT_SECRET'),
        grant_type: 'authorization_code',
        code: q.code,
        redirect_uri: redirectUri(req)
      }).toString()
    });
    if (!tr.ok) return L.redirect(res, '/?e=expired');
    const tok = (await tr.json()).access_token;

    const m = await L.discordMember(tok);
    if (m.status === 'not_member') return L.redirect(res, '/?e=not_member');
    if (m.status !== 'ok') return L.redirect(res, '/?e=expired');
    const u = m.member.user || {};
    const who = { uid: String(u.id), name: L.displayName(m.member) };

    if (await L.isBlocked(who.uid)) {
      await L.alert('blocked-login', who, 'blocked member tried to sign in', req);
      return L.redirect(res, '/?e=blocked');
    }
    if (!L.hasAccess(who.uid, m.member.roles)) {
      return L.redirect(res, '/?e=no_access');
    }
    const du = await L.discordUser(tok);
    const bits = L.profileBits(m.member, du);
    const email = du && du.email ? String(du.email).slice(0, 120) : null;
    const created = L.createdAt(who.uid);
    const ip = L.ip(req);
    await L.createSession(res, {
      uid: who.uid, name: who.name, tok: tok,
      avatar: bits.avatar, gavatar: bits.gavatar, banner: bits.banner,
      accent: bits.accent,
      username: String(u.username || '').slice(0, 40),
      joinedAt: m.member.joined_at || null,
      roles: m.member.roles,
      mfa: !!(du && du.mfa_enabled),
      admin: L.adminOk(who.uid, m.member.roles, !!(du && du.mfa_enabled))
    }, req);
    // Remember members so admins can block by name and trace leaks.
    const net = await L.noteNet(who, req, 'sign-in');
    let prev = null;
    try { prev = JSON.parse(await L.kv('HGET', L.K('users'), who.uid) || 'null'); } catch (e) { prev = null; }
    await L.kv('HSET', L.K('users'), who.uid,
      JSON.stringify({ name: who.name, username: u.username || '', code: L.memberCode(who.uid),
        last: Date.now(), first: (prev && prev.first) || Date.now(),
        email: email || (prev && prev.email) || null, verified: !!(du && du.verified),
        created: created, ip: ip,
        country: String(req.headers['x-vercel-ip-country'] || '').slice(0, 4),
        region: String(req.headers['x-vercel-ip-country-region'] || '').slice(0, 8),
        net: net ? net.org : null, asn: net ? net.asn : null, vpn: !!(net && net.vpn),
        city: (() => { try { return decodeURIComponent(String(req.headers['x-vercel-ip-city'] || '')).slice(0, 40); }
          catch (e) { return ''; } })() }));
    // brand-new Discord accounts are a common leaker pattern (log only)
    if (created && Date.now() - created < 30 * 86400000 && !prev) {
      await L.alert('new-account', who, 'Discord account created ' +
        Math.max(0, Math.floor((Date.now() - created) / 86400000)) + ' days ago', req);
    }
    // several accounts from the same network (log only: could be a household)
    const ik = L.K('ipu:' + ip);
    await L.kv('SADD', ik, who.uid);
    await L.kv('EXPIRE', ik, 30 * 86400);
    const others = ((await L.kv('SMEMBERS', ik)) || []).filter(x => x !== who.uid);
    if (others.length) {
      await L.alert('shared-ip', who, 'same network as ' + others.slice(0, 5).join(', '), req);
    }
    L.redirect(res, '/');
  } catch (e) {
    console.error('callback', e);
    L.redirect(res, '/?e=expired');
  }
};
