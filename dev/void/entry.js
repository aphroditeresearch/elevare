// ELEVARE sign-in intro: "Unlimited Void V2".
// Built into /domain.js by `npm run build` in this folder (see README).
//
// Every picture on screen is one of the supplied textures in /void/
// (01 flash, 02 reality tear, 03 acceleration, 04 void environment,
// 05 ink transition, 10 ink mask). The shader only moves, masks, blends
// and distorts those pixels; it never draws new artwork. The logo is a
// separate transparent <img> above the canvas and is never processed.
//
// Timing (from the storyboard README):
//   0.0-1.0  flash         1.0-2.5  reality tears     2.5-4.5  acceleration
//   4.5-7.5  the void      7.5-9.5  ink transition    9.5-13   logo + hold
// Anime language: anticipation before each move, impact frames (1-2
// frames of inverted black/white) on each hit, decaying camera shake,
// radial speed smears on fast moves, and short held beats between cuts.

import { WebGLRenderer } from 'three/src/renderers/WebGLRenderer.js';
import { Scene } from 'three/src/scenes/Scene.js';
import { OrthographicCamera } from 'three/src/cameras/OrthographicCamera.js';
import { Mesh } from 'three/src/objects/Mesh.js';
import { BufferGeometry } from 'three/src/core/BufferGeometry.js';
import { BufferAttribute } from 'three/src/core/BufferAttribute.js';
import { ShaderMaterial } from 'three/src/materials/ShaderMaterial.js';
import { Texture } from 'three/src/textures/Texture.js';
import { Vector2 } from 'three/src/math/Vector2.js';
import { LinearFilter, ClampToEdgeWrapping } from 'three/src/constants.js';
import { gsap } from 'gsap';

const SEEN_KEY = 'elevare.voidSeen';
const TEX = ['t01', 't02', 't03', 't04', 't05', 't10'];

