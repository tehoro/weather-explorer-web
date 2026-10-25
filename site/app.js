// Weather Explorer web viewer: plays the current highlights from static files.
//
// Everything is drawn in the browser: the colour fill on the GPU (WebGL2), isobars, highs and
// lows in a worker, wind particles on a canvas. The server only provides files.

const $ = (s) => document.querySelector(s);
const DATA = "data/";
const SPEEDS = [0.5, 1, 2, 4];
const FEED_REFRESH_MS = 10 * 60 * 1000;
const DEG = Math.PI / 180;

const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + Math.max(-85, Math.min(85, lat)) * DEG / 2)) / DEG;
const invMercY = (y) => (2 * Math.atan(Math.exp(y * DEG)) - Math.PI / 2) / DEG;
const parseTime = (s) => new Date(s);     // "2026-10-25T09:00Z" is valid ISO 8601

// ------------------------------------------------------------------------------------------
// State
// ------------------------------------------------------------------------------------------

const S = {
  feed: null,
  entries: [],          // [{key, item, requested}]
  entry: null,
  sceneIndex: 0,
  meta: null,           // the package's meta.json
  pkg: "",
  fill: [],             // per frame: {tex, data} once loaded
  uv: [],               // per frame: Uint8Array of u/v pairs
  contour: null,        // {segs, levels, centres, key}
  pos: 0,
  playing: false,
  speed: 1,
  view: null,           // {cx, cy, s}: centre in (lon, mercY) and pixels per degree
  token: 0,             // bumps on every scene load, to ignore stale results
};

// ------------------------------------------------------------------------------------------
// Worker
// ------------------------------------------------------------------------------------------

const worker = new Worker("worker.js");
let nextId = 1;
const pending = new Map();
worker.onmessage = ({ data }) => {
  const p = pending.get(data.id);
  if (!p) return;
  pending.delete(data.id);
  data.error ? p.reject(new Error(data.error)) : p.resolve(data);
};
function ask(msg) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id });
  });
}

// ------------------------------------------------------------------------------------------
// Canvases
// ------------------------------------------------------------------------------------------

const mapEl = $("#map");
const base = $("#base"), field = $("#field"), overlay = $("#overlay"), particles = $("#particles");
let W = 0, H = 0, DPR = 1;

function resize() {
  const r = mapEl.getBoundingClientRect();
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = r.width; H = r.height;
  for (const c of [base, field, overlay, particles]) {
    c.width = Math.round(W * DPR);
    c.height = Math.round(H * DPR);
  }
  // Keep the scene fitted until the viewer pans or zooms.
  if (S.entry && (!S.view || !S.view.touched)) fit();
  drawAll();
}

// World (lon, mercY) <-> screen (CSS pixels).
function toScreen(lon, y) {
  const v = S.view;
  return [(lon - v.cx) * v.s + W / 2, (v.cy - y) * v.s + H / 2];
}
function toWorld(px, py) {
  const v = S.view;
  return [v.cx + (px - W / 2) / v.s, v.cy - (py - H / 2) / v.s];
}

function sceneBox() {
  const sc = S.entry.item.scenes[S.sceneIndex];
  let [w, s, e, n] = sc.bbox;
  if (e <= w) e += 360;
  return { w, s, e, n };
}

function fit() {
  if (!W || !H) {
    const r = mapEl.getBoundingClientRect();
    W = r.width; H = r.height;
  }
  const b = sceneBox();
  const y0 = mercY(b.s), y1 = mercY(b.n);
  const s = Math.min(W / (b.e - b.w), H / (y1 - y0)) * 0.94;
  S.view = { cx: (b.w + b.e) / 2, cy: (y0 + y1) / 2, s, fit: s };
}

// ------------------------------------------------------------------------------------------
// Basemap: Natural Earth land and borders, drawn in the same Mercator as the data
// ------------------------------------------------------------------------------------------

let basemap = null;
fetch("basemap.json").then((r) => r.json()).then((j) => {
  const decode = (arr) => {
    const out = new Float32Array(arr.length);
    let x = 0, y = 0;
    for (let i = 0; i < arr.length; i += 2) {
      x += arr[i]; y += arr[i + 1];
      out[i] = x / j.scale;
      out[i + 1] = mercY(y / j.scale);
    }
    return out;
  };
  basemap = { land: j.land.map(decode), borders: j.borders.map(decode) };
  drawBase();
}).catch(() => {});

const css = getComputedStyle(document.documentElement);
const colour = (name) => css.getPropertyValue(name).trim();

