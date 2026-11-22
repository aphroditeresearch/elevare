# Elevare

A locked-down video vault for the community's **Lectures** and **Breakdowns**.
Members sign in with Discord (one role gets in), videos are DRM-protected on
VdoCipher, and the mentor runs everything from the admin panel.

**Launching this for another brand?** Follow `NEW-BRAND.md`. All branding
lives in `brand.js` plus the three images.

Stack: static `index.html` + 6 Vercel serverless functions + Upstash Redis
(keys prefixed `elevare:`, or `REDIS_PREFIX`). No servers to run, no npm dependencies.

## Keeping Elevare separate from Akon V2

Elevare started from the same code as Akon V2 but is its own project. Nothing
in this repo points at Akon, and the two can't interfere as long as each one
has **its own accounts**:

| Piece | Elevare uses | Make sure |
|---|---|---|
| GitHub | its own repo (`elevare`) | don't push this into the Akon repo |
| Vercel | its own project | new project, its own env variables |
| Database | keys start with `elevare:` (Akon uses `vault:`) | best: a new Upstash database; even a shared one can't collide |
| Discord sign-in | its own Discord application | new Client ID/Secret and redirect URL |
| Video | its own VdoCipher account | Elevare's admin can never touch Akon's videos |
| Cookies / browser storage | `elevare_session`, `elevare_state`, `elevare.*` | different names from Akon's even on one domain |
| Alerts | its own Discord webhook | point it at Elevare's admin channel |

Changes made here never reach Akon V2, and the other way round.

```
index.html        the whole front end (ES5, pure ASCII, short lines)
brand.js          brand name, mark, tagline, colours (rebrand here)
logo.png, favicon.png, apple-touch-icon.png
rain.webm, rain.mp4  rain loop behind the sign-in screens (rain-poster.jpg = still)
fonts/            Anton (headings, OFL licensed, self-hosted)
vercel.json       security headers (CSP, frame-deny, permissions)
.vercelignore     keeps dev/test/docs off the live site
api/_lib.js       shared helpers (not a function)
api/login.js      -> Discord OAuth
api/callback.js   role gate, starts the session
api/me.js         who am I + library; security flags; logout
api/play.js       locks, tiers, one-device, VdoCipher OTP + watermark, completion
api/admin.js      content, uploads, status, alerts, plays, sessions, blocking
api/poster.js     video thumbnails for signed-in members (hides VdoCipher ids)
dev/              local dev server, mocks, placeholder seed, demo builder
test/             end-to-end tests + repo convention checks
SECURITY.md       protection layers, test checklist, remaining risks
```

## What members see

- **Lectures**: player on the left, the course path on the right. Lectures
  unlock **one at a time**: the next opens when the current one is completed
  (automatically near the end of the video, or with **Mark complete** once
  enough watch time has passed). A segmented bar under the player shows the
  whole course.
- **Breakdowns**: same layout, always open, in any order.
- Those are the only two sections (there is no Q&A or Random).
- **Profile**: Discord name and handle, status, member since, progress, ID.
- An **announcement** strip across the top when an admin posts one.
- **Browsers:** Google Chrome (or Brave) on a computer only. Safari, Firefox,
  Edge, phones and tablets get a "Google Chrome required" page. Safari can't
  be switched on; there's no setting for it.

## Admin guide (for the mentor)

Sign in with Discord, then open **Admin** in the top bar.

1. **Content -> Lectures or Breakdowns.** Type a section name, **Add section**.
2. In that section, **+ Add lecture**: title, optional description, and (if
   tiers are set up) who can watch it. **Save**.
3. **Upload video** on the new row and pick the file (MP4, MOV, M4V, MKV, WEBM
   or AVI). Keep the tab open until the bar finishes. It shows **Processing**,
   then **Ready** by itself. Members only see Ready videos.
4. **Replace video** swaps the file; members keep the old one until the new
   one is ready.
5. Arrows reorder (lecture order = unlock order). **Edit** changes details.
   **Delete** removes the item *and* its video (sections must be empty first).
