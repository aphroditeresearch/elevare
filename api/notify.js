'use strict';
// The notification bell: a member's own notifications, ones for everyone
// (new videos they can watch, announcements) and, for admins, admin ones.
const L = require('./_lib');

const KEEP_ALL = 30 * 86400000;   // community-wide news stays 30 days

function parse(s) { try { return JSON.parse(s); } catch (e) { return null; } }
async function read(key) {
  return ((await L.kv('LRANGE', L.K('nt:' + key), 0, 99)) || []).map(parse).filter(Boolean);
}

module.exports = async function (req, res) {
  if (!L.guard(req, res, ['POST'])) return;
  try {
    const s = await L.requireMember(req, res);
    if (!s) return;
    const b = await L.readBody(req);
    if (b.action === 'read') {
      await L.kv('SET', L.K('ntr:' + s.uid), String(Date.now()));
      return L.json(res, 200, { ok: true });
    }
    if (b.action !== 'list') return L.json(res, 400, { error: 'action' });
    const now = Date.now();
    const all = (await read('all')).filter(n => now - n.t < KEEP_ALL && L.hasTier(s, n.tier));
    let items = (await read(s.uid)).concat(all);
    if (s.admin) items = items.concat(await read('admins'));
    items.sort((x, y) => y.t - x.t);
    items = items.slice(0, 40).map(n => ({ id: n.id, t: n.t, kind: n.kind, title: n.title,
      body: n.body || '', tab: n.tab || '', ref: n.ref || '', href: n.href || '' }));
    const readAt = Number(await L.kv('GET', L.K('ntr:' + s.uid))) || 0;
    return L.json(res, 200, { items, readAt, unread: items.filter(n => n.t > readAt).length });
  } catch (e) {
    console.error(e);
    return L.json(res, 500, { error: 'server' });
  }
};