function drawBase() {
  const g = base.getContext("2d");
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.fillStyle = colour("--ocean");
  g.fillRect(0, 0, W, H);
  if (!basemap || !S.view) return;
  const [lonL] = toWorld(0, 0), [lonR] = toWorld(W, 0);
  const shifts = [-360, 0, 360].filter((k) => lonR >= -180 + k && lonL <= 180 + k);
  const path = (arrs, close) => {
    g.beginPath();
    for (const k of shifts) {
      for (const a of arrs) {
        for (let i = 0; i < a.length; i += 2) {
          const [x, y] = toScreen(a[i] + k, a[i + 1]);
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        if (close) g.closePath();
      }
    }
  };
  path(basemap.land, true);
  g.fillStyle = colour("--land");
  g.fill("evenodd");
  g.lineWidth = 0.8;
  g.strokeStyle = colour("--coast");
  g.stroke();
  path(basemap.borders, false);
  g.lineWidth = 0.6;
  g.strokeStyle = colour("--border");
  g.stroke();
}

// ------------------------------------------------------------------------------------------
// Colour fill (WebGL2)
// ------------------------------------------------------------------------------------------

const gl = field.getContext("webgl2", { premultipliedAlpha: true, antialias: false });
let prog = null, lutTex = null, quad = null;

function setupGL() {
  if (!gl) return;
  const vs = `#version 300 es
    in vec2 p; uniform vec4 rect; out vec2 uv;
    void main() { uv = p; vec2 c = rect.xy + p * rect.zw; gl_Position = vec4(c.x, -c.y, 0.0, 1.0); }`;
  const fs = `#version 300 es
    precision highp float;
    in vec2 uv; out vec4 o;
    uniform sampler2D A, B, LUT;
    uniform float mixT, lo, hi, rlo, rhi, sq;
    void main() {
      float a = texture(A, uv).r, b = texture(B, uv).r;
      if (a > 0.997 || b > 0.997) discard;
      float t = mix(a, b, mixT) * 255.0 / 254.0;
      if (sq > 0.5) t = t * t;
      float v = lo + (hi - lo) * t;
      float k = clamp((v - rlo) / (rhi - rlo), 0.0, 1.0);
      vec4 c = texture(LUT, vec2(k * 255.0 / 256.0 + 0.5 / 256.0, 0.5));
      o = vec4(c.rgb * c.a, c.a);
    }`;
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
}

function parseColour(hex) {
  let h = hex.replace("#", "");
  if (h.length === 6) h += "ff";
  const n = parseInt(h, 16);
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

function rampSample(stops, v) {
  const s = stops.map(([value, c]) => [value, parseColour(c)]).sort((a, b) => a[0] - b[0]);
  if (v <= s[0][0]) return s[0][1];
  if (v >= s[s.length - 1][0]) return s[s.length - 1][1];
  for (let i = 1; i < s.length; i++) {
    if (v <= s[i][0]) {
      const t = (v - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
      return s[i - 1][1].map((x, k) => x + (s[i][1][k] - x) * t);
    }
  }
  return s[s.length - 1][1];
}

function makeLUT(stops) {
  const lo = Math.min(...stops.map((s) => s[0])), hi = Math.max(...stops.map((s) => s[0]));
  const px = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const c = rampSample(stops, lo + (hi - lo) * i / 255);
    px.set(c.map(Math.round), i * 4);
  }
  if (gl) {
    if (!lutTex) lutTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, lutTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  return { lo, hi };
}

function frameTexture(data, nx, ny) {
  if (!gl) return null;
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, nx, ny, 0, gl.RED, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

// The two loaded frames either side of the position, and the blend between them.
function bracket(list, pos) {
  const n = list.length;
  if (!n) return null;
  let i = Math.max(0, Math.min(n - 1, Math.floor(pos)));
  let j = Math.min(n - 1, i + 1);
  let t = Math.max(0, Math.min(1, pos - i));
  while (i > 0 && !list[i]) i--;
  if (!list[i]) return null;
  if (!list[j]) { j = i; t = 0; }
  return { i, j, t };
}

function drawField() {
  if (!gl || !prog) return;
  gl.viewport(0, 0, field.width, field.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const m = S.meta?.fill;
  const br = m && bracket(S.fill, S.pos);
  if (!br) return;
  const b = m.box;
  const east = b.east <= b.west ? b.east + 360 : b.east;
  const [x0, y0] = toScreen(b.west, mercY(b.north));
  const [x1, y1] = toScreen(east, mercY(b.south));
  gl.useProgram(prog);
  gl.uniform4f(gl.getUniformLocation(prog, "rect"), x0 / W * 2 - 1, y0 / H * 2 - 1, (x1 - x0) / W * 2, (y1 - y0) / H * 2);
  const tex = (unit, t, name) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(gl.getUniformLocation(prog, name), unit);
  };
  tex(0, S.fill[br.i].tex, "A");
  tex(1, S.fill[br.j].tex, "B");
  tex(2, lutTex, "LUT");
  const u = (n, v) => gl.uniform1f(gl.getUniformLocation(prog, n), v);
  u("mixT", br.t); u("lo", m.lo); u("hi", m.hi); u("rlo", S.ramp.lo); u("rhi", S.ramp.hi);
  u("sq", m.scale === "sqrt" ? 1 : 0);
  const loc = gl.getAttribLocation(prog, "p");
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// ------------------------------------------------------------------------------------------
// Overlay: isobars, highs and lows, focus places
// ------------------------------------------------------------------------------------------

function gridToScreen(meta, gx, gy) {
  const b = meta.box;
  const east = b.east <= b.west ? b.east + 360 : b.east;
  const yN = mercY(b.north), yS = mercY(b.south);
  return toScreen(b.west + (east - b.west) * gx / meta.nx, yN + (yS - yN) * gy / meta.ny);
}

function contourMeta() {
  const m = S.meta;
  if (m?.contours?.contour_interval) return { meta: m.contours, role: "contours" };
  if (m?.fill?.contour_interval) return { meta: m.fill, role: "fill" };
  return null;
}

function drawOverlay() {
  const g = overlay.getContext("2d");
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.clearRect(0, 0, W, H);
  if (!S.view || !S.meta) return;
  const cm = contourMeta();
  const c = S.contour;
  const placed = [];
  if (cm && c) {
    const segs = c.segs;
    g.beginPath();
    for (let k = 0; k < segs.length; k += 4) {
      const [ax, ay] = gridToScreen(cm.meta, segs[k], segs[k + 1]);
      const [bx, by] = gridToScreen(cm.meta, segs[k + 2], segs[k + 3]);
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
    }
    g.strokeStyle = "rgba(255,255,255,0.78)";
    g.lineWidth = 1.1;
    g.stroke();

    // Highs and lows.
    for (const e of c.centres) {
      const [x, y] = gridToScreen(cm.meta, e.x, e.y);
      if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
      placed.push([x, y]);
      g.textAlign = "center";
      g.shadowColor = "rgba(0,0,0,0.85)";
      g.shadowBlur = 4;
      g.fillStyle = e.high ? "#6bb3ff" : "#ff615c";
      g.font = "800 22px -apple-system, system-ui, sans-serif";
      g.fillText(e.high ? "H" : "L", x, y + 4);
      g.fillStyle = "#fff";
      g.font = "600 10.5px ui-monospace, SFMono-Regular, Menlo, monospace";
      g.fillText(String(Math.round(e.value)), x, y + 17);
      g.shadowBlur = 0;
    }

    // A few contour values, spread out and clear of the centres.
    const gap = Math.max(140, Math.min(W, H) / 3.2), maxLabels = W > 700 ? 12 : 7;
    const step = Math.max(1, Math.floor(segs.length / 4 / 400));
    const cands = [];
    for (let k = 0, n = 0; k < segs.length; k += 4 * step, n++) {
      const mx = (segs[k] + segs[k + 2]) / 2, my = (segs[k + 1] + segs[k + 3]) / 2;
      const [x, y] = gridToScreen(cm.meta, mx, my);
      if (x < 30 || y < 60 || x > W - 30 || y > H - 50) continue;
      const [ax, ay] = gridToScreen(cm.meta, segs[k], segs[k + 1]);
      const [bx, by] = gridToScreen(cm.meta, segs[k + 2], segs[k + 3]);
      cands.push({ x, y, a: Math.atan2(by - ay, bx - ax), v: c.levels[k / 4], h: (n * 2654435761) >>> 0 });
    }
    cands.sort((p, q) => p.h - q.h);
    const labels = [];
    for (const p of cands) {
      if (labels.length >= maxLabels) break;
      if (placed.some(([x, y]) => Math.hypot(x - p.x, y - p.y) < 60)) continue;
      if (labels.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < gap)) continue;
      labels.push(p);
    }
    g.font = "600 10.5px ui-monospace, SFMono-Regular, Menlo, monospace";
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const p of labels) {
      let a = p.a;
      if (a > Math.PI / 2) a -= Math.PI; else if (a < -Math.PI / 2) a += Math.PI;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(a);
      g.lineWidth = 3;
      g.strokeStyle = "rgba(0,0,0,0.75)";
      g.strokeText(String(Math.round(p.v)), 0, 0);
      g.fillStyle = "rgba(255,255,255,0.95)";
      g.fillText(String(Math.round(p.v)), 0, 0);
      g.restore();
    }
    g.textBaseline = "alphabetic";
  }

  // Focus places.
  const sc = S.entry.item.scenes[S.sceneIndex];
  g.font = "600 12px -apple-system, system-ui, sans-serif";
  g.textAlign = "left";
  for (const f of sc.focus || []) {
    let lon = f.lon;
    const b = sceneBox();
    while (lon < b.w - 180) lon += 360;
    while (lon > b.e + 180) lon -= 360;
    const [x, y] = toScreen(lon, mercY(f.lat));
    if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue;
    g.beginPath();
    g.arc(x, y, 4, 0, 2 * Math.PI);
    g.fillStyle = "#ffffff";
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = "#0b1218";
    g.stroke();
    g.lineWidth = 3;
    g.strokeStyle = "rgba(0,0,0,0.7)";
    g.strokeText(f.label, x + 8, y + 4);
    g.fillStyle = "#fff";
    g.fillText(f.label, x + 8, y + 4);
  }
}

let contourBusy = false, contourWant = null;
function updateContours() {
  const cm = contourMeta();
  if (!cm) { S.contour = null; return; }
  const list = cm.role === "fill" ? S.fill : S.contourFrames;
  const br = bracket(list, S.pos);
  if (!br) return;
  const q = Math.round(br.t * 4) / 4;
  const key = `${S.token}:${br.i}:${br.j}:${q}`;
  if (S.contour?.key === key || contourWant?.key === key) return;
  contourWant = { key, br, q, cm, token: S.token };
  if (!contourBusy) runContours();
}
async function runContours() {
  const w = contourWant;
  if (!w) return;
  contourWant = null;
  contourBusy = true;
  const old = (S.meta.format || 0) < 3;      // format 2 packages had 16-bit contour frames
  const url = (i) => `${DATA}${S.pkg}/${w.cm.role}/${String(i).padStart(3, "0")}.${old ? "c16" : "c12"}.webp`;
  try {
    const r = await ask({ type: "contours", urlA: url(w.br.i), urlB: url(w.br.j), q: w.q, centres: w.cm.meta.layer === "mslp",
      top: old ? 65535 : 4095,
      meta: { nx: w.cm.meta.nx, ny: w.cm.meta.ny, lo: w.cm.meta.lo, hi: w.cm.meta.hi,
              contour_interval: w.cm.meta.contour_interval } });
    if (w.token === S.token) {
      S.contour = { key: w.key, segs: r.segs, levels: r.levels, centres: r.centres };
      drawOverlay();
    }
  } catch (e) { /* the frame will be retried when it loads */ }
  contourBusy = false;
  if (contourWant) runContours();
}

// ------------------------------------------------------------------------------------------
// Wind particles
// ------------------------------------------------------------------------------------------

let parts = [];
function vectorMeta() {
  const m = S.meta;
  for (const role of ["vectors", "fill", "contours"]) if (m?.[role]?.vectors) return { meta: m[role], role };
  return null;
}
function windAt(vm, br, x, y) {
  // Screen point -> fraction of the vector grid, then bilinear u/v blended between two frames.
  const m = vm.meta, b = m.box, east = b.east <= b.west ? b.east + 360 : b.east;
  const [lon, my] = toWorld(x, y);
  const fx = (lon - b.west) / (east - b.west), fy = (mercY(b.north) - my) / (mercY(b.north) - mercY(b.south));
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
  const nx = m.vectors.nx, ny = m.vectors.ny;
  const gx = Math.min(nx - 1.001, Math.max(0, fx * nx - 0.5)), gy = Math.min(ny - 1.001, Math.max(0, fy * ny - 0.5));
  const i = Math.floor(gx), j = Math.floor(gy), tx = gx - i, ty = gy - j;
  const span = m.vectors.hi - m.vectors.lo;
  const sample = (d, c) => {
    const at = (ii, jj) => d[(jj * nx + ii) * 2 + c];
    const v = at(i, j) * (1 - tx) * (1 - ty) + at(i + 1, j) * tx * (1 - ty) + at(i, j + 1) * (1 - tx) * ty + at(i + 1, j + 1) * tx * ty;
    return m.vectors.lo + span * v / 254;
  };
  const A = S.uv[br.i], B = S.uv[br.j];
  return [sample(A, 0) * (1 - br.t) + sample(B, 0) * br.t, sample(A, 1) * (1 - br.t) + sample(B, 1) * br.t];
}
function stepParticles() {
  const g = particles.getContext("2d");
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  const vm = vectorMeta();
  const br = vm && bracket(S.uv, S.pos);
  if (!br) { g.clearRect(0, 0, W, H); return; }
  g.globalCompositeOperation = "destination-in";
  g.fillStyle = "rgba(0,0,0,0.9)";
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = "source-over";
  const want = Math.round(Math.min(2500, W * H / 450));
  while (parts.length < want) parts.push({ x: Math.random() * W, y: Math.random() * H, age: Math.random() * 80 | 0, life: 40 + Math.random() * 60 | 0 });
  parts.length = want;
  const ref = vm.meta.layer === "jet250" ? 70 : 22;
  g.strokeStyle = "rgba(255,255,255,0.75)";
  g.lineWidth = 1;
  g.beginPath();
  for (const p of parts) {
    const w = windAt(vm, br, p.x, p.y);
    if (!w || ++p.age > p.life) {
      p.x = Math.random() * W; p.y = Math.random() * H; p.age = 0;
      continue;
    }
    const k = 2.2 / ref * Math.min(2.5, Math.sqrt(S.view.s / S.view.fit));
    const nx = p.x + w[0] * k * 3, ny = p.y - w[1] * k * 3;
    g.moveTo(p.x, p.y);
    g.lineTo(nx, ny);
    p.x = nx; p.y = ny;
  }
  g.stroke();
}

// ------------------------------------------------------------------------------------------
// Loading a scene
// ------------------------------------------------------------------------------------------

function frameUrl(role, i, uv) {
  return `${DATA}${S.pkg}/${role}/${String(i).padStart(3, "0")}${uv ? ".uv" : ""}.webp`;
}

async function loadScene(entry, sceneIndex, keepView) {
  const token = ++S.token;
  S.entry = entry;
  S.sceneIndex = sceneIndex;
  const scene = entry.item.scenes[sceneIndex];
  S.pkg = scene.package;
  S.meta = null;
  S.fill = []; S.uv = []; S.contourFrames = []; S.contour = null; parts = [];
  S.pos = 0;
  worker.postMessage({ type: "reset" });
  renderList();
  renderDetails();
  status("Loading…");
  if (!keepView) S.view = null;
  const meta = await fetch(`${DATA}${S.pkg}/meta.json`).then((r) => r.json());
  if (token !== S.token) return;
  S.meta = meta;
  S.ramp = makeLUT(meta.fill.stops);
  if (!S.view) fit();
  renderLegend();
  setupTimeline();
  drawAll();

  // Frames: the first straight away, then the rest in order, a few at a time.
  const n = meta.fill.frames.length;
  const vm = vectorMeta();
  const cm = contourMeta();
  const jobs = [];
  for (let i = 0; i < n; i++) {
    jobs.push(async () => {
      const r = await ask({ type: "frame", url: frameUrl("fill", i), channels: 1 });
      if (token !== S.token) return;
      S.fill[i] = { data: r.data, tex: frameTexture(r.data, meta.fill.nx, meta.fill.ny) };
      if (vm) {
        const u = await ask({ type: "frame", url: frameUrl(vm.role, i, true), channels: 2 });
        if (token !== S.token) return;
        S.uv[i] = u.data;
      }
      if (cm && cm.role === "contours") S.contourFrames[i] = true;
      markLoaded(i);
      if (i === 0) { status(null); drawAll(); }
    });
  }
  let next = 0;
  const run = async () => {
    while (next < jobs.length && token === S.token) {
      const job = jobs[next++];
      try { await job(); } catch (e) { console.warn(e); }
    }
  };
  await jobs[next++]().catch((e) => { status("This scene could not be loaded."); console.warn(e); });
  await Promise.all([run(), run(), run(), run()]);
  if (token === S.token && !S.playing && S.fill.length) play(true);
}

function status(text) {
  const el = $("#status");
  el.hidden = !text;
  el.textContent = text || "";
}

// ------------------------------------------------------------------------------------------
// Timeline and playback
// ------------------------------------------------------------------------------------------

const scrub = $("#scrub");
function setupTimeline() {
  const n = S.meta.fill.frames.length;
  scrub.max = String(Math.max(0, n - 1));
  scrub.value = "0";
  const ticks = $("#ticks");
  ticks.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const t = document.createElement("i");
    t.style.left = n > 1 ? `calc(${(i / (n - 1)) * 100}% - 0.5px)` : "0";
    ticks.appendChild(t);
  }
  updateTime();
}
function markLoaded(i) {
  $("#ticks").children[i]?.classList.add("loaded");
}

const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false });
function updateTime() {
  const fr = S.meta?.fill.frames;
  if (!fr?.length) return;
  const i = Math.round(S.pos);
  const f = fr[Math.max(0, Math.min(fr.length - 1, i))];
  const valid = parseTime(f.valid_time);
  const run = f.run ? parseTime(f.run) : null;
  const lead = run ? Math.round((valid - run) / 3.6e6) : null;
  const runText = run ? `${String(run.getUTCHours()).padStart(2, "0")} UTC run` : "";
  const tag = lead === null ? "" : lead <= 0 ? `analysis, ${runText}` : `T+${lead} h, ${runText}`;
  $("#when").innerHTML = `${fmtDay.format(valid)} UTC<small>${tag}</small>`;
  scrub.value = String(S.pos);

  // Caption: the latest one whose time has passed.
  const sc = S.entry.item.scenes[S.sceneIndex];
  const t = timeAt(S.pos);
  const cap = (sc.captions || []).filter((c) => parseTime(c.at) <= t).pop();
  const el = $("#caption");
  el.hidden = !cap;
  el.textContent = cap ? cap.text : "";
}
function timeAt(pos) {
  const fr = S.meta.fill.frames;
  const i = Math.max(0, Math.min(fr.length - 1, Math.floor(pos)));
  const j = Math.min(fr.length - 1, i + 1);
  const a = parseTime(fr[i].valid_time).getTime(), b = parseTime(fr[j].valid_time).getTime();
  return new Date(a + (b - a) * Math.max(0, Math.min(1, pos - i)));
}

