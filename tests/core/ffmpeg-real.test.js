// Законы на настоящем ffmpeg (версия для ПК). Без ffmpeg в системе тесты пропускаются.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { rng } from '../../web/core/rand.js';
import { findFfmpeg, convertFile, concatFiles, probe, runFfmpeg } from '../../electron/backend/ffmpeg.js';

const ff = await findFfmpeg();
const skip = ff ? false : 'ffmpeg not installed';
const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function makeVideo(dir, name, { w, h, seconds, audio = true, noise = 20 }) {
  const file = path.join(dir, name);
  const args = ['-hide_banner', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:rate=25:duration=${seconds}`];
  if (audio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`);
  args.push('-vf', `noise=alls=${noise}:allf=t`, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '10', '-pix_fmt', 'yuv420p');
  if (audio) args.push('-c:a', 'aac', '-shortest');
  args.push(file);
  const r = spawnSync(ff.bin, args);
  assert.equal(r.status, 0, String(r.stderr));
  return file;
}

test('закон: сжатие до N МБ - результат не больше, источник цел, имя не перетёрто (зерно 31)', { skip, timeout: 300000 }, async () => {
  const r = rng(31);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-ff-'));
  try {
    for (let n = 0; n < 4; n++) {
      const src = makeVideo(dir, `clip${n}.mp4`, { w: r.pick([320, 640, 960]), h: r.pick([240, 360, 540]), seconds: r.int(2, 5), audio: r() < 0.7 });
      const before = hash(src);
      const maxBytes = r.int(60, 400) * 1024;
      const to = r.pick(['mp4', 'webm', 'mkv']);
      fs.writeFileSync(path.join(dir, `clip${n}.${to === 'mp4' ? 'mp4' : to}`.replace('.mp4', '-formatbox.mp4')), 'занято');
      const occupied = new Map(fs.readdirSync(dir).map((f) => [f, hash(path.join(dir, f))]));
      const res = await convertFile(ff.bin, { input: src, to, opts: { maxBytes } });
      assert.ok(res.bytes <= maxBytes, `${to}: ${res.bytes} > ${maxBytes}`);
      assert.equal(hash(src), before);
      assert.ok(!occupied.has(res.name), `${res.name} перетёр существующий`);
      for (const [f, h] of occupied) assert.equal(hash(path.join(dir, f)), h);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('закон: пиксели не больше заданных, длительность сохраняется ±1 кадр (зерно 32)', { skip, timeout: 300000 }, async () => {
  const r = rng(32);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-ff-'));
  try {
    for (let n = 0; n < 3; n++) {
      const seconds = r.int(1, 3);
      const src = makeVideo(dir, `v${n}.mp4`, { w: 640, h: 480, seconds, noise: 0 });
      const maxPixels = r.int(10_000, 200_000);
      const res = await convertFile(ff.bin, { input: src, to: 'mp4', opts: { maxPixels, quality: 40 } });
      const info = await probe(ff.bin, res.path);
      assert.ok(info.width * info.height <= maxPixels, `${info.width}x${info.height} > ${maxPixels}`);
      assert.ok(Math.abs(info.duration - seconds) <= 1 / 25 + 0.03, `${info.duration} vs ${seconds}`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('закон: разрядность и частота в заголовке WAV = выбранным', { skip, timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-ff-'));
  try {
    const src = makeVideo(dir, 's.mp4', { w: 160, h: 120, seconds: 1 });
    for (const [bits, rate, ch] of [[8, 8000, 1], [16, 44100, 2], [24, 96000, 2], [32, 48000, 1]]) {
      const res = await convertFile(ff.bin, { input: src, to: 'wav', opts: { audio: { bits, sampleRate: rate, channels: ch, float: bits === 32, dither: bits <= 16 ? 'tpdf' : 'none' } }, tag: `${bits}` });
      const b = fs.readFileSync(res.path);
      const fmt = b.indexOf('fmt ');
      assert.equal(b.readUInt16LE(fmt + 10), ch);
      assert.equal(b.readUInt32LE(fmt + 12), rate);
      assert.equal(b.readUInt16LE(fmt + 22), bits);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('склейка, отмена, сбой ffmpeg, не медиа', { skip, timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-ff-'));
  try {
    const a = makeVideo(dir, 'a.mp4', { w: 320, h: 240, seconds: 1 });
    const b = makeVideo(dir, 'b.mp4', { w: 160, h: 120, seconds: 1, audio: false });
    const joined = await concatFiles(ff.bin, { inputs: [a, b], to: 'mp4' });
    const info = await probe(ff.bin, joined.path);
    assert.ok(Math.abs(info.duration - 2) < 0.15);
    assert.match(joined.name, /^a-joined\.mp4$/);
    const ctl = new AbortController();
    const p = convertFile(ff.bin, { input: a, to: 'webm', opts: { quality: 100 } }, { signal: ctl.signal });
    setTimeout(() => ctl.abort(), 50);
    await assert.rejects(p, /canceled/);
    const pre = new AbortController(); pre.abort();
    await assert.rejects(runFfmpeg(ff.bin, ['-version'], { signal: pre.signal }), /canceled/);
    await assert.rejects(runFfmpeg(ff.bin, ['-i', path.join(dir, 'none.mp4'), path.join(dir, 'x.mp4')]), /ffmpeg-failed/);
    fs.writeFileSync(path.join(dir, 'text.mp4'), 'not a video');
    await assert.rejects(convertFile(ff.bin, { input: path.join(dir, 'text.mp4'), to: 'mp4' }), /not-media/);
    await assert.rejects(convertFile(ff.bin, { input: a, to: 'wav', opts: { maxBytes: 1000 } }), /size-needs-compressed-audio/);
    assert.equal((await findFfmpeg({ FORMATBOX_FFMPEG: '/nope/ffmpeg', PATH: '' }))?.bin ?? null, null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ревью: mp4 только со звуком -> mp4 и склейка «до N МБ» на настоящем ffmpeg', { skip, timeout: 180000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-ff-'));
  try {
    const audio = path.join(dir, 'voice.mp4');
    assert.equal(spawnSync(ff.bin, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'sine=duration=2', '-c:a', 'aac', audio]).status, 0);
    const res = await convertFile(ff.bin, { input: audio, to: 'mp4', opts: {} });
    assert.ok(res.bytes > 0);
    const a = makeVideo(dir, 'a.mp4', { w: 640, h: 360, seconds: 3, noise: 30 });
    const b = makeVideo(dir, 'b.mp4', { w: 640, h: 360, seconds: 3, noise: 30 });
    const maxBytes = 120 * 1024;
    const joined = await concatFiles(ff.bin, { inputs: [a, b], to: 'mp4', opts: { maxBytes } });
    assert.ok(joined.bytes <= maxBytes, `${joined.bytes} > ${maxBytes}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
