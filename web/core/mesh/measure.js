// Обмеры сетки и прикидка печати: объём, площадь, габариты, единицы, вес и длина нити.
export function bounds(mesh) {
  const p = mesh.positions;
  if (!p.length) return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], center: [0, 0, 0], diagonal: 0 };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = p[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  return {
    min, max, size,
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    diagonal: Math.hypot(size[0], size[1], size[2]),
  };
}

// Знаковый объём (мм³): положителен, если грани смотрят наружу. Считаем от центра, чтобы далёкие координаты не теряли точность.
export function volume(mesh) {
  const p = mesh.positions, idx = mesh.indices;
  if (!idx.length) return 0;
  const c = bounds(mesh).center;
  let v = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = 3 * idx[i], b = 3 * idx[i + 1], d = 3 * idx[i + 2];
    const ax = p[a] - c[0], ay = p[a + 1] - c[1], az = p[a + 2] - c[2];
    const bx = p[b] - c[0], by = p[b + 1] - c[1], bz = p[b + 2] - c[2];
    const cx = p[d] - c[0], cy = p[d + 1] - c[1], cz = p[d + 2] - c[2];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

export function surfaceArea(mesh) {
  const p = mesh.positions, idx = mesh.indices;
  let s = 0;
  for (let i = 0; i < idx.length; i += 3) s += triangleArea(p, idx[i], idx[i + 1], idx[i + 2]);
  return s;
}

export function triangleArea(p, a, b, c) {
  a *= 3; b *= 3; c *= 3;
  const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
  const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
}

export function meshStats(mesh) {
  return {
    triangles: mesh.indices.length / 3,
    vertices: mesh.positions.length / 3,
    volume: volume(mesh),
    area: surfaceArea(mesh),
    bounds: bounds(mesh),
  };
}

// Масштаб числом или [sx, sy, sz]. Нечётное число отрицательных осей - зеркало, порядок вершин переворачиваем.
export function scaleMesh(mesh, s) {
  const [sx, sy, sz] = typeof s === 'number' ? [s, s, s] : s;
  const p = mesh.positions;
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) { out[i] = p[i] * sx; out[i + 1] = p[i + 1] * sy; out[i + 2] = p[i + 2] * sz; }
  const indices = mesh.indices.slice();
  if (sx * sy * sz < 0) for (let i = 0; i < indices.length; i += 3) { indices[i + 1] = mesh.indices[i + 2]; indices[i + 2] = mesh.indices[i + 1]; }
  return { positions: out, indices };
}

// Сколько миллиметров в единице
export const UNITS = { um: 0.001, micron: 0.001, mm: 1, cm: 10, m: 1000, in: 25.4, inch: 25.4, ft: 304.8, foot: 304.8 };

export function convertUnits(mesh, from, to) {
  const a = UNITS[from], b = UNITS[to];
  if (!a || !b) throw new Error(`unknown unit: ${a ? to : from}`);
  return scaleMesh(mesh, a / b);
}

// Плотность, г/см³
export const MATERIALS = {
  PLA: { density: 1.24 }, PETG: { density: 1.27 }, ABS: { density: 1.04 }, ASA: { density: 1.07 },
  TPU: { density: 1.21 }, NYLON: { density: 1.14 }, PC: { density: 1.2 }, HIPS: { density: 1.04 },
  PVA: { density: 1.23 }, WOOD: { density: 1.15 }, CF: { density: 1.3 }, RESIN: { density: 1.1 },
};

// Прикидка без слайсера: стенки = площадь * толщина (не больше объёма), внутри - заполнение долей infill.
export function printEstimate(mesh, opts = {}) {
  const { material = 'PLA', infill = 0.2, wallMm = 0.8, pricePerKg = 20, diameter = 1.75 } = opts;
  const density = opts.density ?? MATERIALS[String(material).toUpperCase()]?.density;
  if (!density) throw new Error(`unknown material: ${material}`);
  const fill = Math.min(1, Math.max(0, infill));
  const vol = Math.abs(volume(mesh));
  const shell = Math.min(vol, surfaceArea(mesh) * Math.max(0, wallMm));
  const used = shell + (vol - shell) * fill;
  const grams = (used / 1000) * density;
  const lengthM = used / (Math.PI * (diameter / 2) ** 2) / 1000;
  return { volumeMm3: vol, usedMm3: used, grams, lengthM, price: (grams / 1000) * pricePerKg, density };
}
