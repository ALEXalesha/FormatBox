// Общие кирпичики для сеток: { positions: Float32Array (x,y,z), indices: Uint32Array (3 на треугольник) }.
export function checkAbort(signal) {
  if (signal?.aborted) throw new Error('canceled');
}

// Длинная работа отдаёт управление раз в ~30 мс: иначе в Worker отмена (AbortSignal) не дойдёт до цикла.
export function makeTicker({ signal, progress } = {}) {
  let last = Date.now();
  return async (frac) => {
    checkAbort(signal);
    if (Date.now() - last < 30) return;
    if (progress) progress(Math.min(1, Math.max(0, frac)));
    await new Promise((r) => setTimeout(r, 0));
    last = Date.now();
    checkAbort(signal);
  };
}

export function emptyMesh() {
  return { positions: new Float32Array(0), indices: new Uint32Array(0) };
}

export function triangleCount(mesh) {
  return mesh.indices.length / 3;
}

// Набор вершин и граней без лишних копий: генераторы (литофан, силуэт, примитивы) пишут сюда.
export function createBuilder() {
  const pos = [];
  const idx = [];
  return {
    vertex(x, y, z) { pos.push(x, y, z); return pos.length / 3 - 1; },
    tri(a, b, c) { idx.push(a, b, c); },
    quad(a, b, c, d) { idx.push(a, b, c, a, c, d); },
    get vertexCount() { return pos.length / 3; },
    build() { return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) }; },
  };
}

export function mergeMeshes(list) {
  let nv = 0, ni = 0;
  for (const m of list) { nv += m.positions.length; ni += m.indices.length; }
  const positions = new Float32Array(nv);
  const indices = new Uint32Array(ni);
  let pv = 0, pi = 0;
  for (const m of list) {
    positions.set(m.positions, pv);
    const base = pv / 3;
    for (let i = 0; i < m.indices.length; i++) indices[pi + i] = m.indices[i] + base;
    pv += m.positions.length;
    pi += m.indices.length;
  }
  return { positions, indices };
}

// Матрица 4x4 по столбцам (как в glTF). Зеркальная матрица переворачивает порядок вершин, чтобы нормали остались наружу.
export function transformMesh(mesh, m) {
  const p = mesh.positions;
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  const det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
  return { positions: out, indices: det < 0 ? flipIndices(mesh.indices) : mesh.indices.slice() };
}

export function flipIndices(indices) {
  const out = indices.slice();
  for (let i = 0; i < out.length; i += 3) { out[i + 1] = indices[i + 2]; out[i + 2] = indices[i + 1]; }
  return out;
}

export function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    out[c * 4 + r] = s;
  }
  return out;
}

export const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

// Склейка вершин с одинаковыми координатами (бит в бит): STL и GLB хранят копии на каждом треугольнике.
export function weldExact(mesh) {
  const p = mesh.positions;
  const n = p.length / 3;
  const bits = new Uint32Array(p.buffer, p.byteOffset, p.length);
  const map = new Map();
  const remap = new Uint32Array(n);
  const keep = [];
  for (let i = 0; i < n; i++) {
    const key = `${bits[3 * i]},${bits[3 * i + 1]},${bits[3 * i + 2]}`;
    let j = map.get(key);
    if (j === undefined) { j = keep.length; map.set(key, j); keep.push(i); }
    remap[i] = j;
  }
  const positions = new Float32Array(keep.length * 3);
  keep.forEach((i, j) => { positions[3 * j] = p[3 * i]; positions[3 * j + 1] = p[3 * i + 1]; positions[3 * j + 2] = p[3 * i + 2]; });
  const indices = new Uint32Array(mesh.indices.length);
  for (let i = 0; i < indices.length; i++) indices[i] = remap[mesh.indices[i]];
  return { positions, indices };
}

// Убрать вершины, на которые не ссылается ни один треугольник (порядок оставшихся прежний).
export function compact(positions, indices) {
  const n = positions.length / 3;
  const remap = new Int32Array(n).fill(-1);
  let k = 0;
  for (let i = 0; i < indices.length; i++) if (remap[indices[i]] < 0) remap[indices[i]] = 0;
  for (let i = 0; i < n; i++) if (remap[i] === 0) remap[i] = k++;
  if (k === n) return { positions: positions.slice(), indices: Uint32Array.from(indices) };
  const out = new Float32Array(k * 3);
  for (let i = 0; i < n; i++) if (remap[i] >= 0) out.set(positions.subarray(3 * i, 3 * i + 3), 3 * remap[i]);
  const idx = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) idx[i] = remap[indices[i]];
  return { positions: out, indices: idx };
}

// Самое короткое десятичное, которое возвращается в тот же float32
export function num(x) {
  for (let p = 6; p < 10; p++) {
    const s = x.toPrecision(p);
    if (Math.fround(+s) === x) return String(+s);
  }
  return String(x);
}
