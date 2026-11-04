import test from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import { rng } from '../../web/core/rand.js';
import * as img from '../../web/core/image/index.js';
import { randomImage, solidImage, pixel } from './image-helpers.js';

const { imageFormats, sniffImage, decodeImage, encodeImage, formatById, flatten } = img;
const enc = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

test('закон: encodeImage -> sniffImage -> decodeImage возвращает те же пиксели для форматов ядра (120 случаев)', async () => {
  const r = rng(5001);
  for (let n = 0; n < 120; n++) {
    const id = r.pick(['png', 'bmp', 'tiff', 'ico']);
    const size = r.int(1, 40);
    const im = randomImage(r, size, id === 'ico' ? size : r.int(1, 40));
    const bytes = await encodeImage(im, id, { sizes: [size] });
    assert.equal(sniffImage(bytes), id);
    assert.deepEqual(Buffer.from(decodeImage(bytes).data), Buffer.from(im.data), `случай ${n} (${id})`);
  }
});

test('закон: flatten - непрозрачное не меняется, прозрачное становится фоном, альфа 255 (200 случаев)', () => {
  const r = rng(5002);
  for (let n = 0; n < 200; n++) {
    const im = randomImage(r, r.int(1, 10), r.int(1, 10));
    const bg = [r.int(0, 255), r.int(0, 255), r.int(0, 255)];
    const out = flatten(im, bg);
    for (let i = 0; i < im.data.length; i += 4) {
      const a = im.data[i + 3];
      const want = a === 255 ? [...im.data.subarray(i, i + 3)] : a === 0 ? bg : null;
      if (want) assert.deepEqual([...out.data.subarray(i, i + 3)], want);
      assert.equal(out.data[i + 3], 255);
    }
  }
});

test('все форматы описаны, поиск по расширению, распознавание по байтам', () => {
  for (const id of ['png', 'jpg', 'webp', 'avif', 'bmp', 'gif', 'ico', 'heic', 'tiff']) assert.ok(formatById(id), id);
  assert.equal(formatById('.JPEG').id, 'jpg');
  assert.equal(formatById('tif').id, 'tiff');
  assert.equal(formatById('xyz'), null);
  assert.ok(imageFormats.every((f) => f.mime.startsWith('image/') && f.exts.length));
  const ftyp = (brand) => Uint8Array.from([0, 0, 0, 24, ...enc('ftyp'), ...enc(brand), 0, 0, 0, 0]);
  assert.equal(sniffImage(ftyp('avif')), 'avif');
  assert.equal(sniffImage(ftyp('heic')), 'heic');
  assert.equal(sniffImage(ftyp('mp42')), null);
  assert.equal(sniffImage(enc('GIF89a......')), 'gif');
  assert.equal(sniffImage(enc('RIFF....WEBPVP8 ')), 'webp');
  assert.equal(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.equal(sniffImage(enc('hello world!')), null);
});

test('чтение и запись через окно: коды ошибок, кодер снаружи, белый фон для JPEG', async () => {
  const code = (bytes) => { try { decodeImage(bytes); } catch (e) { return e.code; } return 'ok'; };
  assert.equal(code(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'NEEDS_CANVAS');
  assert.equal(code(Uint8Array.from([0, 0, 0, 24, ...enc('ftypheic'), 0, 0, 0, 0])), 'NEEDS_MODULE');
  assert.equal(code(enc('nothing here')), 'UNKNOWN_FORMAT');
  const clear = solidImage(8, 8, [0, 0, 0, 0]);
  let seen;
  const encode = async (im, q, mime) => { seen = { q, mime }; return new Uint8Array(jpeg.encode({ data: im.data, width: im.width, height: im.height }, q).data); };
  const bytes = await encodeImage(clear, 'jpg', { quality: 80, encode });
  assert.deepEqual(seen, { q: 80, mime: 'image/jpeg' });
  const back = jpeg.decode(bytes, { useTArray: true });
  assert.ok(back.data[0] > 250, 'прозрачное стало белым, а не чёрным');
  const webp = await encodeImage(clear, 'webp', { encode: async (im) => im.data });
  assert.equal(webp[3], 0, 'webp сохраняет альфу');
  await assert.rejects(encodeImage(clear, 'gif'), /cannot write gif/);
  await assert.rejects(encodeImage(clear, 'avif'), /needs an encoder/);
  const ico = await encodeImage(solidImage(40, 40, [1, 2, 3, 255]), 'ico');
  assert.equal(img.decodeIco(ico).length, img.ICO_SIZES.length);
  assert.deepEqual(pixel(decodeImage(ico), 0, 0), [1, 2, 3, 255]);
});
