# Elevare: video protection, what is tested, and what is still possible

No browser-based system can guarantee zero piracy. This document says exactly
what each layer does, how it was verified, and what a determined person can
still do. Nothing below is marked as working unless it was actually tested.

**Legend.** Status: **Blocked** (the attempt fails), **Deterred** (possible but
traceable/slowed), **Detected** (logged/alerted), **Possible** (not prevented).
Verified: **Auto** = covered by `npm test` (39 end-to-end tests against mocked
Discord / VdoCipher / Redis) or the in-browser smoke test; **Live** = must be
checked on the deployed site with real VdoCipher + real devices (not done yet).

## 0. At a glance (Chrome on Windows and macOS, desktop only)

### A. Fully implemented in our code
- **Widevine DRM playback** only through VdoCipher's official v2 player; no unencrypted fallback, no media URLs are ever sent to members. (The `playbackInfo` VdoCipher's player needs does encode the video id; on its own it is useless without a fresh server-issued OTP.)
- **OTP + playbackInfo generated on the backend** (Vercel serverless functions, the equivalent of a Cloudflare Worker), **TTL 300 s**, API secret only in server env vars.
- **No OTP without** a valid Discord session + the access role (re-checked live with Discord on every play) + not blocked + Chrome on a computer + allowed tier + lecture unlocked.
- **Role removed = next play refused** immediately; page access ends within 5 minutes.
- **One viewing session per account**: one playing device (takeover required) and one website session; admin Sign out everywhere / Block.
- **VdoCipher native dynamic watermark** (`annotate`), 6 moving marks at different speeds and sizes: viewer code (4x), @username, session id + time + Discord ID.
- **Server-side session-to-user mapping**: every play logged with session id, viewer code, member, video, time, network, browser (Admin > Plays).
- **VdoCipher `userId`** sent with every OTP (their viewer analytics / sharing detection) and **`whitelisthref`** domain lock.
- **Rate limits**: 40 plays / 10 min, 600 requests / 10 min per member, 20 sign-ins / 10 min per IP; repeated refusals raise alerts.
- **Security log + Discord alerts** for sketchy events; desktop only (phones/tablets refused on server and page).

### B. Needs VdoCipher account configuration (owner)
- **Desktop screen-capture black frames**: now working on Mac Chrome (screenshot, recording, OBS) after the player cleanup. Windows still to test; if it isn't black there, ask VdoCipher support (message in section 3).
- **Strongest Widevine security level / output protection (HDCP)**: VdoCipher's OTP API exposes no such option; only they can configure it.
- **Allowed domains** in the dashboard (the site also sends `whitelisthref`).
- **Viewer analytics / piracy tracker dashboards** (fed by the `userId` the site now sends).
- FairPlay is not needed: Elevare is Chrome-only and Safari is always refused (there is no setting to allow it).

### C. Impossible to guarantee in desktop Chrome
- **Blocking every recording or screenshot.** VdoCipher states Windows capture is preventable in roughly 70 to 80% of cases, and its overview says Chrome on Mac can't be prevented. Black frames depend on the viewer's hardware, drivers and settings.
- **Detecting OBS, StreamFab, extensions or screenshots from JavaScript.** No reliable web API exists; nothing here claims it.
- **Watermarks surviving a rip.** VdoCipher's watermark is drawn by the player, not burned into the file.
- **Stopping a camera pointed at the screen.**
- The page's right-click/shortcut/focus-loss measures are **tripwires for logging only**, not protection.

## 1. The layers

