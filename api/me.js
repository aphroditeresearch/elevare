'use strict';
const L = require('./_lib');

const FLAGS = ['devtools', 'devtools-open', 'printscreen', 'screenshot-keys', 'browser',
  'automation', 'blocked-action', 'extension', 'no-gpu', 'vm', 'other'];

// Strip anything a member should never see (video ids, upload state).
function publicItem(it) {
  return {
    id: it.id, kind: it.kind, sectionId: it.sectionId,
    title: it.title, desc: it.desc || '', length: it.length || 0,
    status: it.status, added: it.added || 0, tier: it.tier || ''
  };
}

module.exports = async function (req, res) {
  if (!L.guard(req, res, ['GET', 'POST'])) return;
  try {
    const b = req.method === 'POST' ? await L.readBody(req) : {};
    if (req.method === 'POST') {
      if (b.action === 'logout') {
        const s0 = await L.getSession(req);
        await L.destroySession(res, s0);
        return L.json(res, 200, { ok: true });
      }
    }
    const s = await L.requireMember(req, res);
    if (!s) return;

    if (req.method === 'POST') {
      if (b.action === 'flag') {
        if (!(await L.rateLimit('flag:' + s.uid, 60, 600))) return L.json(res, 429, { error: 'slow' });
        let kind = FLAGS.indexOf(b.kind) >= 0 ? b.kind : 'other';
        // an extension that looks like a recorder pings the admins
        if (kind === 'extension' &&
          /rec|capture|screen|loom|cam|video|clip|snag|stream|grab|download/i.test(String(b.detail || ''))) {
          kind = 'recorder-extension';
        }
        await L.alert(kind, s, b.detail ? String(b.detail).slice(0, 200) : '', req);
        // second developer-tools catch within an hour: 10-minute timeout
        if (kind === 'devtools' && !s.admin) {
          const ck = L.K('dtc:' + s.uid);
          const n = await L.kv('INCR', ck);
          if (n === 1) await L.kv('EXPIRE', ck, 3600);
          if (n >= 2) {
            await L.kv('SET', L.K('timeout:' + s.uid), '1', 'EX', 600);
            await L.kv('DEL', ck);
            await L.kv('DEL', L.K('dev:' + s.uid));
            await L.alert('timeout', s, 'developer tools caught twice within an hour', req);
            return L.json(res, 200, { ok: true, timeout: 600 });
          }
        }
        return L.json(res, 200, { ok: true });
      }
      if (b.action === 'agree') {
        const r = L.rulesOf(await L.loadContent());
        if (Number(b.v) !== r.v) return L.json(res, 409, { error: 'rules_changed', v: r.v });
        const rec = { v: r.v, t: Date.now(), ip: L.ip(req), code: L.memberCode(s.uid),
          ua: String(req.headers['user-agent'] || '').slice(0, 160) };
        await L.kv('HSET', L.K('agreements'), s.uid, JSON.stringify(rec));
        await L.sessLog('agreed', s, req);
        return L.json(res, 200, { ok: true });
      }
      return L.json(res, 400, { error: 'action' });
    }

    if (L.isMobile(req)) return L.json(res, 403, { error: 'mobile' });
    if (!L.browserOk(req)) return L.json(res, 403, { error: 'browser' });
    const c = await L.loadContent();
    const items = c.items
      .filter(it => s.admin || it.status === 'ready')
      .map(publicItem);
    const seen = (await L.kv('SMEMBERS', L.K('seen:' + s.uid))) || [];
    const done = (await L.kv('SMEMBERS', L.K('done:' + s.uid))) || [];
    const unlocked = await L.isUnlocked(s.uid);
    const rules = L.rulesOf(c);
    const ag = s.admin ? null : await L.agreement(s.uid);
    const agreed = !!s.admin || !!(ag && ag.v === rules.v);
    L.json(res, 200, {
      user: {
        id: s.uid, name: s.name, username: s.username || '',
        avatar: s.avatar || null, gavatar: s.gavatar || null,
        banner: s.banner || null, accent: s.accent == null ? null : s.accent,
        guild: L.env('DISCORD_GUILD_ID'), joinedAt: s.joinedAt || null,
        code: L.memberCode(s.uid)
      },
      announcement: c.announcement || null,
      tiers: L.tiers().map(t => t.name),
      myTiers: L.tiers().filter(t => L.hasTier(s, t.name)).map(t => t.name),
      isAdmin: !!s.admin,
      siteName: L.SITE_NAME(),
      sections: c.sections,
      items: items,
      seen: seen,
      done: done,
      unlocked: unlocked,
      agreed: agreed,
      needsMfa: !s.admin && L.isAdminOf(s.uid, s.roles) && !s.mfa,
      rules: { v: rules.v, text: rules.text.split('{CODE}').join(L.memberCode(s.uid)) }
    });
  } catch (e) {
    console.error('me', e);
    L.json(res, 500, { error: 'server' });
  }
};
