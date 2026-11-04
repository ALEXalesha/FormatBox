import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import jpeg from 'jpeg-js';
import { rng } from '../../web/core/rand.js';
import { readExif, stripMetadata, jpegSegments, riffChunks, parseTiff, sniffContainer } from '../../web/core/image/exif.js';
import { encodePng, decodePng, readChunks, chunk } from '../../web/core/image/png.js';
import { randomImage } from './image-helpers.js';

const enc = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const cat = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]));
const has = (bytes, text) => Buffer.from(bytes).includes(Buffer.from(text, 'latin1'));

// Сторонний сборщик TIFF/EXIF для тестов: IFD0 (+ ExifIFD + GPS IFD).
function buildTiff({ le, orientation, make, model, date, dateOriginal, gps }) {
  const n16 = (v) => (le ? [v & 255, v >> 8] : [v >> 8, v & 255]);
  const n32 = (v) => (le ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24] : [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255]);
  const asciiE = (tag, s) => ({ tag, type: 2, count: s.length + 1, data: [...enc(s), 0] });
  const rat = (tag, vals) => ({ tag, type: 5, count: vals.length, data: vals.flatMap(([a, b]) => [...n32(a), ...n32(b)]) });
  const block = (entries, base) => {
    entries.sort((a, b) => a.tag - b.tag);
    let dataOff = base + 2 + entries.length * 12 + 4;
    const head = [...n16(entries.length)], tail = [];
    for (const e of entries) {
      head.push(...n16(e.tag), ...n16(e.type), ...n32(e.count));
      if (e.data.length <= 4) head.push(...e.data, ...Array(4 - e.data.length).fill(0));
      else {
        head.push(...n32(dataOff + tail.length));
        tail.push(...e.data);
        if (tail.length & 1) tail.push(0);
      }
    }
    return [...head, 0, 0, 0, 0, ...tail];
  };
  const dms = (v) => { const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = Math.round(((a - d) * 60 - m) * 60 * 100); return [[d, 1], [m, 1], [s, 100]]; };
  const exifE = dateOriginal ? [asciiE(0x9003, dateOriginal)] : [];
  const gpsE = gps ? [asciiE(1, gps.lat < 0 ? 'S' : 'N'), rat(2, dms(gps.lat)), asciiE(3, gps.lon < 0 ? 'W' : 'E'), rat(4, dms(gps.lon))] : [];
  const ifd0 = (ptrExif, ptrGps) => {
    const e = [];
    if (orientation) e.push({ tag: 0x0112, type: 3, count: 1, data: n16(orientation) });
    if (make) e.push(asciiE(0x010f, make));
    if (model !== undefined) e.push(asciiE(0x0110, model));
    if (date) e.push(asciiE(0x0132, date));
    if (exifE.length) e.push({ tag: 0x8769, type: 4, count: 1, data: n32(ptrExif) });
    if (gpsE.length) e.push({ tag: 0x8825, type: 4, count: 1, data: n32(ptrGps) });
    return block(e, 8);
  };
  const l0 = ifd0(0, 0).length;
  const exifB = block(exifE, 8 + l0);
  const gpsB = block(gpsE, 8 + l0 + exifB.length);
  return Uint8Array.from([...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...n16(42), ...n32(8), ...ifd0(8 + l0, 8 + l0 + exifB.length), ...exifB, ...gpsB]);
}

const seg = (marker, body) => cat([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255], body);

function randomTiffFields(r) {
  return {
    le: r() < 0.5,
    orientation: r.int(1, 8),
    make: r() < 0.7 ? `Make${r.int(0, 99)}` : undefined,
    model: r() < 0.7 ? `Cam ${r.int(0, 999)}` : undefined,
    date: r() < 0.5 ? '2020:01:02 03:04:05' : undefined,
    dateOriginal: r() < 0.5 ? '2021:05:06 07:08:09' : undefined,
    gps: r() < 0.6 ? { lat: (r() - 0.5) * 170, lon: (r() - 0.5) * 350 } : null,
  };
}