function play(on) {
  S.playing = on;
  $("#play").textContent = on ? "❚❚" : "▶";
  $("#play").setAttribute("aria-label", on ? "Pause" : "Play");
}
$("#play").onclick = () => {
  if (!S.meta) return;
  if (!S.playing && S.pos >= S.meta.fill.frames.length - 1) S.pos = 0;
  play(!S.playing);
};
$("#speed").onclick = () => {
  S.speed = SPEEDS[(SPEEDS.indexOf(S.speed) + 1) % SPEEDS.length];
  $("#speed").textContent = S.speed < 1 ? "½×" : `${S.speed}×`;
};
scrub.oninput = () => {
  S.pos = parseFloat(scrub.value);
  play(false);
  frameChanged();
};

function frameChanged() {
  updateTime();
  drawField();
  updateContours();
}

let last = performance.now();
function tick(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (S.playing && S.meta) {
    const n = S.meta.fill.frames.length;
    const next = Math.min(n - 1, S.pos + dt * S.speed);
    // Wait for frames that haven't arrived yet rather than skipping them.
    if (S.fill[Math.min(n - 1, Math.ceil(next))]) {
      S.pos = next;
      frameChanged();
      status(null);
    } else {
      status("Loading frames…");
    }
    // Hold the last frame for a moment, then loop.
    if (S.pos >= n - 1) {
      S.held = (S.held || 0) + dt;
      if (S.held > 1.5) { S.held = 0; S.pos = 0; frameChanged(); }
    }
  }
  stepParticles();
  requestAnimationFrame(tick);
}

