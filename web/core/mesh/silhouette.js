// Силуэт: картинка -> маска -> контуры -> выдавливание. Режимы: plain, keychain (ушко с отверстием),
// sign (табличка с выпуклой фигурой), cookie (формочка: стенка + фланец), stencil (пластина с вырезом).
import { createBuilder, checkAbort, emptyMesh } from './common.js';
import { toGray, downsample } from './litho.js';
import { traceRings, groupRings, simplifyRing, triangulatePolygon, dilate, erode, ringArea } from './contours.js';

// Тёмное (ниже порога) - фигура; invert - наоборот. Прозрачное считается фоном (белым).
export function imageToMask(gray, opts = {}) {
  const img = downsample(toGray(gray), opts.maxPixels ?? 1000000);
  const thr = opts.threshold ?? 128;
  const data = new Uint8Array(img.width * img.height);
  for (let i = 0; i < data.length; i++) data[i] = (img.data[i] < thr) !== !!opts.invert ? 1 : 0;
  return { width: img.width, height: img.height, data };
}

// Убрать крошки: связные куски фигуры и дырки фона меньше minPixels (связность по сторонам, как у контуров)
export function despeckle(mask, minPixels) {
  const { width: w, height: h } = mask;
  const data = mask.data.slice();
  if (!(minPixels > 1)) return { width: w, height: h, data };
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let s = 0; s < w * h; s++) {
    if (seen[s]) continue;
    const v = data[s];
    const part = [];
    let border = false;
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop();
      part.push(i);
      const x = i % w, y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && !seen[j] && data[j] === v) { seen[j] = 1; stack.push(j); }
      }
    }
    // фон, касающийся края, - это не дырка
    if (part.length < minPixels && (v === 1 || !border)) for (const i of part) data[i] = 1 - v;
  }
  return { width: w, height: h, data };
}

function maskBox(mask) {
  const { width: w, height: h, data } = mask;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!data[y * w + x]) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

// Вырезать рамку фигуры, увеличить в k раз (ближайший сосед) и добавить поля pad
function reframe(mask, box, k, pad) {
  const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
  const w = bw * k + 2 * pad, h = bh * k + 2 * pad;
  const data = new Uint8Array(w * h);
  for (let y = 0; y < bh * k; y++) {
    const sy = box.y0 + Math.floor(y / k);
    for (let x = 0; x < bw * k; x++) data[(y + pad) * w + x + pad] = mask.data[sy * mask.width + box.x0 + Math.floor(x / k)];
  }
  return { width: w, height: h, data };
}

function disk(mask, cx, cy, r, value) {
  const { width: w, height: h, data } = mask;
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) data[y * w + x] = value;
    }
  }
}

function rect(mask, x0, y0, x1, y1) {
  const out = new Uint8Array(mask.width * mask.height);
  for (let y = y0; y <= y1; y++) out.fill(1, y * mask.width + x0, y * mask.width + x1 + 1);
  return { width: mask.width, height: mask.height, data: out };
}

function combine(a, b, fn) {
  return { width: a.width, height: a.height, data: a.data.map((v, i) => fn(v, b.data[i])) };
}

// gray: картинка { width, height, data }; opts - как у extrudeMask плюс threshold, invert
export function extrudeSilhouette(gray, opts = {}) {
  return extrudeMask(imageToMask(gray, opts), opts);
}