function checkFields(info, f) {
  assert.equal(info.orientation, f.orientation);
  assert.equal(info.make, f.make);
  assert.equal(info.model, f.model);
  assert.equal(info.date, f.dateOriginal ?? f.date);
  assert.equal(info.hasGps, !!f.gps);
  if (f.gps) {
    assert.ok(Math.abs(info.gps.lat - f.gps.lat) < 1e-3 && Math.abs(info.gps.lon - f.gps.lon) < 1e-3);
  }
}

// JPEG от jpeg-js со вставленными метаданными сразу после APP0.
function dirtyJpeg(r, img) {
  const clean = new Uint8Array(jpeg.encode({ data: img.data, width: img.width, height: img.height }, r.int(10, 95)).data);
  const fields = randomTiffFields(r);
  fields.gps = fields.gps || { lat: 10, lon: 20 };
  const extra = [];
  const icc = r() < 0.5;
  extra.push(seg(0xe1, cat(enc('Exif\0\0'), buildTiff(fields))));
  if (r() < 0.7) extra.push(seg(0xe1, enc('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>secret</x:xmpmeta>')));
  if (r() < 0.7) extra.push(seg(0xfe, enc('my comment')));
  if (r() < 0.7) extra.push(seg(0xed, enc('Photoshop 3.0\x008BIM....')));
  if (r() < 0.5) extra.push(seg(0xe2, enc('MPF\0MM\0*')));
  if (icc) extra.push(seg(0xe2, cat(enc('ICC_PROFILE\0'), [1, 1], r.bytes(r.int(1, 60)))));
  for (let i = extra.length - 1; i > 0; i--) { const j = r.int(0, i); [extra[i], extra[j]] = [extra[j], extra[i]]; }
  const app0End = 4 + ((clean[4] << 8) | clean[5]);
  const trailer = r() < 0.4 ? enc('TRAILER-Exif\0GPS') : [];
  return { bytes: cat(clean.subarray(0, app0End), ...extra, clean.subarray(app0End), trailer), clean, fields, icc };
}

const scanOf = (b) => { const s = jpegSegments(b); return Buffer.from(b.subarray(s.scan, s.scanEnd)); };

test('закон: JPEG после очистки - без Exif/XMP/GPS, скан байт в байт, jpeg-js даёт те же пиксели (80 случаев)', () => {
  const r = rng(6001);
  for (let n = 0; n < 80; n++) {
    const img = randomImage(r, r.int(1, 40), r.int(1, 40));
    const { bytes, clean, fields, icc } = dirtyJpeg(r, img);
    const before = Uint8Array.from(bytes);
    const keepIcc = r() < 0.5;
    const res = stripMetadata(bytes, { keepIcc });
    const out = res.bytes;
    assert.equal(res.orientation, fields.orientation);
    for (const marker of ['Exif\0', 'http://ns.adobe.com', 'Photoshop 3.0', 'my comment', 'MPF\0', 'TRAILER']) assert.ok(!has(out, marker), `${marker} остался`);
    const info = readExif(out);
    assert.deepEqual([info.hasExif, info.hasGps, info.hasXmp, info.hasIptc, info.hasText], [false, false, false, false, false]);
    assert.equal(info.hasIcc, icc && keepIcc);
    assert.equal(info.orientation, 1);
    assert.deepEqual(scanOf(out), scanOf(bytes));
    const a = jpeg.decode(clean, { useTArray: true }), b = jpeg.decode(out, { useTArray: true });
    assert.deepEqual(Buffer.from(b.data), Buffer.from(a.data));
    assert.deepEqual(bytes, before, 'вход изменился');
  }
});

