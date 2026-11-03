import test from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../../web/core/rand.js';
import { detect, sniff, extOf, targetsFor, kindOf, FORMATS } from '../../web/core/formats.js';
import { PRESETS, presetsFor, applyPreset, presetById } from '../../web/core/presets.js';

const enc = (s) => new TextEncoder().encode(s);
const pad = (head, n = 300) => { const b = new Uint8Array(Math.max(n, head.length)); b.set(head); return b; };
const ftyp = (brand) => pad([0, 0, 0, 0x18, ...enc('ftyp'), ...enc(brand)]);

const SAMPLES = {
  png: pad([0x89, 0x50, 0x4e, 0x47]), jpg: pad([0xff, 0xd8, 0xff, 0xe0]), gif: pad(enc('GIF89a')),
  webp: pad([...enc('RIFF'), 0, 0, 0, 0, ...enc('WEBP')]), wav: pad([...enc('RIFF'), 0, 0, 0, 0, ...enc('WAVE')]),
  avi: pad([...enc('RIFF'), 0, 0, 0, 0, ...enc('AVI ')]), aiff: pad([...enc('FORM'), 0, 0, 0, 0, ...enc('AIFF')]),
  heic: ftyp('heic'), avif: ftyp('avif'), mov: ftyp('qt  '), m4a: ftyp('M4A '), '3gp': ftyp('3gp5'), mp4: ftyp('isom'),
  mkv: pad([0x1a, 0x45, 0xdf, 0xa3, ...enc('matroska')]), webm: pad([0x1a, 0x45, 0xdf, 0xa3, ...enc('webm')]),
  mp3: pad(enc('ID3')), flac: pad(enc('fLaC')), ogg: pad(enc('OggS vorbis')), opus: pad(enc('OggS OpusHead')),
  wmv: pad([0x30, 0x26, 0xb2, 0x75]), flv: pad(enc('FLV')), mpg: pad([0, 0, 1, 0xba]), pdf: pad(enc('%PDF-1.7')), rtf: pad(enc('{\\rtf1')),
  doc: pad([0xd0, 0xcf, 0x11, 0xe0]), zip: pad([0x50, 0x4b, 0x03, 0x04]), docx: pad([0x50, 0x4b, 0x03, 0x04, ...enc('word/document.xml')]),
  odt: pad([0x50, 0x4b, 0x03, 0x04, ...enc('mimetypeapplication/vnd.oasis.opendocument.text')]), '3mf': pad([0x50, 0x4b, 0x03, 0x04, ...enc('3D/3dmodel.model')]),
  '7z': pad([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), rar: pad(enc('Rar!')), gz: pad([0x1f, 0x8b]), xz: pad([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0]),
  bz2: pad(enc('BZh9')), bmp: pad(enc('BM')), tiff: pad([0x49, 0x49, 0x2a, 0]), ico: pad([0, 0, 1, 0, 2, 0]), glb: pad(enc('glTF')),
  ply: pad(enc('ply\nformat ascii')), svg: enc('<svg xmlns="x"></svg>'), html: enc('<!DOCTYPE html><html>'),
};

test('закон: формат узнаётся по содержимому при любом (даже чужом) имени (зерно 21)', () => {
  const r = rng(21);
  const names = ['file', 'x.bin', 'фото.jpg', 'a.txt', 'clip'];
  for (const [ext, bytes] of Object.entries(SAMPLES)) {
    for (let n = 0; n < 5; n++) {
      const got = detect(bytes, r.pick(names));
      assert.equal(got.ext, ext, `${ext}`);
      assert.equal(got.kind, FORMATS[ext].kind);
      assert.equal(got.sure, true);
    }
  }
});

test('особые случаи: ts, mp3 без ID3, aac, tar, stl, имя уточняет семейство', () => {
  const ts = new Uint8Array(400); ts[0] = 0x47; ts[188] = 0x47;
  assert.equal(sniff(ts), 'ts');
  assert.equal(sniff(pad([0xff, 0xfb, 0x90])), 'mp3');
  assert.equal(sniff(pad([0xff, 0xf1, 0x50])), 'aac');
  const tar = new Uint8Array(600); tar.set(enc('ustar'), 257);
  assert.equal(sniff(tar), 'tar');
  const stl = new Uint8Array(84 + 50); stl[80] = 1;
  assert.equal(sniff(stl), 'stl');
  assert.equal(sniff(enc('solid cube\n facet normal 0 0 1')), 'stl');
  assert.equal(sniff(enc('<?xml version="1.0"?>\n<svg>')), 'svg');
  assert.equal(sniff(new Uint8Array(2)), null);
  assert.equal(sniff(enc('just some text here')), null);
  assert.equal(detect(SAMPLES.gz, 'a.tar.gz').ext, 'tar.gz');
  assert.equal(detect(SAMPLES.xz, 'a.txz').ext, 'tar.xz');
  assert.equal(detect(SAMPLES.bz2, 'a.tar.bz2').ext, 'tar.bz2');
  assert.equal(detect(SAMPLES.zip, 'book.docx').ext, 'docx');
  assert.equal(detect(SAMPLES.mp4, 'a.m4a').ext, 'm4a');
  assert.equal(detect(SAMPLES.ogg, 'a.opus').ext, 'opus');
  assert.equal(detect(SAMPLES.mkv, 'a.webm').ext, 'webm');
  assert.deepEqual(detect(enc('v 0 0 0\nf 1 2 3'), 'm.obj'), { ext: 'obj', kind: 'mesh', sure: false });
  assert.deepEqual(detect(enc('hello'), 'readme.MD'), { ext: 'md', kind: 'doc', sure: false });
  assert.deepEqual(detect(enc('hello'), 'x.weird'), { ext: 'weird', kind: 'unknown', sure: false });
  assert.equal(extOf('A.JPEG'), 'jpg');
  assert.equal(extOf('x.tgz'), 'tar.gz');
  assert.equal(extOf('noext'), '');
  assert.equal(kindOf('stl'), 'mesh');
  assert.equal(kindOf('zzz'), 'unknown');
});

test('закон: сам формат - цель только там, где есть смысл (сжать, починить), все цели известны', () => {
  for (const ext of Object.keys(FORMATS)) {
    for (const desktop of [false, true]) {
      const list = targetsFor(ext, { desktop });
      const kind = FORMATS[ext].kind;
      if (list.includes(ext)) assert.ok(['video', 'audio', 'image', 'mesh'].includes(kind), ext);
      if (['doc', 'archive'].includes(kind)) assert.ok(!list.includes(ext), ext);
      assert.equal(new Set(list).size, list.length, `${ext}: повтор`);
      for (const t of list) assert.ok(FORMATS[t], `${ext} -> ${t}`);
    }
  }
  assert.ok(targetsFor('mp4').includes('mp3'));
  assert.deepEqual(targetsFor('doc'), []);
  assert.ok(targetsFor('doc', { desktop: true }).includes('pdf'));
  assert.ok(targetsFor('svg').includes('png'));
  assert.deepEqual(targetsFor('gcode'), []);
});

test('наборы: подходят по виду файла, не трогают чужое', () => {
  for (const p of PRESETS) assert.ok(FORMATS[p.to], p.id);
  assert.ok(presetsFor('video').some((p) => p.id === 'discord10'));
  const job = { kind: 'video', to: 'webm', opts: { trim: { start: 1 } } };
  const out = applyPreset(job, 'discord10');
  assert.equal(out.to, 'mp4');
  assert.equal(out.opts.maxBytes, 10 * 1024 * 1024);
  assert.deepEqual(out.opts.trim, { start: 1 });
  assert.equal(applyPreset(job, 'web'), job);
  assert.equal(applyPreset(job, 'nope'), job);
  assert.equal(presetById('nope'), null);
  out.opts.maxBytes = 1;
  assert.equal(presetById('discord10').opts.maxBytes, 10 * 1024 * 1024);
  const cd = applyPreset({ kind: 'audio', opts: {} }, 'cd');
  cd.opts.audio.bits = 8;
  assert.equal(presetById('cd').opts.audio.bits, 16);
});
