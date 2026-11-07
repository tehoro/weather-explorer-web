// Decodes frame images and draws contours off the main thread.
//
// Frames are lossless WebP with 8-bit values: 0..254 between lo and hi, 255 = missing.
// Vector frames carry u in the red channel and v in the green one; contour frames (.c12) carry
// 12-bit values split across red and green.

const frames = new Map();      // path -> Uint8Array (values, or interleaved u/v)

// src is a URL to fetch, or, in a saved copy, {path, bytes}: a page opened from a local file may
// not fetch its own embedded data from here, so the page sends the bytes themselves.
async function decode(src, channels) {
  const key = typeof src === "string" ? src : src.path;
  if (frames.has(key)) return frames.get(key);
  let blob;
  if (typeof src === "string") {
    // A request that hangs is given up after 20 s, so the page can try it again.
    const r = await fetch(src, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`${r.status} ${src}`);
    blob = await r.blob();
  } else {
    blob = new Blob([src.bytes], { type: "image/webp" });
  }
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  const px = g.getImageData(0, 0, bmp.width, bmp.height).data;
  const n = bmp.width * bmp.height;
  const out = new Uint8Array(n * channels);
  for (let i = 0; i < n; i++) {
    out[i * channels] = px[i * 4];
    if (channels === 2) out[i * 2 + 1] = px[i * 4 + 1];
  }
  frames.set(key, out);
  return out;
}

// Real values for a blend of two contour frames (red = high byte, green = low byte; NaN where
// missing). `top` is the missing value: 4095 for 12-bit frames, 65535 for older 16-bit ones.
// With `eye` (app.js eyeShift), points near a tracked low take each frame from where that frame
// has the low, so the low moves between frames rather than fading (as the map's colours do).
function values(a, b, q, meta, top, eye) {
  const n = meta.nx * meta.ny, out = new Float32Array(n);
  const scale = (meta.hi - meta.lo) / (top - 1);
  for (let i = 0; i < n; i++) {
    let va = a[i * 2] * 256 + a[i * 2 + 1], vb = b[i * 2] * 256 + b[i * 2 + 1];
    if (eye) {
      const fx = (i % meta.nx + 0.5) / meta.nx, fy = (Math.floor(i / meta.nx) + 0.5) / meta.ny;
      const d = Math.hypot((fx - eye.x) / eye.rx, (fy - eye.y) / eye.ry);
      if (d < 1) {
        const s = d <= 0.5 ? 0 : (d - 0.5) / 0.5, w = 1 - s * s * (3 - 2 * s);   // as GLSL smoothstep(0.5, 1, d)
        va = sampleAt(a, fx + eye.ax * w, fy + eye.ay * w, meta, top);
        vb = sampleAt(b, fx + eye.bx * w, fy + eye.by * w, meta, top);
        if (Number.isNaN(va) || Number.isNaN(vb)) { out[i] = NaN; continue; }
        out[i] = meta.lo + scale * (va * (1 - q) + vb * q);
        continue;
      }
    }
    if (va === top || vb === top) { out[i] = NaN; continue; }
    out[i] = meta.lo + scale * (va * (1 - q) + vb * q);
  }
  return out;
}

