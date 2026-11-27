'use strict';
// A journal for each member, laid out like Discord: categories group
// #channels, and each channel holds the member's entries in order (text they
// write or paste, screenshots, notes taken under a lecture). Only plain text
// is stored, never HTML. Admins can read every journal, for reviews.
const L = require('./_lib');

// A new journal starts with these; everything else is the member's to make.
// (Lectures and Breakdowns fill themselves from the notes under each video.)
const STARTER = [['Trade Journal', 'trade-executions'], ['Markups', 'markups'],
  ['Daily Thesis', 'daily-thesis']];
const MAX = { cats: 40, chans: 200, entries: 2000, text: 8000, perEntry: 6, img: 760000,
  userImgs: 300, bytes: 900000 };
const KIND_CAT = { lecture: 'Lectures', breakdown: 'Breakdowns' };
const OLD_TYPES = { h: '# ', li: '- ', quote: '> ', call: '! ' };

const IK = uid => L.K('jr:' + uid);
const CK = (uid, ch) => L.K('jc:' + uid + ':' + ch);
const GK = (uid, id) => L.K('ji:' + uid + ':' + id);
const OLDPK = (uid, id) => L.K('jp:' + uid + ':' + id);
const WHO = () => L.K('jr:who');
const id36 = () => L.rid(6);
// the page names new things itself, so they show up before the server answers
const ID_RE = /^[a-f0-9]{12}$/;
const takeId = (want, list) => (ID_RE.test(String(want || '')) &&
  !list.some(x => x.id === want) ? String(want) : id36());
const IMG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

function slug(s) {
  return String(s || '').toLowerCase().replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'notes';
}
function cleanCat(s) {
  return String(s || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ')
    .trim().slice(0, 24);
}
function cleanText(s) {
  return String(s == null ? '' : s).replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, MAX.text)
    .replace(/\s+$/, '');
}
function parse(raw, def) {
  try { return raw ? JSON.parse(raw) : def; } catch (e) { return def; }
}
async function mget(keys) {
  const out = [];
  for (let i = 0; i < keys.length; i += 50) {
    const part = keys.slice(i, i + 50);
    const got = (await L.kv.apply(null, ['MGET'].concat(part))) || [];
    for (let k = 0; k < part.length; k++) out.push(got[k] || null);
  }
  return out;
}

// the first journal (pages inside channels) becomes entries in each channel
async function migrate(uid, ix) {
  const pages = Array.isArray(ix.pages) ? ix.pages : [];
  const raw = await mget(pages.map(p => OLDPK(uid, p.id)));
  const by = {};
  pages.forEach((p, i) => {
    const d = parse(raw[i], null);
    const lines = (d && Array.isArray(d.blocks) ? d.blocks : []).map(b => {
      const x = String(b && b.x || '');
      if (b && b.t === 'todo') return (b.c ? '[x] ' : '[ ] ') + x;
      return (OLD_TYPES[b && b.t] || '') + x;
    });
    if (!p.vid && p.title) lines.unshift('# ' + p.title);
    const x = cleanText(lines.join('\n').replace(/\n{3,}/g, '\n\n').trim());
    if (x) (by[p.ch] || (by[p.ch] = [])).push({ id: id36(), at: p.up || Date.now(), x });
  });
  for (const ch of ix.chans) {
    const list = (by[ch.id] || []).sort((a, b) => a.at - b.at);
    ch.n = list.length; ch.up = list.length ? list[list.length - 1].at : 0;
    if (list.length) await L.kv('SET', CK(uid, ch.id), JSON.stringify(list));
  }
  for (const p of pages) await L.kv('DEL', OLDPK(uid, p.id));
  return { v: 3, cats: Array.isArray(ix.cats) ? ix.cats : [], chans: ix.chans, imgs: 0 };
}

async function loadIndex(uid, create) {
  let ix = parse(await L.kv('GET', IK(uid)), null);
  if (!ix || !Array.isArray(ix.chans)) {
    if (!create) return null;
    ix = { v: 3, cats: STARTER.map(x => x[0]), imgs: 0,
      chans: STARTER.map(x => ({ id: id36(), cat: x[0], name: x[1], n: 0, up: 0 })) };
    await saveIndex(uid, ix);
  } else if (ix.v !== 3) {
    ix = await migrate(uid, ix);
    await saveIndex(uid, ix);
  }
  if (!Array.isArray(ix.cats)) ix.cats = [];
  return ix;
}
async function saveIndex(uid, ix) { await L.kv('SET', IK(uid), JSON.stringify(ix)); }
async function readChan(uid, ch) {
  const list = parse(await L.kv('GET', CK(uid, ch)), []);
  return Array.isArray(list) ? list : [];
}

