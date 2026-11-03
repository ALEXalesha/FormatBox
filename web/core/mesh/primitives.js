// Простые замкнутые тела (грани против часовой снаружи): для примеров, проверок и подставок.
import { createBuilder } from './common.js';

// Коробка от (0,0,0) до (sx,sy,sz)
export function box(sx = 1, sy = sx, sz = sx) {
  const b = createBuilder();
  const v = [];
  for (let i = 0; i < 8; i++) v.push(b.vertex(i & 1 ? sx : 0, i & 2 ? sy : 0, i & 4 ? sz : 0));
  b.quad(v[0], v[2], v[3], v[1]); // низ
  b.quad(v[4], v[5], v[7], v[6]); // верх
  b.quad(v[0], v[1], v[5], v[4]); // y = 0
  b.quad(v[2], v[6], v[7], v[3]); // y = sy
  b.quad(v[0], v[4], v[6], v[2]); // x = 0
  b.quad(v[1], v[3], v[7], v[5]); // x = sx
  return b.build();
}

// Шар с полюсами-вершинами, центр в начале координат
export function sphere(r = 1, seg = 24, rings = 12) {
  const b = createBuilder();
  const south = b.vertex(0, 0, -r);
  const rows = [];
  for (let j = 1; j < rings; j++) {
    const t = Math.PI * (j / rings - 0.5);
    const row = [];
    for (let i = 0; i < seg; i++) {
      const a = (2 * Math.PI * i) / seg;
      row.push(b.vertex(r * Math.cos(t) * Math.cos(a), r * Math.cos(t) * Math.sin(a), r * Math.sin(t)));
    }
    rows.push(row);
  }
  const north = b.vertex(0, 0, r);
  for (let i = 0; i < seg; i++) {
    const n = (i + 1) % seg;
    b.tri(south, rows[0][n], rows[0][i]);
    for (let j = 0; j + 1 < rows.length; j++) b.quad(rows[j][i], rows[j][n], rows[j + 1][n], rows[j + 1][i]);
    b.tri(north, rows.at(-1)[i], rows.at(-1)[n]);
  }
  return b.build();
}

export function torus(R = 2, r = 0.5, seg = 24, sides = 12) {
  const b = createBuilder();
  const v = [];
  for (let i = 0; i < seg; i++) {
    const a = (2 * Math.PI * i) / seg;
    for (let j = 0; j < sides; j++) {
      const t = (2 * Math.PI * j) / sides;
      const w = R + r * Math.cos(t);
      v.push(b.vertex(w * Math.cos(a), w * Math.sin(a), r * Math.sin(t)));
    }
  }
  const at = (i, j) => v[(i % seg) * sides + (j % sides)];
  for (let i = 0; i < seg; i++) for (let j = 0; j < sides; j++) b.quad(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
  return b.build();
}

// Цилиндр по оси Z от 0 до h
export function cylinder(r = 1, h = 1, seg = 24) {
  const b = createBuilder();
  const lo = [], hi = [];
  for (let i = 0; i < seg; i++) {
    const a = (2 * Math.PI * i) / seg;
    lo.push(b.vertex(r * Math.cos(a), r * Math.sin(a), 0));
    hi.push(b.vertex(r * Math.cos(a), r * Math.sin(a), h));
  }
  const cl = b.vertex(0, 0, 0), ch = b.vertex(0, 0, h);
  for (let i = 0; i < seg; i++) {
    const n = (i + 1) % seg;
    b.quad(lo[i], lo[n], hi[n], hi[i]);
    b.tri(cl, lo[n], lo[i]);
    b.tri(ch, hi[i], hi[n]);
  }
  return b.build();
}
