'use strict';
// Payouts: members upload proof of a prop-firm payout (screenshot or
// certificate). An admin approves or rejects it. Approved payouts from members
// who opted in feed the Payouts leaderboard; the community total counts every
// approved payout without naming anyone who opted out.
const crypto = require('crypto');
const L = require('./_lib');

const MAX_IMG = 1000000;          // data URL characters (about 730 KB of image)
const MAX_AMOUNT = 10000000;      // dollars
const MAX_PENDING = 10;
const IMG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

const HK = () => L.K('po');
const IK = id => L.K('poi:' + id);
const UK = uid => L.K('po:u:' + uid);

function parse(s) { try { return JSON.parse(s); } catch (e) { return null; } }
async function all() {
  const f = (await L.kv('HGETALL', HK())) || [];
  const out = [];
  for (let i = 0; i + 1 < f.length; i += 2) { const p = parse(f[i + 1]); if (p) out.push(p); }
  return out;
}
async function one(id) { return parse(await L.kv('HGET', HK(), String(id || ''))); }
async function put(p) { await L.kv('HSET', HK(), p.id, JSON.stringify(p)); }

function mine(p) {
  return { id: p.id, amount: p.amount, firm: p.firm, date: p.date, show: !!p.show,
    status: p.status, note: p.note || '', t: p.t };
}
function who(p) {
  return { uid: p.uid, name: p.name, avatar: p.avatar || null, gavatar: p.gavatar || null };
}
function cleanDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const d = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if (isNaN(d) || d > Date.now() + 2 * 86400000 || d < Date.UTC(2010, 0, 1)) return null;
  return m[0];
}

function board(list) {
  const ok = list.filter(p => p.status === 'approved');
  const people = {};
  ok.filter(p => p.show).forEach(p => {
    const e = people[p.uid] || (people[p.uid] = Object.assign(who(p), { total: 0, count: 0,
      firms: [], last: '' }));
    e.total += p.amount; e.count += 1;
    if (e.firms.indexOf(p.firm) < 0) e.firms.push(p.firm);
    if (p.date > e.last) e.last = p.date;
    // the newest snapshot of their name and avatar wins
    if (!e.t || p.t > e.t) { e.t = p.t; e.name = p.name; e.avatar = p.avatar || null;
      e.gavatar = p.gavatar || null; }
  });
  const rows = Object.keys(people).map(k => people[k]).sort((a, b) => b.total - a.total);
  rows.forEach(r => { delete r.t; r.firms = r.firms.slice(0, 4); });
  return {
    total: ok.reduce((n, p) => n + p.amount, 0),
    payouts: ok.length,
    traders: Object.keys(ok.reduce((o, p) => { o[p.uid] = 1; return o; }, {})).length,
    rows: rows.slice(0, 100)
  };
}

