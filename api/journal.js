'use strict';
// A private journal for each member: Discord-style channels holding
// Notion-style pages. Every lecture and breakdown gets its own channel the
// first time the member writes notes under it. Pages are plain-text blocks
// (no HTML is ever stored), and only the member can read their own journal.
const L = require('./_lib');

const TYPES = ['p', 'h', 'li', 'todo', 'quote', 'call'];
// A new journal starts with these; everything else is the member's to make.
// (Lectures and Breakdowns fill themselves from the notes under each video.)
const STARTER = [['Trade Journal', 'trade-executions'], ['Markups', 'markups'],
  ['Daily Thesis', 'daily-thesis']];
const MAX = { cats: 40, chans: 200, pages: 2000, blocks: 400, text: 4000, title: 140,
  bytes: 60000 };
const KIND_CAT = { lecture: 'Lectures', breakdown: 'Breakdowns' };

const IK = uid => L.K('jr:' + uid);
const PK = (uid, id) => L.K('jp:' + uid + ':' + id);
const id36 = () => L.rid(6);

function slug(s) {
  return String(s || '').toLowerCase().replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'notes';
}
function cleanCat(s) {
  return String(s || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ')
    .trim().slice(0, 24);
}
function cleanTitle(s) {
  return String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, MAX.title);
}
function cleanBlocks(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const b of list.slice(0, MAX.blocks)) {
    if (!b || typeof b !== 'object') continue;
    const t = TYPES.indexOf(b.t) >= 0 ? b.t : 'p';
    const x = String(b.x == null ? '' : b.x).replace(/\u0000/g, '').slice(0, MAX.text);
    const o = { t, x };
    if (t === 'todo' && b.c) o.c = 1;
    out.push(o);
  }
  return out;
}

async function loadIndex(uid) {
  const raw = await L.kv('GET', IK(uid));
  let ix = null; try { ix = raw ? JSON.parse(raw) : null; } catch (e) { ix = null; }
  if (!ix || !Array.isArray(ix.chans) || !Array.isArray(ix.pages)) {
    ix = { v: 2, cats: STARTER.map(x => x[0]),
      chans: STARTER.map(x => ({ id: id36(), cat: x[0], name: x[1] })), pages: [] };
    await saveIndex(uid, ix);
  }
  if (!Array.isArray(ix.cats)) ix.cats = [];
  return ix;
}
async function saveIndex(uid, ix) { await L.kv('SET', IK(uid), JSON.stringify(ix)); }

// what the member may see of the library (same rules as the lecture list)
function visibleItem(c, s, id) {
  const it = c.items.find(x => x.id === id);
  if (!it) return null;
  if (!s.admin && it.status !== 'ready') return null;
  if (!L.hasTier(s, it.tier)) return null;
  return it;
}

// video channels follow the video's current title and kind
function present(ix, c) {
  const titles = {};
  c.items.forEach(it => { titles[it.id] = it; });
  return {
    cats: ix.cats,
    chans: ix.chans.map(ch => {
      const it = ch.vid ? titles[ch.vid] : null;
      return {
        id: ch.id, cat: it ? (KIND_CAT[it.kind] || ch.cat) : ch.cat,
        name: it ? slug(it.title) : ch.name, vid: ch.vid || undefined
      };
    }),
    pages: ix.pages.map(p => {
      const it = p.vid ? titles[p.vid] : null;
      return { id: p.id, ch: p.ch, title: it ? it.title : p.title, up: p.up,
        vid: p.vid || undefined };
    })
  };
}

async function readPage(uid, id) {
  const raw = await L.kv('GET', PK(uid, id));
  let d = null; try { d = raw ? JSON.parse(raw) : null; } catch (e) { d = null; }
  return d && Array.isArray(d.blocks) ? d.blocks : [];
}

