// ELEVARE sign-in intro: "the void".
// Built into /domain.js by `npm run build` in this folder (see README).
//
// Three render passes on one full-screen triangle:
//   A  energy   - lensing, streaks, the point of light and the energy
//                 currents around the central void (rendered at an adaptive
//                 fraction of screen resolution)
//   B  bloom    - only the brightest parts of A, blurred at half of A's size
//   C  final    - A + selective bloom, chromatic separation toward the
//                 edges, gentle tone curve, grain and vignette, to the screen
// The ELEVARE logo is an ordinary <img> above the canvas, so it is never
// touched by any of this and stays perfectly sharp.

import { WebGLRenderer } from 'three/src/renderers/WebGLRenderer.js';
import { WebGLRenderTarget } from 'three/src/renderers/WebGLRenderTarget.js';
import { Scene } from 'three/src/scenes/Scene.js';
import { OrthographicCamera } from 'three/src/cameras/OrthographicCamera.js';
import { Mesh } from 'three/src/objects/Mesh.js';
import { BufferGeometry } from 'three/src/core/BufferGeometry.js';
import { BufferAttribute } from 'three/src/core/BufferAttribute.js';
import { ShaderMaterial } from 'three/src/materials/ShaderMaterial.js';
import { Vector2 } from 'three/src/math/Vector2.js';
import { HalfFloatType, LinearFilter } from 'three/src/constants.js';
import { gsap } from 'gsap';

const SEEN_KEY = 'elevare.voidSeen';