| Layer | What it does | Where |
|---|---|---|
| DRM delivery | Videos live only on VdoCipher (Widevine / FairPlay). The site never has an MP4, HLS URL or permanent link. VdoCipher video IDs never leave the server. | `api/play.js`, `api/me.js` |
| Thumbnails | Lesson thumbnails are fetched by the server and passed through to signed-in members only, so the VdoCipher id in the image address never reaches the browser. | `api/poster.js` |
| Short-lived playback | Each play gets a VdoCipher OTP with `ttl: 300` (5 min), issued only by the server, after checks below. No unencrypted fallback exists. | `api/play.js` |
| Discord gate | OAuth with signed state. Must be in the server with `ACCESS_ROLE_ID` (or an admin). Roles are re-checked every 5 minutes on page loads, and **live on every play** (if Discord can't confirm, the play is refused). | `api/callback.js`, `api/_lib.js` |
| Tiers | Optional per-lesson tier (`TIERS` env). Enforced on the server at play time. | `api/play.js` |
| Lecture order | Lecture N plays only if 1..N-1 are completed. "Completed" is accepted only after 85% of the lecture's running time has passed since it was first opened (server clock), so skipping to the end doesn't count. | `api/play.js` |
| Watermark (VdoCipher) | Three moving texts drawn by VdoCipher's player: name + Discord ID; playback session ID + UTC time; large faint Discord ID. Random positions, three speeds, so it crosses the centre too. Built on the server per play. | `api/play.js` |
| Watermark (site) | A second, lighter moving overlay (name, ID, session) drawn by the site above the player. Extra deterrent only. | `index.html` |
| Play log | Every play: session ID, member, video, time, network, browser. Searchable in Admin > Plays. Match a leaked clip's session ID to one person and one viewing. | `api/play.js`, Admin |
| One device at a time | A playback lock per account (2-min heartbeat). A second device must take over; the first stops. | `api/play.js` |
| One website session | A new sign-in replaces the old session (old one is refused + logged). | `api/_lib.js` |
| Cookie safety | `HttpOnly; Secure; SameSite=Lax`, HMAC-signed id, record in Redis (revocable), bound to the browser type (a copied cookie used from another browser is killed + logged). Nothing sensitive in localStorage (only a random device id and UI state). | `api/_lib.js` |
| Discord alerts | Only clearly sketchy events ping the admin channel (devtools, screenshot keys, save/print/source, copied login cookie, forced locked/tier plays, admin probing, scraping speed). Network changes and normal actions are logged only. Max one ping per member per type every 10 min. | `api/_lib.js` |
| Abuse limits | Sign-in 20/10 min per IP; plays 40/10 min; all API calls 600/10 min per member; 5 refused requests in 10 min raises an `auth-failures` alert; 3+ networks in a day raises `ip-anomaly`. | `api/*` |
| Admin controls | Block (instant), Sign out everywhere, security log, plays log, sign-in history, optional Discord webhook. | Admin |
| Headers | CSP (only VdoCipher may be framed / scripted), `frame-ancestors 'none'`, HSTS, nosniff, Referrer-Policy, Permissions-Policy, COOP. API responses `no-store`. | `vercel.json` |
| No stray files | `.vercelignore` keeps `dev/`, `test/`, `dist/` and docs off the live site. Secrets exist only in Vercel env vars. | `.vercelignore` |
| Developer-tools tripwires | Three checks for non-admins: debugger pause (shuts the page), docked-panel size (covers the page), and a console-attached timing check that also catches tools in a **separate window** with breakpoints off (measured: ~0.5 ms closed vs 14-26 ms attached; needs 2 slow readings). Covering the page stops playback; the first catch is logged and pings Discord. Bypassable by a determined expert, so counted as detection, not protection. | `index.html` |
| Behaviour alerts (server) | Can't be faked from the browser: 8+ different videos started in 20 min (`binge`), plays from 2+ countries in a day (`geo-anomaly`, from Vercel's location headers), 3+ networks a day (logged), forced locked/tier plays, repeated refusals. Country and city are stored with every play. | `api/play.js` |
| Rules agreement | Members must agree to the community rules (showing their viewer code) before entering or playing; the server refuses play keys until they have. Agreement is recorded with time, network and browser (Admin > Members). Editing the rules asks everyone to agree again. | `api/me.js`, `api/play.js` |
| Developer-tools timeout | Two developer-tools catches within an hour lock the account out for 10 minutes (server-enforced), ping the admins, and can be lifted early from the security log. | `api/me.js`, `api/_lib.js` |
| Evidence trail | Every sign-in, play and alert is also kept per member (last 3,000 events each) with IP, city/country, browser and device. Admin > Members > **Report** downloads it all as one text file (identity, email, Discord account age, viewer code, rules agreement, payment ID, full activity, raw JSON). Global logs keep 2,000 alerts, 5,000 sign-ins and 20,000 plays. | `api/_lib.js`, `api/admin.js` |
| Identity signals | Discord email (shown to the member on Discord's consent screen), Discord account age (accounts under 30 days are logged), several accounts from one network (logged), the same browser used by two accounts (pings admins), and an owner-entered payment ID per member. | `api/callback.js`, `api/play.js` |
| Host lock | Only `SITE_HOSTS` may serve members; Vercel preview deployments (which share production secrets) are refused unless `ALLOW_PREVIEW=1`. | `api/_lib.js` |
| Admin two-factor | Admin tools need two-factor on the admin's Discord account (`mfa_enabled`, re-checked every 5 minutes). | `api/_lib.js`, `api/callback.js` |
| Device limit | Each member may use `DEVICE_LIMIT` browsers (default 3) per 30 days; a new one past that is refused, pings admins, and an admin can reset. One browser plays at a time. | `api/play.js` |
| Watching now | Admin > Security log lists everyone playing right now (member, video, network, browser) with a Stop button. | `api/admin.js` |
| Picture-in-picture | Blocked for the page and the player via Permissions-Policy. | `vercel.json` |
| Secret scan + CI | `test/check.js` fails on webhook URLs, tokens, API secrets or keys in the repo; GitHub Actions runs checks and tests on every push. | `test/check.js`, `.github/workflows/check.yml` |
| Subtle watermark (default) | VdoCipher draws it in the player (DRM-protected recordings and screen captures carry it; a decrypted download does not). A tiny faint viewer code fixed in the top-left corner, the Discord ID at 8% opacity mid-frame (visible when a copy's brightness/contrast is raised), and ghost marks (code, @handle, session + time) that appear for ~1 s at random spots then hide 20-45 s, plus a barely-there slow drifting code. Corner offsets and flash timings are derived from the member's ID. Not forensic watermarking (that is embedded in the video frames by the provider; ask VdoCipher). `WATERMARK_MODE=bold` restores the large moving marks. | `api/play.js` |
| App-browser block | DRM downloaders sign in through their own built-in Chromium browser with a Chrome user agent. Real Chrome and Brave name themselves in the `Sec-CH-UA` header; a request that claims Chrome but whose header lacks "Google Chrome"/"Brave" (or whose UA says Electron/QtWebEngine/CefSharp) is refused at login and play, and pings admins. Headers can be forged by a determined tool. Optional `LOCK_OTP_IP=1` binds each key to the member's IPv4 address. Important: VdoCipher's watermark is drawn by the player, so a successfully decrypted download does not carry it; stopping key extraction is VdoCipher's job (license-side), and `userId` is sent so they can name the account. | `api/_lib.js`, `api/play.js` |
| Hardware acceleration required | Recorder makers (e.g. EaseUS RecExperts) tell users to turn off the browser's hardware acceleration so protected video stops blacking out. With it off, the browser uses a software renderer (SwiftShader) that the page can read, so playback is refused with instructions to turn it back on, and admins are pinged. Client-side check: a determined user could patch it, and some recorders may capture without this step; the watermark covers those. | `index.html` |
| VPN flag | With `IPINFO_TOKEN`, each sign-in and play looks up the network owner (IPinfo Lite, cached 7 days). VPN / hosting networks are logged once a day per member and marked in Members; nobody is blocked or pinged for it. | `api/_lib.js` |
| Virtual machine block | Running the browser inside a VM lets the host computer record it with no DRM black-out. VM graphics name themselves (VMware, VirtualBox, Parallels, QEMU/virtio) in WebGL, so playback is refused and admins pinged. Client-side; a VM that hides its GPU name is not caught. | `index.html` |
| Recorder-extension check | Extension tab recorders (e.g. CapRec) capture inside Chrome, which DRM may not black out. Anything an extension adds to the page that isn't ours (common password managers and Grammarly excepted) stops the video, shows a warning, and is logged; recorder-looking ones ping admins. Playback stays blocked while the element is on the page. A recorder that adds nothing to the page is not caught: the watermark covers that. | `index.html`, `api/me.js` |
| Page lockdown | Chrome only, right-click/save/print/source/devtools shortcuts blocked with a visible warning, screenshot keys and focus loss cover the page, devtools detection. **These are deterrents and tripwires, not security** (see note below). | `index.html` |

**Note on the page lockdown.** The spec says to avoid relying on right-click /
devtools blocking. They are kept only because you asked for parity with The
Project; they are not counted as protection anywhere in this document. Their
real value is the log entries they create. They can be removed without
weakening anything above.

## 2. Capture-protection spec: status

| # | Requirement | Status |
|---|---|---|
| 1 | Only VdoCipher's DRM player; no unencrypted URLs | Done. Members never receive video ids or media URLs; only a 5-min OTP. Thumbnails are proxied. |
| 2 | Widevine + FairPlay | Widevine is on by default. **FairPlay needs the account owner to request VdoCipher's FairPlay upgrade** (dashboard security section; iOS needs an Apple application process). Not used: Elevare never allows Safari. |
| 3 | Hardware-backed DRM / HDCP, no silent fallback | **Not settable from the site.** VdoCipher's OTP API documents only ttl, annotate, whitelisthref, IP/geo rules and userId; no security-level or HDCP option. Must be requested from VdoCipher support (see section 3). |
| 4 | Server-generated short-lived OTPs, secret server-side | Done (ttl 300 s; `VDOCIPHER_API_SECRET` only in Vercel). |
| 5 | Moving viewer-specific watermark: Discord ID, username, time | Done: 6 VdoCipher marks: viewer code x4, @username, session + time + Discord ID; random positions at different speeds. |
| 6 | One active playback session, server-side invalidation | Done: one website session + one playing device per account; admin Sign out / Block. |
| 7 | Pause/obscure during recording where an API reliably allows | **No reliable web API exists** to detect OS screen recording or sharing. The page covers itself and pauses the video when the window loses focus or the tab is hidden. That's a deterrent, not detection. |
| 8 | VdoCipher piracy/analytics features | `userId` is now sent with every OTP (VdoCipher viewer analytics + password-sharing detection in their dashboard). `whitelisthref` restricts playback to your domain. |
| 9 | No false claims about detecting OBS/StreamFab/extensions | Kept: nothing in the site or docs claims this. |
| 10 | Vulnerabilities by browser/OS + test matrix | Section 3. |

## 3. Capture by browser and OS

What VdoCipher documents, and what we have actually observed. "Black" = the
video area records/screenshots as black while watermarks stay visible.

| Platform | Expected (VdoCipher docs) | Observed |
|---|---|---|
| Mac, Chrome | Not preventable per VdoCipher's overview page | **Black (2026-11-21, tested on the original deployment of this code; re-test on yours):** native screenshot, macOS screen recording and OBS all show a black video area with the watermarks visible. It started working once nothing on the page sat over or around the player (no site overlay, no transforms/containment on the player box). **Keep the player area free of overlays and effects in future changes.** |
| Mac, Safari | n/a | Safari is always refused on Elevare |
| Windows, Chrome/Edge | Black on roughly 70 to 80% of machines (device-dependent) | Not tested |
| iPhone/iPad | n/a | Phones and tablets are refused |
| Android, Chrome | Not guaranteed in browsers | Not tested |
| Linux, any browser | Not preventable | Not tested |

### Test matrix (run on the live site, record results here)

For each platform above, play a Ready lecture on your live domain and try:

| Method | What to check |
|---|---|
| Native screenshot (Cmd+Shift+3/4, Win+Shift+S, PrtSc) | Video area black? Page shield appears and Discord alert fires? |
| macOS screen recording (Cmd+Shift+5 / QuickTime) | Video black in the recording? |
| OBS: display capture | Video black? |
| OBS: window capture | Video black? |
| Screen share (Discord / Zoom / Meet) | Viewers see black? |
| Downloader extension (e.g. video DownloadHelper) | Fails to find/save a playable file? |
| StreamFab-style downloader | Fails? (rips carry no overlay watermark) |
| Copying the OTP to another browser | Refused after 5 min; other domain refused (whitelist) |

Record: date, OS + version, browser + version, result (Blocked / Black / Visible / Logged).

### What to ask VdoCipher support (owner's account)

> We embed with the API (OTP + v2 iframe). Another VdoCipher-powered site
> records as black in Chrome on macOS; ours doesn't on the same machine.
> Please enable the same desktop screen-capture protection on our account,
> enforce the strongest Widevine security level / output protection you
> support without falling back, and activate FairPlay for Safari. Is any
> OTP or player parameter needed on our side, or re-encoding of videos?

## 4. Remaining piracy risks (honest)

- **Screen recording in desktop Chrome** is the main open door. Only the
  watermark deters it.
- **Camera pointed at the screen**: nothing stops it; the watermark is visible.
- **Cracked DRM modules**: a rip removes the overlay watermark. The play log
  narrows it to who played that video and when.
- **Forensic (invisible, re-encode-proof) watermarking is not in place.**
  VdoCipher's watermark is an overlay, so it doesn't survive a rip. Ask
  VdoCipher directly whether they offer server-side/forensic watermarking on
  your plan before relying on it; this site doesn't claim it.
- **Members who share their screen live** (e.g. in a call) show the watermark
  but aren't detected.

## 5. Would a native app be stronger?

Yes, meaningfully, for the recording problem: VdoCipher states screen capture
can be blocked in their Android and iOS apps (hardware-backed Widevine L1 /
FairPlay with OS capture flags). A desktop app (Electron etc.) does not get
hardware DRM on most PCs and would be no better than Chrome. Recommendation: if
recording is the real threat, a mobile app later is the strong step, keeping
the website Chrome-only on desktop with the watermark as the deterrent.

_Repository is private. Last checked: 2026-11-21._