test('закон: readExif читает поля TIFF (II и MM) из JPEG, PNG и WebP (300 случаев)', () => {
  const r = rng(6002);
  for (let n = 0; n < 300; n++) {
    const f = randomTiffFields(r);
    const tiff = buildTiff(f);
    const kind = r.pick(['jpeg', 'png', 'webp', 'webp-prefixed']);
    let bytes;
    if (kind === 'jpeg') bytes = cat([0xff, 0xd8], seg(0xe1, cat(enc('Exif\0\0'), tiff)), [0xff, 0xda, 0, 2, 1, 2, 0xff, 0xd9]);
    else if (kind === 'png') bytes = cat(encodePng(randomImage(r, 2, 2)).subarray(0, 33), chunk('eXIf', tiff));
    else bytes = webp([['VP8X', [8, 0, 0, 0, 0, 0, 0, 0, 0, 0]], ['VP8 ', [1, 2, 3]], ['EXIF', kind === 'webp' ? tiff : cat(enc('Exif\0\0'), tiff)]]);
    const info = readExif(bytes);
    assert.equal(info.format, kind.startsWith('webp') ? 'webp' : kind);
    assert.equal(info.hasExif, true);
    checkFields(info, f);
  }
});

test('закон: PNG после очистки - нет текстов/eXIf/tIME, IDAT байт в байт, decodePng те же пиксели (100 случаев)', () => {
  const r = rng(6003);
  for (let n = 0; n < 100; n++) {
    const img = randomImage(r, r.int(1, 30), r.int(1, 30));
    const png = encodePng(img);
    const cs = readChunks(png);
    const head = png.subarray(0, cs[1].start), body = png.subarray(cs[1].start);
    const meta = [chunk('tEXt', enc('Comment\0hello')), chunk('eXIf', buildTiff({ le: true, orientation: 6, gps: { lat: 1, lon: 2 } })),
      chunk('iTXt', enc('XML:com.adobe.xmp\0\0\0\0\0<x/>')), chunk('zTXt', enc('Raw profile type exif\0\0abc')), chunk('tIME', [7, 230, 1, 1, 0, 0, 0])];
    const kept = meta.filter(() => r() < 0.8);
    const icc = r() < 0.5;
    if (icc) kept.push(chunk('iCCP', enc('sRGB\0\0xyz')));
    const bytes = cat(head, ...kept, body, r() < 0.5 ? chunk('tEXt', enc('After\0end')) : []);
    const keepIcc = r() < 0.5;
    const out = stripMetadata(bytes, { keepIcc }).bytes;
    const types = readChunks(out).map((c) => c.type);
    for (const t of ['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']) assert.ok(!types.includes(t), t);
    assert.equal(types.includes('iCCP'), icc && keepIcc);
    const info = readExif(out);
    assert.deepEqual([info.hasExif, info.hasGps, info.hasXmp, info.hasText], [false, false, false, false]);
    const idat = (b) => Buffer.concat(readChunks(b).filter((c) => c.type === 'IDAT').map((c) => b.subarray(c.dataStart, c.dataStart + c.length)));
    assert.deepEqual(idat(out), idat(bytes));
    for (const c of readChunks(out)) assert.equal(Buffer.from(out).readUInt32BE(c.end - 4), zlib.crc32(out.subarray(c.start + 4, c.end - 4)));
    assert.deepEqual(Buffer.from(decodePng(out).data), Buffer.from(img.data));
  }
});

// WebP из списка чанков [тип, байты]: размер RIFF и выравнивание как в формате.
function webp(list) {
  const parts = list.map(([t, d]) => {
    const pad = d.length & 1 ? [0] : [];
    return cat(enc(t), [d.length & 255, (d.length >> 8) & 255, (d.length >> 16) & 255, 0], d, pad);
  });
  const body = cat(enc('WEBP'), ...parts);
  return cat(enc('RIFF'), [body.length & 255, (body.length >> 8) & 255, (body.length >> 16) & 255, 0], body);
}

