# Launch this site for a new brand

This folder is the complete Elevare website:
Discord sign-in with role gate, DRM video (VdoCipher), lectures that unlock
one by one, breakdowns / Q&A / random sections, admin panel, rules
agreement, watermarks, device limits, recorder / VM / fake-browser blocks,
Discord alerts, evidence reports, member export and VPN flags.

A new brand gets its **own copy** with its own accounts. Nothing is shared
with any other brand, and no other site is affected.

Plan on about an hour the first time. Do the steps in order.

---

## Step 1. Make the copy on GitHub

1. Sign in to GitHub and click **New repository** (top right **+**).
2. Name it (for example `nova-vault`), choose **Private**, click **Create**.
3. On the new repo page click **uploading an existing file**.
4. Unzip this package on your computer and drag **everything inside the
   folder** (not the folder itself) into the page. Click **Commit changes**.

## Step 2. Put the new brand on it

1. In the repo, open **brand.js**, click the pencil icon, and change:
   - `name`: the full name (browser tab, messages, alerts)
   - `mark`: the giant outlined letters on the sign-in page (1-3 characters)
   - `tagline`: the line under the logo
   - `accent` and `accentBright`: the brand colour and a brighter version
   - `fileSlug`: one short lowercase word for download file names
   Click **Commit changes**.
2. Replace the three images with the new brand's (keep the exact names):
   - `logo.png`: the wordmark, transparent background, about 1000 px wide
   - `favicon.png`: 64 x 64 icon
   - `apple-touch-icon.png`: 180 x 180 icon
   (Click the file, then the three dots, **Delete file**, then **Add file >
   Upload files** with the new one.)

## Step 3. New Discord app (sign-in)

The person doing this needs to be able to see the brand's Discord server.

1. Go to **discord.com/developers/applications** and click **New Application**.
   Name it after the brand.
2. Open **OAuth2**. Copy the **Client ID**. Click **Reset Secret** and copy
   the **Client Secret** (keep it private).
3. Under **Redirects** add `https://YOURDOMAIN.com/api/callback` and save.
4. In Discord, turn on **Developer Mode** (User Settings > Advanced). Then
   right-click to **Copy ID** of:
   - the server (the **Server ID**)
   - the student role(s) that should get in
   - the owner/admin role
   - the owner's own account (**User ID**)
5. The owner turns on **two-factor authentication** in Discord
   (User Settings > My Account). Admin tools stay off without it.

## Step 4. New database (Upstash)

1. Go to **upstash.com**, sign in, **Create Database** (Redis), any region
   near most members, free plan is fine.
2. Open it and copy the **REST URL** and **REST Token**.

## Step 5. Video host (VdoCipher)

1. Use a **separate VdoCipher account** for the new brand (so one brand's
   admin can never reach the other's videos).
2. In the VdoCipher dashboard go to **Config > API Keys**, create one, copy
   the **API Secret**.

## Step 6. Discord alert channel (optional but recommended)

1. In the brand's Discord, make a private admin-only channel.
2. Channel settings > **Integrations > Webhooks > New Webhook** >
   **Copy Webhook URL**.

## Step 7. Vercel (the website)

1. Go to **vercel.com**, **Add New > Project**, import the GitHub repo from
   Step 1, and before clicking Deploy open **Environment Variables**.
2. Add these (name on the left, your value on the right):

| Name | Value |
|---|---|
| `DISCORD_CLIENT_ID` | from Step 3 |
| `DISCORD_CLIENT_SECRET` | from Step 3 |
| `DISCORD_GUILD_ID` | the Server ID |
| `ACCESS_ROLE_ID` | student role ID (several: separate with commas) |
| `ADMIN_ROLE_ID` | owner/admin role ID |
| `ADMIN_IDS` | owner's User ID (admin even without the role) |
| `KV_REST_API_URL` | Upstash REST URL |
| `KV_REST_API_TOKEN` | Upstash REST Token |
| `VDOCIPHER_API_SECRET` | from Step 5 |
| `SESSION_SECRET` | a random 40+ character string (see below) |
| `SITE_HOSTS` | `yourdomain.com,www.yourdomain.com` |
| `ALERT_WEBHOOK` | webhook URL from Step 6 |
| `IPINFO_TOKEN` | free token from ipinfo.io (VPN flags) |

   For `SESSION_SECRET`, any long random text works: mash the keyboard for
   two lines, or use a password generator set to 48 characters.

3. Click **Deploy**.
4. Project **Settings > Domains**: add the brand's domain and follow the DNS
   instructions Vercel shows.
5. Project **Settings > Deployment Protection**: Vercel Authentication,
   **Standard Protection**.
6. If you changed any variable after the first deploy: **Deployments**, three
   dots on the latest, **Redeploy**.

Optional settings (leave out to use the defaults this site runs with):

| Name | What it does |
|---|---|
| `TIERS` | extra paid tiers, e.g. `Elite:ROLEID` |
| `DEVICE_LIMIT` | browsers per member per 30 days (default 3) |
| `WATERMARK_MODE` | `subtle` (default) or `bold` |
| `WATERMARK_COLOR` | watermark hex colour |
| `ALERT_PING` | who alerts ping (default: the admin role) |
| `REDIS_PREFIX` | only if two brands share one database (default `elevare`) |
| `LOCK_OTP_IP` | `1` = video keys only work from the member's own IP |
| `ALLOW_SAFARI` | `1` = also allow Safari (needs VdoCipher FairPlay) |

## Step 8. Check it works

1. Open the domain in Chrome. Sign in with the owner's Discord.
2. Admin should appear in the top bar. If not: check `ADMIN_IDS` and that
   two-factor is on.
3. **Admin > Content**: create a section, upload a video (or **Link existing**
   with a VdoCipher video ID), wait for it to show Ready.
4. **Admin > Content > Community rules**: edit the rules for the brand.
5. **Admin > Security log > Send test alert**: the Discord channel should get
   it.
6. Sign in with a test student account: it should ask to agree to the rules,
   then play the video with the watermark.

## Step 9. Ask VdoCipher support (once per account)

Send them:

> Please enable for our account: your piracy tracker / hacker identification
> blocking with alerts to us by userId, the strictest Widevine settings you
> support for desktop Chrome (VMP, revoked-CDM blocking), and tell us if
> forensic watermarking or a FairPlay/Safari option is available.

---

### Good to know

- **Updates:** fixing or improving one brand's copy doesn't change the other.
  To bring an improvement across, copy the changed files into the other repo.
- **Secrets:** never put any of the Step 7 values into the code or a Discord
  message. They live only in Vercel.
- **Try it offline first (optional, for developers):** `node dev/server.js`
  runs the whole site locally with fake Discord/VdoCipher; `node test/run.js`
  runs the tests.
- Full technical details: **README.md** and **SECURITY.md**.