const VERT = `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
uniform sampler2D t01, t02, t03, t04, t05, t10;
uniform vec2 uRes;        // canvas size in px
uniform vec2 uAsp;        // aspect (w/h): x = panels 01-03, y = 04/05/10
uniform vec2 uCenter04;   // the ring's centre inside texture 04 (uv)
uniform float uT;         // ambient time (s)
uniform float wFlash, wTear, wAcc, wVoid, wInk;
uniform float zFlash, zTear, zAcc, zVoid, zInk;
uniform float tearOpen;   // 0..1 how far the tear has spread
uniform float accT;       // acceleration travel
uniform float smear;      // radial speed smear 0..1
uniform float inkCover;   // 0..1 ink sweeps across
uniform float inkSlide;   // ink drift along its stroke
uniform float impact;     // 0..1 impact frame (invert)
uniform vec2 shake;       // camera shake offset (screen units)
uniform float rot;        // small camera roll
uniform float idle;       // 0..1 ambient life in the void
uniform float fade;       // 0..1 fade from black at the very start
varying vec2 vUv;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
// screen point -> texture uv for a cover-fitted panel, zoomed about c
vec2 cover(vec2 p, float asp, vec2 c, float zoom) {
  float sa = uRes.x / uRes.y;
  vec2 s = sa > asp ? vec2(1.0, asp / sa) : vec2(sa / asp, 1.0);
  return c + p * s / zoom;
}
vec3 tex(sampler2D t, vec2 uv) {
  return texture2D(t, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
}
// radial smear toward the focal point: several taps along the ray
vec3 smeared(sampler2D t, vec2 p, float asp, vec2 c, float z, float amt) {
  if (amt < 0.01) return tex(t, cover(p, asp, c, z));
  vec3 acc = vec3(0.0); float wsum = 0.0;
  float j = hash(p * uRes + uT) / 11.0;      // dither: no banding
  for (int i = 0; i < 12; i++) {
    float k = float(i) / 11.0 + j;
    float w = 1.0 - k * 0.6;
    acc += tex(t, cover(p, asp, c, z * (1.0 + amt * 0.22 * k))) * w;
    wsum += w;
  }
  return acc / wsum;
}
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

void main() {
  vec2 p = vUv - 0.5;
  p = rot2(rot) * p + shake;
  vec3 col = vec3(0.0);
  vec2 C = vec2(0.5);

  // 01 flash: white burst, pulled slightly toward the viewer
  if (wFlash > 0.001) col += tex(t01, cover(p, uAsp.x, C, zFlash)) * wFlash;

  // 02 reality tear: the panel's own darkness spreads by thresholding its
  // luminance; anything not yet torn stays the flash white
  if (wTear > 0.001) {
    vec2 uv = cover(p, uAsp.x, C, zTear);
    vec3 c2 = smeared(t02, p, uAsp.x, C, zTear, smear);
    float lum = dot(tex(t02, uv), vec3(0.3, 0.55, 0.15));
    float th = mix(1.05, -0.05, tearOpen);   // darkest parts tear first
    float torn = smoothstep(th - 0.08, th + 0.08, 1.0 - lum);
    vec3 white = tex(t01, cover(p, uAsp.x, C, 1.0));
    col += mix(white, c2, torn) * wTear;
  }

  // 03 acceleration: an endless push through the tunnel. Two copies of
  // the panel an octave apart cross-fade, so the zoom never ends
  if (wAcc > 0.001) {
    float f = fract(accT);
    vec2 pr = rot2(accT * 0.12) * p;
    vec3 a = smeared(t03, pr, uAsp.x, C, exp2(f) * zAcc, smear);
    vec3 b = smeared(t03, pr, uAsp.x, C, exp2(f - 1.0) * zAcc, smear);
    col += mix(b, a, smoothstep(0.0, 1.0, 1.0 - f)) * wAcc;
  }

  // 04 the void. Ambient life is UV displacement of the panel itself:
  // the energy band ripples sideways, the clouds breathe, and the ring's
  // light drifts very slowly around it
  if (wVoid > 0.001) {
    vec2 uv = cover(p, uAsp.y, uCenter04, zVoid);
    vec2 d = uv - uCenter04;
    float rr = length(d * vec2(uAsp.y, 1.0));
    float n1 = noise(uv * vec2(9.0, 5.0) + vec2(uT * 0.06, 0.0)) - 0.5;
    float n2 = noise(uv * vec2(4.0, 7.0) - vec2(0.0, uT * 0.05)) - 0.5;
    float band = exp(-pow((uv.y - uCenter04.y) / 0.08, 2.0));
    vec2 disp = vec2(n1 * 0.006 + band * sin(uv.x * 18.0 - uT * 0.6) * 0.0025,
                     n2 * 0.006);
    float ringW = exp(-pow((rr - 0.2) / 0.07, 2.0));
    disp += vec2(-d.y, d.x) * ringW * 0.03 * sin(uT * 0.2);
    vec3 v4 = smeared(t04, p, uAsp.y, uCenter04, zVoid, smear * 0.6);
    v4 = mix(v4, tex(t04, uv + disp), idle);
    col += v4 * wVoid;
  }

  // 05 ink transition: the ink panel sweeps over the void through the
  // supplied ink mask (10), sliding along its stroke direction
  if (wInk > 0.001) {
    vec2 uv5 = cover(p, uAsp.y, C, zInk) + vec2(-0.10, 0.045) * inkSlide;
    float m = dot(tex(t10, uv5), vec3(0.3333));
    float th = mix(1.05, -0.05, inkCover);
    float a = smoothstep(th - 0.06, th + 0.06, m);
    col = mix(col, tex(t05, uv5), a * wInk);
  }

  // impact frame: inverted black and white for a beat
  float g = dot(col, vec3(0.3, 0.55, 0.15));
  col = mix(col, vec3(1.0 - smoothstep(0.15, 0.6, g)), impact);

  // a breath of grain so the panels sit together as one film
  col += (hash(vUv * uRes + fract(uT) * 97.0) - 0.5) * 0.018;
  col *= fade;
  gl_FragColor = vec4(col, 1.0);
}`;