// what the member may see of the library (same rules as the lecture list)
function visibleItem(c, s, id) {
  const it = c.items.find(x => x.id === id);
  if (!it) return null;
  if (!s.admin && it.status !== 'ready') return null;
  if (!L.hasTier(s, it.tier)) return null;
  return it;
}
// video channels follow the video's current title and kind
function showChan(ch, titles) {
  const it = ch.vid ? titles[ch.vid] : null;
  return { id: ch.id, cat: it ? (KIND_CAT[it.kind] || ch.cat) : ch.cat,
    name: it ? slug(it.title) : ch.name, vid: ch.vid || undefined,
    title: it ? it.title : undefined, n: ch.n || 0, up: ch.up || 0 };
}
function present(ix, c) {
  const titles = {};
  c.items.forEach(it => { titles[it.id] = it; });
  return { cats: ix.cats, chans: ix.chans.map(ch => showChan(ch, titles)) };
}
// the admins' list of journals: who wrote, and when
async function touch(s, ix) {
  const n = ix.chans.reduce((t, c) => t + (c.n || 0), 0);
  await L.kv('HSET', WHO(), s.uid, JSON.stringify({ uid: s.uid, name: s.name,
    avatar: s.avatar || null, gavatar: s.gavatar || null, t: Date.now(), n,
    c: ix.chans.filter(c => c.n).length }));
}
async function dropImages(uid, ix, entries) {
  let gone = 0;
  for (const e of entries) {
    for (const id of e.im || []) { await L.kv('DEL', GK(uid, id)); gone++; }
  }
  ix.imgs = Math.max(0, (ix.imgs || 0) - gone);
}
async function dropChans(uid, ix, ids) {
  for (const id of ids) {
    await dropImages(uid, ix, await readChan(uid, id));
    await L.kv('DEL', CK(uid, id));
  }
  ix.chans = ix.chans.filter(c => ids.indexOf(c.id) < 0);
}

