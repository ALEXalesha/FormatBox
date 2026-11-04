import test from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../../web/core/rand.js';
import { removeBackground, estimateBackground, deltaE, rgbToLab } from '../../web/core/image/background.js';
import { solidImage, pixel } from './image-helpers.js';

// Сцена: фон (однотонный или с шумом), фигура (прямоугольник или эллипс) с дыркой цвета фона внутри.
function scene(r, { noise = 0, near = false } = {}) {
  const w = r.int(12, 50), h = r.int(12, 50);
  const bg = [r.int(20, 235), r.int(20, 235), r.int(20, 235)];
  const img = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  const role = new Uint8Array(w * h); // 0 фон, 1 фигура, 2 дырка
  const cx = r.int(w / 3, (2 * w) / 3), cy = r.int(h / 3, (2 * h) / 3), rx = r.int(3, w / 3), ry = r.int(3, h / 3), ellipse = r() < 0.5;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      const inside = ellipse ? dx * dx + dy * dy <= 1 : Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
      const hole = rx >= 6 && ry >= 6 && Math.abs(x - cx) <= 1 && Math.abs(y - cy) <= 1;
      role[y * w + x] = hole ? 2 : inside ? 1 : 0;
    }
  }
  const figColors = [];
  return { w, h, bg, img, role, figColors, fill(fig) {
    for (let i = 0; i < w * h; i++) {
      let px;
      if (role[i] === 1) px = fig(i);
      else px = bg.map((v) => Math.max(0, Math.min(255, v + (noise ? r.int(-noise, noise) : 0))));
      img.data.set([...px.slice(0, 3), 255], i * 4);
    }
  } };
}

test('закон: фон, связанный с краем, прозрачен; фигура и дырка внутри не тронуты (200 случаев)', () => {
  const r = rng(2001);
  for (let n = 0; n < 200; n++) {
    const noise = r() < 0.5 ? r.int(1, 3) : 0;
    const s = scene(r, { noise });
    s.fill(() => [0, 0, 0]);
    // Допуск больше разброса шума; цвет фигуры - дальше 2 допусков (зона мягкого края).
    let maxNoise = 0;
    for (let i = 0; i < s.w * s.h; i++) if (s.role[i] !== 1) maxNoise = Math.max(maxNoise, deltaE(pixel(s.img, i % s.w, Math.floor(i / s.w)), s.bg));
    const tol = noise ? maxNoise + r.int(1, 8) : r.int(0, 20);
    let fig;
    do fig = [r.int(0, 255), r.int(0, 255), r.int(0, 255)]; while (deltaE(fig, s.bg) <= 2 * tol + maxNoise + 5);
    const figNoise = r() < 0.5;
    s.fill(() => fig.map((v) => (figNoise ? Math.max(0, Math.min(255, v + r.int(-2, 2))) : v)));
    const before = Uint8Array.from(s.img.data);
    const out = removeBackground(s.img, { tolerance: tol, feather: r.int(0, 3) });
    for (let i = 0; i < s.w * s.h; i++) {
      const x = i % s.w, y = Math.floor(i / s.w);
      if (s.role[i] === 0) assert.equal(out.data[i * 4 + 3], 0, `случай ${n}: фон ${x},${y} не прозрачен`);
      else assert.deepEqual(pixel(out, x, y), pixel(s.img, x, y), `случай ${n}: ${s.role[i] === 1 ? 'фигура' : 'дырка'} ${x},${y} изменена`);
    }
    assert.deepEqual(Uint8Array.from(s.img.data), before, 'вход изменился');
  }
});

test('закон: tolerance 0 на однотонном фоне убирает ровно фон (200 случаев)', () => {
  const r = rng(2002);
  for (let n = 0; n < 200; n++) {
    const s = scene(r);
    // Фигура из случайных цветов, в том числе отличающихся от фона на 1 в одном канале.
    s.fill(() => (r() < 0.5 ? s.bg.map((v, c) => (c === r.int(0, 2) ? (v + (r() < 0.5 ? 1 : -1)) : v)) : [r.int(0, 255), r.int(0, 255), r.int(0, 255)]));
    const out = removeBackground(s.img, { tolerance: 0, feather: r.int(0, 3) });
    // Ожидание считаем сами: заливка от краёв по точному цвету фона.
    const want = new Uint8Array(s.w * s.h);
    const eq = (i) => pixel(s.img, i % s.w, Math.floor(i / s.w)).slice(0, 3).every((v, c) => v === s.bg[c]);
    const stack = [];
    for (let i = 0; i < s.w * s.h; i++) {
      const x = i % s.w, y = Math.floor(i / s.w);
      if ((x === 0 || y === 0 || x === s.w - 1 || y === s.h - 1) && eq(i)) { want[i] = 1; stack.push(i); }
    }
    while (stack.length) {
      const i = stack.pop(), x = i % s.w;
      for (const j of [x > 0 ? i - 1 : -1, x < s.w - 1 ? i + 1 : -1, i - s.w, i + s.w]) {
        if (j >= 0 && j < s.w * s.h && !want[j] && eq(j)) { want[j] = 1; stack.push(j); }
      }
    }
    for (let i = 0; i < s.w * s.h; i++) {
      const got = [...out.data.subarray(i * 4, i * 4 + 4)];
      const src = [...s.img.data.subarray(i * 4, i * 4 + 4)];
      assert.deepEqual(got, want[i] ? [...src.slice(0, 3), 0] : src, `случай ${n}, пиксель ${i}`);
    }
  }
});