function loadTexture(img) {
  const t = new Texture(img);
  t.minFilter = LinearFilter; t.magFilter = LinearFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

function start(section) {
  const canvas = section.querySelector('.uv-gl');
  const skipBtn = section.querySelector('.uv-skip');
  const imgs = {};
  TEX.forEach(k => { imgs[k] = section.querySelector('img[data-tex="' + k + '"]'); });
  const calm = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let seen = false;
  try { seen = sessionStorage.getItem(SEEN_KEY) === '1'; } catch (e) {}

  function finishUI(instant) {
    try { sessionStorage.setItem(SEEN_KEY, '1'); } catch (e) {}
    section.classList.add('uv-done', 'uv-logo-in');
    if (instant) section.classList.add('uv-instant');
    if (skipBtn) skipBtn.hidden = true;
  }

  let renderer = null;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false,
      powerPreference: 'high-performance' });
  } catch (e) { renderer = null; }
  if (!renderer || !renderer.capabilities) {
    section.classList.add('uv-nogl'); finishUI(true); return;
  }
  renderer.setPixelRatio(1);

  const U = {
    uRes: { value: new Vector2(1, 1) }, uAsp: { value: new Vector2(2.25, 2.29) },
    uCenter04: { value: new Vector2(0.5, 0.5) }, uT: { value: 0 },
    wFlash: { value: 0 }, wTear: { value: 0 }, wAcc: { value: 0 },
    wVoid: { value: 0 }, wInk: { value: 0 },
    zFlash: { value: 1 }, zTear: { value: 1 }, zAcc: { value: 1 },
    zVoid: { value: 1 }, zInk: { value: 1 },
    tearOpen: { value: 0 }, accT: { value: 0 }, smear: { value: 0 },
    inkCover: { value: 0 }, inkSlide: { value: 0 }, impact: { value: 0 },
    shake: { value: new Vector2() }, rot: { value: 0 }, idle: { value: 0 },
    fade: { value: 0 }
  };
  TEX.forEach(k => { U[k] = { value: loadTexture(imgs[k]) }; });
  const c04 = (section.getAttribute('data-ring') || '0.5 0.5').split(' ');
  U.uCenter04.value.set(+c04[0], +c04[1]);
  U.uAsp.value.set(imgs.t01.naturalWidth / imgs.t01.naturalHeight,
    imgs.t04.naturalWidth / imgs.t04.naturalHeight);

  const mat = new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG,
    uniforms: U, depthTest: false, depthWrite: false });
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(
    new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const mesh = new Mesh(geo, mat); mesh.frustumCulled = false;
  const scene = new Scene(); scene.add(mesh);
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // adaptive resolution
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const MAXS = Math.min(1.25, dpr), MINS = 0.45;
  let scale = Math.min(MAXS, 1);
  let W = 0, H = 0;
  function resize() {
    W = section.clientWidth; H = section.clientHeight;
    const w = Math.max(2, Math.round(W * scale)), h = Math.max(2, Math.round(H * scale));
    renderer.setSize(w, h, false);
    U.uRes.value.set(w, h);
  }
  resize();
  window.addEventListener('resize', resize);

  // camera shake: a decaying kick, re-triggered on each impact
  const K = { amp: 0 };
  function kick(a) { K.amp = Math.max(K.amp, a); }

  // ---- the sequence ----
  const tl = gsap.timeline({ paused: true });
  // 0.0-1.0 flash: open from black into white, gently pulled toward us
  tl.to(U.fade, { value: 1, duration: 0.25, ease: 'power2.out' }, 0)
    .set(U.wFlash, { value: 1 }, 0)
    .fromTo(U.zFlash, { value: 1.25 }, { value: 1.0, duration: 1.0, ease: 'expo.out' }, 0)
  // 1.0-2.5 reality tears: anticipation (a small pull back), then the
  // tear spreads out of the centre while the camera pushes in
    .to(U.zFlash, { value: 0.96, duration: 0.18, ease: 'sine.inOut' }, 0.82)
    .set(U.wTear, { value: 1 }, 1.0).set(U.wFlash, { value: 0 }, 1.0)
    .fromTo(U.zTear, { value: 0.96 }, { value: 1.4, duration: 1.5, ease: 'power2.in' }, 1.0)
    .fromTo(U.tearOpen, { value: 0 }, { value: 1, duration: 1.15, ease: 'expo.out' }, 1.0)
    .fromTo(U.smear, { value: 0 }, { value: 1, duration: 0.5, ease: 'power3.in' }, 2.0)
  // 2.5-4.5 acceleration: punch through into the tunnel
    .set(U.wTear, { value: 0 }, 2.5).set(U.wAcc, { value: 1 }, 2.5)
    .fromTo(U.accT, { value: 0 }, { value: 5.2, duration: 2.0, ease: 'power1.in' }, 2.5)
    .fromTo(U.zAcc, { value: 1.0 }, { value: 1.12, duration: 2.0, ease: 'none' }, 2.5)
    .to(U.smear, { value: 0.5, duration: 0.6, ease: 'power2.out' }, 2.5)
    .to(U.smear, { value: 1.1, duration: 1.2, ease: 'power2.in' }, 3.2)
    .fromTo(U.rot, { value: 0 }, { value: 0.05, duration: 2.0, ease: 'sine.inOut' }, 2.5)
  // white flash on the way out of the tunnel
    .set(U.zFlash, { value: 1.0 }, 4.25)
    .fromTo(U.wFlash, { value: 0 }, { value: 1, duration: 0.2, ease: 'power2.in' }, 4.25)
  // 4.5-7.5 the void: hard cut in, overshooting zoom settles, ambient life
    .set(U.wAcc, { value: 0 }, 4.5).set(U.wVoid, { value: 1 }, 4.5)
    .set(U.rot, { value: 0 }, 4.5)
    .to(U.wFlash, { value: 0, duration: 0.55, ease: 'power2.out' }, 4.5)
    .fromTo(U.zVoid, { value: 1.55 }, { value: 1.0, duration: 1.3, ease: 'expo.out' }, 4.5)
    .fromTo(U.smear, { value: 0.9 }, { value: 0, duration: 0.9, ease: 'power3.out' }, 4.5)
    .to(U.idle, { value: 1, duration: 2.0, ease: 'sine.inOut' }, 5.2)
  // 7.5-9.5 ink transition: the void draws back, the ink slashes across,
  // holds a beat, then drags off to reveal the void again
    .to(U.zVoid, { value: 0.97, duration: 0.25, ease: 'sine.inOut' }, 7.25)
    .set(U.wInk, { value: 1 }, 7.5)
    .fromTo(U.inkCover, { value: 0 }, { value: 1, duration: 0.42, ease: 'expo.out' }, 7.5)
    .fromTo(U.inkSlide, { value: -0.6 }, { value: 0.6, duration: 2.0, ease: 'power1.inOut' }, 7.5)
    .fromTo(U.zInk, { value: 1.08 }, { value: 1.0, duration: 2.0, ease: 'power1.out' }, 7.5)
    .to(U.zVoid, { value: 1.0, duration: 1.6, ease: 'power2.out' }, 7.6)
    .to(U.inkCover, { value: 0, duration: 0.75, ease: 'power3.in' }, 8.75)
    .set(U.wInk, { value: 0 }, 9.5)
  // 9.5-13 logo reveal, then hold
    .call(() => section.classList.add('uv-logo-in'), null, 9.55)
    .call(() => finishUI(false), null, 11.2)
    .to({}, { duration: 1.8 }, 11.2);
  // impact frames: inverted black and white on each hit, with a shake
  [[1.0, 0.05], [2.5, 0.07], [4.5, 0.05], [7.5, 0.035]].forEach(([at, len]) => {
    tl.set(U.impact, { value: 1 }, at).set(U.impact, { value: 0 }, at + len)
      .call(() => kick(0.02), null, at);
  });

  function skip() { tl.progress(1); finishUI(false); }
  if (skipBtn) skipBtn.addEventListener('click', skip);

  // test hook: lets automated checks hold the sequence at a given moment
  const hook = { tl: tl, hold: false, fixed: false,
    setScale: (v) => { scale = v; hook.fixed = true; resize(); } };
  window.__elevareVoid = hook;

  // ---- loop ----
  let last = 0, acc = 0, frames = 0, lastGrow = 0, started = false, amb = 0;
  function visible() { return section.classList.contains('on') && !document.hidden; }
  function draw() { renderer.render(scene, cam); }
  function begin() {
    started = true;
    if (calm || seen) { tl.progress(1); amb = 40; finishUI(true); }
    else { if (skipBtn) skipBtn.hidden = false; tl.play(0); }
    if (calm) { resize(); draw(); }
  }
  function frame(now) {
    requestAnimationFrame(frame);
    if (!visible()) { last = 0; tl.pause(); return; }
    if (section.clientWidth !== W || section.clientHeight !== H) resize();
    if (!started) { begin(); if (calm) return; }
    if (calm) return;
    if (!hook.hold && tl.paused() && tl.progress() < 1) tl.resume();
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0.016;
    last = now;
    amb += dt * (tl.progress() >= 1 ? 0.6 : 1);     // calmer once settled
    U.uT.value = amb;
    K.amp *= Math.exp(-dt * 7.5);                     // shake decays
    U.shake.value.set(Math.sin(now * 0.163) * K.amp,
      Math.cos(now * 0.131) * K.amp * 0.7);
    draw();
    acc += dt; frames++;
    if (frames >= 40 && !hook.fixed) {
      const avg = acc / frames; acc = 0; frames = 0;
      if (avg > 0.024 && scale > MINS) { scale = Math.max(MINS, scale * 0.82); resize(); }
      else if (avg < 0.0145 && scale < MAXS && now - lastGrow > 4000) {
        scale = Math.min(MAXS, scale * 1.1); lastGrow = now; resize();
      }
    }
  }
  requestAnimationFrame(frame);
}

function boot() {
  const s = document.getElementById('v-login');
  if (!s || !s.classList.contains('uv')) return;
  const all = [].slice.call(s.querySelectorAll('img[data-tex], .uv-logo'));
  Promise.all(all.map(i => (i.decode ? i.decode() : Promise.resolve())
    .catch(() => {}))).then(() => start(s));
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else boot();
