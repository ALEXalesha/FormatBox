// Водяной знак: наложение картинки-штампа (текст окно рисует на canvas и передаёт сюда как картинку)
// с привязкой к углу/центру, прозрачностью, масштабом и плиткой. Смешение - «source over», альфа
// не умножена на цвет (straight alpha), как в canvas и PNG.
import { resize } from './geometry.js';

const ANCHORS = {
  tl: [0, 0], t: [0.5, 0], tr: [1, 0], l: [0, 0.5], center: [0.5, 0.5], r: [1, 0.5], bl: [0, 1], b: [0.5, 1], br: [1, 1],
};

// Левый верхний угол штампа: x, y - отступ от выбранного края (у центра - сдвиг).
export function stampPosition(W, H, sw, sh, anchor = 'tl', x = 0, y = 0) {
  const a = ANCHORS[anchor];
  if (!a) throw new Error(`overlay: unknown anchor ${anchor}`);
  const px = a[0] === 1 ? W - sw - x : Math.round((W - sw) * a[0]) + x;
  const py = a[1] === 1 ? H - sh - y : Math.round((H - sh) * a[1]) + y;
  return [px, py];
}

function blendAt(out, W, H, stamp, px, py, opacity) {
  const { width: sw, height: sh, data: s } = stamp;
  const x0 = Math.max(0, px), y0 = Math.max(0, py);
  const x1 = Math.min(W, px + sw), y1 = Math.min(H, py + sh);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = ((y - py) * sw + (x - px)) * 4, o = (y * W + x) * 4;
      const sa = (s[i + 3] / 255) * opacity;
      if (sa === 0) continue;
      const da = out[o + 3] / 255;
      const oa = sa + da * (1 - sa);
      const k = (da * (1 - sa)) / oa;
      out[o] = s[i] * (sa / oa) + out[o] * k;
      out[o + 1] = s[i + 1] * (sa / oa) + out[o + 1] * k;
      out[o + 2] = s[i + 2] * (sa / oa) + out[o + 2] * k;
      out[o + 3] = oa * 255;
    }
  }
}

export function overlay(base, stamp, { x = 0, y = 0, anchor = 'tl', opacity = 1, tile = false, gap = 0, scale = 1, method } = {}) {
  const { width: W, height: H } = base;
  const out = { width: W, height: H, data: Uint8ClampedArray.from(base.data) };
  if (!(scale > 0)) throw new Error('overlay: scale must be > 0');
  const st = scale === 1 ? stamp
    : resize(stamp, Math.max(1, Math.round(stamp.width * scale)), Math.max(1, Math.round(stamp.height * scale)), { method });
  const op = Math.max(0, Math.min(1, opacity));
  const [px, py] = stampPosition(W, H, st.width, st.height, anchor, x, y);
  if (op === 0) return out;
  if (!tile) {
    blendAt(out.data, W, H, st, px, py, op);
    return out;
  }
  // Сетка проходит через позицию по привязке и покрывает всю картинку.
  const stepX = st.width + Math.max(0, gap), stepY = st.height + Math.max(0, gap);
  const startX = (px % stepX) - (px % stepX > 0 ? stepX : 0);
  const startY = (py % stepY) - (py % stepY > 0 ? stepY : 0);
  for (let ty = startY; ty < H; ty += stepY) {
    for (let tx = startX; tx < W; tx += stepX) blendAt(out.data, W, H, st, tx, ty, op);
  }
  return out;
}

// Убрать прозрачность, положив картинку на цвет фона (для JPEG и других форматов без альфы).
export function flatten(image, background = [255, 255, 255]) {
  const { width, height, data } = image;
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    out[i] = data[i] * a + background[0] * (1 - a);
    out[i + 1] = data[i + 1] * a + background[1] * (1 - a);
    out[i + 2] = data[i + 2] * a + background[2] * (1 - a);
    out[i + 3] = 255;
  }
  return { width, height, data: out };
}