// ------------------------------------------------------------------------------------------
// Pan, zoom and click readout
// ------------------------------------------------------------------------------------------

const pointers = new Map();
let dragStart = null, moved = false;
mapEl.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".zoom")) return;
  mapEl.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
  dragStart = { x: e.offsetX, y: e.offsetY };
  moved = false;
  mapEl.classList.add("dragging");
});
mapEl.addEventListener("pointermove", (e) => {
  if (!pointers.has(e.pointerId) || !S.view) return;
  const prev = pointers.get(e.pointerId);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const before = Math.hypot(a[0] - b[0], a[1] - b[1]);
    pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
    const [c, d] = [...pointers.values()];
    const after = Math.hypot(c[0] - d[0], c[1] - d[1]);
    if (before > 0) zoomAt((c[0] + d[0]) / 2, (c[1] + d[1]) / 2, after / before);
    moved = true;
    return;
  }
  pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
  if (Math.hypot(e.offsetX - dragStart.x, e.offsetY - dragStart.y) > 4) moved = true;
  S.view.cx -= (e.offsetX - prev[0]) / S.view.s;
  S.view.cy += (e.offsetY - prev[1]) / S.view.s;
  viewChanged();
});
const up = (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  mapEl.classList.remove("dragging");
  if (!moved && pointers.size === 0) readout(e.offsetX, e.offsetY);
};
mapEl.addEventListener("pointerup", up);
mapEl.addEventListener("pointercancel", (e) => { pointers.delete(e.pointerId); mapEl.classList.remove("dragging"); });
mapEl.addEventListener("wheel", (e) => {
  e.preventDefault();
  zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });

