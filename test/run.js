'use strict';
// End-to-end tests against mocked Discord / VdoCipher / Upstash.
const assert = require('assert');
const mocks = require('../dev/mocks');
const dev = require('../dev/server');

const MP = 4511, SP = 4510, BASE = 'http://localhost:' + SP;
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ADMIN = '100000000000000001', MEMBER = '100000000000000002';

function client(ua) {
  const jar = {};
  async function req(method, path, body, extra) {
    const h = { 'User-Agent': ua || CHROME,
      Cookie: Object.keys(jar).map(k => k + '=' + jar[k]).join('; ') };
    if (method !== 'GET') { h.Origin = BASE; h['Content-Type'] = 'application/json'; }
    Object.assign(h, extra || {});
    const r = await fetch(BASE + path, { method, headers: h, redirect: 'manual',
      body: body ? JSON.stringify(body) : undefined });
    (r.headers.getSetCookie ? r.headers.getSetCookie() : []).forEach(c => {
      const kv = c.split(';')[0]; const i = kv.indexOf('=');
      const name = kv.slice(0, i), val = kv.slice(i + 1);
      if (/Max-Age=0/.test(c)) delete jar[name]; else jar[name] = val;
    });
    const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch (e) {}
    return { status: r.status, loc: r.headers.get('location'), data, text };
  }
  async function signIn(code) {
    // tests sign in far more often than the 20-per-10-minutes limit allows
    for (const k of Array.from(mocks.store.keys())) if (/^(vault|elevare):rl:login:/.test(k)) mocks.store.delete(k);
    const a = await req('GET', '/api/login');
    if (!/discord\.com\/oauth2\/authorize/.test(a.loc || '')) return a.loc;
    const state = new URL(a.loc).searchParams.get('state');
    const b = await req('GET', '/api/callback?code=' + code + '&state=' + encodeURIComponent(state));
    if (b.loc === '/' && !signIn.skipAgree) {
      const me = await req('GET', '/api/me');
      if (me.data && me.data.agreed === false) await req('POST', '/api/me', { action: 'agree', v: me.data.rules.v });
    }
    return b.loc;
  }
  return { req, signIn, jar };
}

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

