'use strict';
// This week's economic calendar from Forex Factory's public weekly feed
// (nfs.faireconomy.media). Cached for 30 minutes so the feed is asked at most
// a couple of times an hour for the whole site; if it's down, the last good
// copy is served.
const L = require('./_lib');

const FRESH_MS = 30 * 60 * 1000;
const IMPACTS = ['High', 'Medium', 'Low', 'Holiday'];
const KEY = () => L.K('news:ff');

function feedBase() {
  return L.env('NEWS_API', 'https://nfs.faireconomy.media');
}
function cleanStr(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
}
function clean(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const x of list.slice(0, 600)) {
    if (!x || typeof x !== 'object') continue;
    const at = Date.parse(String(x.date || ''));
    if (!isFinite(at)) continue;
    const country = cleanStr(x.country, 4).toUpperCase();
    out.push({
      at, title: cleanStr(x.title, 120),
      cur: /^[A-Z]{3,4}$/.test(country) ? country : '',
      impact: IMPACTS.indexOf(x.impact) >= 0 ? x.impact : 'Low',
      forecast: cleanStr(x.forecast, 24), previous: cleanStr(x.previous, 24)
    });
  }
  out.sort((a, b) => a.at - b.at);
  return out;
}
async function grab(name) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(feedBase() + '/' + name, { signal: ctl.signal,
      headers: { 'User-Agent': 'Elevare calendar (members site)', Accept: 'application/json' } });
    if (!r.ok) return null;
    return clean(await r.json());
  } catch (e) {
    return null;
  } finally { clearTimeout(t); }
}

module.exports = async function (req, res) {
  if (!L.guard(req, res, ['POST'])) return;
  try {
    const s = await L.requireMember(req, res);
    if (!s) return;
    if (!(await L.rateLimit('news:' + s.uid, 60, 300))) return L.json(res, 429, { error: 'slow' });
    let have = null;
    try { have = JSON.parse((await L.kv('GET', KEY())) || 'null'); } catch (e) { have = null; }
    if (!have || Date.now() - (have.t || 0) > FRESH_MS) {
      // one refresh at a time across the site
      const mine = await L.kv('SET', L.K('news:lock'), '1', 'NX', 'EX', 20);
      if (mine === 'OK' || !have) {
        const week = await grab('ff_calendar_thisweek.json');
        if (week) {
          const next = await grab('ff_calendar_nextweek.json');
          have = { t: Date.now(), items: week, next: next || [] };
          await L.kv('SET', KEY(), JSON.stringify(have));
        }
      }
    }
    if (!have) return L.json(res, 503, { error: 'feed' });
    return L.json(res, 200, { t: have.t, items: have.items, next: have.next || [],
      source: 'Forex Factory' });
  } catch (e) {
    console.error(e);
    return L.json(res, 500, { error: 'server' });
  }
};