module.exports = async function (req, res) {
  if (!L.guard(req, res, ['POST'])) return;
  try {
    const s = await L.requireMember(req, res);
    if (!s) return;
    const b = await L.readBody(req, 131072);
    const a = String(b.action || '');
    const uid = s.uid;
    if (!(await L.rateLimit('jr:' + uid, 240, 300))) return L.json(res, 429, { error: 'slow' });

    if (a === 'index') {
      const ix = await loadIndex(uid);
      return L.json(res, 200, present(ix, await L.loadContent()));
    }

    if (a === 'page') {
      const ix = await loadIndex(uid);
      const p = ix.pages.find(x => x.id === String(b.id || ''));
      if (!p) return L.json(res, 404, { error: 'not_found' });
      const c = await L.loadContent();
      const it = p.vid ? c.items.find(x => x.id === p.vid) : null;
      return L.json(res, 200, { page: { id: p.id, ch: p.ch, up: p.up, vid: p.vid || undefined,
        title: it ? it.title : p.title, blocks: await readPage(uid, p.id) } });
    }

    // the notes under a video: its page if it exists, else an empty one
    if (a === 'video') {
      const c = await L.loadContent();
      const it = visibleItem(c, s, String(b.vid || ''));
      if (!it) return L.json(res, 404, { error: 'not_found' });
      const ix = await loadIndex(uid);
      const p = ix.pages.find(x => x.vid === it.id);
      return L.json(res, 200, { page: { id: p ? p.id : null, vid: it.id, title: it.title,
        chan: slug(it.title), up: p ? p.up : 0, blocks: p ? await readPage(uid, p.id) : [] } });
    }

    if (a === 'save') {
      const blocks = cleanBlocks(b.blocks);
      if (!blocks) return L.json(res, 400, { error: 'blocks' });
      if (JSON.stringify(blocks).length > MAX.bytes) return L.json(res, 413, { error: 'too_long' });
      const ix = await loadIndex(uid);
      let p;
      if (b.vid) {
        const c = await L.loadContent();
        const it = visibleItem(c, s, String(b.vid));
        if (!it) return L.json(res, 404, { error: 'not_found' });
        p = ix.pages.find(x => x.vid === it.id);
        if (!p) {
          if (ix.pages.length >= MAX.pages || ix.chans.length >= MAX.chans) {
            return L.json(res, 409, { error: 'full' });
          }
          let ch = ix.chans.find(x => x.vid === it.id);
          if (!ch) {
            ch = { id: id36(), cat: KIND_CAT[it.kind] || 'Lectures', name: slug(it.title), vid: it.id };
            ix.chans.push(ch);
          }
          p = { id: id36(), ch: ch.id, title: it.title, vid: it.id, up: 0 };
          ix.pages.push(p);
        }
      } else {
        p = ix.pages.find(x => x.id === String(b.id || ''));
        if (!p) return L.json(res, 404, { error: 'not_found' });
        if (!p.vid && b.title !== undefined) p.title = cleanTitle(b.title);
      }
      p.up = Date.now();
      await L.kv('SET', PK(uid, p.id), JSON.stringify({ blocks }));
      await saveIndex(uid, ix);
      return L.json(res, 200, { ok: true, id: p.id, ch: p.ch, up: p.up });
    }

    if (a === 'newpage') {
      const ix = await loadIndex(uid);
      const ch = ix.chans.find(x => x.id === String(b.ch || ''));
      if (!ch || ch.vid) return L.json(res, 404, { error: 'not_found' });
      if (ix.pages.length >= MAX.pages) return L.json(res, 409, { error: 'full' });
      const p = { id: id36(), ch: ch.id, title: cleanTitle(b.title), up: Date.now() };
      ix.pages.push(p);
      await L.kv('SET', PK(uid, p.id), JSON.stringify({ blocks: [] }));
      await saveIndex(uid, ix);
      return L.json(res, 200, { ok: true, page: p });
    }

    if (a === 'cat') {
      const ix = await loadIndex(uid);
      const name = cleanCat(b.name);
      if (!name) return L.json(res, 400, { error: 'name' });
      if (ix.cats.length >= MAX.cats) return L.json(res, 409, { error: 'full' });
      if (ix.cats.indexOf(name) < 0) ix.cats.push(name);
      await saveIndex(uid, ix);
      return L.json(res, 200, { ok: true, cats: ix.cats });
    }

    if (a === 'renamecat') {
      const ix = await loadIndex(uid);
      const from = String(b.from || ''), to = cleanCat(b.name);
      const i = ix.cats.indexOf(from);
      if (i < 0 || !to) return L.json(res, 404, { error: 'not_found' });
      ix.cats[i] = to;
      ix.chans.forEach(c => { if (!c.vid && c.cat === from) c.cat = to; });
      await saveIndex(uid, ix);
      return L.json(res, 200, { ok: true, cats: ix.cats });
    }

    if (a === 'delcat') {
      const ix = await loadIndex(uid);
      const name = String(b.name || '');
      if (ix.cats.indexOf(name) < 0) return L.json(res, 404, { error: 'not_found' });
      const gone = ix.chans.filter(c => !c.vid && c.cat === name).map(c => c.id);
      for (const p of ix.pages.filter(x => gone.indexOf(x.ch) >= 0)) {
        await L.kv('DEL', PK(uid, p.id));
      }
      ix.pages = ix.pages.filter(x => gone.indexOf(x.ch) < 0);
      ix.chans = ix.chans.filter(c => gone.indexOf(c.id) < 0);
      ix.cats = ix.cats.filter(c => c !== name);
      await saveIndex(uid, ix);
      return L.json(res, 200, { ok: true });
    }

    if (a === 'chan') {
      const ix = await loadIndex(uid);
      // a channel sits in one of the member's categories, or on its own
      const cat = ix.cats.indexOf(b.cat) >= 0 ? b.cat : '';
      if (ix.chans.length >= MAX.chans) return L.json(res, 409, { error: 'full' });
      const ch = { id: id36(), cat, name: slug(b.name) };
      ix.chans.push(ch);
      await saveIndex(uid, ix);
      return L.json(res, 200, { ok: true, chan: ch });
    }

    if (a === 'rename') {
      const ix = await loadIndex(uid);
      const ch = ix.chans.find(x => x.id === String(b.id || ''));
      if (!ch || ch.vid) return L.json(res, 404, { error: 'not_found' });
      ch.name = slug(b.name);
      await saveIndex(uid, ix);
      return L.json(res, 200, { ok: true, chan: ch });
    }

    if (a === 'delpage') {
      const ix = await loadIndex(uid);
      const p = ix.pages.find(x => x.id === String(b.id || ''));
      if (!p) return L.json(res, 404, { error: 'not_found' });
      ix.pages = ix.pages.filter(x => x !== p);
      await L.kv('DEL', PK(uid, p.id));
      await saveIndex(uid, ix);
      return L.json(res, 200, { ok: true });
    }

    if (a === 'delchan') {
      const ix = await loadIndex(uid);
      const ch = ix.chans.find(x => x.id === String(b.id || ''));
      if (!ch) return L.json(res, 404, { error: 'not_found' });
      const gone = ix.pages.filter(x => x.ch === ch.id);
      for (const p of gone) await L.kv('DEL', PK(uid, p.id));
      ix.pages = ix.pages.filter(x => x.ch !== ch.id);
      ix.chans = ix.chans.filter(x => x !== ch);
      await saveIndex(uid, ix);
      return L.json(res, 200, { ok: true });
    }

    return L.json(res, 400, { error: 'action' });
  } catch (e) {
    console.error(e);
    return L.json(res, 500, { error: 'server' });
  }
};