// A 12-bit frame's raw value at grid fraction (fx, fy), bilinear; NaN where missing.
function sampleAt(arr, fx, fy, meta, top) {
  const x = Math.max(0, Math.min(meta.nx - 1, fx * meta.nx - 0.5)), y = Math.max(0, Math.min(meta.ny - 1, fy * meta.ny - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(meta.nx - 1, x0 + 1), y1 = Math.min(meta.ny - 1, y0 + 1);
  const v = (ix, iy) => { const k = (iy * meta.nx + ix) * 2, r = arr[k] * 256 + arr[k + 1]; return r === top ? NaN : r; };
  const tx = x - x0, ty = y - y0;
  return (v(x0, y0) * (1 - tx) + v(x1, y0) * tx) * (1 - ty) + (v(x0, y1) * (1 - tx) + v(x1, y1) * tx) * ty;
}

// Marching squares. Values sit at cell centres, so grid point (i, j) is at (i + 0.5, j + 0.5).
// Returns segments [x1, y1, x2, y2, ...] in grid units and the level of each one.
function contours(v, nx, ny, interval) {
  let lo = Infinity, hi = -Infinity;
  for (const x of v) if (x === x) { if (x < lo) lo = x; if (x > hi) hi = x; }
  const segs = [], levels = [];
  if (!(hi > lo)) return { segs: new Float32Array(0), levels: new Float32Array(0) };
  for (let L = Math.ceil(lo / interval) * interval; L <= hi; L += interval) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = v[j * nx + i], b = v[j * nx + i + 1], c = v[(j + 1) * nx + i + 1], d = v[(j + 1) * nx + i];
        if (a !== a || b !== b || c !== c || d !== d) continue;
        const k = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (c > L ? 2 : 0) | (d > L ? 1 : 0);
        if (k === 0 || k === 15) continue;
        const x = i + 0.5, y = j + 0.5;
        const top = [x + (L - a) / (b - a), y], right = [x + 1, y + (L - b) / (c - b)];
        const bottom = [x + (L - d) / (c - d), y + 1], left = [x, y + (L - a) / (d - a)];
        const add = (p, q) => { segs.push(p[0], p[1], q[0], q[1]); levels.push(L); };
        switch (k) {
          case 1: case 14: add(left, bottom); break;
          case 2: case 13: add(bottom, right); break;
          case 3: case 12: add(left, right); break;
          case 4: case 11: add(top, right); break;
          case 6: case 9: add(top, bottom); break;
          case 7: case 8: add(left, top); break;
          case 5: add(left, top); add(bottom, right); break;
          case 10: add(top, right); add(left, bottom); break;
        }
      }
    }
  }
  return { segs: new Float32Array(segs), levels: new Float32Array(levels) };
}

// Highs and lows, exactly as the app finds them (Contours.pressureCentres): a low below 1004 hPa
// or a high above 1022 hPa that is the extreme of its 3×3 cells and of a wide neighbourhood,
// right up to the edges of the scene.
function centres(v, nx, ny) {
  const r = Math.max(4, Math.floor(Math.min(nx, ny) / 12));
  const out = [];
  for (let y = 1; y < ny - 1; y++) {
    for (let x = 1; x < nx - 1; x++) {
      const c = v[y * nx + x];
      if (c !== c || !(c < 1004 || c > 1022)) continue;
      // Cheap 3×3 test first; only those candidates get the wide-radius check.
      let lmin = true, lmax = true;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const o = v[(y + dy) * nx + x + dx];
          if (o < c) lmin = false;
          if (o > c) lmax = false;
        }
      }
      if (!((lmin && c < 1004) || (lmax && c > 1022))) continue;
      let ok = true;
      outer: for (let yy = Math.max(0, y - r); yy <= Math.min(ny - 1, y + r); yy++) {
        for (let xx = Math.max(0, x - r); xx <= Math.min(nx - 1, x + r); xx++) {
          const o = v[yy * nx + xx];
          if ((lmin && o < c) || (!lmin && o > c)) { ok = false; break outer; }
        }
      }
      if (ok) out.push({ x: x + 0.5, y: y + 0.5, value: c, high: !lmin });
    }
  }
  // Flat highs give clusters of equal maxima: keep one per neighbourhood.
  const kept = [];
  for (const e of out) {
    if (!kept.some((k) => k.high === e.high && Math.abs(k.x - e.x) < r * 2 && Math.abs(k.y - e.y) < r * 2)) kept.push(e);
  }
  return kept;
}

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === "reset") {
      frames.clear();
    } else if (m.type === "frame") {
      const d = await decode(m.src, m.channels);
      self.postMessage({ id: m.id, data: d.slice() });
    } else if (m.type === "contours") {
      const [a, b] = await Promise.all([decode(m.srcA, 2), decode(m.srcB, 2)]);
      const v = values(a, b, m.q, m.meta, m.top, m.eye);
      const { segs, levels } = contours(v, m.meta.nx, m.meta.ny, m.meta.contour_interval);
      const ext = m.centres ? centres(v, m.meta.nx, m.meta.ny) : [];
      self.postMessage({ id: m.id, segs, levels, centres: ext }, [segs.buffer, levels.buffer]);
    }
  } catch (e) {
    self.postMessage({ id: m.id, error: String(e.message || e) });
  }
};
