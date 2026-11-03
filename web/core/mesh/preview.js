// Программная картинка сетки: ортогональная проекция, z-буфер, плоское освещение. Без WebGL - работает и в Worker.

const VIEWS = {
  // строки - экранные оси: вправо, вверх, к зрителю
  front: [[1, 0, 0], [0, 0, 1], [0, -1, 0]],
  top: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  iso: isoAxes(),
};

function isoAxes() {
  const r = [Math.SQRT1_2, Math.SQRT1_2, 0];
  const t = 1 / Math.sqrt(6);
  const up = [-t, t, 2 * t];
  const toward = [r[1] * up[2] - r[2] * up[1], r[2] * up[0] - r[0] * up[2], r[0] * up[1] - r[1] * up[0]];
  return [r, up, toward];
}

export function parseColor(c, fallback) {
  if (Array.isArray(c)) return [c[0], c[1], c[2], c[3] ?? 255];
  if (typeof c === 'string') {
    let h = c.trim().replace(/^#/, '');
    if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
    if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) {
      const n = (i) => parseInt(h.slice(i, i + 2), 16);
      return [n(0), n(2), n(4), h.length === 8 ? n(6) : 255];
    }
  }
  return fallback;
}

// opts: width, height, background, color, view ('iso' | 'front' | 'top'), margin (px)
export function renderPreview(mesh, opts = {}) {
  const W = Math.max(1, Math.round(opts.width ?? 256));
  const H = Math.max(1, Math.round(opts.height ?? W));
  const bg = parseColor(opts.background, [240, 240, 240, 255]);
  const fg = parseColor(opts.color, [64, 128, 220, 255]);
  const axes = VIEWS[opts.view] ?? VIEWS.iso;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set(bg, 4 * i);
  const p = mesh.positions, idx = mesh.indices;
  const nv = p.length / 3;
  if (!idx.length) return { width: W, height: H, data };

  // проекция в экранные оси и вписывание с отступом
  const sx = new Float64Array(nv), sy = new Float64Array(nv), sz = new Float64Array(nv);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < idx.length; i++) {
    const v = idx[i];
    const x = p[3 * v], y = p[3 * v + 1], z = p[3 * v + 2];
    sx[v] = axes[0][0] * x + axes[0][1] * y + axes[0][2] * z;
    sy[v] = axes[1][0] * x + axes[1][1] * y + axes[1][2] * z;
    sz[v] = axes[2][0] * x + axes[2][1] * y + axes[2][2] * z;
    x0 = Math.min(x0, sx[v]); x1 = Math.max(x1, sx[v]);
    y0 = Math.min(y0, sy[v]); y1 = Math.max(y1, sy[v]);
  }
  const margin = opts.margin ?? Math.max(2, Math.round(Math.min(W, H) * 0.05));
  const scale = Math.min((W - 2 * margin) / Math.max(x1 - x0, 1e-9), (H - 2 * margin) / Math.max(y1 - y0, 1e-9));
  const ox = W / 2 - ((x0 + x1) / 2) * scale;
  const oy = H / 2 + ((y0 + y1) / 2) * scale;
  const zbuf = new Float64Array(W * H).fill(-Infinity);
  const light = norm3([-0.4, 0.5, 0.75]);

  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ax = ox + sx[a] * scale, ay = oy - sy[a] * scale;
    const bx = ox + sx[b] * scale, by = oy - sy[b] * scale;
    const cx = ox + sx[c] * scale, cy = oy - sy[c] * scale;
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (area === 0) continue;
    // нормаль в экранных осях; знак не важен - освещаем обе стороны (сетка может быть вывернута)
    const n = norm3(cross([sx[a], sy[a], sz[a]], [sx[b], sy[b], sz[b]], [sx[c], sy[c], sz[c]]));
    const shade = 0.35 + 0.65 * Math.abs(n[0] * light[0] + n[1] * light[1] + n[2] * light[2]);
    const r = fg[0] * shade, g = fg[1] * shade, bl = fg[2] * shade;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxY = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let py = minY; py <= maxY; py++) {
      const y = py + 0.5;
      for (let px = minX; px <= maxX; px++) {
        const x = px + 0.5;
        const w0 = ((bx - x) * (cy - y) - (cx - x) * (by - y)) / area;
        const w1 = ((cx - x) * (ay - y) - (ax - x) * (cy - y)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * sz[a] + w1 * sz[b] + w2 * sz[c];
        const k = py * W + px;
        if (z <= zbuf[k]) continue;
        zbuf[k] = z;
        data[4 * k] = r; data[4 * k + 1] = g; data[4 * k + 2] = bl; data[4 * k + 3] = fg[3];
      }
    }
  }
  return { width: W, height: H, data };
}

function cross(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