const VERT = `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const NOISE = `
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float hash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash3(i), hash3(i + vec3(1,0,0)), u.x),
                mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), u.x), u.y);
  float b = mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), u.x),
                mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), u.x), u.y);
  return mix(a, b, u.z);
}
float fbm3(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) { v += a * noise3(p); p = p * 2.03 + 1.7; a *= 0.5; }
  return v;
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}`;

const FRAG_ENERGY = `
precision highp float;
uniform vec2 uRes;      // render-target size in px
uniform vec2 uAxis;     // semi-axes of the central void (screen-height units)
uniform float uTime;    // flow time (already scaled by the current speed)
uniform float uPoint;   // 0..1 the first point of light
uniform float uCollapse;// 0..1 the point pulls inward before expanding
uniform float uLens;    // gravitational pull toward the centre
uniform float uExpand;  // 0..1 the void opens to full size
uniform float uStreak;  // 0..1 radial light streaks
uniform float uFlash;   // 0..1 white-blue flash at the moment of expansion
uniform float uEnergy;  // 0..1 the energy currents around the void
varying vec2 vUv;
${NOISE}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float r0 = length(p);
  vec2 dir = p / max(r0, 1e-4);

  // gravitational lensing: space is pulled toward the centre
  vec2 pl = p - dir * uLens * 0.035 / (r0 + 0.06);

  vec2 q = pl / uAxis;            // void-shaped (elliptical) space
  float r = length(q);
  float t = uTime;
  vec3 col = vec3(0.0);

  // faint midnight depth so the black has distance in it
  col += vec3(0.0, 0.010, 0.035) * smoothstep(0.15, 1.5, r0)
       * (0.35 + 0.65 * uEnergy);

  // ---- the domain: cel-shaded fractal clouds spiralling into the void ----
  float R = uExpand;
  float ang = atan(q.y, q.x);
  vec2 cs0 = vec2(cos(ang), sin(ang));
  // the void's edge breathes a little so it never reads as a perfect ring
  R *= 1.0 + 0.045 * (fbm(cs0 * 2.0 + t * 0.03) - 0.5);
  float lr = log(max(r, 1e-3));
  // logarithmic spiral: angle twists with depth, and the clouds drift
  // inward toward the void over time (a tunnel converging on the centre)
  float twist = ang + 1.15 * lr + t * 0.035;
  vec2 cs = vec2(cos(twist), sin(twist));
  vec3 cp = vec3(cs * 3.2, lr * 4.2 + t * 0.22);
  vec3 warp = vec3(fbm3(cp * 0.7 + 3.1), fbm3(cp * 0.7 + 7.7), 0.0) - 0.5;
  float v = fbm3(cp + warp * 0.9);                 // cloud field
  // fractal edge breakup: jagged, snowflake-like cloud borders
  float jag = fbm3(cp * 5.5 + warp * 2.0 + 21.0) - 0.5;
  v += jag * 0.22;
  float v2 = fbm3(cp * 1.9 + warp * 1.4 + 11.0);   // inner shading
  // denser further out, sparse wisps near the void, and a dark moat
  float th = mix(0.55, 0.45, smoothstep(R + 0.02, R + 0.9, r));
  float aa = 0.007;
  float cloud = smoothstep(th - aa, th + aa, v);
  float lit   = smoothstep(th + 0.05 - aa, th + 0.05 + aa, v * 0.7 + v2 * 0.42);
  float hi    = smoothstep(th + 0.13 - aa, th + 0.13 + aa, v * 0.6 + v2 * 0.55);
  vec3 cobalt = vec3(0.09, 0.20, 0.95);
  vec3 lav    = vec3(0.60, 0.66, 1.00);
  vec3 white  = vec3(0.95, 0.97, 1.00);
  vec3 cel = mix(cobalt * 0.85, mix(lav, white, hi), lit);
  float reach = smoothstep(R, R + 0.05, r);
  col += cel * cloud * reach * uEnergy;
  // faint cobalt haze between the clouds, deepening toward the edges
  col += cobalt * 0.05 * (1.0 - cloud) * reach * uEnergy
       * smoothstep(R + 0.2, R + 1.4, r);

  // the void itself: absolute darkness with a hairline edge
  col *= smoothstep(R - 0.012, R + 0.03, r);

  // the first point of light, shrinking and brightening as it collapses
  float sz = mix(0.0032, 0.0016, uCollapse);
  float core = exp(-r0 * r0 / (sz * sz));
  float halo = (0.00006 + 0.00022 * uCollapse) / (r0 * r0 + 0.00004);
  float spike = exp(-abs(p.y) * 900.0) * exp(-abs(p.x) * 22.0)
              + 0.55 * exp(-abs(p.x) * 900.0) * exp(-abs(p.y) * 38.0);
  col += vec3(0.62, 0.78, 1.0) * uPoint * (core * 1.6 + halo + spike * 0.9);

  // directional light streaks thrown out as space is stretched apart
  float pa = atan(p.y, p.x);
  float lane = hash(vec2(floor((pa + 3.14159) * 57.3 * 1.4), 7.0));
  float fine = noise(vec2(pa * 140.0, 3.0));
  float streak = pow(fine, 14.0) * 0.9 + pow(lane, 30.0) * 2.2;
  streak *= exp(-r0 * mix(9.0, 1.4, uStreak)) * smoothstep(0.0, 0.02, r0);
  col += mix(vec3(0.10, 0.30, 1.0), vec3(0.70, 0.82, 1.0), pow(lane, 30.0))
       * streak * uStreak * 1.1;
  col += vec3(0.30, 0.52, 1.0) * uStreak * (0.05 / (r0 * r0 * 40.0 + 0.05)) * 0.9;

  // the flash as the domain opens
  col += vec3(0.62, 0.78, 1.0) * uFlash * exp(-r0 * 4.0) * 0.9;

  gl_FragColor = vec4(col, 1.0);
}`;

const FRAG_BLOOM = `
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel;   // 1 / size of the energy target
varying vec2 vUv;
vec3 bright(vec2 uv) {
  vec3 c = texture2D(uSrc, uv).rgb;
  float l = max(c.r, max(c.g, c.b));
  return c * smoothstep(0.62, 1.1, l);   // only the brightest energy blooms
}
void main() {
  vec3 acc = vec3(0.0); float wsum = 0.0;
  for (int i = 0; i < 24; i++) {          // golden-angle spiral gather
    float fi = float(i);
    float rad = sqrt(fi + 0.5) * 3.2;
    float a = fi * 2.39996;
    vec2 o = vec2(cos(a), sin(a)) * rad * uTexel;
    float wt = 1.0 - fi / 26.0;
    acc += bright(vUv + o) * wt; wsum += wt;
  }
  gl_FragColor = vec4(acc / wsum, 1.0);
}`;

const FRAG_FINAL = `
precision highp float;
uniform sampler2D uSrc;
uniform sampler2D uBloom;
uniform vec2 uRes;
uniform float uChroma;   // chromatic separation strength
uniform float uGrainT;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 d = vUv - 0.5;
  float edge = dot(d, d) * 4.0;                       // 0 centre .. ~2 corners
  vec2 off = d * uChroma * 0.008 * edge;
  vec3 col;
  col.r = texture2D(uSrc, vUv + off).r;
  col.g = texture2D(uSrc, vUv).g;
  col.b = texture2D(uSrc, vUv - off).b;
  col += texture2D(uBloom, vUv).rgb * 0.75;
  col = 1.0 - exp(-col * 1.3);                         // soft shoulder
  col *= 1.0 - 0.38 * pow(clamp(edge * 0.55, 0.0, 1.0), 1.5);   // vignette
  col += (h(vUv * uRes + uGrainT) - 0.5) * 0.022;     // film grain
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

