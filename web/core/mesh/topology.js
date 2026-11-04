// Связность сетки: рёбра, оболочки, согласование ориентации, контуры дыр.

// Полурёбра по вершинам (CSR): у вершины u - список концов v для всех рёбер u->v в гранях.
// Без хэшей: ключи вида u * n + v больше 2^31 и делают Map/Set медленными на больших сетках.
function buckets(indices, nv, keyOf) {
  const nh = indices.length;
  const start = new Int32Array(nv + 1);
  for (let h = 0; h < nh; h++) start[keyOf(h) + 1] += 1;
  for (let i = 0; i < nv; i++) start[i + 1] += start[i];
  const fill = start.slice(0, nv);
  const half = new Int32Array(nh);
  for (let h = 0; h < nh; h++) half[fill[keyOf(h)]++] = h;
  return { start, half };
}

const nextOf = (indices, h) => indices[h - (h % 3) + ((h % 3) + 1) % 3];

// Каждое ребро должно быть ровно у двух граней и обходиться ими в противоположные стороны.
export function isWatertight(mesh) {
  const idx = mesh.indices;
  const n = mesh.positions.length / 3;
  if (!idx.length) return false;
  for (let i = 0; i < idx.length; i += 3) if (idx[i] === idx[i + 1] || idx[i + 1] === idx[i + 2] || idx[i] === idx[i + 2]) return false;
  const { start, half } = buckets(idx, n, (h) => idx[h]);
  const count = (u, v) => {
    let c = 0;
    for (let i = start[u]; i < start[u + 1]; i++) if (nextOf(idx, half[i]) === v) c += 1;
    return c;
  };
  for (let h = 0; h < idx.length; h++) {
    const u = idx[h], v = nextOf(idx, h);
    if (count(u, v) !== 1 || count(v, u) !== 1) return false;
  }
  return true;
}

// Неориентированные рёбра: у каждого первые две грани и направление обхода в них (1 - от меньшей вершины к большей).
export function buildEdges(indices, nv) {
  const nh = indices.length;
  const lo = (h) => Math.min(indices[h], nextOf(indices, h));
  const { start, half } = buckets(indices, nv, lo);
  const faceEdges = new Int32Array(nh).fill(-1);
  const f1 = [], f2 = [], d1 = [], d2 = [], count = [];
  for (let u = 0; u < nv; u++) {
    for (let i = start[u]; i < start[u + 1]; i++) {
      const h = half[i];
      if (faceEdges[h] >= 0) continue;
      const hi = Math.max(indices[h], nextOf(indices, h));
      const e = count.length;
      count.push(0); f1.push(-1); d1.push(0); f2.push(-1); d2.push(0);
      // полурёбра в корзине идут по возрастанию номера - первая грань раньше второй
      for (let j = i; j < start[u + 1]; j++) {
        const g = half[j];
        if (Math.max(indices[g], nextOf(indices, g)) !== hi) continue;
        faceEdges[g] = e;
        const f = (g - (g % 3)) / 3, dir = indices[g] < nextOf(indices, g) ? 1 : 0;
        if (count[e] === 0) { f1[e] = f; d1[e] = dir; } else if (count[e] === 1) { f2[e] = f; d2[e] = dir; }
        count[e] += 1;
      }
    }
  }
  return { faceEdges, f1, f2, d1, d2, count, edgeCount: count.length };
}

// Есть ли ребро a-b (в любую сторону) среди граней
export function edgeChecker(indices, nv) {
  const { start, half } = buckets(indices, nv, (h) => indices[h]);
  const has = (u, v) => {
    for (let i = start[u]; i < start[u + 1]; i++) if (nextOf(indices, half[i]) === v) return true;
    return false;
  };
  return (a, b) => has(a, b) || has(b, a);
}

// Повторы граней (тот же набор вершин в любом порядке обхода): флаг у второй и следующих
export function duplicateFaces(indices, nv) {
  const nf = indices.length / 3;
  const sorted = new Int32Array(indices.length);
  for (let f = 0; f < nf; f++) {
    const t = [indices[3 * f], indices[3 * f + 1], indices[3 * f + 2]].sort((x, y) => x - y);
    sorted.set(t, 3 * f);
  }
  const { start, half } = buckets(sorted, nv, (h) => sorted[h - (h % 3)]);
  const dup = new Uint8Array(nf);
  for (let u = 0; u < nv; u++) {
    for (let i = start[u]; i < start[u + 1]; i++) {
      if (half[i] % 3) continue;
      const f = half[i] / 3;
      for (let j = start[u]; j < i && !dup[f]; j++) {
        const g = half[j];
        dup[f] = g % 3 === 0 && sorted[g + 1] === sorted[3 * f + 1] && sorted[g + 2] === sorted[3 * f + 2] ? 1 : 0;
      }
    }
  }
  return dup;
}

