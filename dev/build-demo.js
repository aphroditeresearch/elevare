'use strict';
// Builds dist/demo.html: the real index.html running fully offline with a
// fake back end, placeholder content and a guided tour. For showing the
// site to customers without deploying. Usage: npm run demo
const fs = require('fs');
const path = require('path');
const R = p => path.join(__dirname, '..', p);
const b64 = p => fs.readFileSync(R(p)).toString('base64');

// placeholder content from the dev seed
const fake = { videos: {}, store: new Map() };
require('./seed')(fake);
const content = JSON.parse(fake.store.get('elevare:content'));
content.items.forEach(it => { delete it.videoId; });
const now = Date.now(), min = 60000;
const alerts = [
  { t: now - 9 * min, kind: 'devtools', uid: '100000000000000007',
    name: 'Member Seven', detail: 'debugger pause detected', ip: '198.51.100.7' },
  { t: now - 52 * min, kind: 'printscreen', uid: '100000000000000004',
    name: 'Member Four', detail: '', ip: '198.51.100.44' },
  { t: now - 3 * 60 * min, kind: 'device-takeover', uid: '100000000000000003',
    name: 'Member Three', detail: 'switched device', ip: '203.0.113.9' },
  { t: now - 26 * 60 * min, kind: 'admin-probe', uid: '100000000000000005',
    name: 'Member Five', detail: 'GET /api/admin', ip: '192.0.2.15' },
  { t: now - 30 * 60 * min, kind: 'role-removed', uid: '100000000000000006',
    name: 'Member Six', detail: 'access role gone', ip: '192.0.2.61' }
];
const users = {};
['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'].forEach((n, i) => {
  users['10000000000000000' + (i + 1)] = { name: i === 0 ? 'Admin Placeholder' :
    i === 1 ? 'Member Placeholder' : 'Member ' + n,
    username: (i === 0 ? 'admin' : 'member') + '.' + n.toLowerCase(),
    last: now - i * 7 * 60 * min };
});

let html = fs.readFileSync(R('index.html'), 'utf8');
const logo = 'data:image/png;base64,' + b64('logo.png');
const font = 'data:font/woff2;base64,' + b64('fonts/anton.woff2');
const fav = 'data:image/png;base64,' + b64('favicon.png');

html = html
  .replace(/<link rel="preload"[^>]*>\n?/, '')
  .replace(/<link rel="apple-touch-icon"[^>]*>\n?/, '')
  .replace('href="/favicon.png"', 'href="' + fav + '"')
  .replace('url(/fonts/anton.woff2)', 'url(' + font + ')')
  .replace('url(/fonts/cinzel.woff2)', 'url(data:font/woff2;base64,' +
    b64('fonts/cinzel.woff2') + ')')
  .replace(/<title>[^<]*<\/title>/, '<title>' + (require(R('brand.js')).name || 'Vault') + ' demo</title>')
  .replace('<script src="/brand.js"></script>', '<script>' + fs.readFileSync(R('brand.js'), 'utf8') + '</script>')
  .split('src="/logo.png"').join('src="" data-logo')
  .replace(/(src="|poster=")\/media\/([\w.-]+)/g, (m, pre, f) => pre + 'data:' +
    ({ jpg: 'image/jpeg', mp4: 'video/mp4' })[f.split('.').pop()] + ';base64,' + b64('media/' + f))
  .split('src="/emblem.png"').join('src="data:image/png;base64,' + b64('emblem.png') + '"')
  .replace('url(/fonts/bangers.woff2)', 'url(data:font/woff2;base64,' +
    b64('fonts/bangers.woff2') + ')');

