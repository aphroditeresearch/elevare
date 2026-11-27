/* Elevare offline demo: fake back end + guided tour. Injected by
   dev/build-demo.js ahead of the real page script. ES5. Never deployed. */
(function () {
  'use strict';
  window.LVR_DEMO = true;
  var SEED = window.LVR_SEED;
  var ADMIN = { id: '100000000000000001', name: 'Admin Placeholder',
    username: 'admin.placeholder', avatar: null,
    joinedAt: '2024-09-02T15:00:00.000Z' };
  var MEMBER = { id: '100000000000000002', name: 'Member Placeholder',
    username: 'member.placeholder', avatar: null,
    joinedAt: '2025-03-14T18:00:00.000Z' };
  var DB = {
    who: null,
    content: JSON.parse(JSON.stringify(SEED.content)),
    seen: { '100000000000000001': {}, '100000000000000002':
      { i1: 1, i2: 1, i3: 1, i4: 1 } },
    done: { '100000000000000001': {}, '100000000000000002':
      { i1: 1, i2: 1, i3: 1, i4: 1 } },
    starts: {},
    plays: [],
    sessions: [],
    dev: null,
    blocked: [],
    alerts: SEED.alerts.slice(),
    users: SEED.users,
    vids: {}
  };
  var H = {}; // hooks from the page
  var vn = 100;

  function log(kind, detail) {
    var u = DB.who;
    DB.alerts.unshift({ t: Date.now(), kind: kind, uid: u ? u.id : null,
      name: u ? u.name : null, detail: detail || '', ip: '203.0.113.24' });
  }
  function isAdmin() { return DB.who === ADMIN; }
  function find(id) {
    for (var i = 0; i < DB.content.items.length; i++) {
      if (DB.content.items[i].id === id) return DB.content.items[i];
    }
    return null;
  }
  function move(arr, id, dir, same) {
    var idx = -1, i;
    for (i = 0; i < arr.length; i++) if (arr[i].id === id) idx = i;
    if (idx < 0) return;
    var st = dir === 'up' ? -1 : 1;
    for (var j = idx + st; j >= 0 && j < arr.length; j += st) {
      if (same(arr[j], arr[idx])) {
        var t = arr[idx]; arr[idx] = arr[j]; arr[j] = t; return;
      }
    }
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function lectures() {
    var out = [];
    DB.content.sections.forEach(function (s) {
      if (s.kind !== 'lecture') return;
      DB.content.items.forEach(function (it) {
        if (it.sectionId === s.id && it.status === 'ready') out.push(it);
      });
    });
    return out;
  }
  function lectureOpen(it, done) {
    if (done[it.id]) return true;
    var l = lectures();
    for (var i = 0; i < l.length && l[i] !== it; i++) if (!done[l[i].id]) return false;
    return true;
  }
  function psid() {
    return 'S-' + Math.random().toString(16).slice(2, 10).toUpperCase();
  }

  // ---------------- journal (kept in memory, per signed-in person) ----------
  var JRN = {};
  function jslug(t) {
    return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '').slice(0, 40) || 'notes';
  }
  function jix(uid) {
    if (!JRN[uid]) {
      JRN[uid] = { cats: ['Trade Journal', 'Markups', 'Daily Thesis'], chans: [
        { id: 'c1', cat: 'Trade Journal', name: 'trade-executions' },
        { id: 'c2', cat: 'Markups', name: 'markups' },
        { id: 'c3', cat: 'Daily Thesis', name: 'daily-thesis' }],
        pages: [], body: {} };
    }
    return JRN[uid];
  }
  var jn = 10;
  function journal(uid, b) {
    var J = jix(uid), a = b.action, i;
    function pg(id) { for (i = 0; i < J.pages.length; i++) if (J.pages[i].id === id) return J.pages[i]; }
    function byVid(v) { for (i = 0; i < J.pages.length; i++) if (J.pages[i].vid === v) return J.pages[i]; }
    if (a === 'index') {
      return [200, { cats: clone(J.cats), chans: clone(J.chans), pages: clone(J.pages) }];
    }
    if (a === 'cat') {
      var cn = String(b.name || '').trim().slice(0, 24);
      if (cn && J.cats.indexOf(cn) < 0) J.cats.push(cn);
      return [200, { ok: true, cats: clone(J.cats) }];
    }
    if (a === 'renamecat') {
      var ci = J.cats.indexOf(b.from), to = String(b.name || '').trim().slice(0, 24);
      if (ci < 0 || !to) return [404, { error: 'not_found' }];
      J.cats[ci] = to;
      J.chans.forEach(function (c) { if (!c.vid && c.cat === b.from) c.cat = to; });
      return [200, { ok: true, cats: clone(J.cats) }];
    }
    if (a === 'delcat') {
      var gone = J.chans.filter(function (c) { return !c.vid && c.cat === b.name; })
        .map(function (c) { return c.id; });
      J.cats = J.cats.filter(function (c) { return c !== b.name; });
      J.chans = J.chans.filter(function (c) { return gone.indexOf(c.id) < 0; });
      J.pages = J.pages.filter(function (p) { return gone.indexOf(p.ch) < 0; });
      return [200, { ok: true }];
    }
    if (a === 'rename') {
      for (i = 0; i < J.chans.length; i++) {
        if (J.chans[i].id === b.id) { J.chans[i].name = jslug(b.name);
          return [200, { ok: true, chan: clone(J.chans[i]) }]; }
      }
      return [404, { error: 'not_found' }];
    }
    if (a === 'page') {
      var p = pg(b.id); if (!p) return [404, { error: 'not_found' }];
      var o = clone(p); o.blocks = clone(J.body[p.id] || []); return [200, { page: o }];
    }
    if (a === 'video') {
      var it = find(b.vid); if (!it) return [404, { error: 'not_found' }];
      var vp = byVid(it.id);
      return [200, { page: { id: vp ? vp.id : null, vid: it.id, title: it.title,
        up: vp ? vp.up : 0, blocks: clone(vp ? J.body[vp.id] || [] : []) } }];
    }
    if (a === 'save') {
      var sp;
      if (b.vid) {
        var vi = find(b.vid); if (!vi) return [404, { error: 'not_found' }];
        sp = byVid(vi.id);
        if (!sp) {
          var ch = { id: 'c' + (++jn), cat: vi.kind === 'breakdown' ? 'Breakdowns' : 'Lectures',
            name: jslug(vi.title), vid: vi.id };
          J.chans.push(ch);
          sp = { id: 'p' + (++jn), ch: ch.id, title: vi.title, vid: vi.id };
          J.pages.push(sp);
        }
      } else {
        sp = pg(b.id); if (!sp) return [404, { error: 'not_found' }];
        if (b.title !== undefined) sp.title = String(b.title).slice(0, 140);
      }
      sp.up = Date.now(); J.body[sp.id] = clone(b.blocks || []);
      return [200, { ok: true, id: sp.id, ch: sp.ch, up: sp.up }];
    }
    if (a === 'newpage') {
      var np = { id: 'p' + (++jn), ch: b.ch, title: b.title || '', up: Date.now() };
      J.pages.push(np); J.body[np.id] = []; return [200, { ok: true, page: clone(np) }];
    }
    if (a === 'chan') {
      var nc = { id: 'c' + (++jn), cat: J.cats.indexOf(b.cat) >= 0 ? b.cat : '',
        name: jslug(b.name) };
      J.chans.push(nc); return [200, { ok: true, chan: clone(nc) }];
    }
    if (a === 'delpage') {
      J.pages = J.pages.filter(function (x) { return x.id !== b.id; }); return [200, { ok: true }];
    }
    if (a === 'delchan') {
      J.chans = J.chans.filter(function (x) { return x.id !== b.id; });
      J.pages = J.pages.filter(function (x) { return x.ch !== b.id; });
      return [200, { ok: true }];
    }
    return [400, { error: 'action' }];
  }

  // ---------------- payouts (sample verified payouts for the leaderboard) ------
  var PIMG = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" ' +
    'width="640" height="400"><rect width="640" height="400" fill="#0b1219"/>' +
    '<rect x="20" y="20" width="600" height="360" fill="none" stroke="#2c9ef0"/>' +
    '<text x="320" y="190" fill="#ecf3f8" font-family="Georgia" font-size="40" ' +
    'text-anchor="middle">PAYOUT CERTIFICATE</text><text x="320" y="240" fill="#74c5ff" ' +
    'font-family="Georgia" font-size="22" text-anchor="middle">Sample image</text></svg>');
  var POS = [
    ['200000000000000011', 'Kaito', 18450, 'Apex Trader Funding', '2026-11-20'],
    ['200000000000000011', 'Kaito', 9200, 'Lucid Trading', '2026-11-02'],
    ['200000000000000012', 'Rena', 21300, 'Topstep', '2026-11-18'],
    ['200000000000000013', 'Sora', 11800, 'Tradeify', '2026-11-15'],
    ['200000000000000014', 'Haru', 7400, 'MyFundedFutures', '2026-11-12'],
    ['200000000000000015', 'Mika', 5150, 'Apex Trader Funding', '2026-11-09'],
    ['200000000000000016', 'Ren', 3900, 'Lucid Trading', '2026-11-06']
  ].map(function (r, i) {
    return { id: 'po' + i, uid: r[0], name: r[1] + ' (sample)', amount: r[2], firm: r[3],
      date: r[4], show: true, status: 'approved', t: Date.now() - i * 864e5 };
  });
  POS.push({ id: 'poq', uid: MEMBER.id, name: MEMBER.name, amount: 2500, firm: 'Topstep',
    date: '2026-11-25', show: true, status: 'pending', t: Date.now() - 3600e3 });
  var pn = 50;
  function payouts(uid, b) {
    var a = b.action;
    function one(id) { return POS.filter(function (p) { return p.id === id; })[0]; }
    if (a === 'board') {
      var ok = POS.filter(function (p) { return p.status === 'approved'; }), by = {};
      ok.forEach(function (p) {
        if (!p.show) return;
        var e = by[p.uid] || (by[p.uid] = { uid: p.uid, name: p.name, avatar: null,
          total: 0, count: 0, firms: [] });
        e.total += p.amount; e.count++; if (e.firms.indexOf(p.firm) < 0) e.firms.push(p.firm);
      });
      var rows = Object.keys(by).map(function (k) { return by[k]; })
        .sort(function (x, y) { return y.total - x.total; });
      var people = {}; ok.forEach(function (p) { people[p.uid] = 1; });
      return [200, { total: ok.reduce(function (n, p) { return n + p.amount; }, 0),
        payouts: ok.length, traders: Object.keys(people).length, rows: rows }];
    }
    if (a === 'mine') {
      return [200, { list: clone(POS.filter(function (p) { return p.uid === uid; })) }];
    }
    if (a === 'submit') {
      var np = { id: 'po' + (++pn), uid: uid, name: DB.who.name, amount: Number(b.amount),
        firm: b.firm, date: b.date, show: b.show !== false, status: 'pending', t: Date.now(),
        img: b.image };
      POS.push(np); return [200, { ok: true }];
    }
    if (a === 'withdraw') {
      POS = POS.filter(function (p) { return !(p.id === b.id && p.status === 'pending'); });
      return [200, { ok: true }];
    }
    if (a === 'show') { var sp = one(b.id); if (sp) sp.show = !!b.show; return [200, { ok: true }]; }
    if (a === 'img') { var ip = one(b.id); return [200, { image: ip && ip.img || PIMG }]; }
    if (a === 'trader') {
      return [200, { list: clone(POS.filter(function (p) {
        return p.uid === b.uid && p.status === 'approved' && p.show; })) }];
    }
    if (!isAdmin()) return [403, { error: 'admin' }];
    if (a === 'queue') {
      return [200, { pending: clone(POS.filter(function (p) { return p.status === 'pending'; })),
        done: clone(POS.filter(function (p) { return p.status !== 'pending'; })) }];
    }
    if (a === 'review') {
      var rp = one(b.id); if (!rp) return [404, { error: 'not_found' }];
      rp.status = b.ok ? 'approved' : 'rejected'; rp.note = b.note || ''; rp.by = DB.who.name;
      return [200, { ok: true }];
    }
    if (a === 'remove') { POS = POS.filter(function (p) { return p.id !== b.id; }); return [200, { ok: true }]; }
    return [400, { error: 'action' }];
  }

  // ---------------- fake API ----------------
  function route(method, path, b) {
    if (path === '/api/me' && method === 'POST' && b.action === 'logout') {
      DB.who = null; return [200, { ok: true }];
    }
    if (!DB.who) return [401, { error: 'signin' }];
    var uid = DB.who.id;
    if (path === '/api/me') {
      if (method === 'POST') {
        if (b.action === 'flag') log(b.kind, b.detail);
        return [200, { ok: true }];
      }
      var c = DB.content;
      return [200, {
        user: DB.who, isAdmin: isAdmin(), siteName: 'Elevare',
        announcement: c.announcement, sections: clone(c.sections),
        items: c.items.filter(function (it) {
          return isAdmin() || it.status === 'ready';
        }).map(function (it) {
          return { id: it.id, kind: it.kind, sectionId: it.sectionId,
            title: it.title, desc: it.desc, length: it.length,
            status: it.status, added: it.added, tier: it.tier || '' };
        }),
        tiers: ['Elite'], myTiers: isAdmin() ? ['Elite'] : [],
        seen: Object.keys(DB.seen[uid] || {}),
        done: Object.keys(DB.done[uid] || {})
      }];
    }
    if (path === '/api/play') {
      var dn = DB.done[uid] = DB.done[uid] || {};
      if (b.action === 'complete') {
        var ci = find(b.id);
        var st0 = DB.starts[uid + ci.id];
        if (!st0) return [409, { error: 'not_started' }];
        var left = st0 + 10000 - Date.now(); // demo: 10 s instead of 85%
        if (left > 0) return [409, { error: 'too_soon', wait: Math.ceil(left / 1000) }];
        dn[ci.id] = 1;
        return [200, { ok: true, done: Object.keys(dn) }];
      }
      if (b.beat) {
        if (DB.dev && DB.dev !== b.device) return [409, { error: 'taken' }];
        DB.dev = b.device; return [200, { ok: true }];
      }
      if (DB.dev && DB.dev !== b.device && !b.take) {
        return [409, { error: 'other_device' }];
      }
      if (DB.dev && DB.dev !== b.device) log('device-takeover', 'switched device');
      var it = find(b.id);
      if (!it || it.status !== 'ready') return [404, { error: 'not_found' }];
      if (it.tier && !isAdmin()) return [403, { error: 'tier', tier: it.tier }];
      if (it.kind === 'lecture' && !isAdmin() && !lectureOpen(it, dn)) {
        log('locked-probe', 'tried to play a locked lecture');
        return [403, { error: 'locked' }];
      }
      DB.dev = b.device;
      if (!DB.starts[uid + it.id]) DB.starts[uid + it.id] = Date.now();
      var sid = psid();
      DB.plays.unshift({ t: Date.now(), sid: sid, uid: uid, name: DB.who.name,
        item: it.id, title: it.title, ip: '203.0.113.24' });
      (DB.seen[uid] = DB.seen[uid] || {})[it.id] = 1;
      return [200, { otp: 'demo', playbackInfo: 'demo', session: sid }];
    }
    if (path === '/api/journal') return journal(uid, b);
    if (path === '/api/payouts') return payouts(uid, b);
    if (path === '/api/admin') {
      if (!isAdmin()) {
        log('admin-probe', method + ' /api/admin');
        return [403, { error: 'forbidden' }];
      }
      if (method === 'GET') {
        return [200, { content: clone(DB.content), alerts: clone(DB.alerts),
          blocked: DB.blocked.slice(), users: clone(DB.users),
          plays: clone(DB.plays.concat(SEED.plays)),
          sessions: clone(DB.sessions.concat(SEED.sessions)), tiers: ['Elite'] }];
      }
      return admin(b);
    }
    return [404, {}];
  }

  function admin(b) {
    var c = DB.content, a = b.action, it, s, i;
    var ok = function () { return [200, { ok: true, content: clone(c) }]; };
    var title = String(b.title || '').replace(/^\s+|\s+$/g, '');
    if (a === 'section-save') {
      if (!title) return [400, { error: 'title' }];
      for (i = 0; i < c.sections.length; i++) {
        if (c.sections[i].id === b.id) s = c.sections[i];
      }
      if (s) s.title = title;
      else c.sections.push({ id: 's' + (vn++), kind: b.kind, title: title });
      return ok();
    }
    if (a === 'section-move') {
      move(c.sections, b.id, b.dir, function (x, y) { return x.kind === y.kind; });
      return ok();
    }
    if (a === 'section-delete') {
      if (c.items.some(function (x) { return x.sectionId === b.id; })) {
        return [409, { error: 'not_empty' }];
      }
      c.sections = c.sections.filter(function (x) { return x.id !== b.id; });
      return ok();
    }
    if (a === 'item-save') {
      if (!title) return [400, { error: 'title' }];
      var sec = null;
      c.sections.forEach(function (x) { if (x.id === b.sectionId) sec = x; });
      if (!sec) return [400, { error: 'section' }];
      it = find(b.id);
      if (it) {
        it.title = title; it.desc = b.desc || ''; it.sectionId = sec.id;
        it.kind = sec.kind; it.tier = b.tier || '';
      } else {
        c.items.push({ id: 'i' + (vn++), kind: sec.kind, sectionId: sec.id,
          title: title, desc: b.desc || '', status: 'empty', videoId: null,
          length: 0, added: Date.now(), tier: b.tier || '' });
      }
      return ok();
    }
    if (a === 'item-move') {
      move(c.items, b.id, b.dir, function (x, y) {
        return x.sectionId === y.sectionId;
      });
      return ok();
    }
    if (a === 'item-delete') {
      c.items = c.items.filter(function (x) { return x.id !== b.id; });
      return ok();
    }
    if (a === 'upload-start') {
      it = find(b.id);
      if (it.status === 'ready' && it.videoId) it.prevVideoId = it.videoId;
      it.videoId = 'demo' + (vn++); it.status = 'uploading';
      return [200, { ok: true, videoId: it.videoId, clientPayload: {
        policy: 'p', key: 'k', 'x-amz-signature': 's', 'x-amz-algorithm': 'a',
        'x-amz-date': 'd', 'x-amz-credential': 'c', uploadLink: 'demo://upload'
      } }];
    }
    if (a === 'link-video') {
      it = find(b.id);
      if (!/^[a-f0-9]{32}$/i.test(String(b.videoId || ''))) return [400, { error: 'video_id' }];
      it.videoId = b.videoId; it.status = 'ready'; it.length = 1800;
      return ok();
    }
    if (a === 'upload-done') {
      it = find(b.id); it.status = 'processing';
      DB.vids[it.videoId] = Date.now() + 6000;
      return ok();
    }
    if (a === 'upload-failed') {
      it = find(b.id); it.status = it.prevVideoId ? 'ready' : 'empty';
      return ok();
    }
    if (a === 'status') {
      c.items.forEach(function (x) {
        if (x.status === 'processing' && DB.vids[x.videoId] < Date.now()) {
          x.status = 'ready';
          x.length = 1500 + Math.floor(Math.random() * 1800);
          delete x.prevVideoId;
        }
      });
      return [200, { ok: true, results: [], content: clone(c) }];
    }
    if (a === 'announce') {
      if (b.link && !/^https:\/\//i.test(b.link)) return [400, { error: 'link' }];
      c.announcement = b.text ? { text: String(b.text).slice(0, 200),
        link: b.link || '', t: Date.now() } : null;
      return ok();
    }
    if (a === 'alerts-clear') { DB.alerts = []; return ok(); }
    if (a === 'revoke') {
      DB.sessions.unshift({ t: Date.now(), event: 'revoked', uid: b.uid,
        name: 'by ' + DB.who.name, ip: '203.0.113.24' });
      log('revoked', 'signed out ' + b.uid + ' everywhere');
      return ok();
    }
    if (a === 'block' || a === 'unblock') {
      if (!/^\d{5,25}$/.test(String(b.uid || ''))) return [400, { error: 'uid' }];
      if (b.uid === DB.who.id) return [400, { error: 'self' }];
      DB.blocked = DB.blocked.filter(function (x) { return x !== b.uid; });
      if (a === 'block') DB.blocked.push(b.uid);
      log(a === 'block' ? 'blocked' : 'unblocked', a + 'ed ' + b.uid);
      return ok();
    }
    return [400, { error: 'action' }];
  }

  // ---------------- XHR stand-in ----------------
  var RealXHR = window.XMLHttpRequest;
  function FakeXHR() {
    this.upload = {}; this.status = 0; this.responseText = '';
    this.readyState = 0;
  }
  FakeXHR.prototype.open = function (m, u) { this._m = m; this._u = u; };
  FakeXHR.prototype.setRequestHeader = function () {};
  FakeXHR.prototype.send = function (body) {
    var self = this;
    if (this._u === 'demo://upload') {
      var f = body && body.get && body.get('file');
      var total = (f && f.size) || 1e6, done = 0, steps = 18;
      var t = setInterval(function () {
        done = Math.min(total, done + total / steps);
        if (self.upload.onprogress) {
          self.upload.onprogress({ lengthComputable: true, loaded: done,
            total: total });
        }
        if (done >= total) {
          clearInterval(t); self.status = 201; self.readyState = 4;
          if (self.onload) self.onload();
        }
      }, 160);
      return;
    }
    var b = {};
    try { b = body ? JSON.parse(body) : {}; } catch (e) {}
    setTimeout(function () {
      var r = route(self._m, self._u.split('?')[0], b);
      self.status = r[0]; self.responseText = JSON.stringify(r[1]);
      self.readyState = 4;
      if (self.onload) self.onload();
    }, 90);
  };
  window.XMLHttpRequest = function () {
    return new FakeXHR();
  };
  window.XMLHttpRequest.real = RealXHR;

  // ---------------- simulated DRM player ----------------
  function player(item, user) {
    var d = document.createElement('div');
    d.className = 'demo-player';
    d.innerHTML =
      '<div class="dp-mark"></div>' +
      '<div class="dp-c"><div class="dp-k">Encrypted playback</div>' +
      '<div class="dp-t"></div><div class="dp-s">On the live site the' +
      ' VdoCipher DRM player (Widevine / FairPlay) streams here, with its own' +
      ' moving watermark burned into the picture.</div></div>' +
      '<div class="dp-bar"><span class="dp-pp"></span><i><b></b></i>' +
      '<span class="dp-time">0:00</span></div>';
    d.querySelector('.dp-t').textContent = item.title;
    var mk = d.querySelector('.dp-mark');
    mk.textContent = user.name + ' \u00b7 ' + user.id;
    var sec = 0, fill = d.querySelector('.dp-bar b');
    var tm = d.querySelector('.dp-time');
    var t = setInterval(function () {
      if (!d.parentNode) { clearInterval(t); return; }
      sec++;
      var tot = item.length || 1800;
      fill.style.width = Math.min(100, sec / 12 * 100) + '%';
      if (sec === 12) d.setAttribute('data-ended', '1');
      tm.textContent = Math.floor(sec / 60) + ':' +
        ('0' + sec % 60).slice(-2) + ' / ' + Math.floor(tot / 60) + ':' +
        ('0' + tot % 60).slice(-2);
      if (sec % 6 === 0) {
        mk.style.left = (8 + Math.random() * 60) + '%';
        mk.style.top = (10 + Math.random() * 70) + '%';
      }
    }, 1000);
    return d;
  }

  // ---------------- tour ----------------
  function signIn(who) {
    DB.who = who === 'admin' ? ADMIN : MEMBER;
    DB.sessions.unshift({ t: Date.now(), event: 'signin', uid: DB.who.id,
      name: DB.who.name, ip: '203.0.113.24' });
    DB.dev = null;
    H.err('');
    location.hash = '';
    H.boot();
  }
  function door(e) {
    DB.who = null;
    H.show();
    H.err(e || '');
  }
  function q(sel) { return document.querySelector(sel); }
  function later(fn, ms) { setTimeout(fn, ms || 450); }
  function ensure(who, then) {
    if (!DB.who || (who === 'admin') !== isAdmin()) {
      signIn(who); later(then, 500);
    } else then();
  }

  var STEPS = [
    { t: 'The front door',
      d: 'Members sign in with Discord. Only people in the server who hold' +
        ' the community role get in. Everyone else is refused with a clear' +
        ' message.',
      go: function () { door(); } },
    { t: 'Refused at the door',
      d: 'This is what someone without the role sees. Blocked members,' +
        ' people outside the server and other browsers get their own message.',
      go: function () { door('no_access'); } },
    { t: 'The library',
      d: 'Lectures up top, the full library below: completion, sections that' +
        ' fold, and every row marked Watched, New or Now playing. Search' +
        ' covers lectures and breakdowns.',
      go: function () { ensure('member', function () { H.go('lectures'); }); } },
    { t: 'Watermarked playback',
      d: 'Every play gets a fresh 5-minute DRM key after a live Discord' +
        ' role check. Name, Discord ID, a unique playback session ID and' +
        ' the time drift across the video, so a leak traces back to one' +
        ' person and one viewing. (Here a 12-second stand-in plays.)',
      go: function () {
        ensure('member', function () {
          H.go('lectures');
          later(function () { var p = q('#poster'); if (p) p.click(); }, 300);
        });
      } },
    { t: 'Lectures unlock one by one',
      d: 'Lectures are a path: the next one opens only when the current one' +
        ' is completed, and completing needs real watch time (checked by' +
        ' the server), so skipping to the end doesn\u2019t count.' +
        ' Breakdowns stay open any time.',
      go: function () {
        ensure('member', function () {
          var l = lectures(), dn = DB.done[MEMBER.id] || {}, lock = null;
          for (var i = 0; i < l.length; i++) {
            if (!lectureOpen(l[i], dn)) { lock = l[i]; break; }
          }
          H.go('lectures', lock ? lock.id : null);
        });
      } },
    { t: 'One device at a time',
      d: 'Only one device can play at a time. When the same account opens a' +
        ' video somewhere else, the first device stops and shows this.',
      go: function () {
        ensure('member', function () {
          var playing = q('#player .demo-player');
          if (!playing) {
            H.go('lectures');
            later(function () { var p = q('#poster'); if (p) p.click(); }, 300);
          }
          later(function () { DB.dev = 'another-device'; H.beat(); }, 1400);
        });
      } },
    { t: 'Screenshot shield',
      d: 'PrintScreen, Mac screenshot keys, switching windows or printing' +
        ' cover the page with the viewer\u2019s ID. Right-click, saving,' +
        ' selecting and devtools are locked down too, and attempts are logged.',
      go: function () {
        ensure('member', function () { H.shield(true, 3500); });
      } },
    { t: 'Breakdowns',
      d: 'Breakdowns get the same layout with their own sections and' +
        ' progress.',
      go: function () { ensure('member', function () { H.go('breakdowns'); }); } },
    { t: 'Profile',
      d: 'A plain profile: Discord name and handle, status, member since,' +
        ' progress and Discord ID.',
      go: function () { ensure('member', function () { H.go('profile'); }); } },
    { t: 'Admin: content',
      d: 'The mentor runs everything here: sections, lectures, breakdowns,' +
        ' ordering and the announcement bar. No developer needed.',
      go: function () {
        ensure('admin', function () { H.go('admin'); H.adm('content'); });
      } },
    { t: 'Admin: uploading',
      d: 'Try it: press Upload video on any row and pick any file from your' +
        ' computer. Nothing leaves your browser in this demo. It uploads,' +
        ' processes, then goes Ready by itself.',
      go: function () {
        ensure('admin', function () { H.go('admin'); H.adm('content'); });
      } },
    { t: 'Admin: security log',
      d: 'Devtools attempts, screenshot keys, device switches and members' +
        ' poking at admin pages land here (and optionally in a Discord' +
        ' channel). Block anyone straight from the log.',
      go: function () { ensure('admin', function () { H.go('admin'); H.adm('log'); }); } },
    { t: 'Admin: plays',
      d: 'Every play is logged with its session ID, member, video and' +
        ' network. Found a leaked clip? Type the session ID from its' +
        ' watermark here to see who watched it and when.',
      go: function () { ensure('admin', function () { H.go('admin'); H.adm('plays'); }); } },
    { t: 'Admin: members',
      d: 'Everyone who has signed in, with Sign out (everywhere) and Block,' +
        ' plus the sign-in history. Losing the Discord role stops playback' +
        ' on the very next play.',
      go: function () {
        ensure('admin', function () { H.go('admin'); H.adm('members'); });
      } }
  ];
  var at = 0;
  function drawTour() {
    var s = STEPS[at];
    q('#tour .tn').textContent = 'Step ' + (at + 1) + ' of ' + STEPS.length;
    q('#tour h4').textContent = s.t;
    q('#tour p').textContent = s.d;
    q('#tour .tp').disabled = at === 0;
    q('#tour .tx').textContent = at === STEPS.length - 1 ? 'Start over' :
      'Next';
  }
  function goStep(i) {
    at = (i + STEPS.length) % STEPS.length;
    drawTour();
    STEPS[at].go();
  }

  window.lvr = {
    hooks: function (h) { H = h; },
    player: player,
    door: door
  };

  document.addEventListener('DOMContentLoaded', function () {
    // Discord button -> pick a role instead of real OAuth
    document.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t.id !== 'go') t = t.parentNode;
      if (!t) return;
      e.preventDefault(); e.stopPropagation();
      q('#demo-pick').hidden = false;
    }, true);
    q('#demo-pick').addEventListener('click', function (e) {
      var w = e.target.getAttribute && e.target.getAttribute('data-as');
      if (w) { q('#demo-pick').hidden = true; signIn(w); }
      if (e.target.id === 'demo-pick') q('#demo-pick').hidden = true;
    });
    var skip = q('#demo-skip');
    if (skip) skip.addEventListener('click', function () { door(); });
    q('#tour .tp').addEventListener('click', function () { goStep(at - 1); });
    q('#tour .tx').addEventListener('click', function () { goStep(at + 1); });
    q('#tour .tg').addEventListener('click', function () { goStep(at); });
    q('#tour .tmin').addEventListener('click', function () {
      var t = q('#tour'); t.className = t.className ? '' : 'min';
    });
    drawTour();
  });
})();