function zoomAt(px, py, k) {
  if (!S.view) return;
  const [lon, y] = toWorld(px, py);
  S.view.s = Math.max(S.view.fit * 0.5, Math.min(S.view.fit * 10, S.view.s * k));
  S.view.cx = lon - (px - W / 2) / S.view.s;
  S.view.cy = y + (py - H / 2) / S.view.s;
  viewChanged();
}
$("#zoomIn").onclick = () => zoomAt(W / 2, H / 2, 1.5);
$("#zoomOut").onclick = () => zoomAt(W / 2, H / 2, 1 / 1.5);
$("#zoomFit").onclick = () => { fit(); viewChanged(false); };

function viewChanged(touched = true) {
  if (S.view) S.view.touched = touched;
  $("#readout").hidden = true;
  particles.getContext("2d").clearRect(0, 0, particles.width, particles.height);
  drawAll();
}

function readout(px, py) {
  const el = $("#readout");
  const m = S.meta?.fill;
  const i = Math.round(S.pos);
  const f = S.fill[i];
  if (!m || !f) { el.hidden = true; return; }
  const [lon, y] = toWorld(px, py);
  const b = m.box, east = b.east <= b.west ? b.east + 360 : b.east;
  let L = lon;
  while (L < b.west) L += 360;
  while (L > east) L -= 360;
  const fx = (L - b.west) / (east - b.west), fy = (mercY(b.north) - y) / (mercY(b.north) - mercY(b.south));
  if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) { el.hidden = true; return; }
  const q = f.data[Math.floor(fy * m.ny) * m.nx + Math.floor(fx * m.nx)];
  if (q === 255) { el.hidden = true; return; }
  let t = q / 254;
  if (m.scale === "sqrt") t *= t;
  const v = m.lo + (m.hi - m.lo) * t;
  const lat = invMercY(y);
  const digits = Math.abs(v) < 10 ? 1 : 0;
  const ll = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"} ${Math.abs(((L + 540) % 360) - 180).toFixed(1)}°${((L + 540) % 360) - 180 >= 0 ? "E" : "W"}`;
  el.innerHTML = `<b>${v.toFixed(digits)} ${m.units}</b> <span class="muted">${ll}</span>`;
  el.style.left = `${px}px`;
  el.style.top = `${py}px`;
  el.hidden = false;
}

