'use strict';
const L = require('./_lib');

// Two sections only: Lectures and Breakdowns.
const KINDS = ['lecture', 'breakdown'];
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

async function deleteVideos(ids) {
  ids = ids.filter(Boolean);
  if (!ids.length) return;
  try { await L.vdo('DELETE', '/videos?videos=' + ids.map(encodeURIComponent).join(',')); }
  catch (e) { console.error('vdo delete', e.message); }
}

// Moves element at index i of arr to swap with neighbour j, but only among
// entries that pass `same` (so moving within a section skips other sections).
function move(arr, id, dir, same) {
  const idx = arr.findIndex(x => x.id === id);
  if (idx < 0) return false;
  const step = dir === 'up' ? -1 : 1;
  for (let j = idx + step; j >= 0 && j < arr.length; j += step) {
    if (same(arr[j], arr[idx])) {
      const t = arr[idx]; arr[idx] = arr[j]; arr[j] = t;
      return true;
    }
  }
  return false;
}

async function checkStatus(c, ids) {
  const out = [];
  for (const it of c.items) {
    if (ids && ids.indexOf(it.id) < 0) continue;
    if (!it.videoId || (it.status !== 'uploading' && it.status !== 'processing')) continue;
    let v;
    try { v = await L.vdo('GET', '/videos/' + encodeURIComponent(it.videoId)); }
    catch (e) { out.push({ id: it.id, error: e.message }); continue; }
    const st = String(v.status || '').toLowerCase();
    if (st === 'ready') {
      it.status = 'ready';
      it.length = Number(v.length) || 0;
      it.posterUrl = L.posterOf(v);
      if (it.prevVideoId) { await deleteVideos([it.prevVideoId]); delete it.prevVideoId; }
    } else if (/error|fail/.test(st)) {
      it.status = 'error';
    } else if (it.status === 'processing' || /queue|process/.test(st)) {
      it.status = 'processing';
    }
    out.push({ id: it.id, status: it.status, vdo: v.status });
  }
  return out;
}

