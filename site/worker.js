// Decodes frame images and draws contours off the main thread.
//
// Frames are lossless WebP with 8-bit values: 0..254 between lo and hi, 255 = missing.
// Vector frames carry u in the red channel and v in the green one; contour frames (.c12) carry
// 12-bit values split across red and green.

const frames = new Map();      // url -> Uint8Array (values, or interleaved u/v)

async function decode(url, channels) {
  if (frames.has(url)) return frames.get(url);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
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
  frames.set(url, out);
  return out;
}

// Real values for a blend of two contour frames (red = high byte, green = low byte; NaN where
// missing). `top` is the missing value: 4095 for 12-bit frames, 65535 for older 16-bit ones.
function values(a, b, q, meta, top) {
  const n = meta.nx * meta.ny, out = new Float32Array(n);
  const scale = (meta.hi - meta.lo) / (top - 1);
  for (let i = 0; i < n; i++) {
    const va = a[i * 2] * 256 + a[i * 2 + 1], vb = b[i * 2] * 256 + b[i * 2 + 1];
    if (va === top || vb === top) { out[i] = NaN; continue; }
    out[i] = meta.lo + scale * (va * (1 - q) + vb * q);
  }
  return out;
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

// Highs and lows: points that are the extreme of a wide neighbourhood and stand out from it.
function centres(v, nx, ny) {
  const s = Math.max(2, Math.round(Math.min(nx, ny) / 45));
  const R = Math.max(4, Math.round(Math.min(nx, ny) / 9));
  const out = [];
  for (let j = R; j < ny - R; j += s) {
    for (let i = R; i < nx - R; i += s) {
      const c = v[j * nx + i];
      if (c !== c) continue;
      let isMin = true, isMax = true, sum = 0, n = 0;
      for (let jj = j - R; jj <= j + R && (isMin || isMax); jj += s) {
        for (let ii = i - R; ii <= i + R; ii += s) {
          const x = v[jj * nx + ii];
          if (x !== x) continue;
          if (x < c) isMin = false;
          if (x > c) isMax = false;
          sum += x; n++;
        }
      }
      if (!(isMin || isMax) || n === 0) continue;
      if (Math.abs(c - sum / n) < 2) continue;      // too flat to call
      if (out.some(e => Math.hypot(e.x - i, e.y - j) < R)) continue;
      out.push({ x: i + 0.5, y: j + 0.5, value: c, high: isMax });
    }
  }
  return out;
}

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === "reset") {
      frames.clear();
    } else if (m.type === "frame") {
      const d = await decode(m.url, m.channels);
      self.postMessage({ id: m.id, data: d.slice() });
    } else if (m.type === "contours") {
      const [a, b] = await Promise.all([decode(m.urlA, 2), decode(m.urlB, 2)]);
      const v = values(a, b, m.q, m.meta, m.top);
      const { segs, levels } = contours(v, m.meta.nx, m.meta.ny, m.meta.contour_interval);
      const ext = m.centres ? centres(v, m.meta.nx, m.meta.ny) : [];
      self.postMessage({ id: m.id, segs, levels, centres: ext }, [segs.buffer, levels.buffer]);
    }
  } catch (e) {
    self.postMessage({ id: m.id, error: String(e.message || e) });
  }
};