const demoCss = `
<style>
/* ---- demo-only ---- */
.demo-player { position: absolute; inset: 0; background:
  radial-gradient(90% 70% at 50% 45%, #0f1a3a 0%, #060606 75%); }
.dp-c { position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; text-align: center;
  padding: 30px; gap: 12px; }
.dp-k { font-size: 11px; letter-spacing: .3em; text-transform: uppercase;
  color: #4fa3ff; }
.dp-t { font-family: var(--display); font-size: 34px; text-transform: uppercase;
  color: #f2f5fb; line-height: 1.05; }
.dp-s { max-width: 460px; color: #8790a3; font-size: 13px; line-height: 1.6; }
.dp-mark { position: absolute; left: 12%; top: 18%; font-size: 14px;
  color: rgba(255,255,255,.4); transition: left 2s ease, top 2s ease;
  pointer-events: none; white-space: nowrap; }
.dp-bar { position: absolute; left: 16px; right: 16px; bottom: 16px;
  display: flex; align-items: center; gap: 12px; color: #8790a3;
  font-size: 12px; font-variant-numeric: tabular-nums; }
.dp-bar i { flex: 1; height: 3px; background: rgba(255,255,255,.12); }
.dp-bar b { display: block; height: 100%; width: 0; background: #f2f5fb;
  transition: width 1s linear; }
.dp-pp { width: 0; height: 0; border-left: 9px solid #f2f5fb;
  border-top: 6px solid transparent; border-bottom: 6px solid transparent; }
#demo-pick { position: fixed; inset: 0; z-index: 990; display: flex;
  align-items: center; justify-content: center; background: rgba(0,0,0,.75);
  padding: 20px; }
#demo-pick .card { text-align: center; }
#demo-pick p { margin: 0 0 22px; }
#demo-pick .acts { justify-content: center; }
#tour { position: fixed; right: 20px; bottom: 20px; z-index: 980;
  width: 340px; max-width: calc(100vw - 40px); background: #f2f5fb;
  color: #0a0a0a; box-shadow: 0 18px 50px rgba(0,0,0,.6);
  -webkit-user-select: none; user-select: none; }
#tour .th { display: flex; align-items: center; gap: 10px;
  padding: 12px 16px 0; }
#tour .tb { font-size: 10px; font-weight: 700; letter-spacing: .24em;
  text-transform: uppercase; color: #1f6bff; }
#tour .tn { font-size: 11px; color: #5c5953; margin-left: auto; }
#tour .tmin { background: none; border: 0; cursor: pointer; font-size: 18px;
  line-height: 1; color: #5c5953; padding: 2px 4px; }
#tour .tbody { padding: 8px 16px 16px; }
#tour h4 { margin: 0; font-family: var(--display); font-weight: 400;
  font-size: 24px; text-transform: uppercase; letter-spacing: .01em; }
#tour p { margin: 8px 0 14px; font-size: 13.5px; line-height: 1.55;
  color: #2b2926; }
#tour .ta { display: flex; gap: 8px; }
#tour .ta button { height: 36px; padding: 0 14px; cursor: pointer;
  font-size: 10px; font-weight: 700; letter-spacing: .2em;
  text-transform: uppercase; border: 1px solid #0a0a0a; background: none;
  color: #0a0a0a; }
#tour .ta .tg { background: #0a0a0a; color: #f2f5fb; flex: 1; }
#tour .ta button:disabled { opacity: .3; cursor: default; }
#tour.min .tbody, #tour.min .tn { display: none; }
#tour.min { width: auto; }
#tour.min .th { padding: 10px 14px; }
@media (max-width: 600px) { #tour { right: 10px; bottom: 10px; left: 10px;
  width: auto; max-width: none; } }
</style>`;

const demoHtml = `
<div id="demo-pick" hidden>
  <div class="card">
    <h2 class="display">Demo sign-in</h2>
    <p>On the live site this button opens Discord. Pick who to sign in as:</p>
    <div class="acts">
      <button type="button" class="sb line" data-as="member">Member</button>
      <button type="button" class="sb" data-as="admin">Admin</button>
    </div>
  </div>
</div>
<div id="tour">
  <div class="th"><span class="tb">Demo tour</span><span class="tn"></span>
    <button type="button" class="tmin" aria-label="Minimise">&#x2013;</button>
  </div>
  <div class="tbody">
    <h4></h4><p></p>
    <div class="ta">
      <button type="button" class="tp">Back</button>
      <button type="button" class="tg">Show me</button>
      <button type="button" class="tx">Next</button>
    </div>
  </div>
</div>`;

const plays = [3, 4, 5, 6, 7].map((n, i) => ({ t: now - (i + 1) * 47 * min,
  sid: 'S-' + (0x3A7F21C0 + i * 7919).toString(16).toUpperCase(),
  uid: '10000000000000000' + n, name: users['10000000000000000' + n].name,
  item: 'i' + (i + 1), title: content.items[i].title, ip: '198.51.100.' + (10 + n) }));
const sessions = [3, 4, 5].map((n, i) => ({ t: now - (i + 1) * 95 * min,
  event: i === 1 ? 'replaced' : 'signin', uid: '10000000000000000' + n,
  name: users['10000000000000000' + n].name, ip: '198.51.100.' + (10 + n) }));
const seedJs = 'window.LVR_SEED=' + JSON.stringify({ content, alerts, users, plays, sessions }) + ';';
const logoJs = 'document.addEventListener("DOMContentLoaded",function(){' +
  'var l=' + JSON.stringify(logo) + ';[].forEach.call(document.querySelectorAll(' +
  '"img[data-logo]"),function(i){i.src=l;});});';
const shim = fs.readFileSync(path.join(__dirname, 'demo-shim.js'), 'utf8');

html = html.replace('</head>', demoCss + '\n</head>');
// Demo only: let a presenter continue from a non-Chrome browser (e.g. the
// Claude app) after showing the Chrome-only screen.
html = html.replace('id="wall-copy" type="button"\n        style="height:48px">Copy link</button>',
  'id="wall-copy" type="button"\n        style="height:48px">Copy link</button>\n' +
  '      <button class="ghost line" id="demo-skip" type="button"' +
  ' style="height:48px">Preview anyway (demo only)</button>');
const i = html.indexOf('<script>');
html = html.slice(0, i) + demoHtml + '\n<script>' + seedJs + logoJs + '</script>\n' +
  '<script>' + shim + '</script>\n' + html.slice(i);

fs.mkdirSync(R('dist'), { recursive: true });
fs.writeFileSync(R('dist/demo.html'), html);
console.log('dist/demo.html', Math.round(html.length / 1024) + ' KB');
