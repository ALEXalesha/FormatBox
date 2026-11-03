// Сжатие «до размера»: двоичный поиск качества, а если даже минимальное качество не влезает -
// уменьшение размеров картинки. Само кодирование приходит снаружи: encode(image, quality 1..100)
// -> Promise<Uint8Array> (в окне - canvas, в тестах - jpeg-js).
import { resize, fitToPixels, checkAbort } from './geometry.js';

// Честное «нельзя»: code = 'TOO_SMALL', minBytes - самый маленький полученный файл.
function tooSmall(message, minBytes) {
  return Object.assign(new Error(message), { code: 'TOO_SMALL', minBytes });
}

// Наибольшее проверенное качество, при котором влезает; все проверенные выше - не влезли.
async function searchQuality(image, maxBytes, lo, hi, step) {
  const top = await step(image, hi);
  if (top.length <= maxBytes) return { bytes: top, quality: hi };
  if (lo === hi) return { bytes: null, minBytes: top.length };
  let best = await step(image, lo);
  if (best.length > maxBytes) return { bytes: null, minBytes: best.length };
  // Инвариант: lo влезает, hi - нет.
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const b = await step(image, mid);
    if (b.length <= maxBytes) { lo = mid; best = b; } else hi = mid;
  }
  return { bytes: best, quality: lo };
}

export async function encodeToSize(image, maxBytes, encode, {
  minQuality = 10, maxQuality = 95, allowDownscale = true, minSide = 1, signal, progress,
} = {}) {
  if (!(maxBytes > 0) || !Number.isFinite(maxBytes)) throw tooSmall('target size must be a positive number', 0);
  minQuality = Math.max(1, Math.min(100, Math.round(minQuality)));
  maxQuality = Math.max(minQuality, Math.min(100, Math.round(maxQuality)));
  // Оценка числа шагов для хода работы: поиск качества + несколько уменьшений.
  const steps = Math.ceil(Math.log2(maxQuality - minQuality + 2)) + 2;
  let done = 0;
  const step = async (img, q) => {
    checkAbort(signal);
    const bytes = await encode(img, q);
    checkAbort(signal);
    done += 1;
    progress?.(Math.min(0.99, done / (steps * 2)));
    return bytes;
  };
  let current = image;
  for (;;) {
    const res = await searchQuality(current, maxBytes, minQuality, maxQuality, step);
    if (res.bytes) {
      progress?.(1);
      return { bytes: res.bytes, quality: res.quality, width: current.width, height: current.height };
    }
    const { width, height } = current;
    if (!allowDownscale) throw tooSmall(`cannot fit into ${maxBytes} bytes: minimum is ${res.minBytes} bytes at quality ${minQuality}`, res.minBytes);
    // Размер файла примерно пропорционален числу пикселей; берём с запасом, но не меньше 10 % за шаг.
    const ratio = Math.min(0.81, (maxBytes / res.minBytes) * 0.9);
    const target = Math.max(1, Math.floor(width * height * ratio));
    let next = fitToPixels(width, height, target);
    const k = minSide / Math.min(next.width, next.height);
    if (k > 1) next = { width: Math.min(width, Math.round(next.width * k)), height: Math.min(height, Math.round(next.height * k)) };
    if (next.width === width && next.height === height) {
      throw tooSmall(`cannot fit into ${maxBytes} bytes even at ${width}x${height}: minimum is ${res.minBytes} bytes`, res.minBytes);
    }
    current = resize(image, next.width, next.height, { signal });
  }
}
