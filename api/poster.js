'use strict';
// Serves a lesson's thumbnail (VdoCipher poster image) to signed-in members.
// Proxied so the VdoCipher video id inside the image URL never reaches them.
const L = require('./_lib');

module.exports = async function (req, res) {
  if (!L.guard(req, res, ['GET'])) return;
  try {
    const s = await L.requireMember(req, res);
    if (!s) return;
    const id = String(L.query(req).id || '');
    const c = await L.loadContent();
    const it = c.items.find(x => x.id === id);
    if (!it || it.status !== 'ready' || !it.videoId) return L.json(res, 404, { error: 'not_found' });
    if (!L.hasTier(s, it.tier)) return L.json(res, 404, { error: 'not_found' }); // other tier

    if (!it.posterUrl) {
      // older items: look it up once and remember it
      try {
        it.posterUrl = L.posterOf(await L.vdo('GET', '/videos/' + encodeURIComponent(it.videoId)));
      } catch (e) { it.posterUrl = null; }
      if (it.posterUrl) await L.saveContent(c);
    }
    if (!it.posterUrl) return L.json(res, 404, { error: 'no_poster' });

    const r = await fetch(it.posterUrl);
    const type = String(r.headers.get('content-type') || '');
    if (!r.ok || !/^image\//.test(type)) return L.json(res, 404, { error: 'no_poster' });
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 5 * 1024 * 1024) return L.json(res, 404, { error: 'too_big' });
    res.statusCode = 200;
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(buf);
  } catch (e) {
    console.error('poster', e);
    L.json(res, 404, { error: 'no_poster' });
  }
};
