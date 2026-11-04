import test from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import { rng } from '../../web/core/rand.js';
import { encodeToSize } from '../../web/core/image/target.js';
import { randomImage } from './image-helpers.js';

// Кодер-обёртка: запоминает каждую попытку (размеры, качество, байты).
function recorder(encodeFn) {
  const calls = [];
  const encode = async (img, q) => {
    const bytes = await encodeFn(img, q);
    calls.push({ w: img.width, h: img.height, q, bytes });
    return bytes;
  };
  return { calls, encode };
}

// Сравнение байтов без assert.deepEqual: при расхождении тот строит текст разницы на гигабайты
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

const jpegEncode = (img, q) => new Uint8Array(jpeg.encode({ data: img.data, width: img.width, height: img.height }, q).data);

// Проверка главного закона по журналу попыток.
function checkResult(res, maxBytes, calls, minQ, maxQ) {
  assert.ok(res.bytes.length <= maxBytes, `${res.bytes.length} > ${maxBytes}`);
  const here = calls.filter((c) => c.w === res.width && c.h === res.height);
  const mine = here.find((c) => c.q === res.quality);
  assert.ok(mine, 'результат - одна из попыток');
  assert.ok(same(res.bytes, mine.bytes), 'байты результата - байты этой попытки');
  for (const c of here) if (c.bytes.length <= maxBytes) assert.ok(c.q <= res.quality, `качество ${c.q} влезло, но выбрано ${res.quality}`);
  const above = here.filter((c) => c.q > res.quality).map((c) => c.q);
  if (res.quality < maxQ) assert.ok(above.length > 0, 'выше никто не проверен');
  assert.ok(res.quality >= minQ && res.quality <= maxQ);
}

test('закон: jpeg-js - результат не больше цели, качество наибольшее из проверенных (60 случаев)', async () => {
  const r = rng(9001);
  for (let n = 0; n < 60; n++) {
    const img = randomImage(r, r.int(1, 48), r.int(1, 48), r.pick(['noise', 'opaque', 'gradient', 'solid', 'few']));
    const before = Uint8Array.from(img.data);
    const big = jpegEncode(img, 95).length;
    const maxBytes = r.int(400, Math.round(big * 1.3));
    const minQ = r.int(1, 40), maxQ = r.int(minQ, 100);
    const { calls, encode } = recorder(jpegEncode);
    try {
      const res = await encodeToSize(img, maxBytes, encode, { minQuality: minQ, maxQuality: maxQ });
      checkResult(res, maxBytes, calls, minQ, maxQ);
      assert.ok(res.width <= img.width && res.height <= img.height);
    } catch (e) {
      assert.equal(e.code, 'TOO_SMALL', e.message);
      assert.ok(e.minBytes > maxBytes);
      const last = calls.at(-1);
      assert.equal(Math.min(last.w, last.h), 1, 'отказ только когда уменьшать уже некуда');
    }
    assert.ok(same(Uint8Array.from(img.data), before), 'вход не изменился');
  }
});

test('закон: при любом (даже немонотонном) кодере - наибольшее проверенное влезающее (1000 случаев)', async () => {
  const r = rng(9002);
  for (let n = 0; n < 1000; n++) {
    const img = { width: r.int(1, 300), height: r.int(1, 300), data: new Uint8ClampedArray(0) };
    const salt = r.int(0, 1e6), wobble = r() < 0.5;
    // Размер «файла» растёт с качеством и числом пикселей, иногда с шумом (немонотонно).
    const fake = (im, q) => {
      const noise = wobble ? ((q * 7919 + salt) % 13) * 20 : 0;
      return new Uint8Array(Math.round(50 + (im.width * im.height * q) / 40 + noise));
    };
    const { calls, encode } = recorder(fake);
    const minQ = r.int(1, 50), maxQ = r.int(minQ, 100);
    const maxBytes = r.int(40, fake(img, maxQ).length + 50);
    try {
      const res = await encodeToSize(img, maxBytes, encode, { minQuality: minQ, maxQuality: maxQ, allowDownscale: r() < 0.8 });
      checkResult(res, maxBytes, calls, minQ, maxQ);
      // Монотонный кодер: выбранное качество - ровно наибольшее влезающее.
      if (!wobble && res.quality < maxQ) assert.ok(fake({ width: res.width, height: res.height }, res.quality + 1).length > maxBytes);
    } catch (e) {
      assert.equal(e.code, 'TOO_SMALL', e.message);
      assert.ok(e.minBytes > maxBytes);
    }
  }
});

test('уменьшение размеров, когда даже минимальное качество не влезает', async () => {
  const img = randomImage(rng(4), 64, 64, 'noise');
  const minQ = 20;
  const atMin = jpegEncode(img, minQ).length;
  const { calls, encode } = recorder(jpegEncode);
  const res = await encodeToSize(img, Math.round(atMin / 3), encode, { minQuality: minQ });
  assert.ok(res.width < 64 && res.width === res.height);
  assert.ok(res.bytes.length <= atMin / 3);
  assert.ok(calls.some((c) => c.w === 64 && c.q === minQ));
  await assert.rejects(encodeToSize(img, Math.round(atMin / 3), jpegEncode, { minQuality: minQ, allowDownscale: false }), (e) => e.code === 'TOO_SMALL' && e.minBytes === atMin);
  const res2 = await encodeToSize(img, 100000, jpegEncode, { minQuality: 30, maxQuality: 30 });
  assert.equal(res2.quality, 30);
  const tiny = await encodeToSize(img, Math.round(atMin / 3), jpegEncode, { minQuality: minQ, minSide: 40 }).catch((e) => e);
  assert.ok(tiny.code === 'TOO_SMALL' || tiny.width >= 40);
});

test('ошибки, отмена, ход работы', async () => {
  const img = randomImage(rng(5), 16, 16, 'opaque');
  await assert.rejects(encodeToSize(img, 0, jpegEncode), (e) => e.code === 'TOO_SMALL');
  await assert.rejects(encodeToSize(img, Infinity, jpegEncode), (e) => e.code === 'TOO_SMALL');
  await assert.rejects(encodeToSize(img, 10, jpegEncode, { minQuality: 50, maxQuality: 50 }), /cannot fit into 10 bytes/);
  await assert.rejects(encodeToSize({ width: 1, height: 1, data: new Uint8ClampedArray(4) }, 10, jpegEncode), /even at 1x1/);
  const ctl = new AbortController();
  let n = 0;
  const slow = async (im, q) => { if (++n === 2) ctl.abort(); return jpegEncode(im, q); };
  await assert.rejects(encodeToSize(img, 300, slow, { signal: ctl.signal }), /canceled/);
  const seen = [];
  await encodeToSize(img, 900, jpegEncode, { progress: (p) => seen.push(p) });
  assert.equal(seen.at(-1), 1);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1]);
});
