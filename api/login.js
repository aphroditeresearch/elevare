'use strict';
const L = require('./_lib');

function redirectUri(req) {
  return L.env('DISCORD_REDIRECT_URI') ||
    'https://' + req.headers.host + '/api/callback';
}

module.exports = async function (req, res) {
  if (req.method !== 'GET') return L.json(res, 405, { error: 'method' });
  if (!L.configured()) return L.redirect(res, '/?e=setup');
  if (!L.hostOk(req)) return L.json(res, 403, { error: 'host' });
  if (L.isMobile(req)) return L.redirect(res, '/?e=mobile');
  if (!L.browserOk(req)) return L.redirect(res, '/?e=browser');
  if (!(await L.rateLimit('login:' + L.ip(req), 20, 600))) {
    return L.redirect(res, '/?e=slow');
  }
  const nonce = L.rid(16);
  const ts = Date.now().toString(36);
  const state = nonce + '.' + ts + '.' + L.sign('state:' + nonce + '.' + ts);
  L.setCookie(res, 'elevare_state', nonce, 600);
  const p = new URLSearchParams({
    client_id: L.env('DISCORD_CLIENT_ID'),
    response_type: 'code',
    redirect_uri: redirectUri(req),
    scope: 'identify email guilds.members.read',
    state: state,
    prompt: 'none'
  });
  L.redirect(res, 'https://discord.com/oauth2/authorize?' + p.toString());
};
module.exports.redirectUri = redirectUri;
