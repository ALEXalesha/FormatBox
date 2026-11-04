// Общие заготовки для тестов 3D: случайные тела, порча сеток, случайные маски.
import { box, sphere, torus, cylinder } from '../../web/core/mesh/primitives.js';
import { mergeMeshes, transformMesh } from '../../web/core/mesh/common.js';

export function randomShape(r) {
  const kind = r.pick(['sphere', 'box', 'torus', 'cylinder']);
  const s = 1 + r() * 30;
  let m;
  if (kind === 'sphere') m = sphere(s, r.int(8, 30), r.int(5, 16));
  else if (kind === 'box') m = box(s, 1 + r() * 20, 1 + r() * 20);
  else if (kind === 'torus') m = torus(s + 2, 0.5 + r() * 1.5, r.int(8, 30), r.int(5, 14));
  else m = cylinder(s, 1 + r() * 20, r.int(6, 30));
  const t = [r() * 100 - 50, r() * 100 - 50, r() * 100 - 50];
  return { kind, mesh: transformMesh(m, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...t, 1]) };
}

export function flipAll(mesh) {
  const idx = mesh.indices.slice();
  for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  return { positions: mesh.positions, indices: idx };
}

// Порча: удалить грани, перевернуть грани, дубли, мелкие оболочки, шум сварки, вся оболочка наизнанку
export function damage(r, mesh, kinds = ['remove', 'flip', 'dup', 'small', 'noise', 'invert']) {
  const pos = Array.from(mesh.positions);
  let tris = [];
  for (let i = 0; i < mesh.indices.length; i += 3) tris.push([mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]]);
  const used = new Set();
  const size = Math.max(...pos.map(Math.abs)) || 1;
  const pickFace = () => r.int(0, tris.length - 1);
  if (kinds.includes('invert') && r() < 0.3) tris = tris.map(([a, b, c]) => [a, c, b]);
  if (kinds.includes('remove')) {
    const n = r.int(1, Math.max(1, Math.floor(tris.length / 40)));
    for (let k = 0; k < n && tris.length > 8; k++) {
      // удаляем только не соседние, чтобы дыры не съедали тело целиком
      const f = pickFace();
      if (tris[f].some((v) => used.has(v))) continue;
      tris[f].forEach((v) => used.add(v));
      tris.splice(f, 1);
    }
    // большая дыра: все грани вокруг одной вершины
    if (r() < 0.6) {
      const v = tris[pickFace()][0];
      const star = tris.filter((t) => t.includes(v));
      if (star.every((t) => t.every((x) => !used.has(x)))) {
        star.flat().forEach((x) => used.add(x));
        tris = tris.filter((t) => !t.includes(v));
      }
    }
  }
  if (kinds.includes('flip')) for (let k = r.int(0, 5); k > 0; k--) { const t = tris[pickFace()]; [t[1], t[2]] = [t[2], t[1]]; }
  if (kinds.includes('dup')) for (let k = r.int(0, 4); k > 0; k--) { const t = tris[pickFace()]; tris.push(r() < 0.5 ? [...t] : [t[0], t[2], t[1]]); }
  if (kinds.includes('noise')) {
    for (let k = r.int(0, 8); k > 0; k--) {
      const t = tris[pickFace()];
      const j = r.int(0, 2);
      const v = t[j];
      pos.push(pos[3 * v] + (r() - 0.5) * size * 1e-7, pos[3 * v + 1], pos[3 * v + 2]);
      t[j] = pos.length / 3 - 1;
    }
  }
  if (kinds.includes('small')) {
    for (let k = r.int(0, 3); k > 0; k--) {
      const b = pos.length / 3;
      const o = [size * 3 + r() * 10, r() * 10, r() * 10];
      pos.push(...o, o[0] + 0.01, o[1], o[2], o[0], o[1] + 0.01, o[2]);
      tris.push([b, b + 1, b + 2]);
    }
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(tris.flat()) };
}

// Случайная маска: кляксы (метаболы), часть - кольца с дырами, немного шума
export function blobMask(r, w = r.int(16, 70), h = r.int(16, 70)) {
  const data = new Uint8Array(w * h);
  const cs = Array.from({ length: r.int(1, 5) }, () => [r() * w, r() * h, 2 + (r() * Math.min(w, h)) / 4]);
  const ring = r() < 0.5;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (const [cx, cy, rr] of cs) v += (rr * rr) / ((x - cx) ** 2 + (y - cy) ** 2 + 1);
      data[y * w + x] = (v > 1 && (!ring || v < 3)) || r() < 0.01 ? 1 : 0;
    }
  }
  return { width: w, height: h, data };
}

export function maskArea(mask) {
  return mask.data.reduce((s, v) => s + v, 0);
}

export function sameMesh(a, b) {
  return a.positions.length === b.positions.length && a.indices.length === b.indices.length
    && a.positions.every((v, i) => Object.is(v, b.positions[i])) && a.indices.every((v, i) => v === b.indices[i]);
}

export function copyMesh(m) {
  return { positions: m.positions.slice(), indices: m.indices.slice() };
}

export { mergeMeshes, box, sphere, torus, cylinder };
