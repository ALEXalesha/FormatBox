// Удаление фона: заливка от краёв по похожести цвета (расстояние ΔE в Lab) или хромакей по цвету,
// затем мягкий край - пиксели фигуры рядом с фоном, чей цвет близок к фону, получают частичную альфу.
import { checkAbort } from './geometry.js';

const LIN = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (t * 24389) / 27 / 116 + 16 / 116);

export function rgbToLab(r, g, b) {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const x = f((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047);
  const y = f(0.2126729 * R + 0.7151522 * G + 0.072175 * B);
  const z = f((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

export function deltaE(p, q) {
  const a = rgbToLab(p[0], p[1], p[2]), b = rgbToLab(q[0], q[1], q[2]);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// Цвет фона по краю: среди непрозрачных пикселей края ищем цвет, у которого больше всего близких
// соседей (поиск моды; шум не дробит её, как дробил бы жёсткие ячейки), внутри - медиана.
export function estimateBackground(image) {
  const { width: w, height: h, data } = image;
  const border = [];
  const add = (i) => { if (data[i * 4 + 3] !== 0) border.push(i); };
  for (let x = 0; x < w; x++) { add(x); if (h > 1) add((h - 1) * w + x); }
  for (let y = 1; y < h - 1; y++) { add(y * w); if (w > 1) add(y * w + w - 1); }
  if (!border.length) return [0, 0, 0];
  const near = (i, j) => Math.max(Math.abs(data[i * 4] - data[j * 4]), Math.abs(data[i * 4 + 1] - data[j * 4 + 1]), Math.abs(data[i * 4 + 2] - data[j * 4 + 2])) <= 8;
  const step = Math.max(1, Math.floor(border.length / 256));
  let best = -1, bestCount = -1;
  for (let k = 0; k < border.length; k += step) {
    let count = 0;
    for (const j of border) if (near(border[k], j)) count++;
    if (count > bestCount) { bestCount = count; best = border[k]; }
  }
  const group = border.filter((j) => near(best, j));
  const median = (c) => {
    const v = group.map((i) => data[i * 4 + c]).sort((a, b) => a - b);
    return v[v.length >> 1];
  };
  return [median(0), median(1), median(2)];
}

export function removeBackground(image, {
  tolerance = 12, softness = tolerance, feather = 2, mode = 'edges', color, signal, progress,
} = {}) {
  if (mode !== 'edges' && mode !== 'color') throw new Error(`removeBackground: unknown mode ${mode}`);
  const { width: w, height: h, data } = image;
  const n = w * h;
  const bg = color ? [color[0], color[1], color[2]] : estimateBackground(image);
  const bgLab = rgbToLab(bg[0], bg[1], bg[2]);
  // Расстояние до цвета фона; полностью прозрачные пиксели уже фон.
  const dist = new Float32Array(n);
  const cache = new Map();
  for (let y = 0; y < h; y++) {
    checkAbort(signal);
    for (let x = 0; x < w; x++) {
      const i = y * w + x, p = i * 4;
      if (data[p + 3] === 0) continue;
      const key = (data[p] << 16) | (data[p + 1] << 8) | data[p + 2];
      let d = cache.get(key);
      if (d === undefined) {
        const lab = rgbToLab(data[p], data[p + 1], data[p + 2]);
        d = Math.hypot(lab[0] - bgLab[0], lab[1] - bgLab[1], lab[2] - bgLab[2]);
        if (cache.size < 1 << 20) cache.set(key, d);
      }
      dist[i] = d;
    }
    if (progress && y % 64 === 0) progress((0.6 * y) / h);
  }
  // При tolerance 0 фон - только точное совпадение (ΔE ровно 0), никакой погрешности.
  const isBg = (i) => dist[i] <= tolerance;
  const mask = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  if (mode === 'color') {
    for (let i = 0; i < n; i++) if (isBg(i)) { mask[i] = 1; queue[tail++] = i; }
  } else {
    const seed = (i) => { if (!mask[i] && isBg(i)) { mask[i] = 1; queue[tail++] = i; } };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
    while (head < tail) {
      const i = queue[head++], x = i % w;
      if (x > 0) seed(i - 1);
      if (x < w - 1) seed(i + 1);
      if (i >= w) seed(i - w);
      if (i < n - w) seed(i + w);
    }
  }
  checkAbort(signal);
  progress?.(0.8);
  const out = Uint8ClampedArray.from(data);
  for (let i = 0; i < n; i++) if (mask[i]) out[i * 4 + 3] = 0;
  // Мягкий край: цепочки пикселей длиной до feather от фона с ΔE в (tolerance, tolerance + softness).
  if (feather > 0 && softness > 0) {
    const depth = new Int32Array(n).fill(-1);
    head = 0; tail = 0;
    for (let i = 0; i < n; i++) if (mask[i]) { depth[i] = 0; queue[tail++] = i; }
    while (head < tail) {
      const i = queue[head++], x = i % w;
      if (depth[i] >= feather) continue;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= n || depth[j] >= 0) continue;
        depth[j] = depth[i] + 1;
        const p = j * 4;
        let a = (dist[j] - tolerance) / softness;
        // Альфа не меньше той, при которой «очищенный» цвет остаётся в 0..255 - иначе смесь не восстановится.
        for (let c = 0; c < 3; c++) {
          const v = data[p + c], b = bg[c];
          if (v > b) a = Math.max(a, (v - b) / (255 - b));
          else if (v < b) a = Math.max(a, (b - v) / b);
        }
        // Край идёт только по «смешанным» пикселям: через чистый цвет фигуры он не проходит.
        if (a >= 1 || data[p + 3] === 0) continue;
        queue[tail++] = j;
        // Убираем примесь фона из цвета: c = a*c' + (1-a)*bg.
        for (let c = 0; c < 3; c++) out[p + c] = (data[p + c] - (1 - a) * bg[c]) / a;
        out[p + 3] = data[p + 3] * a;
      }
    }
  }
  progress?.(1);
  return { width: w, height: h, data: out };
}