function drawAll() {
  if (!S.view) { drawBase(); return; }
  drawBase();
  drawField();
  drawOverlay();
  updateContours();
}

// ------------------------------------------------------------------------------------------
// Panels
// ------------------------------------------------------------------------------------------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeUrl = (u) => /^https?:\/\//i.test(u || "") ? u : null;

function renderList() {
  const el = $("#list");
  const row = (e) => `<button class="entry" data-key="${esc(e.key)}" aria-current="${S.entry === e}">
      <span class="t">${esc(e.item.title)}</span><span class="w">${esc(e.item.where?.label || "")}</span></button>`;
  const main = S.entries.filter((e) => !e.requested), req = S.entries.filter((e) => e.requested);
  el.innerHTML = `<h2>Highlights</h2>${main.map(row).join("")}` + (req.length ? `<h2>Requested</h2>${req.map(row).join("")}` : "");
  for (const b of el.querySelectorAll(".entry")) {
    b.onclick = () => {
      const e = S.entries.find((x) => x.key === b.dataset.key);
      if (e && e !== S.entry) { location.hash = e.key; }
    };
  }
}

function renderDetails() {
  const it = S.entry.item;
  const sc = it.scenes;
  const fmt = (s) => s ? fmtDay.format(parseTime(s)) + " UTC" : "";
  const when = it.when ? [it.when.start && `from ${fmt(it.when.start)}`, it.when.peak && `peak ${fmt(it.when.peak)}`].filter(Boolean).join(" · ") : "";
  const evidence = (it.evidence || []).map((e) => {
    const u = safeUrl(e.url);
    return `<li><span class="k">${esc(e.kind || "")}</span>${u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(e.text)}</a>` : esc(e.text)}</li>`;
  }).join("");
  $("#details").innerHTML = `
    <h2>${esc(it.title)}</h2>
    <p class="where">${esc(it.where?.label || "")}${when ? `<br>${esc(when)}` : ""}</p>
    ${it.hazards?.length ? `<div class="chips">${it.hazards.map((h) => `<span class="chip">${esc(h.replace(/-/g, " "))}</span>`).join("")}</div>` : ""}
    ${sc.length > 1 ? `<h3>Scenes</h3><div class="scenes">${sc.map((s, i) => `<button data-i="${i}" aria-current="${i === S.sceneIndex}">${esc(s.title || `Scene ${i + 1}`)}</button>`).join("")}</div>` : ""}
    <h3>What's happening</h3><p>${esc(it.summary)}</p>
    ${it.why_interesting ? `<h3>Why it's interesting</h3><p>${esc(it.why_interesting)}</p>` : ""}
    ${it.talking_points?.length ? `<h3>Questions to explore</h3><ul>${it.talking_points.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
    ${evidence ? `<h3>Sources</h3><ul class="evidence">${evidence}</ul>` : ""}
    ${it.confidence ? `<h3>Confidence</h3><p>${esc(it.confidence)}</p>` : ""}`;
  for (const b of $("#details").querySelectorAll(".scenes button")) {
    b.onclick = () => { location.hash = `${S.entry.key}/${b.dataset.i}`; };
  }
}

function renderLegend() {
  const m = S.meta.fill;
  const lo = S.ramp.lo, hi = S.ramp.hi;
  const cm = contourMeta();
  const el = $("#legend");
  el.innerHTML = `<div class="lt">${esc(m.title)} <span class="muted">(${esc(m.units)})</span></div>
    <canvas width="200" height="10"></canvas>
    <div class="scale"><span>${lo}</span><span>${Math.round((lo + hi) / 2)}</span><span>${hi}</span></div>
    ${cm ? `<div class="note">Lines: ${esc(cm.meta.title.toLowerCase())} every ${cm.meta.contour_interval} ${esc(cm.meta.units)}</div>` : ""}
    ${vectorMeta() ? `<div class="note">Streaks: ${esc(vectorMeta().meta.title.toLowerCase())}</div>` : ""}
    <div class="note">${esc(m.model)}</div>`;
  const c = el.querySelector("canvas"), g = c.getContext("2d");
  for (let x = 0; x < 200; x++) {
    const [r, gg, b, a] = rampSample(m.stops, lo + (hi - lo) * x / 199);
    g.fillStyle = `rgba(${r},${gg},${b},${Math.max(0.12, a / 255)})`;
    g.fillRect(x, 0, 1, 10);
  }
}

const fmtTime = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false });
function renderFresh() {
  const f = S.feed;
  if (!f?.generated_utc) return;
  const t = parseTime(f.generated_utc);
  const h = (Date.now() - t) / 3.6e6;
  const age = h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : `${Math.round(h)} h ago`;
  $("#fresh").textContent = `Highlights from ${fmtTime.format(t)} UTC (${age}) · refreshed twice a day`;
  if (f.attribution) $("#attribution").textContent = f.attribution;
}