// mask: { width, height, data 0/1 } - из картинки, шрифта или canvas. Размеры в мм:
// widthMm - ширина фигуры (или pxMm - мм на пиксель), heightMm - полная высота, baseMm - подложка/фланец,
// wallMm - стенка формочки или ушка, holeMm - отверстие брелка, marginMm - поля таблички и трафарета,
// flangeMm - ширина фланца формочки, simplify (пикс), minArea (пикс²), signal
export function extrudeMask(mask, opts = {}) {
  const mode = opts.mode ?? 'plain';
  if (!['plain', 'keychain', 'sign', 'cookie', 'stencil'].includes(mode)) throw new Error(`unknown mode: ${mode}`);
  checkAbort(opts.signal);
  mask = despeckle(mask, opts.minArea ?? 3);
  const box = maskBox(mask);
  if (!box) return emptyMesh();
  let pxMm = opts.pxMm ?? (opts.widthMm ?? 50) / (box.x1 - box.x0 + 1);
  const holeMm = opts.holeMm ?? 4;
  const wallMm = opts.wallMm ?? (mode === 'cookie' ? 1 : 2);
  const marginMm = opts.marginMm ?? 3;
  const flangeMm = opts.flangeMm ?? 4;
  const heightMm = opts.heightMm ?? { plain: 3, keychain: 3, sign: 4, cookie: 15, stencil: 1.5 }[mode];
  const baseMm = opts.baseMm ?? 2;
  const ring = mode === 'keychain' || (mode === 'sign' && !!opts.ring);
  const plate = mode === 'sign' || mode === 'stencil';
  // мелкие детали (ушко, стенка, поля) должны занять хотя бы 3 пикселя - иначе увеличиваем маску
  const finest = Math.min(ring ? Math.min(holeMm / 2, wallMm) : Infinity, plate ? marginMm : Infinity, mode === 'cookie' ? wallMm : Infinity);
  const area = (box.x1 - box.x0 + 1) * (box.y1 - box.y0 + 1);
  let k = 1;
  while (finest / (pxMm / k) < 3 && area * (k + 1) ** 2 <= (opts.maxPixels ?? 4000000)) k += 1;
  pxMm /= k;
  const px = (mm) => mm / pxMm;
  const closeMm = opts.plate === 'outline' ? opts.closeMm ?? marginMm : 0;
  const extra = (ring ? px(holeMm + 2 * wallMm) : 0) + (plate ? px(marginMm + closeMm) : 0) + (mode === 'cookie' ? px(wallMm + flangeMm) + 2 : 0);
  const pad = Math.ceil(extra) + 2;
  const m = reframe(mask, box, k, pad);
  const margin = Math.max(1, Math.round(px(marginMm)));
  // пластина по контуру: раздуть и сжать обратно (closing), чтобы промежутки между частями заросли.
  // Фигура должна лежать строго внутри пластины и по диагонали тоже: запас не меньше 1.5 пикселя.
  const plateOf = () => {
    if (opts.plate !== 'outline') return rect(m, pad - margin, pad - margin, m.width - pad - 1 + margin, m.height - pad - 1 + margin);
    const c = px(closeMm);
    return combine(erode(dilate(m, margin + 0.5 + c), c), dilate(m, margin + 0.5), (a, b) => a | b);
  };
  // ушко над самой верхней точкой, заходит в фигуру на полстенки
  const withRing = (src) => {
    const out = { width: src.width, height: src.height, data: src.data.slice() };
    const top = src.data.findIndex((v) => v);
    const tx = top % src.width, ty = (top - tx) / src.width;
    const ri = px(holeMm) / 2, ro = ri + px(wallMm);
    const cy = ty - ri - px(wallMm) / 2;
    disk(out, tx, cy, ro, 1);
    disk(out, tx, cy, ri, 0);
    return out;
  };
  let base = m, top = null, baseH = heightMm, topH = 0;
  if (mode === 'keychain') base = withRing(m);
  else if (mode === 'sign') {
    base = ring ? withRing(plateOf()) : plateOf();
    top = m; baseH = baseMm; topH = heightMm;
  } else if (mode === 'cookie') {
    const w = Math.max(1, px(wallMm));
    // фланец заходит внутрь на 1.5 пикселя: стенка лежит строго внутри него и контуры не касаются
    top = combine(dilate(m, w), m, (a, b) => a & (1 - b));
    base = combine(dilate(m, w + Math.max(px(flangeMm), 1.5)), erode(m, 1.5), (a, b) => a & (1 - b));
    baseH = baseMm; topH = heightMm;
  } else if (mode === 'stencil') base = combine(plateOf(), m, (a, b) => a & (1 - b));
  if (top && !(topH > baseH)) throw new Error(`${mode}: heightMm must be above baseMm`);
  checkAbort(opts.signal);
  opts.progress?.(0.4);
  // упрощённые контуры близких колец могут пересечься - тогда строим по сырым (они не пересекаются никогда)
  const mesh = stackSolid(base, baseH, top, topH, pxMm, opts) ?? stackSolid(base, baseH, top, topH, pxMm, { ...opts, simplify: 0 });
  if (!mesh) throw new Error('triangulation failed');
  // левый нижний угол - в начало координат
  let x0 = Infinity, y0 = Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) { x0 = Math.min(x0, mesh.positions[i]); y0 = Math.min(y0, mesh.positions[i + 1]); }
  for (let i = 0; i < mesh.positions.length; i += 3) { mesh.positions[i] -= x0; mesh.positions[i + 1] -= y0; }
  opts.progress?.(1);
  return mesh;
}