test('закон: хромакей убирает цвет везде, включая закрытые области (100 случаев)', () => {
  const r = rng(2003);
  for (let n = 0; n < 100; n++) {
    const s = scene(r);
    const key = [r.int(0, 255), r.int(0, 255), r.int(0, 255)];
    let other;
    do other = [r.int(0, 255), r.int(0, 255), r.int(0, 255)]; while (deltaE(other, key) < 40);
    const tol = r.int(0, 15);
    for (let i = 0; i < s.w * s.h; i++) s.img.data.set([...(r() < 0.3 ? key : other), 255], i * 4);
    const out = removeBackground(s.img, { mode: 'color', color: key, tolerance: tol });
    for (let i = 0; i < s.w * s.h; i++) {
      const src = [...s.img.data.subarray(i * 4, i * 4 + 4)];
      const isKey = deltaE(src, key) <= tol;
      assert.equal(out.data[i * 4 + 3], isKey ? 0 : 255, `случай ${n}`);
      if (!isKey) assert.deepEqual([...out.data.subarray(i * 4, i * 4 + 4)], src);
    }
  }
});

test('закон: мягкий край - смешанный пиксель над фоном снова даёт исходный цвет (200 случаев)', () => {
  const r = rng(2004);
  for (let n = 0; n < 200; n++) {
    const bg = [r.int(0, 255), r.int(0, 255), r.int(0, 255)];
    let fig;
    do fig = [r.int(0, 255), r.int(0, 255), r.int(0, 255)]; while (deltaE(fig, bg) < 75);
    // Полоска: фон | смесь t | фигура.
    const t = r.int(1, 9) / 10;
    const mix = bg.map((v, c) => Math.round(v * (1 - t) + fig[c] * t));
    const img = solidImage(9, 5, [...bg, 255]);
    for (let y = 0; y < 5; y++) { img.data.set([...mix, 255], (y * 9 + 4) * 4); for (let x = 5; x < 8; x++) img.data.set([...fig, 255], (y * 9 + x) * 4); }
    const tol = r.int(2, 10), d = deltaE(mix, bg);
    const out = removeBackground(img, { tolerance: tol, softness: 60, feather: 2 });
    const p = pixel(out, 4, 2);
    if (d <= tol) { assert.equal(p[3], 0); continue; }
    if (d >= tol + 60) { assert.deepEqual(p, [...mix, 255]); continue; }
    assert.ok(p[3] > 0 && p[3] < 255, `альфа ${p[3]}`);
    const a = p[3] / 255;
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(p[c] * a + bg[c] * (1 - a) - mix[c]) <= 2.5, `случай ${n}: канал ${c}`);
    assert.deepEqual(pixel(out, 6, 2), [...fig, 255]);
  }
});

test('оценка фона по краю, прозрачный край, ошибки, отмена', () => {
  const img = solidImage(10, 10, [10, 200, 30, 255]);
  img.data.set([255, 0, 0, 255], 0);
  assert.deepEqual(estimateBackground(img), [10, 200, 30]);
  assert.deepEqual(estimateBackground(solidImage(3, 3, [5, 5, 5, 0])), [0, 0, 0]);
  const clear = solidImage(4, 4, [9, 9, 9, 0]);
  clear.data.set([200, 0, 0, 255], (1 * 4 + 1) * 4);
  const out = removeBackground(clear, { tolerance: 0 });
  assert.deepEqual(pixel(out, 1, 1), [200, 0, 0, 255]);
  assert.equal(pixel(out, 0, 0)[3], 0);
  assert.deepEqual(rgbToLab(255, 255, 255).map((v) => Math.round(v) + 0), [100, 0, 0]);
  assert.deepEqual(rgbToLab(0, 0, 0).map((v) => Math.round(v) + 0), [0, 0, 0]);
  assert.throws(() => removeBackground(img, { mode: 'magic' }), /unknown mode/);
  const ctl = new AbortController();
  ctl.abort();
  assert.throws(() => removeBackground(img, { signal: ctl.signal }), /canceled/);
  const seen = [];
  removeBackground(solidImage(70, 70, [1, 1, 1, 255]), { progress: (p) => seen.push(p) });
  assert.equal(seen.at(-1), 1);
});
