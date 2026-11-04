// Общие помощники тестов картинок (не тест - node --test его не запускает).

export const KINDS = ['noise', 'opaque', 'gradient', 'solid', 'few', 'gray', 'grayAlpha', 'two'];

// Случайная картинка заданного вида: шум, градиент, однотонная, несколько цветов, серая...
export function randomImage(r, width, height, kind = r.pick(KINDS)) {
  const data = new Uint8ClampedArray(width * height * 4);
  const pal = Array.from({ length: kind === 'two' ? 2 : r.int(1, 40) }, () => [r.int(0, 255), r.int(0, 255), r.int(0, 255), r() < 0.7 ? 255 : r.int(0, 255)]);
  const base = pal[0];
  const g0 = [r.int(0, 255), r.int(0, 255), r.int(0, 255)], g1 = [r.int(0, 255), r.int(0, 255), r.int(0, 255)];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let px;
      if (kind === 'noise') px = [r.int(0, 255), r.int(0, 255), r.int(0, 255), r.int(0, 255)];
      else if (kind === 'opaque') px = [r.int(0, 255), r.int(0, 255), r.int(0, 255), 255];
      else if (kind === 'gradient') {
        const t = (x + y) / Math.max(1, width + height - 2);
        px = [0, 1, 2].map((c) => Math.round(g0[c] + (g1[c] - g0[c]) * t)).concat(255);
      } else if (kind === 'solid') px = base;
      else if (kind === 'gray') { const v = r.int(0, 255); px = [v, v, v, 255]; }
      else if (kind === 'grayAlpha') { const v = r.int(0, 255); px = [v, v, v, r.int(0, 255)]; }
      else px = r.pick(pal);
      data.set(px, i);
    }
  }
  return { width, height, data };
}

export function solidImage(width, height, px) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(px, i);
  return { width, height, data };
}

export const pixel = (img, x, y) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

export function cloneImage(img) {
  return { width: img.width, height: img.height, data: Uint8ClampedArray.from(img.data) };
}