// ------------------------------------------------------------------------------------------
// Feed and routing
// ------------------------------------------------------------------------------------------

async function loadFeed() {
  const feed = await fetch(`${DATA}feed.json`, { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  });
  const changed = feed.synced_utc !== S.feed?.synced_utc;
  S.feed = feed;
  S.entries = [
    ...feed.items.map((item) => ({ key: item.id, item })),
    ...(feed.requested || []).map((r) => ({ key: r.item.id, item: r.item, requested: true })),
  ];
  renderFresh();
  return changed;
}

function route() {
  const [key, n] = decodeURIComponent(location.hash.slice(1)).split("/");
  const entry = S.entries.find((e) => e.key === key) || S.entries[0];
  if (!entry) {
    $("#list").innerHTML = `<p class="muted pad">No highlights at the moment.</p>`;
    return;
  }
  const i = Math.max(0, Math.min(entry.item.scenes.length - 1, parseInt(n || "0", 10) || 0));
  if (entry === S.entry && i === S.sceneIndex) return;
  play(false);
  loadScene(entry, i, false);
}

window.addEventListener("hashchange", route);
new ResizeObserver(resize).observe(mapEl);

(async function start() {
  try {
    setupGL();
  } catch (e) {
    console.warn(e);
  }
  if (!gl) status("This browser can't show the weather layer (WebGL2 is needed).");
  try {
    await loadFeed();
    route();
  } catch (e) {
    $("#list").innerHTML = `<p class="muted pad">The highlights could not be loaded. Please try again later.</p>`;
    console.warn(e);
  }
  requestAnimationFrame(tick);
  setInterval(async () => {
    try {
      if (await loadFeed()) {
        renderList();
        if (!S.entries.includes(S.entry)) {
          const same = S.entries.find((e) => e.key === S.entry?.key);
          if (same) { S.entry = same; renderList(); } else route();
        }
      }
    } catch { /* keep showing what we have */ }
  }, FEED_REFRESH_MS);
})();
