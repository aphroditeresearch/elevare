// ---------------------------------------------------------------------------
// BRAND SETTINGS: everything that makes this site look like one brand.
//
// To launch the same site for another brand or mentorship:
//   1. Change the values below.
//   2. Replace logo.png, favicon.png and apple-touch-icon.png with the new
//      brand's images (same file names).
// Nothing else in the code needs to change. See NEW-BRAND.md for the full
// step-by-step setup.
//
// Plain ASCII only in this file (no emoji or curly quotes).
// ---------------------------------------------------------------------------
(function (b) {
  if (typeof module !== 'undefined' && module.exports) module.exports = b;
  else window.BRAND = b;
})({
  // Full name, shown in the browser tab, messages, alerts and reports.
  name: 'Elevare',

  // Short mark shown as the giant outlined letters on the sign-in page and
  // the profile banner (1-3 characters works best, e.g. 'V2', 'X', 'PRO').
  mark: 'LVR',

  // Line under the logo on the sign-in page.
  tagline: 'Private Trading Community',

  // Accent colour (buttons, dots, highlights) and a brighter version of it
  // (numbers, labels, the timeout clock). Hex colours.
  accent: '#7c2cf0',
  accentBright: '#a974ff',

  // Top-bar wordmark: the name in white with these letter positions
  // (0 = first letter) in the accent colour. [] = all white.
  wordmark: 'ELEVARE',
  wordmarkAccent: [1, 3, 5],

  // Short lowercase word used in downloaded file names
  // (e.g. elevare-members-2026-11-22.csv).
  fileSlug: 'elevare'
});