(async () => {
  const ms = await mocks.start(MP); dev.mockEnv(MP, SP);
  const ss = await dev.start(SP);
  const admin = client(), member = client();
  let itemId, vid1;

  console.log('Gate');
  await t('non-Chrome is refused at login', async () => {
    assert.strictEqual(await client(SAFARI).signIn(MEMBER), '/?e=browser');
  });
  await t('phones and tablets are refused (desktop only)', async () => {
    const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1';
    const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
    assert.strictEqual(await client(IPHONE).signIn(MEMBER), '/?e=mobile');
    assert.strictEqual(await client(ANDROID).signIn(MEMBER), '/?e=mobile');
  });
  await t('person not in the server is refused', async () => {
    assert.strictEqual(await client().signIn('100000000000000004'), '/?e=not_member');
  });
  await t('server member without the access role is refused', async () => {
    assert.strictEqual(await client().signIn('100000000000000003'), '/?e=no_access');
  });
  await t('forged OAuth state is refused', async () => {
    const r = await client().req('GET', '/api/callback?code=' + MEMBER + '&state=a.b.c');
    assert.strictEqual(r.loc, '/?e=expired');
  });
  await t('the second student role also gets in', async () => {
    assert.strictEqual(await client().signIn('100000000000000008'), '/');
  });
  await t('member with role signs in', async () => {
    assert.strictEqual(await member.signIn(MEMBER), '/');
    const r = await member.req('GET', '/api/me');
    assert.strictEqual(r.status, 200); assert.strictEqual(r.data.isAdmin, false);
  });
  await t('admin signs in as admin', async () => {
    assert.strictEqual(await admin.signIn(ADMIN), '/');
    assert.strictEqual((await admin.req('GET', '/api/me')).data.isAdmin, true);
  });
  await t('anonymous /api/me is 401', async () => {
    assert.strictEqual((await client().req('GET', '/api/me')).status, 401);
  });

  console.log('Admin API');
  await t('members cannot use the admin API (and it is logged)', async () => {
    assert.strictEqual((await member.req('GET', '/api/admin')).status, 403);
    assert.strictEqual((await member.req('POST', '/api/admin', { action: 'section-save', kind: 'lecture', title: 'x' })).status, 403);
    const g = await admin.req('GET', '/api/admin');
    assert.ok(g.data.alerts.some(a => a.kind === 'admin-probe' && a.uid === MEMBER));
  });
  await t('cross-origin POST is refused', async () => {
    const r = await admin.req('POST', '/api/admin', { action: 'alerts-clear' }, { Origin: 'https://evil.example' });
    assert.strictEqual(r.status, 403);
  });
  let secId;
  await t('create section + lecture', async () => {
    const s = await admin.req('POST', '/api/admin', { action: 'section-save', kind: 'lecture', title: 'Foundations' });
    secId = s.data.section.id;
    const i = await admin.req('POST', '/api/admin', { action: 'item-save', sectionId: secId, title: 'Lecture 1', desc: 'Intro' });
    itemId = i.data.item.id; assert.strictEqual(i.data.item.kind, 'lecture');
  });
  await t('upload start -> S3 -> done -> status -> ready', async () => {
    const u = await admin.req('POST', '/api/admin', { action: 'upload-start', id: itemId, name: 'clip.mp4', size: 1000 });
    assert.ok(u.data.clientPayload.uploadLink); vid1 = u.data.videoId;
    const s3 = await fetch(u.data.clientPayload.uploadLink, { method: 'POST', body: 'x' });
    assert.strictEqual(s3.status, 201);
    await admin.req('POST', '/api/admin', { action: 'upload-done', id: itemId });
    mocks.videos[vid1].status = 'Processing';
    let st = await admin.req('POST', '/api/admin', { action: 'status' });
    assert.strictEqual(st.data.results[0].status, 'processing');
    mocks.videos[vid1].status = 'ready'; mocks.videos[vid1].length = 754;
    st = await admin.req('POST', '/api/admin', { action: 'status' });
    const it = st.data.content.items.find(x => x.id === itemId);
    assert.strictEqual(it.status, 'ready'); assert.strictEqual(it.length, 754);
  });
  await t('items not ready are hidden from members', async () => {
    await admin.req('POST', '/api/admin', { action: 'item-save', sectionId: secId, title: 'Draft' });
    const r = await member.req('GET', '/api/me');
    assert.deepStrictEqual(r.data.items.map(x => x.title), ['Lecture 1']);
  });
  await t('members never receive video ids', async () => {
    const r = await member.req('GET', '/api/me');
    assert.ok(r.text.indexOf(vid1) < 0 && !/videoId/.test(r.text));
  });

  await t('announcement shows to members; non-https links refused', async () => {
    assert.strictEqual((await admin.req('POST', '/api/admin', { action: 'announce', text: 'Hello', link: 'javascript:x' })).status, 400);
    await admin.req('POST', '/api/admin', { action: 'announce', text: 'Placeholder notice', link: 'https://example.com' });
    const r = await member.req('GET', '/api/me');
    assert.strictEqual(r.data.announcement.text, 'Placeholder notice');
    assert.strictEqual(r.data.user.username, 'member');
  });

  console.log('Playback');
  await t('play returns an OTP watermarked to the viewer', async () => {
    const r = await member.req('POST', '/api/play', { id: itemId, device: 'deviceAAAA' });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.data.otp, 'otp_' + vid1);
    const o = mocks.otps[mocks.otps.length - 1];
    assert.strictEqual(o.body.ttl, 90);
    const ann = JSON.parse(o.body.annotate);
    assert.ok(ann.some(a => a.text.indexOf(MEMBER) >= 0));
    assert.ok(ann.some(a => a.type === 'text' && a.x && a.y));          // corner + mid-frame marks
    assert.ok(ann.filter(a => a.type === 'rtext' && Number(a.skip) >= 20000).length >= 3); // ghosts
    assert.ok(r.text.indexOf('"' + vid1 + '"') < 0);
    assert.ok((await member.req('GET', '/api/me')).data.seen.indexOf(itemId) >= 0);
  });
  await t('second device is refused, then can take over', async () => {
    const b = await member.req('POST', '/api/play', { id: itemId, device: 'deviceBBBB' });
    assert.strictEqual(b.status, 409); assert.strictEqual(b.data.error, 'other_device');
    const tk = await member.req('POST', '/api/play', { id: itemId, device: 'deviceBBBB', take: true });
    assert.strictEqual(tk.status, 200);
  });
  await t('old device heartbeat gets "taken"; new one keeps going', async () => {
    const a = await member.req('POST', '/api/play', { device: 'deviceAAAA', beat: true });
    assert.strictEqual(a.status, 409); assert.strictEqual(a.data.error, 'taken');
    assert.strictEqual((await member.req('POST', '/api/play', { device: 'deviceBBBB', beat: true })).status, 200);
  });
  await t('play refuses unknown items', async () => {
    assert.strictEqual((await member.req('POST', '/api/play', { id: 'nope', device: 'deviceBBBB' })).status, 404);
  });
  await t('every play is logged for leak tracing', async () => {
    const g = await admin.req('GET', '/api/admin');
    assert.ok(g.data.plays.length >= 2 && g.data.plays[0].uid === MEMBER && g.data.plays[0].ip);
  });
  await t('3+ networks in a day raises an ip-anomaly alert', async () => {
    for (const ipx of ['198.51.100.1', '198.51.100.2', '198.51.100.3']) {
      await member.req('POST', '/api/play', { id: itemId, device: 'deviceBBBB' }, { 'X-Forwarded-For': ipx });
    }
    const g = await admin.req('GET', '/api/admin');
    assert.ok(g.data.alerts.some(a => a.kind === 'ip-anomaly' && a.uid === MEMBER));
  });

  console.log('Session protection');
  await t('a stolen cookie used from another browser is killed and logged', async () => {
    const c = client(SAFARI); Object.assign(c.jar, member.jar);
    assert.strictEqual((await c.req('GET', '/api/me')).status, 401);
    assert.strictEqual((await member.req('GET', '/api/me')).status, 401); // session is gone
    const g = await admin.req('GET', '/api/admin');
    assert.ok(g.data.alerts.some(a => a.kind === 'session-mismatch'));
    assert.strictEqual(await member.signIn(MEMBER), '/');
  });
  await t('signing in elsewhere signs the old session out', async () => {
    const other = client();
    assert.strictEqual(await other.signIn(MEMBER), '/');
    const r = await member.req('GET', '/api/me');
    assert.strictEqual(r.status, 401); assert.strictEqual(r.data.error, 'elsewhere');
    assert.strictEqual(await member.signIn(MEMBER), '/');
  });
  await t('form posts (non-JSON) are refused', async () => {
    const r = await admin.req('POST', '/api/admin', null, { 'Content-Type': 'application/x-www-form-urlencoded' });
    assert.strictEqual(r.status, 415);
  });
  await t('uploads must be a video file', async () => {
    const g = await admin.req('GET', '/api/admin');
    const id = g.data.content.items[0].id;
    const r = await admin.req('POST', '/api/admin', { action: 'upload-start', id: id, name: 'evil.html', size: 10 });
    assert.strictEqual(r.status, 400);
  });

  console.log('Replace / delete');
  await t('replacing a video keeps the old one until the new one is ready', async () => {
    const u = await admin.req('POST', '/api/admin', { action: 'upload-start', id: itemId, name: 'clip.mp4', size: 1000 });
    const vid2 = u.data.videoId;
    let g = await admin.req('GET', '/api/admin');
    assert.strictEqual(g.data.content.items.find(x => x.id === itemId).prevVideoId, vid1);
    await admin.req('POST', '/api/admin', { action: 'upload-done', id: itemId });
    mocks.videos[vid2].status = 'ready';
    await admin.req('POST', '/api/admin', { action: 'status' });
    assert.ok(mocks.deleted.indexOf(vid1) >= 0);
    g = await admin.req('GET', '/api/admin');
    const it = g.data.content.items.find(x => x.id === itemId);
    assert.strictEqual(it.videoId, vid2); assert.ok(!it.prevVideoId);
  });
  await t('section with items cannot be deleted; item delete removes the video', async () => {
    assert.strictEqual((await admin.req('POST', '/api/admin', { action: 'section-delete', id: secId })).status, 409);
    const g = await admin.req('GET', '/api/admin');
    const vid = g.data.content.items.find(x => x.id === itemId).videoId;
    await admin.req('POST', '/api/admin', { action: 'item-delete', id: itemId });
    assert.ok(mocks.deleted.indexOf(vid) >= 0);
  });

  console.log('One-by-one lectures');
  async function readyLecture(sec, title) {
    const i = await admin.req('POST', '/api/admin', { action: 'item-save', sectionId: sec, title });
    const id = i.data.item.id;
    const u = await admin.req('POST', '/api/admin', { action: 'upload-start', id, name: 'a.mp4', size: 10 });
    await admin.req('POST', '/api/admin', { action: 'upload-done', id });
    mocks.videos[u.data.videoId].status = 'ready'; mocks.videos[u.data.videoId].length = 600;
    await admin.req('POST', '/api/admin', { action: 'status' });
    return id;
  }
  let L1, L2;
  await t('a later lecture is locked until the earlier one is completed', async () => {
    const sec = (await admin.req('POST', '/api/admin', { action: 'section-save', kind: 'lecture', title: 'Lock Test' })).data.section.id;
    L1 = await readyLecture(sec, 'Lock One'); L2 = await readyLecture(sec, 'Lock Two');
    const r = await member.req('POST', '/api/play', { id: L2, device: 'deviceBBBB' });
    assert.strictEqual(r.status, 403); assert.strictEqual(r.data.error, 'locked');
    assert.strictEqual((await member.req('POST', '/api/play', { id: L1, device: 'deviceBBBB' })).status, 200);
  });
  await t('completing too early (skipping ahead) is refused', async () => {
    const r = await member.req('POST', '/api/play', { action: 'complete', id: L1 });
    assert.strictEqual(r.status, 409); assert.strictEqual(r.data.error, 'too_soon');
    assert.ok(r.data.wait > 400);
  });
  await t('after enough watch time it completes and the next unlocks', async () => {
    mocks.store.set('elevare:start:' + MEMBER + ':' + L1, String(Date.now() - 600000));
    const r = await member.req('POST', '/api/play', { action: 'complete', id: L1 });
    assert.strictEqual(r.status, 200); assert.ok(r.data.done.indexOf(L1) >= 0);
    assert.strictEqual((await member.req('POST', '/api/play', { id: L2, device: 'deviceBBBB' })).status, 200);
    assert.ok((await member.req('GET', '/api/me')).data.done.indexOf(L1) >= 0);
  });
  await t('watching at 2x completes (80% of the parts watched); skipping ahead does not', async () => {
    // L2 was just opened; at 2x a 10-minute lecture is done in 5 minutes
    let r = await member.req('POST', '/api/play', { action: 'complete', id: L2, w: [0, 1, 18, 19] });
    assert.strictEqual(r.data.error, 'too_soon');                    // skipped the middle
    await member.req('POST', '/api/play', { device: 'deviceBBBB', beat: true, id: L2, w: [2, 3, 4, 5, 6, 7, 8] });
    r = await member.req('POST', '/api/play', { action: 'complete', id: L2, w: [9, 10, 11, 12, 13, 14, 15] });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    assert.ok(r.data.done.indexOf(L2) >= 0);
    // junk part numbers are ignored
    await member.req('POST', '/api/play', { action: 'complete', id: L2, w: [-1, 99999, 'x'] });
  });
  await t('one-time repair: lectures finished before the fix are marked complete', async () => {
    const uid = '100000000000000010', c = client();
    await c.signIn(uid);
    const old = Date.parse('2026-11-22T12:00:00Z');
    mocks.store.delete('elevare:heal1:' + uid);
    mocks.store.delete('elevare:done:' + uid);
    mocks.store.set('elevare:start:' + uid + ':' + L1, String(old));
    mocks.store.set('elevare:start:' + uid + ':' + L2, String(old + 3600000));
    const me = await c.req('GET', '/api/me');
    assert.ok(me.data.done.indexOf(L1) >= 0 && me.data.done.indexOf(L2) >= 0, JSON.stringify(me.data.done));
    mocks.store.delete('elevare:done:' + uid);                         // only ever runs once
    assert.strictEqual((await c.req('GET', '/api/me')).data.done.length, 0);
  });
  await t('owner can unlock everything for a proven member', async () => {
    const sec = (await admin.req('POST', '/api/admin', { action: 'section-save', kind: 'lecture', title: 'Unlock Test' })).data.section.id;
    await readyLecture(sec, 'U1'); const u3 = await readyLecture(sec, 'U2');
    assert.strictEqual((await member.req('POST', '/api/play', { id: u3, device: 'deviceBBBB' })).status, 403);
    await admin.req('POST', '/api/admin', { action: 'unlock', uid: MEMBER });
    assert.strictEqual((await member.req('POST', '/api/play', { id: u3, device: 'deviceBBBB' })).status, 200);
    assert.strictEqual((await member.req('GET', '/api/me')).data.unlocked, true);
    await admin.req('POST', '/api/admin', { action: 'relock', uid: MEMBER });
  });
  await t('admins are never locked', async () => {
    const sec = (await admin.req('POST', '/api/admin', { action: 'section-save', kind: 'lecture', title: 'Admin Lock' })).data.section.id;
    await readyLecture(sec, 'A1'); const a2 = await readyLecture(sec, 'A2');
    assert.strictEqual((await admin.req('POST', '/api/play', { id: a2, device: 'deviceADMIN1' })).status, 200);
  });

  console.log('Spec: tiers, fresh checks, watermark, sessions');
  await t('tier lessons refuse members without that role', async () => {
    const sec = (await admin.req('POST', '/api/admin', { action: 'section-save', kind: 'breakdown', title: 'Tier Test' })).data.section.id;
    const id = await readyLecture(sec, 'Elite Only');
    assert.strictEqual((await admin.req('POST', '/api/admin', { action: 'item-save', id, sectionId: sec, title: 'Elite Only', tier: 'Nope' })).status, 400);
    await admin.req('POST', '/api/admin', { action: 'item-save', id, sectionId: sec, title: 'Elite Only', tier: 'Elite' });
    const r = await member.req('POST', '/api/play', { id, device: 'deviceBBBB' });
    assert.strictEqual(r.status, 403); assert.strictEqual(r.data.error, 'tier');
    mocks.users[MEMBER].roles = [mocks.ACCESS, 'role_elite'];
    assert.strictEqual((await member.req('POST', '/api/play', { id, device: 'deviceBBBB' })).status, 200);
    mocks.users[MEMBER].roles = [mocks.ACCESS];
  });
  await t('watermark carries name, ID, playback session ID and time', async () => {
    const r = await member.req('POST', '/api/play', { id: L1, device: 'deviceBBBB' });
    const ann = JSON.parse(mocks.otps[mocks.otps.length - 1].body.annotate);
    assert.strictEqual(ann.length, 6);
    const ob = mocks.otps[mocks.otps.length - 1].body;
    assert.strictEqual(ob.userId, MEMBER);
    assert.strictEqual(ob.whitelisthref, 'localhost');
    assert.ok(/^[A-Z2-9]{6}$/.test(ann[0].text) && ann[0].text === r.data.code);
    assert.strictEqual(ann[1].text, MEMBER);                       // faint mid-frame ID
    assert.strictEqual(ann[3].text, '@member');                    // ghost handle
    assert.ok(ann[4].text.indexOf(r.data.session) === 0);          // ghost session + time
    assert.ok(ann.every(a => Number(a.alpha) <= 0.4));             // nothing obvious
    assert.ok(ann.filter(a => a.type === 'rtext' && Number(a.size) >= 18).length >= 3); // sturdy ghosts
    const g = await admin.req('GET', '/api/admin');
    assert.strictEqual(g.data.plays[0].sid, r.data.session);
    assert.strictEqual(g.data.plays[0].code, r.data.code);
    process.env.WATERMARK_MODE = 'bold';
    const rb = await member.req('POST', '/api/play', { id: L1, device: 'deviceBBBB', take: true });
    assert.strictEqual(rb.status, 200, JSON.stringify(rb.data));
    const bold = JSON.parse(mocks.otps[mocks.otps.length - 1].body.annotate);
    delete process.env.WATERMARK_MODE;
    assert.strictEqual(bold[3].color, '0x3D6FB6'); assert.strictEqual(bold[4].text, 'member');
  });
  await t('role removed mid-session: the very next play is refused (no 5-min wait)', async () => {
    mocks.users[MEMBER].roles = [];
    const r = await member.req('POST', '/api/play', { id: L1, device: 'deviceBBBB' });
    assert.strictEqual(r.status, 403);
    mocks.users[MEMBER].roles = [mocks.ACCESS];
    assert.strictEqual(await member.signIn(MEMBER), '/');
  });
  await t('repeated refused requests raise an auth-failures alert', async () => {
    for (let i = 0; i < 5; i++) await member.req('POST', '/api/play', { id: 'nope' + i, device: 'deviceBBBB' });
    const g = await admin.req('GET', '/api/admin');
    assert.ok(g.data.alerts.some(a => a.kind === 'auth-failures' && a.uid === MEMBER));
  });
  await t('admin can sign a member out everywhere; sign-ins are logged', async () => {
    await admin.req('POST', '/api/admin', { action: 'revoke', uid: MEMBER });
    assert.strictEqual((await member.req('GET', '/api/me')).status, 401);
    const g = await admin.req('GET', '/api/admin');
    assert.ok(g.data.sessions.some(x => x.event === 'signin' && x.uid === MEMBER));
    assert.ok(g.data.sessions.some(x => x.event === 'revoked'));
    assert.strictEqual(await member.signIn(MEMBER), '/');
  });
  await t('Safari is always refused, even with ALLOW_SAFARI=1 set', async () => {
    assert.strictEqual(await client(SAFARI).signIn(MEMBER), '/?e=browser');
    process.env.ALLOW_SAFARI = '1';
    assert.strictEqual(await client(SAFARI).signIn(MEMBER), '/?e=browser');
    delete process.env.ALLOW_SAFARI;
    assert.strictEqual(await member.signIn(MEMBER), '/');
  });

  await t('admin can link a video already in VdoCipher', async () => {
    const g = await admin.req('GET', '/api/admin');
    const it = g.data.content.items.find(x => x.status === 'empty');
    assert.strictEqual((await admin.req('POST', '/api/admin', { action: 'link-video', id: it.id, videoId: 'nope' })).status, 400);
    assert.strictEqual((await admin.req('POST', '/api/admin', { action: 'link-video', id: it.id, videoId: 'f'.repeat(32) })).status, 400);
    mocks.videos['a'.repeat(32)] = { status: 'ready', length: 321 };
    const r = await admin.req('POST', '/api/admin', { action: 'link-video', id: it.id, videoId: 'a'.repeat(32) });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.data.item.status, 'ready');
  });

  await t('thumbnails are served to members without exposing the video id', async () => {
    const r = await fetch(BASE + '/api/poster?id=' + L1, { headers: { 'User-Agent': CHROME,
      Cookie: Object.keys(member.jar).map(k => k + '=' + member.jar[k]).join('; ') } });
    assert.strictEqual(r.status, 200);
    assert.ok(/image\/jpeg/.test(r.headers.get('content-type')));
    assert.strictEqual((await client().req('GET', '/api/poster?id=' + L1)).status, 401);
    const me = await member.req('GET', '/api/me');
    assert.ok(!/posterUrl|vdo\/poster/.test(me.text));
  });

  await t('login cookie ends with the browser; idle sessions expire', async () => {
    const c = client();
    const a = await fetch(BASE + '/api/login', { redirect: 'manual', headers: { 'User-Agent': CHROME } });
    const state = new URL(a.headers.get('location')).searchParams.get('state');
    const sc = a.headers.getSetCookie()[0].split(';')[0];
    const b = await fetch(BASE + '/api/callback?code=100000000000000008&state=' + encodeURIComponent(state),
      { redirect: 'manual', headers: { 'User-Agent': CHROME, Cookie: sc } });
    const sess = b.headers.getSetCookie().find(x => /^elevare_session=/.test(x));
    assert.ok(sess && !/Max-Age/i.test(sess), sess);
    for (const [k, v] of mocks.store) {
      if (/^elevare:sess:/.test(k)) { const s = JSON.parse(v); if (s.uid === '100000000000000008') { s.seen = Date.now() - 31 * 60000; mocks.store.set(k, JSON.stringify(s)); } }
    }
    c.jar.elevare_session = sess.split(';')[0].split('=')[1];
    const r = await c.req('GET', '/api/me');
    assert.strictEqual(r.status, 401); assert.strictEqual(r.data.error, 'idle');
  });

  await t('only Lectures and Breakdowns exist (Q&A / Random refused)', async () => {
    for (const kind of ['qna', 'random', 'other']) {
      const r = await admin.req('POST', '/api/admin', { action: 'section-save', kind, title: kind + ' sec' });
      assert.strictEqual(r.status, 400); assert.strictEqual(r.data.error, 'kind');
    }
    const sec = (await admin.req('POST', '/api/admin', { action: 'section-save', kind: 'breakdown', title: 'bd sec' })).data.section;
    assert.strictEqual(sec.kind, 'breakdown');
    await readyLecture(sec.id, 'bd one');
    await readyLecture(sec.id, 'bd two');
    const all = (await member.req('GET', '/api/me')).data.items.filter(x => x.kind === 'breakdown');
    assert.strictEqual((await member.req('POST', '/api/play', { id: all[all.length - 1].id, device: 'deviceBBBB' })).status, 200);
  });
  await t('admin test alert posts to the webhook', async () => {
    mocks.hooks.length = 0;
    assert.strictEqual((await admin.req('POST', '/api/admin', { action: 'test-alert' })).status, 200);
    assert.strictEqual(mocks.hooks.length, 1);
    assert.ok(/Test alert/.test(mocks.hooks[0].content));
    assert.strictEqual((await member.req('POST', '/api/admin', { action: 'test-alert' })).status, 403);
  });

  await t('binge starting and country hopping raise alerts', async () => {
    const sec = (await admin.req('POST', '/api/admin', { action: 'section-save', kind: 'breakdown', title: 'Binge' })).data.section.id;
    const ids = [];
    for (let i = 0; i < 8; i++) ids.push(await readyLecture(sec, 'B' + i));
    for (let i = 0; i < 8; i++) {
      await member.req('POST', '/api/play', { id: ids[i], device: 'deviceBBBB' },
        { 'X-Vercel-IP-Country': i < 4 ? 'US' : 'NL' });
    }
    const g = await admin.req('GET', '/api/admin');
    assert.ok(g.data.alerts.some(a => a.kind === 'binge' && a.uid === MEMBER));
    assert.ok(g.data.alerts.some(a => a.kind === 'geo-anomaly' && /US, NL|NL, US/.test(a.detail)));
    assert.strictEqual(g.data.plays[0].country, 'NL');
  });

  await t('members must agree to the rules before playing; edits require re-agreeing', async () => {
    const c = client(); c.signIn.skipAgree = true;
    assert.strictEqual(await c.signIn('100000000000000009'), '/');
    const me = await c.req('GET', '/api/me');
    assert.strictEqual(me.data.agreed, false);
    assert.ok(/[A-Z2-9]{6}/.test(me.data.rules.text) && me.data.rules.text.indexOf('{CODE}') < 0);
    assert.strictEqual((await c.req('POST', '/api/play', { id: L1, device: 'deviceCCCC' })).data.error, 'agree');
    assert.strictEqual((await c.req('POST', '/api/me', { action: 'agree', v: 999 })).status, 409);
    assert.strictEqual((await c.req('POST', '/api/me', { action: 'agree', v: me.data.rules.v })).status, 200);
    assert.strictEqual((await c.req('GET', '/api/me')).data.agreed, true);
    await admin.req('POST', '/api/admin', { action: 'rules-save', text: 'New rule one.\nNew rule two.' });
    assert.strictEqual((await c.req('GET', '/api/me')).data.agreed, false);
    const g = await admin.req('GET', '/api/admin');
    assert.ok(g.data.agreements['100000000000000009'].ip);
    // re-agree the main member so later tests can play
    const mm = await member.req('GET', '/api/me');
    await member.req('POST', '/api/me', { action: 'agree', v: mm.data.rules.v });
  });
  await t('two developer-tools catches in an hour = 10-minute timeout; admin can lift it', async () => {
    await member.req('POST', '/api/me', { action: 'flag', kind: 'devtools', detail: 'test 1' });
    const r = await member.req('POST', '/api/me', { action: 'flag', kind: 'devtools', detail: 'test 2' });
    assert.strictEqual(r.data.timeout, 600);
    const me = await member.req('GET', '/api/me');
    assert.strictEqual(me.status, 403); assert.strictEqual(me.data.error, 'timeout'); assert.ok(me.data.wait > 590);
    assert.strictEqual((await member.req('POST', '/api/play', { id: L1, device: 'deviceBBBB' })).data.error, 'timeout');
    await admin.req('POST', '/api/admin', { action: 'untimeout', uid: MEMBER });
    assert.strictEqual((await member.req('GET', '/api/me')).status, 200);
    for (const k of Array.from(mocks.store.keys())) if (/^elevare:hook:/.test(k)) mocks.store.delete(k);
  });

  await t('evidence trail: email, new-account, shared browser, payment note, full report', async () => {
    const fresh = Object.keys(mocks.users).find(k => mocks.users[k].username === 'fresh');
    const c = client();
    assert.strictEqual(await c.signIn(fresh), '/');
    let g = await admin.req('GET', '/api/admin');
    assert.strictEqual(g.data.users[fresh].email, 'fresh@example.com');
    assert.ok(g.data.alerts.some(x => x.kind === 'new-account' && x.uid === fresh));
    // same browser as the main member -> shared-device
    await admin.req('POST', '/api/admin', { action: 'unlock', uid: fresh });
    assert.strictEqual((await c.req('POST', '/api/play', { id: L1, device: 'deviceBBBB' })).status, 200);
    g = await admin.req('GET', '/api/admin');
    assert.ok(g.data.alerts.some(x => x.kind === 'shared-device' && x.uid === fresh));
    await admin.req('POST', '/api/admin', { action: 'member-note', uid: fresh, pay: 'pi_123', note: 'paid via Whop' });
    g = await admin.req('GET', '/api/admin');
    assert.strictEqual(g.data.notes[fresh].pay, 'pi_123');
    const r = await admin.req('GET', '/api/admin?evidence=' + fresh);
    assert.strictEqual(r.data.user.email, 'fresh@example.com');
    assert.strictEqual(r.data.note.pay, 'pi_123');
    assert.ok(r.data.history.some(x => x.type === 'play'));
    assert.ok(r.data.history.some(x => x.type === 'session' && x.event === 'signin'));
    assert.ok(r.data.history.some(x => x.type === 'alert' && x.kind === 'shared-device'));
    assert.strictEqual((await member.req('GET', '/api/admin?evidence=' + fresh)).status, 403);
    for (const k of Array.from(mocks.store.keys())) if (/^elevare:hook:/.test(k)) mocks.store.delete(k);
  });

  await t('admin powers need Discord two-factor', async () => {
    const c = client();
    assert.strictEqual(await c.signIn('100000000000000010'), '/');
    const me = await c.req('GET', '/api/me');
    assert.strictEqual(me.data.isAdmin, false); assert.strictEqual(me.data.needsMfa, true);
    assert.strictEqual((await c.req('GET', '/api/admin')).status, 403);
  });
  await t('only the real site host serves members; previews refused', async () => {
    process.env.SITE_HOSTS = 'elevare.example,www.elevare.example';
    assert.strictEqual((await member.req('GET', '/api/me')).data.error, 'host');
    delete process.env.SITE_HOSTS;
    process.env.VERCEL_ENV = 'preview';
    assert.strictEqual((await member.req('GET', '/api/me')).data.error, 'host');
    delete process.env.VERCEL_ENV;
    assert.strictEqual((await member.req('GET', '/api/me')).status, 200);
  });
  await t('device limit: a 4th browser is refused until the admin resets', async () => {
    const c = client(); await c.signIn('100000000000000009');
    await admin.req('POST', '/api/admin', { action: 'unlock', uid: '100000000000000009' });
    for (const d of ['devAAAAAAAA1', 'devAAAAAAAA2', 'devAAAAAAAA3']) {
      assert.strictEqual((await c.req('POST', '/api/play', { id: L1, device: d, take: true })).status, 200);
    }
    const r = await c.req('POST', '/api/play', { id: L1, device: 'devAAAAAAAA4', take: true });
    assert.strictEqual(r.status, 403); assert.strictEqual(r.data.error, 'device_limit');
    const ev = await admin.req('GET', '/api/admin?evidence=100000000000000009');
    assert.strictEqual(Object.keys(ev.data.devices).length, 3);
    const g = await admin.req('GET', '/api/admin');
    assert.ok(g.data.live.some(x => x.uid === '100000000000000009'));
    await admin.req('POST', '/api/admin', { action: 'devices-reset', uid: '100000000000000009' });
    assert.strictEqual((await c.req('POST', '/api/play', { id: L1, device: 'devAAAAAAAA4', take: true })).status, 200);
    for (const k of Array.from(mocks.store.keys())) if (/^elevare:hook:/.test(k)) mocks.store.delete(k);
  });

  await t('recorder extension on the page is logged and pings; other extensions only logged', async () => {
    await member.req('POST', '/api/me', { action: 'flag', kind: 'extension', detail: 'div#caprec-widget | text: 00:03' });
    await member.req('POST', '/api/me', { action: 'flag', kind: 'extension', detail: 'div.some-helper | text: ' });
    const g = await admin.req('GET', '/api/admin');
    assert.ok(g.data.alerts.some(x => x.kind === 'recorder-extension'));
    assert.ok(g.data.alerts.some(x => x.kind === 'extension'));
    for (const k of Array.from(mocks.store.keys())) if (/^elevare:hook:/.test(k)) mocks.store.delete(k);
  });

  await t('built-in app browsers posing as Chrome are refused and ping admins', async () => {
    const r = await member.req('POST', '/api/play', { id: L1, device: 'deviceBBBB' },
      { 'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"' });
    assert.strictEqual(r.status, 403); assert.strictEqual(r.data.error, 'browser');
    const ok = await member.req('POST', '/api/play', { id: L1, device: 'deviceBBBB', take: true },
      { 'sec-ch-ua': '"Chromium";v="131", "Google Chrome";v="131", "Not_A Brand";v="24"' });
    assert.notStrictEqual(ok.data.error, 'browser');
    const brave = await member.req('POST', '/api/play', { id: L1, device: 'deviceBBBB', take: true },
      { 'sec-ch-ua': '"Chromium";v="136", "Brave";v="136", "Not.A/Brand";v="99"' });
    assert.notStrictEqual(brave.data.error, 'browser');
    const g = await admin.req('GET', '/api/admin');
    assert.ok(g.data.alerts.some(x => x.kind === 'embedded-browser'));
    for (const k of Array.from(mocks.store.keys())) if (/^elevare:hook:/.test(k)) mocks.store.delete(k);
  });

  await t('VPN / hosting networks are flagged in the log (no block, no ping)', async () => {
    const vpnIp = { 'x-vercel-forwarded-for': '146.70.201.50' };
    const r = await member.req('POST', '/api/play', { id: L1, device: 'deviceBBBB', take: true }, vpnIp);
    assert.strictEqual(r.status, 200);
    const g = await admin.req('GET', '/api/admin');
    const v = g.data.alerts.find(x => x.kind === 'vpn');
    assert.ok(v && /M247/.test(v.detail));
    await member.req('POST', '/api/play', { id: L1, device: 'deviceBBBB', take: true }, vpnIp);
    const g2 = await admin.req('GET', '/api/admin');
    assert.strictEqual(g2.data.alerts.filter(x => x.kind === 'vpn').length, 1); // once a day
    for (const k of Array.from(mocks.store.keys())) if (/^elevare:hook:/.test(k)) mocks.store.delete(k);
  });

  await t('captions: upload Korean (SRT converted to VTT) and Japanese, replace, remove', async () => {
    const srt = '1\r\n00:00:01,000 --> 00:00:03,500\r\n\uc548\ub155\ud558\uc138\uc694\r\n';
    let r = await admin.req('POST', '/api/admin', { action: 'caption-upload', id: L1, lang: 'ko', text: srt });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    r = await admin.req('POST', '/api/admin', { action: 'caption-upload', id: L1, lang: 'ja',
      text: 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n\u3053\u3093\u306b\u3061\u306f\n' });
    assert.deepStrictEqual(r.data.captions.map(x => x.lang).sort(), ['ja', 'ko']);
    r = await admin.req('POST', '/api/admin', { action: 'caption-upload', id: L1, lang: 'ko', text: srt });
    assert.strictEqual(r.data.captions.filter(x => x.lang === 'ko').length, 1);      // replaced, not doubled
    assert.strictEqual((await admin.req('POST', '/api/admin',
      { action: 'caption-upload', id: L1, lang: 'ko', text: 'not a subtitle' })).data.error, 'format');
    const ja = r.data.captions.find(x => x.lang === 'ja');
    r = await admin.req('POST', '/api/admin', { action: 'caption-delete', id: L1, fileId: ja.id });
    assert.deepStrictEqual(r.data.captions.map(x => x.lang), ['ko']);
    assert.strictEqual((await member.req('POST', '/api/admin', { action: 'captions-list', id: L1 })).status, 403);
    assert.strictEqual(require('../api/_lib').toVtt('1\n00:00:01,000 --> 00:00:02,000\nhi').indexOf('WEBVTT\n\n1\n00:00:01.000'), 0);
  });

  let c9;
  await t('video keys expire in 90 s; keys taken without watching ping admins', async () => {
    const c = c9 = client(); await c.signIn('100000000000000009');
    await admin.req('POST', '/api/admin', { action: 'unlock', uid: '100000000000000009' });
    await admin.req('POST', '/api/admin', { action: 'devices-reset', uid: '100000000000000009' });
    mocks.store.delete('elevare:ps:100000000000000009'); mocks.store.delete('elevare:nowatch:100000000000000009');
    // a watched session: heartbeat carries the session id
    const r = await c.req('POST', '/api/play', { id: L1, device: 'devAAAAAAAA1', take: true });
    assert.strictEqual(mocks.otps[mocks.otps.length - 1].body.ttl, 90);
    await c.req('POST', '/api/play', { device: 'devAAAAAAAA1', beat: true, s: r.data.session });
    // five keys never played, all "older than 2 minutes"
    for (let i = 0; i < 5; i++) await c.req('POST', '/api/play', { id: L1, device: 'devAAAAAAAA1', take: true });
    const pk = 'elevare:ps:100000000000000009';
    mocks.store.set(pk, mocks.store.get(pk).map(x => x.split('|')[0] + '|' + (Date.now() - 600000)));
    await c.req('POST', '/api/play', { id: L1, device: 'devAAAAAAAA1', take: true });
    const g = await admin.req('GET', '/api/admin');
    assert.ok(g.data.alerts.some(x => x.kind === 'keys-no-watch' && x.uid === '100000000000000009'));
    for (const k of Array.from(mocks.store.keys())) if (/^vault:hook:/.test(k)) mocks.store.delete(k);
  });
  await t('daily cap on different videos (admins exempt)', async () => {
    process.env.DAILY_VIDEO_LIMIT = '2';
    const c = c9;
    const day = new Date().toISOString().slice(0, 10);
    mocks.store.delete('elevare:dv:100000000000000009:' + day);
    assert.strictEqual((await c.req('POST', '/api/play', { id: L1, device: 'devAAAAAAAA1', take: true })).status, 200);
    assert.strictEqual((await c.req('POST', '/api/play', { id: L2, device: 'devAAAAAAAA1', take: true })).status, 200);
    assert.strictEqual((await c.req('POST', '/api/play', { id: L1, device: 'devAAAAAAAA1', take: true })).status, 200); // same video again is fine
    const sec = (await admin.req('POST', '/api/admin', { action: 'section-save', kind: 'lecture', title: 'Cap Test' })).data.section.id;
    const L9 = await readyLecture(sec, 'Cap Three');
    const r = await c.req('POST', '/api/play', { id: L9, device: 'devAAAAAAAA1', take: true });
    assert.strictEqual(r.status, 429); assert.strictEqual(r.data.error, 'daily_limit');
    delete process.env.DAILY_VIDEO_LIMIT;
    for (const k of Array.from(mocks.store.keys())) if (/^vault:hook:/.test(k)) mocks.store.delete(k);
  });

  await t('a trusted VPN member gets no VPN / country alerts; others still do', async () => {
    const vpnIp = { 'x-vercel-forwarded-for': '146.70.201.77' };
    await admin.req('POST', '/api/admin', { action: 'vpn-trust', uid: MEMBER, on: true });
    const before = (await admin.req('GET', '/api/admin')).data.alerts.filter(x => x.kind === 'vpn' && x.uid === MEMBER).length;
    mocks.store.delete('elevare:vpnseen:' + MEMBER + ':AS9009');
    await member.req('POST', '/api/play', { id: L1, device: 'deviceBBBB', take: true }, vpnIp);
    const g = await admin.req('GET', '/api/admin');
    assert.strictEqual(g.data.alerts.filter(x => x.kind === 'vpn' && x.uid === MEMBER).length, before);
    assert.ok(g.data.vpnok.indexOf(MEMBER) >= 0);
    process.env.LOCK_OTP_IP = '1';
    await member.req('POST', '/api/play', { id: L1, device: 'deviceBBBB', take: true },
      { 'x-vercel-forwarded-for': '146.70.201.77' });
    assert.ok(!mocks.otps[mocks.otps.length - 1].body.ipGeo);      // trusted: no IP lock
    await admin.req('POST', '/api/admin', { action: 'vpn-trust', uid: MEMBER, on: false });
    await member.req('POST', '/api/play', { id: L1, device: 'deviceBBBB', take: true },
      { 'x-vercel-forwarded-for': '146.70.201.77' });
    assert.deepStrictEqual(mocks.otps[mocks.otps.length - 1].body.ipGeo, { allow: ['146.70.201.77'] });
    delete process.env.LOCK_OTP_IP;
    await member.req('POST', '/api/play', { id: L1, device: 'deviceBBBB', take: true }, vpnIp);
    assert.ok((await admin.req('GET', '/api/admin')).data.alerts.filter(x => x.kind === 'vpn' && x.uid === MEMBER).length > before);
  });

  await t('admin can allow extensions for one member', async () => {
    assert.strictEqual((await member.req('GET', '/api/me')).data.relaxed, false);
    await admin.req('POST', '/api/admin', { action: 'relax', uid: MEMBER, on: true });
    assert.strictEqual((await member.req('GET', '/api/me')).data.relaxed, true);
    assert.ok((await admin.req('GET', '/api/admin')).data.relaxed.indexOf(MEMBER) >= 0);
    await admin.req('POST', '/api/admin', { action: 'relax', uid: MEMBER, on: false });
    assert.strictEqual((await member.req('GET', '/api/me')).data.relaxed, false);
  });

  console.log('Discord alerts (rip intent only)');
  await t('devtools / save-page attempts post to Discord with an admin ping', async () => {
    mocks.hooks.length = 0;
    await member.req('POST', '/api/me', { action: 'flag', kind: 'devtools', detail: 'debugger pause detected' });
    await member.req('POST', '/api/me', { action: 'flag', kind: 'blocked-action', detail: 'Save page' });
    assert.strictEqual(mocks.hooks.length, 2);
    const h = mocks.hooks[0];
    assert.ok(h.content.indexOf('<@&role_owner>') === 0);
    assert.deepStrictEqual(h.allowed_mentions.roles, ['role_owner']);
    assert.ok(h.embeds[0].fields.some(f => f.value === MEMBER));
  });
  await t('harmless events are logged but not posted (right-click, device switch)', async () => {
    mocks.hooks.length = 0;
    await member.req('POST', '/api/me', { action: 'flag', kind: 'blocked-action', detail: 'Right-click' });
    await member.req('POST', '/api/play', { id: L1, device: 'deviceZZZZ', take: true });
    assert.strictEqual(mocks.hooks.length, 0);
    const g = await admin.req('GET', '/api/admin');
    assert.ok(g.data.alerts.some(a => a.detail === 'Right-click'));
  });
  await t('repeat attempts within 10 minutes post only once', async () => {
    mocks.hooks.length = 0;
    await member.req('POST', '/api/me', { action: 'flag', kind: 'printscreen' });
    await member.req('POST', '/api/me', { action: 'flag', kind: 'printscreen' });
    assert.strictEqual(mocks.hooks.length, 1);
  });

  console.log('Journal');
  const J = (who, body) => who.req('POST', '/api/journal', body);
  await t('a new journal starts with only the starter sections', async () => {
    const r = await J(member, { action: 'index' });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.data.cats, ['Trade Journal', 'Markups', 'Daily Thesis']);
    assert.deepStrictEqual(r.data.chans.map(c => c.cat + '/' + c.name),
      ['Trade Journal/trade-executions', 'Markups/markups', 'Daily Thesis/daily-thesis']);
    assert.ok(r.data.chans.every(c => c.n === 0));
  });
  await t('members make, rename and delete their own categories', async () => {
    const c = await J(member, { action: 'cat', name: 'Psychology' });
    assert.ok(c.data.cats.includes('Psychology'));
    const ch = await J(member, { action: 'chan', cat: 'Psychology', name: 'Tilt log' });
    assert.strictEqual(ch.data.chan.cat, 'Psychology');
    await J(member, { action: 'renamecat', from: 'Psychology', name: 'Mindset' });
    let ix = await J(member, { action: 'index' });
    assert.strictEqual(ix.data.chans.find(x => x.id === ch.data.chan.id).cat, 'Mindset');
    await J(member, { action: 'delcat', name: 'Mindset' });
    ix = await J(member, { action: 'index' });
    assert.ok(!ix.data.cats.includes('Mindset'));
    assert.ok(!ix.data.chans.some(x => x.id === ch.data.chan.id));
  });
  let thesis;
  await t('channels hold entries: post, edit, delete, in order', async () => {
    const ix = await J(member, { action: 'index' });
    thesis = ix.data.chans.find(c => c.name === 'daily-thesis').id;
    const id = 'a1b2c3d4e5f6';
    const p1 = await J(member, { action: 'post', ch: thesis, id, x: '# Monday\n- bias long\n\n\n' });
    assert.strictEqual(p1.status, 200);
    assert.strictEqual(p1.data.entry.id, id);            // the page's own id is kept
    assert.strictEqual(p1.data.entry.x, '# Monday\n- bias long');
    const again = await J(member, { action: 'post', ch: thesis, id, x: '# Monday\n- bias long' });
    assert.strictEqual(again.data.entry.at, p1.data.entry.at);   // a retry is stored once
    await J(member, { action: 'post', ch: thesis, x: 'Second <b>entry</b>' });
    let o = await J(member, { action: 'open', ch: thesis });
    assert.deepStrictEqual(o.data.entries.map(e => e.x), ['# Monday\n- bias long', 'Second <b>entry</b>']);
    await J(member, { action: 'edit', ch: thesis, id, x: '# Monday\n- bias short' });
    o = await J(member, { action: 'open', ch: thesis });
    assert.ok(o.data.entries[0].ed && /short/.test(o.data.entries[0].x));
    const second = o.data.entries[1].id;
    await J(member, { action: 'del', ch: thesis, id: second });
    o = await J(member, { action: 'open', ch: thesis });
    assert.strictEqual(o.data.entries.length, 1);
    const ix2 = await J(member, { action: 'index' });
    assert.strictEqual(ix2.data.chans.find(c => c.id === thesis).n, 1);
    assert.strictEqual((await J(member, { action: 'post', ch: thesis, x: '   ' })).status, 400);
  });
  await t('pasted screenshots are stored and attached to an entry', async () => {
    const img = 'data:image/png;base64,' + Buffer.from('chart-shot').toString('base64');
    const up = await J(member, { action: 'upimg', data: img });
    assert.strictEqual(up.status, 200);
    assert.strictEqual((await J(member, { action: 'upimg', data: 'data:text/html;base64,AAAA' })).status, 400);
    const p = await J(member, { action: 'post', ch: thesis, x: '', im: [up.data.id] });
    assert.deepStrictEqual(p.data.entry.im, [up.data.id]);
    assert.strictEqual((await J(member, { action: 'img', id: up.data.id })).data.image, img);
    await J(member, { action: 'del', ch: thesis, id: p.data.entry.id });
    assert.strictEqual((await J(member, { action: 'img', id: up.data.id })).data.image, null);
  });
  await t('notes under a video land in that video’s own channel, with the moment', async () => {
    const s1 = await J(member, { action: 'post', vid: L1, x: 'Wait for the second touch.', vt: 754.6 });
    assert.strictEqual(s1.status, 200);
    assert.strictEqual(s1.data.entry.vt, 754);
    assert.ok(s1.data.chan.vid === L1 && s1.data.chan.cat === 'Lectures' && s1.data.chan.name === 'lock-one');
    await J(member, { action: 'post', vid: L1, x: '[ ] Rewatch the open' });
    const v = await J(member, { action: 'video', vid: L1 });
    assert.strictEqual(v.data.chan.id, s1.data.chan.id);
    assert.deepStrictEqual(v.data.entries.map(e => e.x), ['Wait for the second touch.', '[ ] Rewatch the open']);
    const ix = await J(member, { action: 'index' });
    assert.strictEqual(ix.data.chans.filter(c => c.vid === L1).length, 1);
  });
  await t('search finds words inside entries', async () => {
    const r = await J(member, { action: 'search', q: 'SECOND touch' });
    assert.strictEqual(r.data.hits.length, 1);
    assert.ok(/second touch/.test(r.data.hits[0].snippet));
  });
  await t('a journal from before (pages) turns into entries, nothing lost', async () => {
    const uid = '100000000000000009';
    const ix = { v: 2, cats: ['Daily Thesis'], chans: [{ id: 'aaaaaaaaaaaa', cat: 'Daily Thesis',
      name: 'daily-thesis' }], pages: [{ id: 'bbbbbbbbbbbb', ch: 'aaaaaaaaaaaa', title: 'Monday',
      up: 1000 }, { id: 'cccccccccccc', ch: 'aaaaaaaaaaaa', title: '', up: 2000 }] };
    mocks.store.set('elevare:jr:' + uid, JSON.stringify(ix));
    mocks.store.set('elevare:jp:' + uid + ':bbbbbbbbbbbb', JSON.stringify({ blocks: [
      { t: 'p', x: 'Calm open.' }, { t: 'li', x: 'one' }, { t: 'todo', x: 'two', c: 1 }] }));
    mocks.store.set('elevare:jp:' + uid + ':cccccccccccc', JSON.stringify({ blocks: [
      { t: 'quote', x: 'Patience.' }] }));
    const old = client(); assert.strictEqual(await old.signIn(uid), '/');
    const r = await J(old, { action: 'index' });
    assert.strictEqual(r.data.chans[0].n, 2);
    const o = await J(old, { action: 'open', ch: 'aaaaaaaaaaaa' });
    assert.deepStrictEqual(o.data.entries.map(e => e.x),
      ['# Monday\nCalm open.\n- one\n[x] two', '> Patience.']);
    assert.ok(!mocks.store.has('elevare:jp:' + uid + ':bbbbbbbbbbbb'));
  });
  await t('one member can’t read another member’s journal', async () => {
    const other = client(); assert.strictEqual(await other.signIn('100000000000000008'), '/');
    assert.strictEqual((await J(other, { action: 'open', ch: thesis, u: MEMBER })).status, 403);
    assert.strictEqual((await J(other, { action: 'members' })).status, 403);
    assert.strictEqual((await J(other, { action: 'open', ch: thesis })).status, 404);
    const v = await J(other, { action: 'video', vid: L1 });
    assert.deepStrictEqual(v.data.entries, []);
  });
  await t('admins read every journal for reviews, but never write to it', async () => {
    const m = await J(admin, { action: 'members' });
    const me = m.data.members.find(x => x.uid === MEMBER);
    assert.ok(me && me.n >= 3 && me.name);
    const ix = await J(admin, { action: 'index', u: MEMBER });
    assert.ok(ix.data.chans.some(c => c.id === thesis));
    const o = await J(admin, { action: 'open', ch: thesis, u: MEMBER });
    assert.strictEqual(o.data.entries.length, 1);
    const f = await J(admin, { action: 'feed', u: MEMBER, since: Date.now() - 86400000 });
    assert.ok(f.data.items.length >= 3 && f.data.items.every(i => i.ch && i.e.at));
    assert.strictEqual((await J(admin, { action: 'post', ch: thesis, x: 'hi', u: MEMBER })).status, 403);
    assert.strictEqual((await J(admin, { action: 'index', u: '100000000000000077' })).status, 404);
  });
  await t('journal needs a signed-in member', async () => {
    assert.strictEqual((await client().req('POST', '/api/journal', { action: 'index' })).status, 401);
  });

  console.log('News');
  await t('the week comes from the feed, cleaned (bad rows dropped, no HTML)', async () => {
    mocks.news.hits = 0; mocks.store.delete('elevare:news:ff');
    const r = await member.req('POST', '/api/news', {});
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.source, 'Forex Factory');
    assert.ok(r.data.items.length >= 10);
    assert.ok(r.data.items.every(x => x.at && x.title && !/[<>]/.test(x.title)));
    assert.ok(!r.data.items.some(x => /Bad/.test(x.title)));
    const nfp = r.data.items.find(x => x.title === 'Non-Farm Employment Change');
    assert.strictEqual(nfp.cur, 'USD'); assert.strictEqual(nfp.impact, 'High');
    assert.ok(r.data.items.every((x, i, a) => !i || a[i - 1].at <= x.at));
  });
  await t('the feed is asked once per 30 minutes, and kept if it goes down', async () => {
    const before = mocks.news.hits;
    await member.req('POST', '/api/news', {});
    await admin.req('POST', '/api/news', {});
    assert.strictEqual(mocks.news.hits, before);
    const c = JSON.parse(mocks.store.get('elevare:news:ff'));
    c.t = Date.now() - 31 * 60 * 1000; mocks.store.set('elevare:news:ff', JSON.stringify(c));
    mocks.store.delete('elevare:news:lock');
    mocks.news.down = true;
    const r = await member.req('POST', '/api/news', {});
    mocks.news.down = false;
    assert.strictEqual(r.status, 200);
    assert.ok(r.data.items.length >= 10);
  });
  await t('news needs a signed-in member', async () => {
    assert.strictEqual((await client().req('POST', '/api/news', {})).status, 401);
  });

  console.log('Payouts');
  const PNG = 'data:image/png;base64,' + Buffer.from('payout-proof-one').toString('base64');
  let poId;
  await t('a member submits a payout and sees it in review', async () => {
    const r = await member.req('POST', '/api/payouts', { action: 'submit', amount: 2500.5,
      firm: 'Topstep', date: '2026-11-20', image: PNG, show: true });
    assert.strictEqual(r.status, 200);
    poId = r.data.item.id;
    const m = await member.req('POST', '/api/payouts', { action: 'mine' });
    assert.strictEqual(m.data.list[0].status, 'pending');
    assert.strictEqual(m.data.list[0].amount, 2500.5);
  });
  await t('bad payouts are refused (no proof, bad amount, duplicate image)', async () => {
    const base = { action: 'submit', amount: 100, firm: 'Apex', date: '2026-11-20' };
    assert.strictEqual((await member.req('POST', '/api/payouts', Object.assign({}, base,
      { image: 'data:text/html;base64,PHNjcmlwdD4=' }))).status, 400);
    assert.strictEqual((await member.req('POST', '/api/payouts', Object.assign({}, base,
      { amount: -5, image: PNG }))).status, 400);
    assert.strictEqual((await member.req('POST', '/api/payouts', Object.assign({}, base,
      { image: PNG }))).status, 409);
  });
  await t('pending payouts stay off the leaderboard', async () => {
    const b = await member.req('POST', '/api/payouts', { action: 'board' });
    assert.strictEqual(b.data.total, 0);
  });
  await t('only admins see the review queue', async () => {
    assert.strictEqual((await member.req('POST', '/api/payouts', { action: 'queue' })).status, 403);
    assert.strictEqual((await member.req('POST', '/api/payouts', { action: 'review', id: poId, ok: true })).status, 403);
    const q = await admin.req('POST', '/api/payouts', { action: 'queue' });
    assert.ok(q.data.pending.some(p => p.id === poId));
  });
  await t('approved payouts feed the leaderboard and the proof opens', async () => {
    await admin.req('POST', '/api/payouts', { action: 'review', id: poId, ok: true, note: 'Nice' });
    const b = await member.req('POST', '/api/payouts', { action: 'board' });
    assert.strictEqual(b.data.total, 2500.5);
    assert.strictEqual(b.data.rows[0].uid, MEMBER);
    const other = client(); assert.strictEqual(await other.signIn('100000000000000008'), '/');
    const img = await other.req('POST', '/api/payouts', { action: 'img', id: poId });
    assert.strictEqual(img.data.image, PNG);
  });
  await t('several proofs, each with an amount, add up to one payout', async () => {
    const shot = k => 'data:image/png;base64,' + Buffer.from('multi-proof-' + k).toString('base64');
    const ids = [];
    for (const k of [1, 2, 3]) {
      const u = await member.req('POST', '/api/payouts', { action: 'upimg', image: shot(k) });
      assert.strictEqual(u.status, 200); ids.push(u.data.id);
    }
    assert.strictEqual((await member.req('POST', '/api/payouts', { action: 'upimg',
      image: 'data:text/html;base64,AAAA' })).status, 400);
    const r = await member.req('POST', '/api/payouts', { action: 'submit', firm: 'Lucid Trading',
      date: '2026-11-21', show: true, parts: [{ id: ids[0], amount: 1000 },
        { id: ids[1], amount: 250.5 }, { id: ids[2], amount: 749.5 }] });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.item.amount, 2000);
    assert.strictEqual(r.data.item.n, 3);
    assert.deepStrictEqual(r.data.item.parts, [1000, 250.5, 749.5]);
    const im = await admin.req('POST', '/api/payouts', { action: 'img', id: r.data.item.id, n: 2 });
    assert.strictEqual(im.data.image, shot(3)); assert.strictEqual(im.data.count, 3);
    // drafts are used up, and the same screenshot can't be used twice
    assert.strictEqual((await member.req('POST', '/api/payouts', { action: 'submit', firm: 'X',
      date: '2026-11-21', parts: [{ id: ids[0], amount: 5 }] })).data.error, 'image_gone');
    const again = await member.req('POST', '/api/payouts', { action: 'upimg', image: shot(2) });
    assert.strictEqual((await member.req('POST', '/api/payouts', { action: 'submit', firm: 'X',
      date: '2026-11-21', parts: [{ id: again.data.id, amount: 5 }] })).data.error, 'duplicate');
    // every part needs an amount
    const one = await member.req('POST', '/api/payouts', { action: 'upimg', image: shot(9) });
    assert.strictEqual((await member.req('POST', '/api/payouts', { action: 'submit', firm: 'X',
      date: '2026-11-21', parts: [{ id: one.data.id, amount: 0 }] })).data.error, 'amount');
    // another member can't use these drafts
    const other = client(); await other.signIn('100000000000000008');
    assert.strictEqual((await other.req('POST', '/api/payouts', { action: 'submit', firm: 'X',
      date: '2026-11-21', parts: [{ id: one.data.id, amount: 5 }] })).data.error, 'image_gone');
    await admin.req('POST', '/api/payouts', { action: 'remove', id: r.data.item.id });
    assert.strictEqual(mocks.store.has('elevare:poi:' + r.data.item.id + ':2'), false);
  });
  await t('hiding from the leaderboard keeps the total but drops the name', async () => {
    await member.req('POST', '/api/payouts', { action: 'show', id: poId, show: false });
    const b = await member.req('POST', '/api/payouts', { action: 'board' });
    assert.strictEqual(b.data.total, 2500.5);
    assert.strictEqual(b.data.rows.length, 0);
    const other = client(); await other.signIn('100000000000000008');
    assert.strictEqual((await other.req('POST', '/api/payouts', { action: 'img', id: poId })).status, 404);
  });

  console.log('Notifications');
  const bell = async c => (await c.req('POST', '/api/notify', { action: 'list' })).data;
  await t('admins are told when a payout is waiting; members are not', async () => {
    const a = await bell(admin);
    assert.ok(a.items.some(n => n.kind === 'payout-new' && n.tab === 'admin'));
    const m = await bell(member);
    assert.ok(!m.items.some(n => n.kind === 'payout-new'));
  });
  await t('the member hears back when their payout is reviewed', async () => {
    const m = await bell(member);
    const n = m.items.find(x => x.kind === 'payout-ok');
    assert.ok(n && /Topstep/.test(n.body) && /Nice/.test(n.body));
    const other = client(); await other.signIn('100000000000000008');
    assert.ok(!(await bell(other)).items.some(x => x.kind === 'payout-ok'));
  });
  await t('announcements reach everyone', async () => {
    await admin.req('POST', '/api/admin', { action: 'announce', text: 'Live at 9:15 tomorrow' });
    const m = await bell(member);
    assert.ok(m.items.some(n => n.kind === 'announce' && n.body === 'Live at 9:15 tomorrow'));
  });
  await t('a newly published video notifies everyone once', async () => {
    const before = (await bell(member)).items.filter(n => n.kind === 'content').length;
    const sid = (await admin.req('POST', '/api/admin', { action: 'section-save', kind: 'lecture',
      title: 'Bell Section' })).data.section.id;
    const id = await readyLecture(sid, 'Bell Lecture');
    await admin.req('POST', '/api/admin', { action: 'status' });   // a second save: no repeat
    const after = (await bell(member)).items.filter(n => n.kind === 'content');
    assert.strictEqual(after.length, before + 1);
    assert.strictEqual(after[0].body, 'Bell Lecture');
    assert.strictEqual(after[0].ref, id);
  });
  await t('switching notifications on with videos already published sends nothing', async () => {
    const before = (await bell(member)).items.filter(n => n.kind === 'content').length;
    mocks.store.delete('elevare:nt:seeded'); mocks.store.delete('elevare:nt:items');
    await admin.req('POST', '/api/admin', { action: 'announce', text: '' });   // any save
    const after = (await bell(member)).items.filter(n => n.kind === 'content').length;
    assert.strictEqual(after, before);
    assert.strictEqual(mocks.store.get('elevare:nt:seeded'), '1');
  });
  await t('opening the bell marks everything read', async () => {
    assert.ok((await bell(member)).unread > 0);
    await member.req('POST', '/api/notify', { action: 'read' });
    assert.strictEqual((await bell(member)).unread, 0);
  });

  console.log('Blocking & role removal');
  await t('blocked member is locked out and cannot sign back in', async () => {
    await admin.req('POST', '/api/admin', { action: 'block', uid: MEMBER });
    assert.strictEqual((await member.req('GET', '/api/me')).status, 403);
    assert.strictEqual(await client().signIn(MEMBER), '/?e=blocked');
    await admin.req('POST', '/api/admin', { action: 'unblock', uid: MEMBER });
    assert.strictEqual(await member.signIn(MEMBER), '/');
  });
  await t('removing the Discord role locks the member out on next check', async () => {
    mocks.users[MEMBER].roles = [];
    for (const [k, v] of mocks.store) {
      if (/^elevare:sess:/.test(k)) { const s = JSON.parse(v); if (s.uid === MEMBER) { s.chk = 0; mocks.store.set(k, JSON.stringify(s)); } }
    }
    assert.strictEqual((await member.req('GET', '/api/me')).status, 401);
    mocks.users[MEMBER].roles = [mocks.ACCESS];
  });
  await t('logout ends the session', async () => {
    await admin.req('POST', '/api/me', { action: 'logout' });
    assert.strictEqual((await admin.req('GET', '/api/me')).status, 401);
  });

  console.log('\n' + passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
  ms.close(); ss.close();
})();
