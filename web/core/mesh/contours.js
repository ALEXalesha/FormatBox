// Маска -> контуры: marching squares, вложенность (дыры), упрощение, триангуляция крышек.
import earcut from '../../vendor/earcut.js';

// Маска: { width, height, data: Uint8Array 0/1 }. Евклидово расстояние до ближайшей единицы (в квадрате), Фельценшвальб.
export function distanceSquared(mask, target = 1) {
  const { width: w, height: h, data } = mask;
  const INF = 1e20;
  const d = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = data[i] === target ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n), out = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  const pass = (len) => {
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k -= 1;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k += 1; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k += 1;
      out[q] = (q - v[k]) ** 2 + f[v[k]];
    }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = d[y * w + x];
    pass(h);
    for (let y = 0; y < h; y++) d[y * w + x] = out[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = d[y * w + x];
    pass(w);
    for (let x = 0; x < w; x++) d[y * w + x] = out[x];
  }
  return d;
}

export function dilate(mask, r) {
  const d = distanceSquared(mask, 1);
  return { width: mask.width, height: mask.height, data: Uint8Array.from(d, (x) => (x <= r * r ? 1 : 0)) };
}

export function erode(mask, r) {
  const d = distanceSquared(mask, 0);
  return { width: mask.width, height: mask.height, data: Uint8Array.from(d, (x) => (x > r * r ? 1 : 0)) };
}

// Отрезки по случаю клетки (углы: лв=8, пв=4, пн=2, лн=1; стороны T R B L). Единицы остаются справа по ходу (y вниз).
// Седловые клетки разделяем: диагональные соседи - разные контуры.
const SEGMENTS = {
  1: [['L', 'B']], 2: [['B', 'R']], 3: [['L', 'R']], 4: [['R', 'T']], 5: [['R', 'T'], ['L', 'B']],
  6: [['B', 'T']], 7: [['L', 'T']], 8: [['T', 'L']], 9: [['T', 'B']], 10: [['T', 'L'], ['B', 'R']],
  11: [['T', 'R']], 12: [['R', 'L']], 13: [['R', 'B']], 14: [['B', 'L']],
};

// Контуры маски в пикселях (центр пикселя - целые координаты). Возвращает кольца [x0, y0, x1, y1, ...].
export function traceRings(mask) {
  const { width: w, height: h, data } = mask;
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? data[y * w + x] : 0);
  const W2 = 2 * w + 4;
  // точка на середине стороны клетки: ключ по удвоенным координатам
  const key = (x2, y2) => (y2 + 2) * W2 + (x2 + 2);
  const next = new Map();
  for (let cy = -1; cy < h; cy++) {
    for (let cx = -1; cx < w; cx++) {
      const c = (at(cx, cy) << 3) | (at(cx + 1, cy) << 2) | (at(cx + 1, cy + 1) << 1) | at(cx, cy + 1);
      const segs = SEGMENTS[c];
      if (!segs) continue;
      const P = { T: [2 * cx + 1, 2 * cy], R: [2 * cx + 2, 2 * cy + 1], B: [2 * cx + 1, 2 * cy + 2], L: [2 * cx, 2 * cy + 1] };
      for (const [a, b] of segs) next.set(key(...P[a]), key(...P[b]));
    }
  }
  const rings = [];
  const seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const ring = [];
    let k = start;
    do {
      seen.add(k);
      ring.push((k % W2) / 2 - 1, Math.floor(k / W2) / 2 - 1);
      k = next.get(k);
    } while (k !== start);
    rings.push(ring);
  }
  return rings;
}

export function ringArea(r) {
  let s = 0;
  for (let i = 0, n = r.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    s += r[2 * i] * r[2 * j + 1] - r[2 * j] * r[2 * i + 1];
  }
  return s / 2;
}

export function pointInRing(r, x, y) {
  let inside = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function ringBox(r) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]);
    y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]);
  }
  return [x0, y0, x1, y1];
}