// Кольца маски в мм: y вверх, порядок обхода развёрнут - внешний контур снова против часовой.
// Вложенность берём по сырым контурам (они не пересекаются), упрощённое кольцо - только для геометрии.
function ringsOf(mask, pxMm, opts) {
  const tol = opts.simplify ?? 0.4;
  return traceRings(mask).map((raw) => {
    const rawArea = ringArea(raw);
    const make = (t) => {
      const sm = simplifyRing(raw, t);
      const n = sm.length / 2;
      const pts = new Array(sm.length);
      for (let i = 0; i < n; i++) {
        const j = n - 1 - i;
        pts[2 * i] = sm[2 * j] * pxMm;
        pts[2 * i + 1] = (mask.height - sm[2 * j + 1]) * pxMm;
      }
      return { raw, rawArea, pts, area: ringArea(pts) };
    };
    const r = make(tol);
    // упрощение могло выродить или вывернуть кольцо - тогда берём сырое (без точно прямых точек)
    return r.pts.length >= 6 && Math.sign(r.area) === Math.sign(rawArea) ? r : make(0);
  });
}

function reverseRing(r) {
  const n = r.pts.length / 2;
  const pts = [];
  for (let i = n - 1; i >= 0; i--) pts.push(r.pts[2 * i], r.pts[2 * i + 1]);
  return { pts, area: -r.area, src: r, rev: true };
}

// Многоугольники (внешний контур + дыры) по сырым контурам; rev - кольца, взятые наоборот
function polygons(list) {
  const groups = groupRings(list.map(({ ring, rev }) => ({ pts: ring.raw, area: rev ? -ring.rawArea : ring.rawArea, ring, rev })));
  const view = (g) => (g.rev ? reverseRing(g.ring) : g.ring);
  return groups.map((p) => ({ outer: view(p.outer), holes: p.holes.map(view) }));
}

// Тело из двух слоёв: base от 0 до baseH, top (внутри base) от baseH до topH
function stackSolid(baseMask, baseH, topMask, topH, pxMm, opts) {
  const b = createBuilder();
  const baseRings = ringsOf(baseMask, pxMm, opts);
  const topRings = topMask ? ringsOf(topMask, pxMm, opts) : [];
  const levels = new Map();
  const vert = (ring, z) => {
    if (!levels.has(z)) levels.set(z, new Map());
    const m = levels.get(z);
    if (!m.has(ring)) {
      const ids = [];
      for (let i = 0; i < ring.pts.length; i += 2) ids.push(b.vertex(ring.pts[i], ring.pts[i + 1], z));
      m.set(ring, ids);
    }
    return m.get(ring);
  };
  let failed = false;
  const cap = (polys, z, up) => {
    for (const poly of polys) {
      checkAbort(opts.signal);
      const t = triangulatePolygon(poly);
      if (!t) { failed = true; return; }
      // кольцо, взятое наоборот, делит вершины с исходным (src)
      const ids = [poly.outer, ...poly.holes].flatMap((r) => (r.rev ? vert(r.src, z).slice().reverse() : vert(r, z)));
      for (let i = 0; i < t.length; i += 3) {
        if (up) b.tri(ids[t[i]], ids[t[i + 1]], ids[t[i + 2]]);
        else b.tri(ids[t[i]], ids[t[i + 2]], ids[t[i + 1]]);
      }
    }
  };
  const walls = (rings, z0, z1) => {
    for (const r of rings) {
      const lo = vert(r, z0), hi = vert(r, z1);
      for (let i = 0, n = lo.length; i < n; i++) {
        const j = (i + 1) % n;
        b.tri(hi[j], hi[i], lo[i]);
        b.tri(hi[j], lo[i], lo[j]);
      }
    }
  };
  const plainBase = baseRings.map((ring) => ({ ring }));
  cap(polygons(plainBase), 0, false);
  walls(baseRings, 0, baseH);
  // кольца верхнего слоя, взятые наоборот, - дыры в крышке нижнего
  cap(polygons([...plainBase, ...topRings.map((ring) => ({ ring, rev: true }))]), baseH, true);
  if (topRings.length) {
    walls(topRings, baseH, topH);
    cap(polygons(topRings.map((ring) => ({ ring }))), topH, true);
  }
  return failed ? null : b.build();
}
