// Литофан (тёмное толще, на просвет видна картинка) и рельеф по карте высот (светлое выше).
// Любая форма строится как «сетка высот на подложке»: верх - сетка, низ и бока - только по краю, поэтому вершин ~ пикселей.
import { createBuilder, checkAbort } from './common.js';
import { volume } from './measure.js';

// Кадр в оттенки серого: принимает 1, 3 или 4 канала (прозрачное считаем белым)
export function toGray(img) {
  const { width: w, height: h, data } = img;
  const n = w * h;
  if (data.length === n) return { width: w, height: h, data };
  const ch = data.length / n;
  if (ch !== 3 && ch !== 4) throw new Error('image data size does not match width x height');
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * ch;
    const lum = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    const a = ch === 4 ? data[o + 3] / 255 : 1;
    out[i] = Math.round(lum * a + 255 * (1 - a));
  }
  return { width: w, height: h, data: out };
}

// Уменьшение усреднением, чтобы пикселей было не больше maxPixels
export function downsample(img, maxPixels) {
  const { width: w, height: h, data } = img;
  if (!maxPixels || w * h <= maxPixels) return img;
  const f = Math.sqrt(maxPixels / (w * h));
  const nw = Math.max(2, Math.floor(w * f)), nh = Math.max(2, Math.floor(h * f));
  const out = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor((y * h) / nh), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / nh));
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor((x * w) / nw), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / nw));
      let s = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) s += data[yy * w + xx];
      out[y * nw + x] = Math.round(s / ((y1 - y0) * (x1 - x0)));
    }
  }
  return { width: nw, height: nh, data: out };
}

// Картинка хотя бы 2x2 (сетке нужны два ряда)
function atLeast2(img) {
  if (img.width >= 2 && img.height >= 2) return img;
  const w = Math.max(2, img.width), h = Math.max(2, img.height);
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = img.data[Math.min(y, img.height - 1) * img.width + Math.min(x, img.width - 1)];
  return { width: w, height: h, data };
}

// Отсчёты вдоль оси: с рамкой - края рамки и центры пикселей, без рамки - пиксели от края до края
function axis(n, length, b0, b1, wrap) {
  if (wrap) return { at: Array.from({ length: n }, (_, i) => (i * length) / n), pixel: Array.from({ length: n }, (_, i) => i) };
  const at = [], pixel = [];
  if (b0 > 0) { at.push(0, b0); pixel.push(-1, -1); }
  const inner = length - b0 - b1;
  for (let i = 0; i < n; i++) {
    at.push(b0 > 0 || b1 > 0 ? b0 + ((i + 0.5) * inner) / n : (i * length) / (n - 1));
    pixel.push(i);
  }
  if (b1 > 0) { at.push(length - b1, length); pixel.push(-1, -1); }
  return { at, pixel };
}

// Замкнутое тело: верх - сетка (xs, ys, heights), низ на высоте 0. map(x, y, h) -> [X, Y, Z]. wrap - замкнуть по x (цилиндр).
export function gridSolid(xs, ys, heights, map, wrap = false) {
  const nx = xs.length, ny = ys.length;
  const b = createBuilder();
  const top = new Int32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) top[j * nx + i] = b.vertex(...map(xs[i], ys[j], heights[j * nx + i]));
  const bottom = new Int32Array(nx * ny).fill(-1);
  const B = (i, j) => {
    const k = j * nx + i;
    if (bottom[k] < 0) bottom[k] = b.vertex(...map(xs[i], ys[j], 0));
    return bottom[k];
  };
  const T = (i, j) => top[j * nx + i];
  const cols = wrap ? nx : nx - 1;
  const last = ny - 1;
  for (let i = 0; i < cols; i++) {
    const i1 = (i + 1) % nx;
    for (let j = 0; j < last; j++) b.quad(T(i, j), T(i1, j), T(i1, j + 1), T(i, j + 1));
    b.quad(T(i1, 0), T(i, 0), B(i, 0), B(i1, 0));
    b.quad(T(i, last), T(i1, last), B(i1, last), B(i, last));
    // низ полосами между соседними столбцами: на изогнутых формах каждая полоса плоская
    const ring = [B(i, 0), B(i1, 0)];
    if (!wrap && i1 === nx - 1) for (let j = 1; j < last; j++) ring.push(B(i1, j));
    ring.push(B(i1, last), B(i, last));
    if (!wrap && i === 0) for (let j = last - 1; j > 0; j--) ring.push(B(0, j));
    if (ring.length === 4) b.quad(ring[3], ring[2], ring[1], ring[0]);
    else {
      // новая вершина - среднее четырёх углов полосы (лежит в её плоскости)
      const c3 = [0, 0, 0];
      for (const [x, y] of [[xs[i], ys[0]], [xs[i1], ys[0]], [xs[i1], ys[last]], [xs[i], ys[last]]]) map(x, y, 0).forEach((v, k) => { c3[k] += v / 4; });
      const c = b.vertex(c3[0], c3[1], c3[2]);
      for (let k = 0; k < ring.length; k++) b.tri(c, ring[(k + 1) % ring.length], ring[k]);
    }
  }
  if (!wrap) {
    for (let j = 0; j < last; j++) {
      b.quad(T(0, j), T(0, j + 1), B(0, j + 1), B(0, j));
      b.quad(T(nx - 1, j + 1), T(nx - 1, j), B(nx - 1, j), B(nx - 1, j + 1));
    }
  }
  const mesh = b.build();
  // отображение могло зеркалить - тогда переворачиваем все грани разом
  if (volume(mesh) < 0) for (let i = 0; i < mesh.indices.length; i += 3) [mesh.indices[i + 1], mesh.indices[i + 2]] = [mesh.indices[i + 2], mesh.indices[i + 1]];
  return mesh;
}