6. **Announcement**: message + optional https link, **Post**; **Remove** clears it.
7. **Security log**: devtools, screenshot keys, blocked actions, device
   switches, locked/tier probes, repeated failures, IP anomalies. **Block**
   from any row.
8. **Plays**: every play with its session ID. If a clip leaks, type the
   session ID from its watermark to see who watched it and when.
9. **Members**: everyone who has signed in. **Sign out** (everywhere) or
   **Block**. Block any Discord ID directly. Sign-in history below.

## Local development

```
npm run dev      # http://localhost:3000 with mocked services + placeholder content
                 #   sign in: /__dev/login?as=admin  or  /__dev/login?as=member
npm test         # 39 end-to-end tests
npm run check    # index.html is ASCII, short lines, scripts parse
npm run demo     # dist/demo.html: offline showcase with a guided tour (not deployed)
```

---

# Backend setup, step by step

You need four free/paid accounts: **GitHub**, **Vercel**, **Discord
Developer Portal**, **VdoCipher**. Upstash is added from inside Vercel.
Keep a notes file open; you'll collect about 10 values.

## Step 1. Put the code on GitHub

Done: the code lives at **github.com/aphroditeresearch/elevare** (private).

If you ever re-upload by hand from a Mac, Finder hides files starting with a
dot. Press **Cmd+Shift+.** in Finder to show them, and make sure
`.vercelignore`, `.gitignore`, `.env.example` and the `.github` folder go up
too. (`.vercelignore` keeps the docs and test code off the live site.)

## Step 2. Create the Vercel project

1. vercel.com -> sign in with GitHub -> **Add New... -> Project** -> import
   `elevare`.
2. Framework preset: **Other**. Leave build command and output directory empty.
   **Deploy**. (It will deploy but show "isn't configured yet" until step 7.)
3. Note your address, e.g. `elevare.vercel.app`. If you'll use your own
   domain, add it now under **Settings -> Domains** and use that domain below.

## Step 3. Add the database (Upstash Redis)

1. In the Vercel project: **Storage -> Create Database -> Upstash (Redis)**.
2. Pick the region closest to your members, free plan is fine, **Create**,
   then **Connect** it to this project (all environments).
3. This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically.

## Step 4. Create the Discord application

1. discord.com/developers/applications -> **New Application** -> name
   "Elevare" -> Create.
2. Left menu **OAuth2**:
   - copy **Client ID** -> `DISCORD_CLIENT_ID`
   - **Reset Secret**, copy it -> `DISCORD_CLIENT_SECRET`
   - **Redirects -> Add Redirect**: `https://YOUR-DOMAIN/api/callback`
     (exactly, e.g. `https://elevare.vercel.app/api/callback`) -> **Save**.
3. No bot is needed. Members' own sign-in reads their roles.

## Step 5. Collect the Discord IDs

In the Discord app: **User Settings -> Advanced -> Developer Mode: on**. Then:

- right-click your server icon -> **Copy Server ID** -> `DISCORD_GUILD_ID`
- Server Settings -> Roles -> right-click the member role -> **Copy Role ID**
  -> `ACCESS_ROLE_ID`
- right-click the mentor's name, and yours -> **Copy User ID** -> `ADMIN_IDS`
  (comma-separated, no spaces needed)
- optional: an admin role's ID -> `ADMIN_ROLE_ID`
- optional tiers: for each tier role, `Name:roleId`, comma-separated ->
  `TIERS` (e.g. `Elite:123456789012345678`)

## Step 6. VdoCipher

1. Sign up at vdocipher.com (30-day trial).
2. **Config -> API Keys -> Add API secret** -> copy -> `VDOCIPHER_API_SECRET`.
3. Optional: create a folder for these videos, copy its id ->
   `VDOCIPHER_FOLDER_ID`.
