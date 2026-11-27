'use strict';
// Builds api/_site.js from src/index.html. Run `npm run site` after any
// change to src/index.html (npm run check fails while it is out of date).
//
//   full    the whole site, for signed-in members
//   public  the sign-in screens only, for everyone else: the members' area
//           markup is replaced by empty placeholders and the styles that only
//           the members' area uses are left out
//
// Both are minified, and the page script is obfuscated so it can't be read
// back or fed to a tool to rebuild the site.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const csso = require('csso');
const { minify } = require('html-minifier-terser');
const JO = require('javascript-obfuscator');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'index.html');
const OUT = path.join(ROOT, 'api', '_site.js');

function hashOf(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// the members' area: <section id="v-app"> up to its matching </section>
function appRange(html) {
  const start = html.indexOf('<section id="v-app"');
  if (start < 0) throw new Error('no <section id="v-app"> in src/index.html');
  const re = /<section\b|<\/section>/g;
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    depth += m[0] === '</section>' ? -1 : 1;
    if (depth === 0) return [start, m.index + m[0].length];
  }
  throw new Error('unbalanced <section id="v-app">');
}

// class and id names used in a piece of markup
function tokens(markup) {
  const out = new Set();
  markup.replace(/\bclass="([^"]*)"/g, (_, c) => {
    c.split(/\s+/).filter(Boolean).forEach(t => out.add('.' + t));
  });
  markup.replace(/\bid="([^"]*)"/g, (_, i) => { out.add('#' + i); });
  return out;
}

// class names the script can put on anything at run time
function scriptClasses(js) {
  const out = new Set();
  const add = s => s.split(/\s+/).filter(Boolean).forEach(t => out.add('.' + t));
  js.replace(/setCls\([^,]+,\s*'([^']+)'/g, (_, c) => add(c));
  js.replace(/classList\.(?:add|remove|toggle)\(\s*'([^']+)'/g, (_, c) => add(c));
  js.replace(/className\s*=\s*'([^']*)'/g, (_, c) => add(c));
  js.replace(/className\s*\+=\s*'([^']*)'/g, (_, c) => add(c));
  js.replace(/class="([^"'+]*)"/g, (_, c) => add(c));
  js.replace(/class=\\?'([^'\\+]*)\\?'/g, (_, c) => add(c));
  return out;
}

// leave out every selector that needs something only the members' area has
function pruneCss(css, memberOnly) {
  const S = csso.syntax;
  const ast = S.parse(css);
  let dropped = 0;
  S.walk(ast, {
    visit: 'Rule',
    enter(node, item, list) {
      if (!node.prelude || node.prelude.type !== 'SelectorList') return;
      const sels = node.prelude.children, gone = [];
      sels.forEach((sel, it) => {
        let needsMember = false;
        S.walk(sel, n => {
          if (n.type === 'ClassSelector' && memberOnly.has('.' + n.name)) needsMember = true;
          if (n.type === 'IdSelector' && memberOnly.has('#' + n.name)) needsMember = true;
        });
        if (needsMember) gone.push(it);
      });
      if (gone.length === sels.size) { list.remove(item); dropped++; return; }
      gone.forEach(it => sels.remove(it));
    }
  });
  return { css: S.generate(ast), dropped };
}

const VOID = new Set(['input', 'img', 'br', 'hr', 'source', 'track', 'wbr', 'meta', 'link']);

async function build() {
  const src = fs.readFileSync(SRC, 'utf8');

  // the one inline page script
  const sm = /<script>([\s\S]*?)<\/script>/.exec(src);
  if (!sm || /<script>[\s\S]*<script>/.test(src.slice(sm.index + 8))) {
    throw new Error('expected exactly one inline <script> in src/index.html');
  }
  const js = sm[1];
  const jsOut = JO.obfuscate(js, {
    compact: true,
    target: 'browser',
    seed: 20261127,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.8,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 2,
    stringArrayWrappersType: 'function',
    splitStrings: false,
    // these cost speed at run time; animations stay smooth without them
    controlFlowFlattening: false,
    deadCodeInjection: false,
    selfDefending: false,
    debugProtection: false,
    transformObjectKeys: false,
    unicodeEscapeSequence: false
  }).getObfuscatedCode();

  // the stylesheet
  const stm = /<style>([\s\S]*?)<\/style>/.exec(src);
  if (!stm) throw new Error('no <style> in src/index.html');
  const css = stm[1];

  const [a, b] = appRange(src);
  const app = src.slice(a, b);
  const outside = (src.slice(0, a) + src.slice(b))
    .replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<style>[\s\S]*?<\/style>/g, '');
  const pub = new Set([...tokens(outside), ...scriptClasses(js)]);
  const memberOnly = new Set([...tokens(app)].filter(t => !pub.has(t)));

  // empty stand-ins keep every id the script looks up at load
  const ids = [];
  app.slice(app.indexOf('>') + 1).replace(/<([a-z][a-z0-9]*)\b[^>]*\bid="([^"]+)"[^>]*>/gi,
    (_, tag, id) => {
      tag = tag.toLowerCase();
      ids.push(VOID.has(tag) ? '<' + tag + ' id="' + id + '" hidden>' :
        '<' + tag + ' id="' + id + '" hidden></' + tag + '>');
    });
  const openTag = app.slice(0, app.indexOf('>') + 1);
  const appStub = openTag + ids.join('') + '</section>';

  const pruned = pruneCss(css, memberOnly);
  const cssFull = csso.minify(css, { restructure: false }).css;
  const cssPub = csso.minify(pruned.css, { restructure: false }).css;

  async function page(markup, sheet) {
    let h = markup.replace(stm[0], '<style>' + sheet + '</style>');
    h = h.replace(sm[0], '<script>/*JS*/</script>');
    h = await minify(h, {
      collapseWhitespace: true, conservativeCollapse: true, removeComments: true,
      minifyCSS: false, minifyJS: false, keepClosingSlash: true,
      removeAttributeQuotes: false, sortAttributes: false
    });
    // put the obfuscated script back after minifying (a function, so
    // "$&"-style patterns in it are left alone)
    return h.replace('<script>/*JS*/</script>', () => '<script>' + jsOut + '</script>');
  }

  const full = await page(src, cssFull);
  const publicPage = await page(src.slice(0, a) + appStub + src.slice(b), cssPub);

  const out = "'use strict';\n" +
    '// GENERATED by dev/build-site.js from src/index.html. Do not edit by hand:\n' +
    '// change src/index.html and run `npm run site`.\n' +
    'module.exports = {\n' +
    '  hash: ' + JSON.stringify(hashOf(src)) + ',\n' +
    '  full: ' + JSON.stringify(full) + ',\n' +
    '  public: ' + JSON.stringify(publicPage) + '\n' +
    '};\n';
  fs.writeFileSync(OUT, out);
  console.log('api/_site.js: full ' + Math.round(full.length / 1024) + ' KB, public ' +
    Math.round(publicPage.length / 1024) + ' KB; ' + pruned.dropped +
    ' members-only style rules left out of the public page; ' + memberOnly.size +
    ' members-only names');
}

module.exports = { build, hashOf };
if (require.main === module) build().catch(e => { console.error(e); process.exitCode = 1; });
