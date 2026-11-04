import test from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../../web/core/rand.js';
import { overlay, stampPosition } from '../../web/core/image/watermark.js';
import { randomImage, solidImage, pixel } from './image-helpers.js';

const ANCHORS = ['tl', 't', 'tr', 'l', 'center', 'r', 'bl', 'b', 'br'];

// Ожидаемый левый верхний угол - отдельно от кода ядра.
function expectPos(W, H, sw, sh, anchor, x, y) {
  const h = anchor.includes('l') ? 'L' : anchor.includes('r') && anchor !== 'center' ? 'R' : 'C';
  const v = anchor.startsWith('t') ? 'T' : anchor.startsWith('b') ? 'B' : 'C';
  return [h === 'L' ? x : h === 'R' ? W - sw - x : Math.round((W - sw) / 2) + x, v === 'T' ? y : v === 'B' ? H - sh - y : Math.round((H - sh) / 2) + y];
}

function randomCase(r) {
  const base = randomImage(r, r.int(1, 30), r.int(1, 30));
  const stamp = randomImage(r, r.int(1, 12), r.int(1, 12));
  const opts = { anchor: r.pick(ANCHORS), x: r.int(-5, 10), y: r.int(-5, 10), tile: r() < 0.3, gap: r.int(0, 4) };
  return { base, stamp, opts };
}

test('закон: opacity 0 - картинка без изменений, вход не меняется (300 случаев)', () => {
  const r = rng(1001);
  for (let n = 0; n < 300; n++) {
    const { base, stamp, opts } = randomCase(r);
    const b0 = Uint8Array.from(base.data), s0 = Uint8Array.from(stamp.data);
    const out = overlay(base, stamp, { ...opts, opacity: r() < 0.5 ? 0 : -1, scale: r.pick([1, 0.5, 2]) });
    assert.deepEqual(Buffer.from(out.data), Buffer.from(base.data));
    assert.notEqual(out.data, base.data);
    assert.deepEqual(Uint8Array.from(base.data), b0);
    assert.deepEqual(Uint8Array.from(stamp.data), s0);
  }
});

test('закон: непрозрачный штамп с opacity 1 - под ним пиксели штампа, вокруг - исходные (300 случаев)', () => {
  const r = rng(1002);
  for (let n = 0; n < 300; n++) {
    const { base, stamp, opts } = randomCase(r);
    for (let i = 3; i < stamp.data.length; i += 4) stamp.data[i] = 255;
    const b0 = Uint8Array.from(base.data), s0 = Uint8Array.from(stamp.data);
    const out = overlay(base, stamp, { ...opts, opacity: r() < 0.5 ? 1 : 5 });
    const [px, py] = expectPos(base.width, base.height, stamp.width, stamp.height, opts.anchor, opts.x, opts.y);
    const sx = stamp.width + opts.gap, sy = stamp.height + opts.gap;
    for (let y = 0; y < base.height; y++) {
      for (let x = 0; x < base.width; x++) {
        let u = x - px, v = y - py;
        if (opts.tile) { u = ((u % sx) + sx) % sx; v = ((v % sy) + sy) % sy; }
        const covered = u >= 0 && v >= 0 && u < stamp.width && v < stamp.height;
        assert.deepEqual(pixel(out, x, y), covered ? pixel(stamp, u, v) : pixel(base, x, y), `случай ${n} (${opts.anchor}${opts.tile ? ', плитка' : ''}) ${x},${y}`);
      }
    }
    assert.deepEqual(Uint8Array.from(base.data), b0);
    assert.deepEqual(Uint8Array.from(stamp.data), s0);
  }
});

test('закон: смешение совпадает с формулой source-over для неумноженной альфы (300 случаев)', () => {
  const r = rng(1003);
  for (let n = 0; n < 300; n++) {
    const base = randomImage(r, 6, 5, 'noise'), stamp = randomImage(r, 6, 5, 'noise');
    const op = r();
    const out = overlay(base, stamp, { opacity: op });
    for (let i = 0; i < base.data.length; i += 4) {
      const sa = (stamp.data[i + 3] / 255) * op, da = base.data[i + 3] / 255;
      const oa = sa + da * (1 - sa);
      for (let c = 0; c < 3; c++) {
        const want = oa === 0 ? base.data[i + c] : (stamp.data[i + c] * sa + base.data[i + c] * da * (1 - sa)) / oa;
        assert.ok(Math.abs(out.data[i + c] - want) <= 0.51, `случай ${n}: ${out.data[i + c]} != ${want}`);
      }
      assert.ok(Math.abs(out.data[i + 3] - oa * 255) <= 0.51);
    }
  }
});

test('масштаб штампа, полупрозрачный штамп над прозрачным фоном, ошибки', () => {
  const base = solidImage(20, 10, [0, 0, 0, 255]);
  const stamp = solidImage(4, 2, [255, 255, 255, 255]);
  const out = overlay(base, stamp, { anchor: 'br', x: 1, y: 1, scale: 2 });
  assert.deepEqual(pixel(out, 18, 8), [255, 255, 255, 255]);
  assert.deepEqual(pixel(out, 11, 5), [255, 255, 255, 255]);
  assert.deepEqual(pixel(out, 10, 5), [0, 0, 0, 255]);
  assert.deepEqual(pixel(out, 19, 9), [0, 0, 0, 255]);
  const clear = overlay(solidImage(2, 2, [9, 9, 9, 0]), solidImage(2, 2, [200, 100, 50, 128]));
  assert.deepEqual(pixel(clear, 0, 0), [200, 100, 50, 128]);
  assert.deepEqual(stampPosition(10, 10, 4, 4, 'center'), [3, 3]);
  assert.throws(() => overlay(base, stamp, { anchor: 'middle' }), /unknown anchor/);
  assert.throws(() => overlay(base, stamp, { scale: 0 }), /scale/);
  // Отрицательный зазор считается нулём.
  const t = overlay(solidImage(5, 1, [0, 0, 0, 255]), { width: 2, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]) }, { tile: true, gap: -3 });
  assert.deepEqual([0, 1, 2, 3, 4].map((x) => pixel(t, x, 0)[0]), [255, 0, 255, 0, 255]);
});