// Оболочки: грани, связанные общими рёбрами
export function faceShells(indices, nv, edges = buildEdges(indices, nv)) {
  const nf = indices.length / 3;
  const parent = new Int32Array(nf).map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const { faceEdges, f1 } = edges;
  for (let f = 0; f < nf; f++) {
    for (let k = 0; k < 3; k++) {
      const a = find(f), b = find(f1[faceEdges[3 * f + k]]);
      if (a !== b) parent[a] = b;
    }
  }
  const label = new Map();
  const shellOf = new Int32Array(nf);
  for (let f = 0; f < nf; f++) {
    const r = find(f);
    if (!label.has(r)) label.set(r, label.size);
    shellOf[f] = label.get(r);
  }
  return { shellOf, count: label.size };
}

// Обход в ширину по рёбрам с двумя гранями: соседняя грань должна идти по ребру навстречу.
// Возвращает флаги переворота для каждой грани (оболочка целиком потом может перевернуться по знаку объёма).
export function orientFlags(indices, nv, edges = buildEdges(indices, nv)) {
  const nf = indices.length / 3;
  const flip = new Uint8Array(nf);
  const seen = new Uint8Array(nf);
  const { faceEdges, f1, f2, d1, d2, count } = edges;
  const queue = new Int32Array(nf);
  let conflicts = 0;
  for (let s = 0; s < nf; s++) {
    if (seen[s]) continue;
    seen[s] = 1;
    let head = 0, tail = 0;
    queue[tail++] = s;
    while (head < tail) {
      const f = queue[head++];
      for (let k = 0; k < 3; k++) {
        const e = faceEdges[3 * f + k];
        if (count[e] !== 2) continue;
        const [g, dg, df] = f1[e] === f ? [f2[e], d2[e], d1[e]] : [f1[e], d1[e], d2[e]];
        if (g === f) continue;
        const want = dg ^ df ^ flip[f] ^ 1;
        if (!seen[g]) { seen[g] = 1; flip[g] = want; queue[tail++] = g; }
        else if (flip[g] !== want) conflicts += 1;
      }
    }
  }
  return { flip, conflicts: conflicts / 2 };
}

// Контуры дыр: рёбра без пары, развёрнутые так, как их должна обойти заплатка.
export function boundaryLoops(indices, nv) {
  const { start, half } = buckets(indices, nv, (h) => indices[h]);
  const out = new Map();
  let total = 0;
  for (let h = 0; h < indices.length; h++) {
    const u = indices[h], v = nextOf(indices, h);
    // край - ребро ровно одной грани; две грани в одну сторону (конфликт ориентации) - не дыра
    let paired = false;
    for (let i = start[v]; i < start[v + 1] && !paired; i++) paired = nextOf(indices, half[i]) === u;
    for (let i = start[u]; i < start[u + 1] && !paired; i++) paired = half[i] !== h && nextOf(indices, half[i]) === v;
    if (paired) continue;
    // ребро грани u->v без пары: заплатка пройдёт его как v->u
    if (!out.has(v)) out.set(v, []);
    out.get(v).push(u);
    total += 1;
  }
  const loops = [];
  for (const [start, list] of out) {
    while (list.length) {
      const loop = [start];
      let cur = list.pop();
      while (cur !== start && cur !== undefined) {
        loop.push(cur);
        cur = out.get(cur)?.pop();
      }
      // незамкнутая цепочка бывает только у неориентируемой сетки - такую не латаем
      if (cur === start) loops.push(loop);
    }
  }
  return { loops, openEdges: total };
}

// Обобщённое число обмотки замкнутой оболочки в точке (1 внутри, 0 снаружи)
export function windingNumber(positions, indices, faces, x, y, z) {
  let sum = 0;
  for (const f of faces) {
    const a = 3 * indices[3 * f], b = 3 * indices[3 * f + 1], c = 3 * indices[3 * f + 2];
    const ax = positions[a] - x, ay = positions[a + 1] - y, az = positions[a + 2] - z;
    const bx = positions[b] - x, by = positions[b + 1] - y, bz = positions[b + 2] - z;
    const cx = positions[c] - x, cy = positions[c + 1] - y, cz = positions[c + 2] - z;
    const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz), lc = Math.hypot(cx, cy, cz);
    const det = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    const div = la * lb * lc + (ax * bx + ay * by + az * bz) * lc + (bx * cx + by * cy + bz * cz) * la + (cx * ax + cy * ay + cz * az) * lb;
    sum += 2 * Math.atan2(det, div);
  }
  return sum / (4 * Math.PI);
}