module.exports = async function (req, res) {
  if (!L.guard(req, res, ['GET', 'POST'])) return;
  try {
    const s = await L.requireMember(req, res);
    if (!s) return;
    if (!s.admin) {
      await L.alert('admin-probe', s, req.method + ' /api/admin', req);
      return L.json(res, 403, { error: 'forbidden' });
    }

    if (req.method === 'GET' && L.query(req).evidence) {
      const uid = String(L.query(req).evidence);
      if (!/^\d{5,25}$/.test(uid)) return L.json(res, 400, { error: 'uid' });
      const parse = x => { try { return JSON.parse(x); } catch (e) { return null; } };
      return L.json(res, 200, {
        generated: Date.now(), uid: uid, code: L.memberCode(uid), created: L.createdAt(uid),
        user: parse(await L.kv('HGET', L.K('users'), uid)),
        note: parse(await L.kv('HGET', L.K('notes'), uid)),
        agreement: await L.agreement(uid),
        blocked: !!(await L.kv('SISMEMBER', L.K('blocked'), uid)),
        unlocked: await L.isUnlocked(uid),
        devices: await (async () => {
          const f = (await L.kv('HGETALL', L.K('devs:' + uid))) || []; const o = {};
          for (let i = 0; i + 1 < f.length; i += 2) o[f[i]] = parse(f[i + 1]);
          return o;
        })(),
        done: (await L.kv('SMEMBERS', L.K('done:' + uid))) || [],
        history: ((await L.kv('LRANGE', L.K('hist:' + uid), 0, 2999)) || []).map(parse).filter(Boolean)
      });
    }
    if (req.method === 'GET') {
      const c = await L.loadContent();
      const alerts = ((await L.kv('LRANGE', L.K('alerts'), 0, 199)) || [])
        .map(x => { try { return JSON.parse(x); } catch (e) { return null; } })
        .filter(Boolean);
      const blocked = (await L.kv('SMEMBERS', L.K('blocked'))) || [];
      const flat = (await L.kv('HGETALL', L.K('users'))) || [];
      const users = {};
      for (let i = 0; i + 1 < flat.length; i += 2) {
        try { users[flat[i]] = JSON.parse(flat[i + 1]); } catch (e) { /* skip */ }
      }
      const plays = ((await L.kv('LRANGE', L.K('plays'), 0, 299)) || [])
        .map(x => { try { return JSON.parse(x); } catch (e) { return null; } })
        .filter(Boolean);
      const sessions = ((await L.kv('LRANGE', L.K('sessions'), 0, 199)) || [])
        .map(x => { try { return JSON.parse(x); } catch (e) { return null; } })
        .filter(Boolean);
      const unlocked = (await L.kv('SMEMBERS', L.K('unlocked'))) || [];
      const vpnok = (await L.kv('SMEMBERS', L.K('vpnok'))) || [];
      const relaxed = (await L.kv('SMEMBERS', L.K('relaxed'))) || [];
      const aflat = (await L.kv('HGETALL', L.K('agreements'))) || [];
      const agreements = {};
      for (let i = 0; i + 1 < aflat.length; i += 2) {
        try { agreements[aflat[i]] = JSON.parse(aflat[i + 1]); } catch (e) { /* skip */ }
      }
      const lflat = (await L.kv('HGETALL', L.K('live'))) || [];
      const live = [];
      for (let i = 0; i + 1 < lflat.length; i += 2) {
        let v = null; try { v = JSON.parse(lflat[i + 1]); } catch (e) { v = null; }
        if (v && Date.now() - v.t < 150000) { v.uid = lflat[i]; live.push(v); }
        else await L.kv('HDEL', L.K('live'), lflat[i]);
      }
      const nflat = (await L.kv('HGETALL', L.K('notes'))) || [];
      const notes = {};
      for (let i = 0; i + 1 < nflat.length; i += 2) {
        try { notes[nflat[i]] = JSON.parse(nflat[i + 1]); } catch (e) { /* skip */ }
      }
      return L.json(res, 200, { content: c, alerts: alerts, blocked: blocked, users: users, notes: notes,
        live: live, deviceLimit: parseInt(L.env('DEVICE_LIMIT', '3'), 10),
        unlocked: unlocked, vpnok: vpnok, relaxed: relaxed, agreements: agreements, rules: L.rulesOf(c),
        plays: plays, sessions: sessions, tiers: L.tiers().map(t => t.name) });
    }

    const b = await L.readBody(req, 3000000);
    const c = await L.loadContent();
    const a = b.action;

    if (a === 'section-save') {
      const title = str(b.title, 80);
      if (!title) return L.json(res, 400, { error: 'title' });
      let sec = b.id && c.sections.find(x => x.id === b.id);
      if (sec) sec.title = title;
      else {
        const kind = KINDS.indexOf(b.kind) >= 0 ? b.kind : null;
        if (!kind) return L.json(res, 400, { error: 'kind' });
        sec = { id: 's' + L.rid(6), kind: kind, title: title };
        c.sections.push(sec);
      }
      await L.saveContent(c);
      return L.json(res, 200, { ok: true, section: sec, content: c });
    }
    if (a === 'section-move') {
      move(c.sections, b.id, b.dir, (x, y) => x.kind === y.kind);
      await L.saveContent(c);
      return L.json(res, 200, { ok: true, content: c });
    }
    if (a === 'section-delete') {
      if (c.items.some(x => x.sectionId === b.id)) return L.json(res, 409, { error: 'not_empty' });
      c.sections = c.sections.filter(x => x.id !== b.id);
      await L.saveContent(c);
      return L.json(res, 200, { ok: true, content: c });
    }

    if (a === 'item-save') {
      const title = str(b.title, 120);
      if (!title) return L.json(res, 400, { error: 'title' });
      const sec = c.sections.find(x => x.id === b.sectionId);
      if (!sec) return L.json(res, 400, { error: 'section' });
      const tier = str(b.tier, 40);
      if (tier && !L.tierRole(tier)) return L.json(res, 400, { error: 'tier' });
      let it = b.id && c.items.find(x => x.id === b.id);
      if (it) {
        it.title = title; it.desc = str(b.desc, 4000);
        it.sectionId = sec.id; it.kind = sec.kind; it.tier = tier;
      } else {
        it = {
          id: 'i' + L.rid(6), kind: sec.kind, sectionId: sec.id, title: title,
          desc: str(b.desc, 4000), status: 'empty', videoId: null, length: 0, tier: tier,
          added: Date.now()
        };
        c.items.push(it);
      }
      await L.saveContent(c);
      return L.json(res, 200, { ok: true, item: it, content: c });
    }
    if (a === 'item-move') {
      move(c.items, b.id, b.dir, (x, y) => x.sectionId === y.sectionId);
      await L.saveContent(c);
      return L.json(res, 200, { ok: true, content: c });
    }
    if (a === 'item-delete') {
      const it = c.items.find(x => x.id === b.id);
      if (!it) return L.json(res, 404, { error: 'not_found' });
      await deleteVideos([it.videoId, it.prevVideoId]);
      c.items = c.items.filter(x => x.id !== b.id);
      await L.saveContent(c);
      return L.json(res, 200, { ok: true, content: c });
    }

    if (a === 'upload-start') {
      const it = c.items.find(x => x.id === b.id);
      if (!it) return L.json(res, 404, { error: 'not_found' });
      if (!/\.(mp4|mov|m4v|mkv|webm|avi)$/i.test(String(b.name || '')) ||
          !(Number(b.size) > 0 && Number(b.size) <= 50 * 1024 * 1024 * 1024)) {
        return L.json(res, 400, { error: 'file' });
      }
      let path = '/videos?title=' + encodeURIComponent(it.title);
      const folder = L.env('VDOCIPHER_FOLDER_ID');
      if (folder) path += '&folderId=' + encodeURIComponent(folder);
      const v = await L.vdo('PUT', path);
      if (it.videoId) {
        if (it.status === 'ready' && !it.prevVideoId) it.prevVideoId = it.videoId;
        else if (it.videoId !== it.prevVideoId) await deleteVideos([it.videoId]); // abandoned attempt
      }
      it.videoId = v.videoId;
      it.posterUrl = null;
      it.status = 'uploading';
      await L.saveContent(c);
      return L.json(res, 200, { ok: true, clientPayload: v.clientPayload, videoId: v.videoId });
    }
    if (a === 'link-video') {
      // use a video that's already in the VdoCipher account
      const it = c.items.find(x => x.id === b.id);
      if (!it) return L.json(res, 404, { error: 'not_found' });
      const vid = str(b.videoId, 64);
      if (!/^[a-f0-9]{32}$/i.test(vid)) return L.json(res, 400, { error: 'video_id' });
      let v;
      try { v = await L.vdo('GET', '/videos/' + encodeURIComponent(vid)); }
      catch (e) { return L.json(res, 400, { error: 'video_missing' }); }
      if (it.videoId && it.videoId !== vid && it.status === 'ready') it.prevVideoId = null;
      it.videoId = vid;
      const st = String(v.status || '').toLowerCase();
      it.status = st === 'ready' ? 'ready' : /error|fail/.test(st) ? 'error' : 'processing';
      it.length = Number(v.length) || 0;
      it.posterUrl = L.posterOf(v);
      await L.saveContent(c);
      return L.json(res, 200, { ok: true, item: it, content: c });
    }
    if (a === 'upload-done' || a === 'upload-failed') {
      const it = c.items.find(x => x.id === b.id);
      if (!it) return L.json(res, 404, { error: 'not_found' });
      if (a === 'upload-done') it.status = 'processing';
      else {
        await deleteVideos([it.videoId]);
        if (it.prevVideoId) { it.videoId = it.prevVideoId; it.status = 'ready'; delete it.prevVideoId; }
        else { it.videoId = null; it.status = 'empty'; }
      }
      await L.saveContent(c);
      return L.json(res, 200, { ok: true, item: it });
    }
    if (a === 'status') {
      const out = await checkStatus(c, b.id ? [b.id] : null);
      await L.saveContent(c);
      return L.json(res, 200, { ok: true, results: out, content: c });
    }

    // ---- captions / subtitles ----
    if (a === 'captions-list' || a === 'caption-upload' || a === 'caption-delete') {
      const it = c.items.find(x => x.id === b.id);
      if (!it || !it.videoId) return L.json(res, 404, { error: 'not_found' });
      if (a === 'caption-upload') {
        const lang = str(b.lang, 8).toLowerCase();
        if (!/^[a-z]{2}$/.test(lang)) return L.json(res, 400, { error: 'lang' });
        const text = String(b.text || '');
        if (!text.trim() || text.length > 2500000) return L.json(res, 400, { error: 'caption_file' });
        if (!/\d{1,2}:\d{2}:\d{2}[.,]\d{3}\s*-->/.test(text)) return L.json(res, 400, { error: 'format' });
        // one track per language: replace an existing one
        for (const f of await L.captionList(it.videoId)) {
          if (f.lang === lang) await L.captionDelete(it.videoId, f.id);
        }
        await L.captionUpload(it.videoId, lang, text);
      }
      if (a === 'caption-delete') {
        if (!/^\d{1,15}$/.test(String(b.fileId))) return L.json(res, 400, { error: 'file' });
        await L.captionDelete(it.videoId, b.fileId);
      }
      return L.json(res, 200, { ok: true, captions: await L.captionList(it.videoId) });
    }

    if (a === 'announce') {
      const text = str(b.text, 200);
      let link = str(b.link, 300);
      if (link && !/^https:\/\//i.test(link)) return L.json(res, 400, { error: 'link' });
      c.announcement = text ? { text: text, link: link || '', t: Date.now() } : null;
      await L.saveContent(c);
      return L.json(res, 200, { ok: true, content: c });
    }
    if (a === 'rules-save') {
      const text = String(b.text || '').trim().slice(0, 6000);
      if (!text) return L.json(res, 400, { error: 'title' });
      c.rules = { v: L.rulesOf(c).v + 1, text: text };
      await L.saveContent(c);
      return L.json(res, 200, { ok: true, content: c });
    }
    if (a === 'member-note') {
      const uid = str(b.uid, 32);
      if (!/^\d{5,25}$/.test(uid)) return L.json(res, 400, { error: 'uid' });
      const rec = { pay: str(b.pay, 200), note: str(b.note, 1000), t: Date.now(), by: s.name };
      if (!rec.pay && !rec.note) await L.kv('HDEL', L.K('notes'), uid);
      else await L.kv('HSET', L.K('notes'), uid, JSON.stringify(rec));
      return L.json(res, 200, { ok: true });
    }
    // Allow extensions: a member's browser extensions (e.g. a live
    // translator) don't stop playback and switching windows doesn't show
    // the protected screen. Extensions are still logged.
    if (a === 'relax') {
      const uid = str(b.uid, 32);
      if (!/^\d{5,25}$/.test(uid)) return L.json(res, 400, { error: 'uid' });
      await L.kv(b.on ? 'SADD' : 'SREM', L.K('relaxed'), uid);
      await L.sessLog(b.on ? 'extensions-allowed' : 'extensions-blocked', { uid: uid, name: 'by ' + s.name }, req);
      return L.json(res, 200, { ok: true });
    }
    if (a === 'vpn-trust') {
      const uid = str(b.uid, 32);
      if (!/^\d{5,25}$/.test(uid)) return L.json(res, 400, { error: 'uid' });
      await L.kv(b.on ? 'SADD' : 'SREM', L.K('vpnok'), uid);
      await L.sessLog(b.on ? 'vpn-trusted' : 'vpn-untrusted', { uid: uid, name: 'by ' + s.name }, req);
      return L.json(res, 200, { ok: true });
    }
    if (a === 'devices-reset') {
      const uid = str(b.uid, 32);
      if (!/^\d{5,25}$/.test(uid)) return L.json(res, 400, { error: 'uid' });
      await L.kv('DEL', L.K('devs:' + uid));
      await L.sessLog('devices-reset', { uid: uid, name: 'by ' + s.name }, req);
      return L.json(res, 200, { ok: true });
    }
    if (a === 'untimeout') {
      const uid = str(b.uid, 32);
      if (!/^\d{5,25}$/.test(uid)) return L.json(res, 400, { error: 'uid' });
      await L.kv('DEL', L.K('timeout:' + uid));
      await L.alert('timeout-lifted', s, 'lifted timeout for ' + uid, req);
      return L.json(res, 200, { ok: true });
    }
    if (a === 'unlock' || a === 'relock') {
      const uid = str(b.uid, 32);
      if (!/^\d{5,25}$/.test(uid)) return L.json(res, 400, { error: 'uid' });
      await L.kv(a === 'unlock' ? 'SADD' : 'SREM', L.K('unlocked'), uid);
      return L.json(res, 200, { ok: true });
    }
    if (a === 'test-alert') {
      // fire a sample alert at the Discord webhook so admins can check it
      const hook = L.env('ALERT_WEBHOOK');
      if (!hook) return L.json(res, 400, { error: 'no_webhook' });
      const ping = L.pingLine();
      let r;
      try {
        r = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: L.SITE_NAME() + ' Security',
            content: (ping.text ? ping.text + ' ' : '') + 'Test alert from the admin panel',
            allowed_mentions: { parse: [], roles: ping.roles, users: ping.users },
            embeds: [{ title: 'This is a test', color: L.ACCENT(),
              description: 'Real alerts look like this: who, their Discord ID, network and what they tried.',
              fields: [{ name: 'Sent by', value: s.name + ' (<@' + s.uid + '>)' }],
              timestamp: new Date().toISOString() }]
          }) });
      } catch (e) { return L.json(res, 502, { error: 'hook_failed' }); }
      if (!r.ok) return L.json(res, 502, { error: 'hook_failed', status: r.status });
      return L.json(res, 200, { ok: true });
    }
    if (a === 'alerts-clear') {
      await L.kv('DEL', L.K('alerts'));
      return L.json(res, 200, { ok: true });
    }
    if (a === 'block' || a === 'unblock') {
      const uid = str(b.uid, 32);
      if (!/^\d{5,25}$/.test(uid)) return L.json(res, 400, { error: 'uid' });
      if (a === 'block') {
        if (uid === s.uid) return L.json(res, 400, { error: 'self' });
        await L.kv('SADD', L.K('blocked'), uid);
        await L.kv('DEL', L.K('dev:' + uid));
        await L.kv('DEL', L.K('active:' + uid));
        await L.alert('blocked', s, 'blocked ' + uid, req);
      } else {
        await L.kv('SREM', L.K('blocked'), uid);
        await L.alert('unblocked', s, 'unblocked ' + uid, req);
      }
      return L.json(res, 200, { ok: true });
    }
    if (a === 'revoke') {
      const uid = str(b.uid, 32);
      if (!/^\d{5,25}$/.test(uid)) return L.json(res, 400, { error: 'uid' });
      await L.kv('DEL', L.K('active:' + uid));
      await L.kv('DEL', L.K('dev:' + uid));
      await L.kv('HDEL', L.K('live'), uid);
      await L.sessLog('revoked', { uid: uid, name: 'by ' + s.name }, req);
      await L.alert('revoked', s, 'signed out ' + uid + ' everywhere', req);
      return L.json(res, 200, { ok: true });
    }
    L.json(res, 400, { error: 'action' });
  } catch (e) {
    console.error('admin', e);
    L.json(res, 502, { error: 'server', detail: String(e.message || e).slice(0, 200) });
  }
};
