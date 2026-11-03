// Геометрия: изменение размера (площадь / билинейно / бикубически), подгонка под число пикселей,
// обрезка, вписывание, повороты и отражения. Вход не меняется - всегда новая картинка.

// Прибавка к альфе при усреднении: цвет взвешивается альфой (без тёмных ореолов у прозрачных краёв),
// а у полностью прозрачных областей цвет всё равно остаётся осмысленным.
const EPS = 0.01;

const KERNELS = {
  bilinear: { support: 1, f: (x) => (x < 1 ? 1 - x : 0) },
  bicubic: {
    support: 2,
    f: (x) => {
      const a = -0.5;
      if (x < 1) return ((a + 2) * x - (a + 3)) * x * x + 1;
      return x < 2 ? (((x - 5) * x + 8) * x - 4) * a : 0;
    },
  },
};

export function checkAbort(signal) {
  if (signal?.aborted) throw new Error('canceled');
}

function newImage(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

// Веса для одной оси: для каждого выходного отсчёта - первый исходный и список весов (сумма 1).
function axisWeights(src, dst, method) {
  const scale = src / dst;
  const list = new Array(dst);
  for (let i = 0; i < dst; i++) {
    let start, w;
    if (method === 'area') {
      const a = i * scale, b = a + scale;
      start = Math.floor(a);
      const end = Math.min(src, Math.ceil(b));
      w = new Float64Array(end - start);
      for (let j = start; j < end; j++) w[j - start] = Math.min(b, j + 1) - Math.max(a, j);
    } else {
      // При уменьшении ядро растягивается на масштаб - иначе пропуск пикселей даёт «лесенку».
      const k = KERNELS[method], fs = Math.max(1, scale);
      const center = (i + 0.5) * scale, support = k.support * fs;
      start = Math.max(0, Math.floor(center - support));
      const end = Math.min(src, Math.ceil(center + support));
      w = new Float64Array(end - start);
      for (let j = start; j < end; j++) w[j - start] = k.f(Math.abs(j + 0.5 - center) / fs);
    }
    let sum = 0;
    for (const v of w) sum += v;
    for (let k = 0; k < w.length; k++) w[k] /= sum;
    list[i] = { start, w };
  }
  return list;
}

export function resize(image, width, height, { method = 'auto', signal, progress } = {}) {
  width = Math.round(width);
  height = Math.round(height);
  if (!(width >= 1 && height >= 1)) throw new Error('resize: bad size');
  const { width: sw, height: sh, data } = image;
  if (method === 'auto') method = width <= sw && height <= sh ? 'area' : 'bicubic';
  if (method !== 'area' && !KERNELS[method]) throw new Error(`resize: unknown method ${method}`);
  if (width === sw && height === sh) return { width, height, data: Uint8ClampedArray.from(data) };
  const wx = axisWeights(sw, width, method), wy = axisWeights(sh, height, method);
  const total = sh + height;
  // Проход по строкам: цвет хранится умноженным на (альфа + EPS).
  const tmp = new Float32Array(width * sh * 4);
  for (let y = 0; y < sh; y++) {
    checkAbort(signal);
    const row = y * sw * 4;
    for (let x = 0; x < width; x++) {
      const { start, w } = wx[x];
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < w.length; k++) {
        const p = row + (start + k) * 4, al = (data[p + 3] + EPS) * w[k];
        r += data[p] * al; g += data[p + 1] * al; b += data[p + 2] * al; a += al;
      }
      const t = (y * width + x) * 4;
      tmp[t] = r; tmp[t + 1] = g; tmp[t + 2] = b; tmp[t + 3] = a;
    }
    if (progress && y % 64 === 0) progress(y / total);
  }
  const out = newImage(width, height);
  const od = out.data;
  for (let y = 0; y < height; y++) {
    checkAbort(signal);
    const { start, w } = wy[y];
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < w.length; k++) {
        const t = ((start + k) * width + x) * 4;
        r += tmp[t] * w[k]; g += tmp[t + 1] * w[k]; b += tmp[t + 2] * w[k]; a += tmp[t + 3] * w[k];
      }
      const o = (y * width + x) * 4;
      // Бикубическое ядро с отрицательными лепестками может дать почти нулевой вес - цвет тогда не определён.
      if (a > 1e-6) { od[o] = r / a; od[o + 1] = g / a; od[o + 2] = b / a; }
      od[o + 3] = a - EPS;
    }
    if (progress && y % 64 === 0) progress((sh + y) / total);
  }
  progress?.(1);
  return out;
}

// Размеры с w*h <= maxPixels и тем же соотношением сторон: меньшая сторона перебирается вниз,
// большая получается округлением - так ошибка соотношения не больше половины пикселя.
export function fitToPixels(width, height, maxPixels) {
  if (!(maxPixels >= 1)) throw new Error('fitToPixels: maxPixels must be >= 1');
  if (width * height <= maxPixels) return { width, height };
  const wide = width >= height;
  const small = wide ? height : width, big = wide ? width : height;
  const s = Math.sqrt(maxPixels / (width * height));
  for (let n = Math.min(small, Math.floor(small * s) + 1); n >= 1; n--) {
    const m = Math.max(1, Math.round((n * big) / small));
    if (n * m <= maxPixels) return wide ? { width: m, height: n } : { width: n, height: m };
  }
  // Сюда попадаем, только если даже n = 1 даёт слишком длинную сторону.
  return wide ? { width: Math.floor(maxPixels), height: 1 } : { width: 1, height: Math.floor(maxPixels) };
}