module.exports = async function (req, res) {
  if (!L.guard(req, res, ['POST'])) return;
  try {
    const s = await L.requireMember(req, res);
    if (!s) return;
    const b = await L.readBody(req, 1100000);
    const a = String(b.action || '');
    const uid = s.uid;
    if (!(await L.rateLimit('jr:' + uid, 300, 300))) return L.json(res, 429, { error: 'slow' });
    // admins may read anyone's journal (never write to it)
    const other = b.u !== undefined && b.u !== null && String(b.u) !== uid;
    if (other && !s.admin) return L.json(res, 403, { error: 'forbidden' });
    if (other && !/^\d{5,25}$/.test(String(b.u))) return L.json(res, 400, { error: 'user' });
    const who = other ? String(b.u) : uid;

    // ---------- reading (the member, or an admin reviewing) ----------
    if (a === 'members') {
      if (!s.admin) return L.json(res, 403, { error: 'forbidden' });
      const h = (await L.kv('HGETALL', WHO())) || [];
      const out = [];
      for (let i = 0; i + 1 < h.length; i += 2) {
        const m = parse(h[i + 1], null);
        if (m && m.n) out.push(m);
      }
      out.sort((x, y) => y.t - x.t);
      return L.json(res, 200, { members: out });
    }

    if (a === 'index') {
      const ix = await loadIndex(who, !other);
      if (!ix) return L.json(res, 404, { error: 'not_found' });
      return L.json(res, 200, present(ix, await L.loadContent()));
    }

    if (a === 'open') {
      const ix = await loadIndex(who, !other);
      const ch = ix && ix.chans.find(x => x.id === String(b.ch || ''));
      if (!ch) return L.json(res, 404, { error: 'not_found' });
      return L.json(res, 200, { entries: await readChan(who, ch.id) });
    }

    if (a === 'img') {
      if (!ID_RE.test(String(b.id || ''))) return L.json(res, 404, { error: 'not_found' });
      return L.json(res, 200, { image: (await L.kv('GET', GK(who, String(b.id)))) || null });
    }

    // everything written since a date, across channels (reviews and recaps)
    if (a === 'feed') {
      const ix = await loadIndex(who, !other);
      if (!ix) return L.json(res, 200, { items: [] });
      const since = Math.max(0, Number(b.since) || 0);
      const chans = ix.chans.filter(c => c.n && (c.up || 0) >= since);
      const raw = await mget(chans.map(c => CK(who, c.id)));
      let items = [];
      chans.forEach((c, i) => {
        parse(raw[i], []).forEach(e => { if (e.at >= since) items.push({ ch: c.id, e }); });
      });
      items.sort((x, y) => x.e.at - y.e.at);
      if (items.length > 600) items = items.slice(-600);
      return L.json(res, 200, { items });
    }

    if (a === 'search') {
      const q = String(b.q || '').toLowerCase().trim().slice(0, 60);
      const ix = await loadIndex(who, !other);
      if (q.length < 2 || !ix) return L.json(res, 200, { hits: [] });
      const chans = ix.chans.filter(c => c.n).sort((x, y) => (y.up || 0) - (x.up || 0));
      const raw = await mget(chans.map(c => CK(who, c.id)));
      const hits = [];
      chans.forEach((c, i) => {
        parse(raw[i], []).slice().reverse().forEach(e => {
          const at = String(e.x || '').toLowerCase().indexOf(q);
          if (at < 0 || hits.length >= 30) return;
          hits.push({ ch: c.id, id: e.id, at: e.at, snippet: (at > 40 ? '…' : '') +
            e.x.slice(Math.max(0, at - 40), at + q.length + 80).replace(/\s+/g, ' ') });
        });
      });
      return L.json(res, 200, { hits });
    }

    if (a === 'video') {
      const c = await L.loadContent();
      const it = visibleItem(c, s, String(b.vid || ''));
      if (!it) return L.json(res, 404, { error: 'not_found' });
      const ix = await loadIndex(uid, true);
      const ch = ix.chans.find(x => x.vid === it.id);
      const titles = {}; titles[it.id] = it;
      return L.json(res, 200, { chan: ch ? showChan(ch, titles) : null,
        entries: ch ? await readChan(uid, ch.id) : [] });
    }

    // ---------- writing (always the member's own journal) ----------
    if (other) return L.json(res, 403, { error: 'read_only' });

    if (a === 'upimg') {
      const data = String(b.data || '');
      if (data.length > MAX.img || !IMG_RE.test(data)) return L.json(res, 400, { error: 'image' });
      const ix = await loadIndex(uid, true);
      if ((ix.imgs || 0) >= MAX.userImgs) return L.json(res, 409, { error: 'images_full' });
      const id = id36();
      await L.kv('SET', GK(uid, id), data);
      ix.imgs = (ix.imgs || 0) + 1;
      await saveIndex(uid, ix);
      return L.json(res, 200, { id });
    }

    if (a === 'post') {
      const x = cleanText(b.x);
      const im = (Array.isArray(b.im) ? b.im : []).map(String).filter(id => ID_RE.test(id))
        .slice(0, MAX.perEntry);
      if (!x.trim() && !im.length) return L.json(res, 400, { error: 'empty' });
      const ix = await loadIndex(uid, true);
      let ch, titles = {};
      if (b.vid) {
        const c = await L.loadContent();
        const it = visibleItem(c, s, String(b.vid));
        if (!it) return L.json(res, 404, { error: 'not_found' });
        titles[it.id] = it;
        ch = ix.chans.find(y => y.vid === it.id);
        if (!ch) {
          if (ix.chans.length >= MAX.chans) return L.json(res, 409, { error: 'full' });
          ch = { id: id36(), cat: KIND_CAT[it.kind] || 'Lectures', name: slug(it.title),
            vid: it.id, n: 0, up: 0 };
          ix.chans.push(ch);
        }
      } else {
        ch = ix.chans.find(y => y.id === String(b.ch || ''));
        if (!ch) return L.json(res, 404, { error: 'not_found' });
      }
      const list = await readChan(uid, ch.id);
      // a retried post (same id) is only stored once
      const again = ID_RE.test(String(b.id || '')) && list.find(e => e.id === b.id);
      if (again) return L.json(res, 200, { entry: again, chan: showChan(ch, titles) });
      if (list.length >= MAX.entries) return L.json(res, 409, { error: 'chan_full' });
      const e = { id: takeId(b.id, list), at: Date.now(), x };
      if (im.length) e.im = im;
      const vt = Number(b.vt);
      if (ch.vid && vt > 0 && vt < 86400) e.vt = Math.floor(vt);
      list.push(e);
      const out = JSON.stringify(list);
      if (out.length > MAX.bytes) return L.json(res, 409, { error: 'chan_full' });
      await L.kv('SET', CK(uid, ch.id), out);
      ch.n = list.length; ch.up = e.at;
      await saveIndex(uid, ix);
      await touch(s, ix);
      return L.json(res, 200, { entry: e, chan: showChan(ch, titles) });
    }

    if (a === 'edit' || a === 'del') {
      const ix = await loadIndex(uid, true);
      const ch = ix.chans.find(y => y.id === String(b.ch || ''));
      if (!ch) return L.json(res, 404, { error: 'not_found' });
      let list = await readChan(uid, ch.id);
      const e = list.find(y => y.id === String(b.id || ''));
      if (!e) return L.json(res, 404, { error: 'not_found' });
      const x = a === 'edit' ? cleanText(b.x) : '';
      if (a === 'del' || (!x.trim() && !(e.im || []).length)) {
        list = list.filter(y => y !== e);
        await dropImages(uid, ix, [e]);
      } else {
        e.x = x; e.ed = Date.now();
      }
      const out = JSON.stringify(list);
      if (out.length > MAX.bytes) return L.json(res, 409, { error: 'chan_full' });
      if (list.length) await L.kv('SET', CK(uid, ch.id), out);
      else await L.kv('DEL', CK(uid, ch.id));
      ch.n = list.length; ch.up = list.length ? list[list.length - 1].at : 0;
      await saveIndex(uid, ix);
      await touch(s, ix);
      return L.json(res, 200, { ok: true, entry: list.indexOf(e) >= 0 ? e : null });
    }

    if (a === 'cat') {
      const ix = await loadIndex(uid, true);
      const name = cleanCat(b.name);
      if (!name) return L.json(res, 400, { error: 'name' });
      if (ix.cats.length >= MAX.cats) return L.json(res, 409, { error: 'full' });
      if (ix.cats.indexOf(name) < 0) ix.cats.push(name);
      await saveIndex(uid, ix);
      return L.json(res, 200, { ok: true, cats: ix.cats });
    }

    if (a === 'renamecat') {
      const ix = await loadIndex(uid, true);
      const from = String(b.from || ''), to = cleanCat(b.name);
      const i = ix.cats.indexOf(from);
      if (i < 0 || !to) return L.json(res, 404, { error: 'not_found' });
      ix.cats[i] = to;
      ix.chans.forEach(c => { if (!c.vid && c.cat === from) c.cat = to; });
      await saveIndex(uid, ix);
      return L.json(res, 200, { ok: true, cats: ix.cats });
    }

    if (a === 'delcat') {
      const ix = await loadIndex(uid, true);
      const name = String(b.name || '');
      if (ix.cats.indexOf(name) < 0) return L.json(res, 404, { error: 'not_found' });
      await dropChans(uid, ix, ix.chans.filter(c => !c.vid && c.cat === name).map(c => c.id));
      ix.cats = ix.cats.filter(c => c !== name);
      await saveIndex(uid, ix);
      await touch(s, ix);
      return L.json(res, 200, { ok: true });
    }

    if (a === 'chan') {
      const ix = await loadIndex(uid, true);
      // a channel sits in one of the member's categories, or on its own
      const cat = ix.cats.indexOf(b.cat) >= 0 ? b.cat : '';
      if (ix.chans.length >= MAX.chans) return L.json(res, 409, { error: 'full' });
      const ch = { id: takeId(b.id, ix.chans), cat, name: slug(b.name), n: 0, up: 0 };
      ix.chans.push(ch);
      await saveIndex(uid, ix);
      return L.json(res, 200, { ok: true, chan: ch });
    }

    if (a === 'rename') {
      const ix = await loadIndex(uid, true);
      const ch = ix.chans.find(x => x.id === String(b.id || ''));
      if (!ch || ch.vid) return L.json(res, 404, { error: 'not_found' });
      ch.name = slug(b.name);
      if (b.cat !== undefined) ch.cat = ix.cats.indexOf(b.cat) >= 0 ? b.cat : '';
      await saveIndex(uid, ix);
      return L.json(res, 200, { ok: true, chan: ch });
    }

    if (a === 'delchan') {
      const ix = await loadIndex(uid, true);
      const ch = ix.chans.find(x => x.id === String(b.id || ''));
      if (!ch) return L.json(res, 404, { error: 'not_found' });
      await dropChans(uid, ix, [ch.id]);
      await saveIndex(uid, ix);
      await touch(s, ix);
      return L.json(res, 200, { ok: true });
    }

    return L.json(res, 400, { error: 'action' });
  } catch (e) {
    console.error(e);
    return L.json(res, 500, { error: 'server' });
  }
};