module.exports = async function (req, res) {
  if (!L.guard(req, res, ['POST'])) return;
  try {
    const s = await L.requireMember(req, res);
    if (!s) return;
    const b = await L.readBody(req, 1200000);
    const a = String(b.action || '');
    if (!(await L.rateLimit('po:' + s.uid, 300, 600))) return L.json(res, 429, { error: 'slow' });

    if (a === 'board') return L.json(res, 200, board(await all()));

    if (a === 'mine') {
      const ids = (await L.kv('SMEMBERS', UK(s.uid))) || [];
      const list = (await all()).filter(p => p.uid === s.uid || ids.indexOf(p.id) >= 0)
        .sort((x, y) => y.t - x.t).map(mine);
      return L.json(res, 200, { list });
    }

    if (a === 'submit') {
      if (!(await L.rateLimit('po-up:' + s.uid, 15, 3600))) return L.json(res, 429, { error: 'slow' });
      const amount = Math.round(Number(b.amount) * 100) / 100;
      if (!(amount > 0) || amount > MAX_AMOUNT) return L.json(res, 400, { error: 'amount' });
      const firm = String(b.firm || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
      if (!firm) return L.json(res, 400, { error: 'firm' });
      const date = cleanDate(b.date);
      if (!date) return L.json(res, 400, { error: 'date' });
      const img = String(b.image || '');
      if (img.length > MAX_IMG || !IMG_RE.test(img)) return L.json(res, 400, { error: 'image' });
      const list = await all();
      if (list.filter(p => p.uid === s.uid && p.status === 'pending').length >= MAX_PENDING) {
        return L.json(res, 409, { error: 'too_many' });
      }
      const hash = crypto.createHash('sha256').update(img).digest('hex');
      if (list.some(p => p.hash === hash)) return L.json(res, 409, { error: 'duplicate' });
      const p = { id: L.rid(8), uid: s.uid, name: s.name, avatar: s.avatar || null,
        gavatar: s.gavatar || null, amount, firm, date, show: b.show !== false,
        status: 'pending', t: Date.now(), hash };
      await L.kv('SET', IK(p.id), img);
      await put(p);
      await L.kv('SADD', UK(s.uid), p.id);
      await L.sessLog('payout-submitted', s, req);
      await L.notify('admins', { kind: 'payout-new', title: 'Payout to review',
        body: s.name + ' \u00b7 $' + amount.toLocaleString('en-US') + ' \u00b7 ' + firm,
        tab: 'admin', ref: 'payouts' });
      return L.json(res, 200, { ok: true, item: mine(p) });
    }

    if (a === 'withdraw') {
      const p = await one(b.id);
      if (!p || p.uid !== s.uid || p.status !== 'pending') return L.json(res, 404, { error: 'not_found' });
      await L.kv('HDEL', HK(), p.id); await L.kv('DEL', IK(p.id));
      await L.kv('SREM', UK(s.uid), p.id);
      return L.json(res, 200, { ok: true });
    }

    if (a === 'show') {
      const p = await one(b.id);
      if (!p || p.uid !== s.uid) return L.json(res, 404, { error: 'not_found' });
      p.show = !!b.show; await put(p);
      return L.json(res, 200, { ok: true });
    }

    // the image: its owner, an admin, or anyone once it's approved and shown
    if (a === 'img') {
      const p = await one(b.id);
      const open = p && (p.uid === s.uid || s.admin || (p.status === 'approved' && p.show));
      if (!open) return L.json(res, 404, { error: 'not_found' });
      return L.json(res, 200, { image: (await L.kv('GET', IK(p.id))) || null });
    }

    // a leaderboard member's approved payouts
    if (a === 'trader') {
      const uid = String(b.uid || '');
      const list = (await all()).filter(p => p.uid === uid && p.status === 'approved' && p.show)
        .sort((x, y) => (y.date > x.date ? 1 : -1))
        .map(p => ({ id: p.id, amount: p.amount, firm: p.firm, date: p.date }));
      return L.json(res, 200, { list });
    }

    // ---------- admin ----------
    if (['queue', 'review', 'remove'].indexOf(a) >= 0 && !s.admin) {
      await L.alert('admin-probe', s, 'payouts ' + a, req);
      return L.json(res, 403, { error: 'admin' });
    }
    if (a === 'queue') {
      const list = (await all()).sort((x, y) => y.t - x.t);
      const pick = p => Object.assign(mine(p), who(p), { by: p.by || '', rt: p.rt || 0 });
      return L.json(res, 200, {
        pending: list.filter(p => p.status === 'pending').map(pick),
        done: list.filter(p => p.status !== 'pending').slice(0, 60).map(pick)
      });
    }
    if (a === 'review') {
      const p = await one(b.id);
      if (!p) return L.json(res, 404, { error: 'not_found' });
      p.status = b.ok ? 'approved' : 'rejected';
      p.note = String(b.note || '').replace(/[\u0000-\u001f<>]/g, ' ').slice(0, 200);
      p.rt = Date.now(); p.by = s.name;
      await put(p);
      await L.sessLog('payout-' + p.status + ':' + p.id, s, req);
      const ok = p.status === 'approved';
      await L.notify(p.uid, { kind: ok ? 'payout-ok' : 'payout-no',
        title: ok ? 'Payout verified' : 'Payout not approved',
        body: '$' + p.amount.toLocaleString('en-US') + ' \u00b7 ' + p.firm +
          (p.note ? ' \u2014 ' + p.note : ''),
        tab: ok ? 'payouts' : 'profile' });
      return L.json(res, 200, { ok: true });
    }
    if (a === 'remove') {
      const p = await one(b.id);
      if (!p) return L.json(res, 404, { error: 'not_found' });
      await L.kv('HDEL', HK(), p.id); await L.kv('DEL', IK(p.id));
      await L.kv('SREM', UK(p.uid), p.id);
      return L.json(res, 200, { ok: true });
    }

    return L.json(res, 400, { error: 'action' });
  } catch (e) {
    console.error(e);
    return L.json(res, 500, { error: 'server' });
  }
};
