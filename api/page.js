'use strict';
// Serves the site. Signed-in members get the whole site; everyone else gets
// the sign-in screens only, so the members' area never leaves the server for
// someone who isn't a member. Both versions are built by dev/build-site.js.
const L = require('./_lib');
const SITE = require('./_site');

module.exports = async function (req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405; res.setHeader('Allow', 'GET, HEAD'); return res.end();
  }
  let member = false;
  try { member = await L.pageAccess(req); } catch (e) { member = false; }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  res.end(req.method === 'HEAD' ? undefined : (member ? SITE.full : SITE.public));
};