// gray: { width, height, data }; opts: shape ('flat' | 'curved' | 'cylinder'), widthMm, minMm, maxMm, borderMm,
// arcDeg (curved), baseMm (цилиндр: сплошное кольцо снизу), invert, maxPixels, signal
export function lithophane(gray, opts = {}) {
  const { shape = 'flat', widthMm = 100, minMm = 0.8, maxMm = 3, borderMm = 0, arcDeg = 120, invert = false, baseMm = 0 } = opts;
  if (!(maxMm > minMm && minMm > 0)) throw new Error('need 0 < minMm < maxMm');
  checkAbort(opts.signal);
  const img = atLeast2(downsample(toGray(gray), opts.maxPixels ?? 250000));
  const thick = (v) => minMm + ((invert ? v : 255 - v) / 255) * (maxMm - minMm);
  if (shape === 'cylinder') {
    const R = widthMm / 2 - maxMm;
    if (!(R > 0)) throw new Error('cylinder is too small for this thickness');
    const circ = 2 * Math.PI * R;
    const imgH = (circ * img.height) / img.width;
    const xs = axis(img.width, circ, 0, 0, true);
    const ys = axis(img.height, imgH + 2 * borderMm + baseMm, borderMm + baseMm, borderMm, false);
    return build(img, xs, ys, thick, maxMm, (x, y, h) => {
      const a = (2 * Math.PI * x) / circ;
      return [(R + h) * Math.cos(a), (R + h) * Math.sin(a), y];
    }, true, opts);
  }
  const inner = widthMm - 2 * borderMm;
  if (!(inner > 0)) throw new Error('border is wider than the picture');
  const imgH = (inner * img.height) / img.width;
  const xs = axis(img.width, widthMm, borderMm, borderMm, false);
  const ys = axis(img.height, imgH + 2 * borderMm, borderMm, borderMm, false);
  if (shape === 'curved') {
    const arc = (Math.min(Math.max(arcDeg, 1), 359) * Math.PI) / 180;
    const R = widthMm / arc;
    return build(img, xs, ys, thick, maxMm, (x, y, h) => {
      const a = (x / widthMm - 0.5) * arc;
      return [(R + h) * Math.sin(a), (R + h) * Math.cos(a) - R, y];
    }, false, opts);
  }
  return build(img, xs, ys, thick, maxMm, (x, y, h) => [x, y, h], false, opts);
}

function build(img, xs, ys, value, frame, map, wrap, opts) {
  const nx = xs.at.length, ny = ys.at.length;
  const heights = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    checkAbort(opts.signal);
    // первая строка картинки - верх: на оси y она дальше всех
    const row = ys.pixel[j] < 0 ? -1 : img.height - 1 - ys.pixel[j];
    for (let i = 0; i < nx; i++) {
      const col = xs.pixel[i];
      heights[j * nx + i] = row < 0 || col < 0 ? frame : value(img.data[row * img.width + col]);
    }
  }
  return gridSolid(xs.at, ys.at, heights, map, wrap);
}

// Рельеф: карта высот, светлое выше. opts: widthMm, baseMm (подложка), heightMm (перепад), invert, maxPixels
export function relief(heightmap, opts = {}) {
  const { widthMm = 100, baseMm = 1, heightMm = 5, invert = false } = opts;
  if (!(baseMm > 0) || !(heightMm >= 0)) throw new Error('need baseMm > 0 and heightMm >= 0');
  checkAbort(opts.signal);
  const img = atLeast2(downsample(toGray(heightmap), opts.maxPixels ?? 250000));
  const xs = axis(img.width, widthMm, 0, 0, false);
  const ys = axis(img.height, (widthMm * (img.height - 1)) / (img.width - 1), 0, 0, false);
  const value = (v) => baseMm + ((invert ? 255 - v : v) / 255) * heightMm;
  return build(img, xs, ys, value, baseMm, (x, y, h) => [x, y, h], false, opts);
}