export function scaleByPercent(image, percent, opts) {
  if (!(percent > 0)) throw new Error('scaleByPercent: percent must be > 0');
  const w = Math.max(1, Math.round((image.width * percent) / 100));
  const h = Math.max(1, Math.round((image.height * percent) / 100));
  return resize(image, w, h, opts);
}

export function cropRect(image, { x = 0, y = 0, width, height }) {
  const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(image.width, Math.round(x + width)), y1 = Math.min(image.height, Math.round(y + height));
  if (!(x1 > x0 && y1 > y0)) throw new Error('crop: empty area');
  const out = newImage(x1 - x0, y1 - y0);
  for (let r = y0; r < y1; r++) {
    out.data.set(image.data.subarray((r * image.width + x0) * 4, (r * image.width + x1) * 4), (r - y0) * out.width * 4);
  }
  return out;
}

// Самый большой прямоугольник с соотношением aw:ah по центру.
export function cropToAspect(image, aw, ah) {
  if (!(aw > 0 && ah > 0)) throw new Error('crop: bad aspect');
  const { width: w, height: h } = image;
  const r = aw / ah;
  let cw = w, ch = h;
  if (w / h > r) cw = Math.max(1, Math.min(w, Math.round(h * r)));
  else ch = Math.max(1, Math.min(h, Math.round(w / r)));
  return cropRect(image, { x: Math.floor((w - cw) / 2), y: Math.floor((h - ch) / 2), width: cw, height: ch });
}

// Размеры, вписанные в W×H с сохранением соотношения (ограничивающая сторона - ровно W или H).
export function containSize(width, height, W, H) {
  if (W / width <= H / height) return { width: W, height: Math.max(1, Math.min(H, Math.round((W * height) / width))) };
  return { width: Math.max(1, Math.min(W, Math.round((H * width) / height))), height: H };
}

export function fitInto(image, W, H, mode = 'contain', { method, background = [0, 0, 0, 0], signal, progress } = {}) {
  W = Math.round(W); H = Math.round(H);
  if (!(W >= 1 && H >= 1)) throw new Error('fitInto: bad size');
  const opts = { method, signal, progress };
  if (mode === 'stretch') return resize(image, W, H, opts);
  if (mode === 'cover') return resize(cropToAspect(image, W, H), W, H, opts);
  const s = containSize(image.width, image.height, W, H);
  const inner = resize(image, s.width, s.height, opts);
  if (mode === 'contain') return inner;
  if (mode !== 'pad') throw new Error(`fitInto: unknown mode ${mode}`);
  const out = newImage(W, H);
  for (let i = 0; i < out.data.length; i += 4) out.data.set(background, i);
  const ox = Math.floor((W - s.width) / 2), oy = Math.floor((H - s.height) / 2);
  for (let y = 0; y < s.height; y++) {
    out.data.set(inner.data.subarray(y * s.width * 4, (y + 1) * s.width * 4), ((oy + y) * W + ox) * 4);
  }
  return out;
}

// Общий перенос пикселей: map(x, y) -> индекс пикселя в новой картинке.
function remap(image, width, height, map) {
  const out = newImage(width, height);
  const s = image.data, d = out.data;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4, o = map(x, y) * 4;
      d[o] = s[i]; d[o + 1] = s[i + 1]; d[o + 2] = s[i + 2]; d[o + 3] = s[i + 3];
    }
  }
  return out;
}

// Повороты по часовой стрелке.
export function rotate90(image) {
  const h = image.height;
  return remap(image, h, image.width, (x, y) => x * h + (h - 1 - y));
}

export function rotate180(image) {
  const { width: w, height: h } = image;
  return remap(image, w, h, (x, y) => (h - 1 - y) * w + (w - 1 - x));
}

export function rotate270(image) {
  const { width: w, height: h } = image;
  return remap(image, h, w, (x, y) => (w - 1 - x) * h + y);
}

export function flipH(image) {
  const w = image.width;
  return remap(image, w, image.height, (x, y) => y * w + (w - 1 - x));
}

export function flipV(image) {
  const { width: w, height: h } = image;
  return remap(image, w, h, (x, y) => (h - 1 - y) * w + x);
}

// Поворот по тегу EXIF Orientation (1..8): после него картинка выглядит так, как задумала камера.
export function applyOrientation(image, orientation) {
  switch (orientation) {
    case 2: return flipH(image);
    case 3: return rotate180(image);
    case 4: return flipV(image);
    case 5: return flipH(rotate90(image));
    case 6: return rotate90(image);
    case 7: return flipV(rotate90(image));
    case 8: return rotate270(image);
    default: return { width: image.width, height: image.height, data: Uint8ClampedArray.from(image.data) };
  }
}