test('закон: WebP после очистки - нет EXIF/XMP, VP8 байт в байт, размер RIFF и флаги VP8X верны (100 случаев)', () => {
  const r = rng(6004);
  for (let n = 0; n < 100; n++) {
    const vp8 = r.bytes(r.int(1, 50));
    const alpha = r() < 0.5, icc = r() < 0.5;
    const flags = (alpha ? 0x10 : 0) | (icc ? 0x20 : 0) | 0x08 | 0x04;
    const list = [['VP8X', [flags, 0, 0, 0, 1, 0, 0, 1, 0, 0]]];
    if (icc) list.push(['ICCP', r.bytes(r.int(1, 9))]);
    if (alpha) list.push(['ALPH', r.bytes(r.int(1, 9))]);
    list.push([r.pick(['VP8 ', 'VP8L']), vp8], ['EXIF', buildTiff({ le: false, orientation: 3, gps: { lat: 5, lon: 6 } })], ['XMP ', enc('<x:xmpmeta/>')]);
    const bytes = webp(list);
    const keepIcc = r() < 0.5;
    const out = stripMetadata(bytes, { keepIcc }).bytes;
    assert.equal(Buffer.from(out).readUInt32LE(4), out.length - 8);
    const cs = riffChunks(out);
    assert.equal(cs.at(-1).end, out.length);
    const types = cs.map((c) => c.type);
    assert.ok(!types.includes('EXIF') && !types.includes('XMP '));
    assert.equal(types.includes('ICCP'), icc && keepIcc);
    const f = out[20];
    assert.equal(f & 0x0c, 0);
    assert.equal(!!(f & 0x20), icc && keepIcc);
    assert.equal(!!(f & 0x10), alpha);
    const img = cs.find((c) => c.type.startsWith('VP8') && c.type !== 'VP8X');
    assert.deepEqual(out.subarray(img.dataStart, img.dataStart + img.length), vp8);
    const info = readExif(out);
    assert.deepEqual([info.hasExif, info.hasGps, info.hasXmp], [false, false, false]);
  }
});

test('закон: порченые файлы не роняют readExif, а stripMetadata падает только понятной ошибкой (2000 случаев)', () => {
  const r = rng(6005);
  const base = dirtyJpeg(r, randomImage(r, 8, 8, 'opaque')).bytes;
  const tiff = buildTiff({ le: true, orientation: 6, make: 'X', gps: { lat: 1, lon: 1 }, dateOriginal: '2000' });
  const pngBase = cat(encodePng(randomImage(r, 3, 3)).subarray(0, 33), chunk('eXIf', tiff));
  const webpBase = webp([['VP8X', [8, 0, 0, 0, 0, 0, 0, 0, 0, 0]], ['EXIF', tiff], ['VP8 ', [1, 2, 3]]]);
  for (let n = 0; n < 2000; n++) {
    const src = r.pick([base, pngBase, webpBase]);
    let b = Uint8Array.from(src);
    if (r() < 0.5) b = b.subarray(0, r.int(0, b.length));
    for (let k = r.int(0, 6); k > 0; k--) if (b.length) b[r.int(0, b.length - 1)] = r.int(0, 255);
    const info = readExif(b);
    assert.ok(info.orientation >= 1 && info.orientation <= 8);
    try {
      const out = stripMetadata(b).bytes;
      assert.ok(out instanceof Uint8Array);
    } catch (e) {
      assert.match(e.message, /unsupported image format|no image data/);
    }
  }
});