function start(section) {
  const canvas = section.querySelector('.uv-gl');
  const logo = section.querySelector('.uv-logo');
  const disp = document.getElementById('uvDisp');
  const smear = document.getElementById('uvSmear');
  const fadeIns = section.querySelectorAll('.uv-in');
  const skipBtn = section.querySelector('.uv-skip');
  const calm = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let seen = false;
  try { seen = sessionStorage.getItem(SEEN_KEY) === '1'; } catch (e) {}

  // logo reveal state (needed even without WebGL)
  const S = { flow: 1 };      // flow speed: 1 during the void, slow after
  const L = { disp: 24, blur: 46, op: 0 };
  function setLogo() {
    disp.setAttribute('scale', L.disp.toFixed(2));
    logo.style.opacity = L.op;
    smear.setAttribute('stdDeviation', L.blur.toFixed(2) + ' ' + (L.blur * 0.04).toFixed(2));
    logo.style.filter = L.disp > 0.05 || L.blur > 0.05 ? 'url(#uvWarp)' : 'none';
  }
  setLogo();

  // ---- WebGL ----
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false,
      powerPreference: 'high-performance' });
  } catch (e) { renderer = null; }
  if (!renderer || !renderer.capabilities) {
    section.classList.add('uv-nogl');
    finishUI(true);
    return;
  }
  renderer.setPixelRatio(1);
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(
    new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const mesh = new Mesh(geo);
  mesh.frustumCulled = false;
  const scene = new Scene(); scene.add(mesh);

  const U = {
    uRes: { value: new Vector2(1, 1) }, uAxis: { value: new Vector2(.6, .3) },
    uTime: { value: 0 }, uPoint: { value: 0 }, uCollapse: { value: 0 },
    uLens: { value: 0 }, uExpand: { value: 0 }, uStreak: { value: 0 },
    uFlash: { value: 0 }, uEnergy: { value: 0 }
  };
  const mA = new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG_ENERGY,
    uniforms: U, depthTest: false, depthWrite: false });
  const UB = { uSrc: { value: null }, uTexel: { value: new Vector2() } };
  const mB = new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG_BLOOM,
    uniforms: UB, depthTest: false, depthWrite: false });
  const UC = { uSrc: { value: null }, uBloom: { value: null },
    uRes: { value: new Vector2() }, uChroma: { value: 1 }, uGrainT: { value: 0 } };
  const mC = new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG_FINAL,
    uniforms: UC, depthTest: false, depthWrite: false });

  const rtOpts = { type: HalfFloatType, minFilter: LinearFilter,
    magFilter: LinearFilter, depthBuffer: false };
  const rtA = new WebGLRenderTarget(4, 4, rtOpts);
  const rtB = new WebGLRenderTarget(4, 4, rtOpts);

  // adaptive resolution: energy pass at a fraction of the screen
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const MAXS = Math.min(1, 0.9 * dpr), MINS = 0.4;
  let scale = Math.min(MAXS, 0.75 * dpr);
  let W = 0, H = 0;
  function resize() {
    W = section.clientWidth; H = section.clientHeight;
    renderer.setSize(Math.round(W * Math.min(dpr, 1.5)),
      Math.round(H * Math.min(dpr, 1.5)), false);
    const aw = Math.max(2, Math.round(W * scale)), ah = Math.max(2, Math.round(H * scale));
    rtA.setSize(aw, ah);
    rtB.setSize(Math.max(2, aw >> 1), Math.max(2, ah >> 1));
    U.uRes.value.set(aw, ah);
    UB.uTexel.value.set(1 / aw, 1 / ah);
    UC.uRes.value.set(W, H);
    // the void hugs the logo: width from the logo, height from the screen
    const lw = logo.getBoundingClientRect().width || W * 0.6;
    U.uAxis.value.set(Math.max(0.3, (lw / H) * 0.62), 0.27);
  }
  resize();
  window.addEventListener('resize', resize);

  function render(dt) {
    mesh.material = mA; renderer.setRenderTarget(rtA); renderer.render(scene, cam);
    UB.uSrc.value = rtA.texture;
    mesh.material = mB; renderer.setRenderTarget(rtB); renderer.render(scene, cam);
    UC.uSrc.value = rtA.texture; UC.uBloom.value = rtB.texture;
    UC.uGrainT.value = (UC.uGrainT.value + 17.3) % 1000;
    mesh.material = mC; renderer.setRenderTarget(null); renderer.render(scene, cam);
  }

  // ---- the sequence ----

  const tl = gsap.timeline({ paused: true, onComplete: () => finishUI(false) });
  // Phase 1: the silence (0-1s)
  tl.to(U.uPoint, { value: 1, duration: 0.75, ease: 'power2.out' }, 0.25)
    .to(U.uLens, { value: 0.35, duration: 0.75, ease: 'sine.inOut' }, 0.25)
  // Phase 2: collapse, then space is stretched apart (1-2.5s)
    .to(U.uCollapse, { value: 1, duration: 0.35, ease: 'power3.in' }, 1.0)
    .to(U.uLens, { value: 1, duration: 0.35, ease: 'power3.in' }, 1.0)
    .to(U.uFlash, { value: 1, duration: 0.08, ease: 'none' }, 1.35)
    .to(U.uFlash, { value: 0, duration: 0.95, ease: 'power2.out' }, 1.43)
    .to(U.uPoint, { value: 0, duration: 0.3, ease: 'power2.out' }, 1.38)
    .to(U.uStreak, { value: 1, duration: 0.12, ease: 'power2.out' }, 1.35)
    .to(U.uStreak, { value: 0, duration: 1.35, ease: 'power2.inOut' }, 1.5)
    .to(U.uExpand, { value: 1, duration: 1.25, ease: 'expo.out' }, 1.35)
    .to(U.uLens, { value: 0.22, duration: 1.1, ease: 'power2.out' }, 1.4)
  // Phase 3: the void (2.5-4.5s)
    .to(U.uEnergy, { value: 1, duration: 1.8, ease: 'power2.out' }, 1.55)
  // Phase 4: the energy settles; the logo resolves out of a distortion
    .to(S, { flow: 0.2, duration: 1.6, ease: 'power2.inOut' }, 4.5)
    .to(UC.uChroma, { value: 0.35, duration: 1.6, ease: 'power2.inOut' }, 4.5)
    .to(L, { op: 1, duration: 0.5, ease: 'power1.out', onUpdate: setLogo }, 4.5)
    .to(L, { disp: 0, blur: 0, duration: 1.3, ease: 'expo.out',
      onUpdate: setLogo }, 4.55)
    .to(section, { '--glint': 1, duration: 0.9, ease: 'power2.out' }, 5.5)
  // Phase 5: the infinite state
    .add(() => finishUI(false), 5.9);

  function finishUI(instant) {
    try { sessionStorage.setItem(SEEN_KEY, '1'); } catch (e) {}
    L.disp = 0; L.blur = 0; L.op = 1; setLogo();
    section.style.setProperty('--glint', '1');
    section.classList.add('uv-done');
    if (instant) section.classList.add('uv-instant');
    if (skipBtn) skipBtn.hidden = true;
  }
  function skip() {
    tl.progress(1); S.flow = 0.2; finishUI(false);
  }
  if (skipBtn) skipBtn.addEventListener('click', skip);

  // test hook: lets automated checks hold the sequence at a given moment
  const hook = { tl: tl, hold: false, fixed: false,
    setScale: (v) => { scale = v; hook.fixed = true; resize(); } };
  window.__elevareVoid = hook;

  // ---- loop ----
  let flowT = 0, last = 0, acc = 0, frames = 0, lastGrow = 0, raf = 0;
  let started = false;
  function visible() {
    return section.classList.contains('on') && !document.hidden;
  }
  function begin() {
    started = true;
    if (calm) {                       // reduced motion: one still frame
      tl.progress(1); S.flow = 0.2; finishUI(true);
      flowT = 40; U.uTime.value = flowT; resize(); render(0);
      return;
    }
    if (seen) {                        // already seen this visit: no replay
      tl.progress(1); S.flow = 0.2; finishUI(true); flowT = 40;
    } else {
      if (skipBtn) skipBtn.hidden = false;
      tl.play(0);
    }
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!visible()) { last = 0; tl.pause(); return; }
    // the screen may have been hidden (size 0) when we started
    if (section.clientWidth !== W || section.clientHeight !== H) resize();
    if (!started) { begin(); if (calm) return; }
    if (calm) return;
    if (!hook.hold && tl.paused() && tl.progress() < 1 && started) tl.resume();
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0.016;
    last = now;
    flowT += dt * S.flow;
    U.uTime.value = flowT;
    render(dt);
    // adapt resolution to keep the frame rate up
    acc += dt; frames++;
    if (frames >= 40 && !hook.fixed) {
      const avg = acc / frames; acc = 0; frames = 0;
      if (avg > 0.024 && scale > MINS) { scale = Math.max(MINS, scale * 0.8); resize(); }
      else if (avg < 0.0145 && scale < MAXS && now - lastGrow > 4000) {
        scale = Math.min(MAXS, scale * 1.12); lastGrow = now; resize();
      }
    }
  }
  raf = requestAnimationFrame(frame);
}

function boot() {
  const s = document.getElementById('v-login');
  if (!s || !s.classList.contains('uv')) return;
  const img = s.querySelector('.uv-logo');
  if (img && !img.complete) img.addEventListener('load', () => start(s), { once: true });
  else start(s);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else boot();