4. Security settings (see SECURITY.md section 2): set **allowed domains**
   to your domain. (FairPlay isn't needed: Elevare never allows Safari.)

## Step 7. Add the environment variables in Vercel

Vercel project -> **Settings -> Environment Variables**. Add each (all
environments), then **Deployments -> ... -> Redeploy**.

| Variable | Value |
|---|---|
| `DISCORD_CLIENT_ID` | step 4 |
| `DISCORD_CLIENT_SECRET` | step 4 |
| `DISCORD_GUILD_ID` | step 5 |
| `ACCESS_ROLE_ID` | step 5 (several roles: comma-separated) |
| `ADMIN_IDS` | step 5, e.g. `111111111111111111,222222222222222222` |
| `SESSION_SECRET` | a random string of **at least 32 characters** (on a Mac: Terminal -> `openssl rand -hex 32`) |
| `VDOCIPHER_API_SECRET` | step 6 |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | already added by step 3 |
| `ADMIN_ROLE_ID` | optional |
| `TIERS` | optional, `Name:roleId,Name2:roleId` |
| `ALERT_WEBHOOK` | optional, a Discord channel webhook URL. Only rip-intent events (devtools, screenshot keys, save/print/source, account sharing, forced/locked plays, scraping) are posted, with a ping |
| `ALERT_PING` | optional, who gets pinged: role id(s), or `user:<id>`; default = `ADMIN_ROLE_ID`; `none` = no ping |
| `VDOCIPHER_FOLDER_ID` | optional |
| `DISCORD_REDIRECT_URI` | only if your callback URL isn't `https://<host>/api/callback` |
| `SITE_NAME` | optional, default `Elevare` (from brand.js) |
| `PLAYBACK_DOMAINS` | optional, domains VdoCipher may play on, comma-separated (default: the site's own domain), e.g. `yourdomain.com` |
| `SITE_HOSTS` | **recommended**, the only addresses allowed to serve members, e.g. `yourdomain.com,www.yourdomain.com`. Also used for the VdoCipher domain lock |
| `DEVICE_LIMIT` | optional, browsers each member may use per 30 days (default `3`, `0` = no limit) |
| `REQUIRE_ADMIN_MFA` | optional, admin tools need Discord two-factor (default on; `0` turns it off) |
| `ALLOW_PREVIEW` | optional, `1` lets Vercel preview deployments serve members (off by default) |
| `LOCK_OTP_IP` | optional, `1` makes each video key work only from the member's own IPv4 address (VdoCipher `ipGeo`). Test before relying on it: networks that switch IPs mid-video will need to reload |
| `IPINFO_TOKEN` | optional, free token from ipinfo.io (IPinfo Lite). Lets the site name each member's network and flag VPN / hosting networks in the Security log and Members list (flag only, never blocks) |
| `REDIS_PREFIX` | optional, start of every database key (default `elevare`); only needed if two brands share one Upstash database |
| `WATERMARK_MODE` | optional, `subtle` (default: faint corner code, near-invisible mid-frame ID, brief ghost flashes) or `bold` (the old large moving marks) |
| `WATERMARK_COLOR` | optional, hex colour of the watermark (subtle default `8A8A8A`, bold default `5A5A5A`) |
| `WATERMARK_ACCENT` | optional, hex colour of the @handle mark and one code mark (default `3D6FB6`, blue) |
| `SESSION_IDLE_MINUTES` | optional, sign members out after this many minutes with no activity (default 30; a playing video keeps it alive) |

## Step 8. First sign-in and check

1. Open your domain in **Chrome** -> **Continue with Discord** -> Authorize.
2. As an admin you'll see **Admin** in the top bar. Add a section, a lecture,
   upload a short test video, wait for **Ready**.
3. Sign in with a normal member account (in another browser profile) and
   check: the video plays with the moving watermark; the second lecture is
   locked; Admin isn't visible.
4. Then run the **Live** checks in SECURITY.md section 3 and note results.

**If something's wrong:** "isn't configured" = a required variable is
missing or `SESSION_SECRET` is under 32 characters (redeploy after fixing).
"Sign-in timed out" right away = the Discord redirect URL doesn't exactly
match. "doesn't have access" = wrong `ACCESS_ROLE_ID` or `DISCORD_GUILD_ID`.
Vercel -> **Logs** shows server errors.