test('keepOrientation оставляет только ориентацию; прогрессивный скан и хвост', () => {
  const r = rng(6006);
  const img = randomImage(r, 9, 7, 'opaque');
  const { bytes, clean } = dirtyJpeg(r, img);
  const o = readExif(bytes).orientation;
  const res = stripMetadata(bytes, { keepOrientation: true });
  const info = readExif(res.bytes);
  assert.equal(info.orientation, o);
  assert.equal(info.hasGps, false);
  assert.equal(info.model, undefined);
  assert.deepEqual(Buffer.from(jpeg.decode(res.bytes, { useTArray: true }).data), Buffer.from(jpeg.decode(clean, { useTArray: true }).data));
  // Без JFIF: ориентация встаёт перед первым сегментом.
  const bare = cat([0xff, 0xd8], seg(0xe1, cat(enc('Exif\0\0'), buildTiff({ le: true, orientation: 8 }))), seg(0xdb, [0, 1]), [0xff, 0xda, 0, 2, 5, 0xff, 0xd9]);
  const out = stripMetadata(bare, { keepOrientation: true }).bytes;
  assert.equal(readExif(out).orientation, 8);
  assert.deepEqual(jpegSegments(out).segments.map((s) => s.marker), [0xe1, 0xdb]);
  // Одни метаданные и скан: ориентация ставится в конец заголовка.
  const only = cat([0xff, 0xd8], seg(0xe1, cat(enc('Exif\0\0'), buildTiff({ le: false, orientation: 5 }))), [0xff, 0xda, 0, 2, 5, 0xff, 0xd9]);
  assert.equal(readExif(stripMetadata(only, { keepOrientation: true }).bytes).orientation, 5);
  // Прогрессивный: несколько SOS, DHT между ними, FF00, RST, заполняющие FF; хвост после EOI выбрасывается.
  const scans = cat([0xff, 0xda, 0, 3, 1, 0x12, 0xff, 0x00, 0x34, 0xff, 0xd3, 0x56], seg(0xc4, [9, 9]), [0xff, 0xff],
    [0xff, 0xda, 0, 2, 7, 0xff, 0x00, 0xff, 0xd9]);
  const prog = cat([0xff, 0xd8, 0xff, 0xff], seg(0xc2, [1, 2, 3]), seg(0xfe, enc('note')), scans, enc('tail'));
  const sp = stripMetadata(prog);
  assert.deepEqual(Buffer.from(sp.bytes), Buffer.from(cat([0xff, 0xd8], seg(0xc2, [1, 2, 3]), scans)));
  assert.deepEqual(sp.removed.sort(), ['comment', 'trailer']);
  // Обрезанный скан без EOI: копируется до конца.
  const cut = cat([0xff, 0xd8], [0xff, 0xda, 0, 2, 1, 2, 3]);
  assert.deepEqual(Buffer.from(stripMetadata(cut).bytes), Buffer.from(cut));
});

test('разбор TIFF: мусор, чужие типы, ссылки за край', () => {
  assert.equal(parseTiff(enc('II')), null);
  assert.equal(parseTiff(enc('XX*\0\0\0\0\0')), null);
  assert.equal(parseTiff(Uint8Array.from([0x49, 0x49, 43, 0, 8, 0, 0, 0])), null);
  const t = parseTiff(Uint8Array.from([0x49, 0x49, 42, 0, 200, 0, 0, 0]));
  assert.deepEqual([t.orientation, t.hasGps, t.make], [1, false, undefined]);
  // Ориентация вне 1..8 и строка без ASCII-типа игнорируются.
  const weird = buildTiff({ le: true, orientation: 77, make: 'Q' });
  weird[12] = 3; // тип Make -> SHORT
  const w = parseTiff(weird);
  assert.deepEqual([w.orientation, w.make], [1, undefined]);
  // Ориентация типом BYTE и пустая строка.
  const byteO = buildTiff({ le: false, orientation: 6, model: '' });
  byteO[8 + 2 + 12 + 3] = 1; byteO[8 + 2 + 12 + 8] = 6;
  assert.deepEqual([parseTiff(byteO).orientation, parseTiff(byteO).model], [6, undefined]);
  assert.equal(sniffContainer(enc('GIF89a')), null);
  assert.throws(() => stripMetadata(enc('GIF89a....')), /unsupported/);
  assert.throws(() => stripMetadata(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])), /no image data/);
  const png = cat(encodePng(randomImage(rng(1), 2, 2)).subarray(0, 33), chunk('iCCP', enc('p\0\0z')), chunk('tEXt', enc('Raw profile type xmp\0x')));
  const info = readExif(png);
  assert.deepEqual([info.hasIcc, info.hasXmp, info.hasExif], [true, true, false]);
  assert.deepEqual(readExif(enc('nothing')).format, null);
});