// Кольца без пересечений: положительная площадь - внешний контур, отрицательная - дыра.
// Каждую дыру отдаём наименьшему внешнему контуру, который её содержит. Вход - объекты { pts }.
export function groupRings(rings) {
  for (const r of rings) { r.area ??= ringArea(r.pts); r.box ??= ringBox(r.pts); }
  const outers = rings.filter((r) => r.area > 0).sort((a, b) => a.area - b.area);
  const polys = new Map(outers.map((o) => [o, { outer: o, holes: [] }]));
  for (const hole of rings) {
    if (hole.area >= 0) continue;
    const x = hole.pts[0], y = hole.pts[1];
    const owner = outers.find((o) => o.area > -hole.area && x >= o.box[0] && x <= o.box[2] && y >= o.box[1] && y <= o.box[3] && pointInRing(o.pts, x, y));
    if (owner) polys.get(owner).holes.push(hole);
  }
  return [...polys.values()];
}

// Дуглас-Пекер для замкнутого кольца; совсем прямые точки убираются и при tol = 0
export function simplifyRing(pts, tol) {
  const n = pts.length / 2;
  if (n < 4) return pts.slice();
  const keep = new Uint8Array(n);
  // опорные точки: первая и самая дальняя от неё
  let far = 0, best = -1;
  for (let i = 1; i < n; i++) {
    const d = (pts[2 * i] - pts[0]) ** 2 + (pts[2 * i + 1] - pts[1]) ** 2;
    if (d > best) { best = d; far = i; }
  }
  keep[0] = 1; keep[far] = 1;
  const stack = [[0, far], [far, n]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const ax = pts[2 * a], ay = pts[2 * a + 1], bx = pts[2 * (b % n)], by = pts[2 * (b % n) + 1];
    const len = Math.hypot(bx - ax, by - ay);
    let idx = -1, dmax = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[2 * i], py = pts[2 * i + 1];
      const d = len > 0 ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len : Math.hypot(px - ax, py - ay);
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > tol) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[2 * i], pts[2 * i + 1]);
  return out;
}

// Триангуляция многоугольника с дырами. Возвращает тройки индексов (в общей нумерации колец),
// обход против часовой. Проверяет, что край триангуляции - ровно рёбра колец; иначе null.
export function triangulatePolygon(poly) {
  const rings = [poly.outer, ...poly.holes];
  const coords = [];
  const holeIdx = [];
  let n = 0;
  // крошечный сдвиг только для earcut: точно коллинеарные точки он выбрасывает, а нам нужны все
  for (const r of rings) {
    if (r !== poly.outer) holeIdx.push(n);
    const k = r.pts.length / 2;
    const [x0, y0, x1, y1] = r.box ?? ringBox(r.pts);
    const eps = Math.max(x1 - x0, y1 - y0, 1) * 1e-7;
    for (let i = 0; i < k; i++) {
      const j = n + i;
      coords.push(r.pts[2 * i] + eps * Math.sin(j * 12.9898), r.pts[2 * i + 1] + eps * Math.sin(j * 78.233));
    }
    n += k;
  }
  const t = earcut(coords, holeIdx.length ? holeIdx : undefined);
  let sum = 0;
  for (let i = 0; i < t.length; i += 3) {
    const [a, b, c] = [t[i], t[i + 1], t[i + 2]];
    sum += (coords[2 * b] - coords[2 * a]) * (coords[2 * c + 1] - coords[2 * a + 1]) - (coords[2 * c] - coords[2 * a]) * (coords[2 * b + 1] - coords[2 * a + 1]);
  }
  if (sum < 0) for (let i = 0; i < t.length; i += 3) [t[i + 1], t[i + 2]] = [t[i + 2], t[i + 1]];
  const edges = new Map();
  for (let i = 0; i < t.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const e = t[i + k] * n + t[i + ((k + 1) % 3)];
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
  }
  const ringEdge = new Set();
  let base = 0;
  for (const r of rings) {
    const k = r.pts.length / 2;
    for (let i = 0; i < k; i++) ringEdge.add((base + i) * n + base + ((i + 1) % k));
    base += k;
  }
  for (const [e, cnt] of edges) {
    if (cnt !== 1) return null;
    const a = Math.floor(e / n), b = e % n;
    if (!ringEdge.has(e) && edges.get(b * n + a) !== 1) return null;
  }
  for (const e of ringEdge) if (!edges.has(e) || edges.has((e % n) * n + Math.floor(e / n))) return null;
  return t;
}
