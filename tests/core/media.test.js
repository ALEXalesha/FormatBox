import test from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../../web/core/rand.js';
import { cropFromPercent, outputSize, outputDuration, bitrateForSize, pixelsForBitrate, buildFfmpeg, buildConcat, fitToSize, parseProbe, parseProgress, atempoChain, crfFor } from '../../web/core/media.js';

const randomInfo = (r) => ({ width: r.int(16, 4000), height: r.int(16, 3000), duration: r.int(1, 7200) / 10, fps: r.pick([24, 25, 30, 60]), hasAudio: r() < 0.8, hasVideo: true });

test('закон: пикселей в кадре не больше заданного, стороны чётные, пропорции сохранены (зерно 11, 3000 случаев)', () => {
  const r = rng(11);
  for (let n = 0; n < 3000; n++) {
    const info = randomInfo(r);
    const opts = { maxPixels: r.int(100, 9_000_000), rotate: r.pick([0, 90, 180, 270]) };
    if (r() < 0.3) opts.percent = r.int(5, 200);
    if (r() < 0.3) { const w = r.int(2, info.width), h = r.int(2, info.height); opts.crop = { w, h, x: 0, y: 0 }; }
    const { width, height } = outputSize(info, opts);
    assert.ok(width * height <= opts.maxPixels || (width === 2 && height === 2), `${width}x${height} > ${opts.maxPixels}`);
    assert.equal(width % 2, 0); assert.equal(height % 2, 0);
    let sw = opts.crop ? opts.crop.w : info.width, sh = opts.crop ? opts.crop.h : info.height;
    if (opts.rotate % 180) [sw, sh] = [sh, sw];
    if (width > 40 && height > 40) {
      assert.ok(Math.abs(width / height - sw / sh) / (sw / sh) < 0.08, `пропорции ${width}x${height} от ${sw}x${sh}`);
    }
  }
});

test('растянуть до размера - ровно этот размер (чётный), вписать - не больше рамки', () => {
  const info = { width: 1920, height: 1080 };
  assert.deepEqual(outputSize(info, { width: 500, height: 500, fit: 'stretch' }), { width: 500, height: 500 });
  assert.deepEqual(outputSize(info, { width: 500, height: 500, fit: 'cover' }), { width: 500, height: 500 });
  assert.deepEqual(outputSize(info, { width: 500, height: 500 }), { width: 500, height: 280 });
  assert.deepEqual(outputSize(info, { width: 640 }), { width: 640, height: 360 });
  assert.deepEqual(outputSize(info, { height: 720 }), { width: 1280, height: 720 });
  assert.deepEqual(outputSize(info, { percent: 50 }), { width: 960, height: 540 });
  assert.deepEqual(outputSize({ width: 3, height: 3 }, { maxPixels: 1 }), { width: 2, height: 2 });
});

test('закон: битрейт под размер не превышает бюджет (зерно 12)', () => {
  const r = rng(12);
  for (let n = 0; n < 2000; n++) {
    const maxBytes = r.int(100_000, 500_000_000), duration = r.int(1, 36000) / 10;
    const hasVideo = r() < 0.8, hasAudio = r() < 0.8;
    const b = bitrateForSize({ maxBytes, duration, hasVideo, hasAudio, audioKbps: r.pick([64, 128, 192, 320]) });
    const bytes = ((b.videoKbps + b.audioKbps) * 1000 * duration) / 8;
    if (b.videoKbps > 1 || !hasVideo) assert.ok(bytes <= maxBytes || b.audioKbps === 6, `${bytes} > ${maxBytes}`);
    if (hasVideo && !hasAudio) assert.equal(b.audioKbps, 0);
  }
  assert.equal(bitrateForSize({ maxBytes: 20000, duration: 600, hasVideo: false }).audioKbps, 6);
});

test('длительность после обрезки и скорости', () => {
  const info = { duration: 100 };
  assert.equal(outputDuration(info, {}), 100);
  assert.equal(outputDuration(info, { trim: { start: 10, end: 30 } }), 20);
  assert.equal(outputDuration(info, { trim: { start: 10 }, speed: 2 }), 45);
  assert.equal(outputDuration(info, { trim: { start: 150, end: 200 } }), 0);
  assert.equal(pixelsForBitrate(1), 160 * 90);
  assert.ok(pixelsForBitrate(2000) > 900_000);
});

test('закон: atempo - каждый шаг 0.5..2 и произведение = скорости (зерно 13)', () => {
  const r = rng(13);
  for (let n = 0; n < 500; n++) {
    const speed = r.int(1, 1600) / 100;
    const steps = atempoChain(speed).split(',').map((s) => +s.split('=')[1]);
    for (const s of steps) assert.ok(s >= 0.5 && s <= 2);
    assert.ok(Math.abs(steps.reduce((a, b) => a * b, 1) - speed) < 1e-3);
  }
});

test('команды ffmpeg: качество, размер в два прохода, звук, gif, обрезка, поворот, без звука', () => {
  const info = { width: 1920, height: 1080, duration: 60, fps: 30, hasAudio: true, hasVideo: true };
  const crf = buildFfmpeg({ input: 'in.mov', output: 'o.mp4', to: 'mp4', info, opts: { quality: 100 } });
  assert.equal(crf.passes.length, 1);
  assert.ok(crf.passes[0].includes('-crf'));
  assert.equal(crf.passes[0].at(-1), 'o.mp4');
  const sized = buildFfmpeg({ input: 'in.mov', output: 'o.webm', to: 'webm', info, opts: { maxBytes: 5e6, trim: { start: 5, end: 25 }, rotate: 90, mute: true } });
  assert.equal(sized.passes.length, 2);
  assert.ok(sized.passes[0].includes('-an'));
  assert.ok(sized.passes[1].join(' ').includes('transpose=1'));
  assert.ok(sized.passes[1].includes('-an'));
  assert.deepEqual(sized.passes[1].slice(2, 6), ['-ss', '5', '-t', '20']);
  assert.ok(sized.videoKbps > 1500 && sized.videoKbps < 2000);
  const audio = buildFfmpeg({ input: 'a.mp4', output: 'a.wav', to: 'wav', info, opts: { audio: { bits: 24, sampleRate: 96000, channels: 1, dither: 'tpdf' }, speed: 3 } });
  const a = audio.passes[0].join(' ');
  assert.ok(a.includes('-vn') && a.includes('pcm_s24le') && a.includes('-ar 96000') && a.includes('-ac 1') && a.includes('dither_method=triangular') && a.includes('atempo=2,atempo=1.5'));
  assert.ok(buildFfmpeg({ input: 'a', output: 'b', to: 'wav', info, opts: { audio: { bits: 8 } } }).passes[0].includes('pcm_u8'));
  assert.ok(buildFfmpeg({ input: 'a', output: 'b', to: 'wav', info, opts: { audio: { bits: 32, float: true } } }).passes[0].includes('pcm_f32le'));
  assert.ok(buildFfmpeg({ input: 'a', output: 'b', to: 'aiff', info, opts: {} }).passes[0].includes('pcm_s16be'));
  assert.ok(buildFfmpeg({ input: 'a', output: 'b', to: 'flac', info, opts: { audio: { bits: 24, dither: 'shaped' } } }).passes[0].join(' ').includes('-sample_fmt s32 -bits_per_raw_sample 24'));
  assert.ok(buildFfmpeg({ input: 'a', output: 'b', to: 'mp3', info, opts: { quality: 100 } }).passes[0].join(' ').includes('-q:a 0'));
  assert.ok(buildFfmpeg({ input: 'a', output: 'b', to: 'ogg', info, opts: { quality: 50 } }).passes[0].join(' ').includes('-q:a 5'));
  assert.ok(buildFfmpeg({ input: 'a', output: 'b', to: 'opus', info, opts: { audioKbps: 64, volume: 2 } }).passes[0].join(' ').includes('-b:a 64k -ar 48000'));
  assert.ok(buildFfmpeg({ input: 'a', output: 'b', to: 'mp3', info, opts: { maxBytes: 1e6 } }).passes[0].join(' ').includes('-b:a 128k') === false);
  assert.deepEqual(buildFfmpeg({ input: 'a', output: 'b', to: 'wav', info, opts: { maxBytes: 1e6 } }), { error: 'size-needs-compressed-audio' });
  assert.deepEqual(buildFfmpeg({ input: 'a', output: 'b', to: 'gif', info, opts: { maxBytes: 1e6 } }), { error: 'size-not-for-gif' });
  const gif = buildFfmpeg({ input: 'a', output: 'b.gif', to: 'gif', info, opts: { maxPixels: 480 * 270, fps: 10, flipH: true, flipV: true, rotate: 180 } });
  assert.ok(gif.passes[0].join(' ').includes('palettegen') && gif.passes[0].join(' ').includes('fps=10'));
  const avi = buildFfmpeg({ input: 'a', output: 'b.avi', to: 'avi', info: { ...info, hasAudio: false }, opts: { rotate: 270, fit: 'cover', width: 300, height: 300, speed: 2, fps: 24, keepMetadata: true } });
  const t = avi.passes[0].join(' ');
  assert.ok(t.includes('-q:v') && t.includes('transpose=2') && t.includes('force_original_aspect_ratio=increase') && t.includes('setpts=PTS/2') && t.includes('-an') && !t.includes('map_metadata'));
  const forced = buildFfmpeg({ input: 'a', output: 'b.mp4', to: 'mp4', info, opts: { forceVideoKbps: 300, audioKbps: 48 } });
  assert.equal(forced.passes.length, 2);
  assert.ok(forced.passes[1].join(' ').includes('-b:v 300k') && forced.passes[1].join(' ').includes('-b:a 48k'));
  assert.equal(crfFor('webm', 0), 52);
  assert.equal(crfFor('mp4', 100), 16);
});

test('склейка: размер первого, тишина вместо пропавшего звука', () => {
  const infos = [{ width: 1280, height: 720, duration: 3, hasAudio: true }, { width: 640, height: 480, duration: 2, hasAudio: false }];
  const plan = buildConcat({ inputs: ['a.mp4', 'b.mp4'], infos, output: 'o.webm', to: 'webm', opts: {} });
  const t = plan.passes[0].join(' ');
  assert.ok(t.includes('anullsrc') && t.includes('concat=n=2:v=1:a=1') && t.includes('-b:v 0'));
  assert.equal(plan.duration, 5);
  assert.deepEqual(plan.size, { width: 1280, height: 720 });
  assert.ok(!buildConcat({ inputs: ['a', 'b'], infos: [infos[0], infos[0]], output: 'o.mp4', to: 'mp4' }).passes[0].join(' ').includes('anullsrc'));
});

test('закон: подгонка под размер возвращает размер <= цели или ошибку (зерно 14, кодер-подделка)', async () => {
  const r = rng(14);
  for (let n = 0; n < 300; n++) {
    const maxBytes = r.int(50_000, 50_000_000);
    const duration = r.int(1, 600);
    const noise = 0.8 + r() * 0.6;
    const encode = async (v, a) => Math.floor(((v + a) * 1000 * duration / 8) * noise + 20_000);
    const first = bitrateForSize({ maxBytes, duration, hasVideo: r() < 0.7 });
    const reachable = (7 * 1000 * duration / 8) * 1.4 + 20_000 < maxBytes * 0.9;
    try {
      const res = await fitToSize({ maxBytes, first, encode });
      assert.ok(res.bytes <= maxBytes);
    } catch (e) {
      assert.equal(e.message, 'size-unreachable');
      assert.ok(!reachable, `цель ${maxBytes} достижима, а подгонка сдалась`);
    }
  }
  const ctl = new AbortController(); ctl.abort();
  await assert.rejects(fitToSize({ maxBytes: 1, first: { videoKbps: 1, audioKbps: 1 }, encode: async () => 10, signal: ctl.signal }), /canceled/);
  await assert.rejects(fitToSize({ maxBytes: 1, first: { videoKbps: 1, audioKbps: 6 }, encode: async () => 10 }), /size-unreachable/);
});

test('разбор вывода ffmpeg', () => {
  const text = `Duration: 00:01:02.50, start: 0\n  Stream #0:0: Video: h264, yuv420p, 1920x1080, 29.97 fps\n    rotate          : 90\n  Stream #0:1: Audio: aac`;
  assert.deepEqual(parseProbe(text), { duration: 62.5, width: 1080, height: 1920, fps: 29.97, hasVideo: true, hasAudio: true });
  assert.deepEqual(parseProbe('nothing'), { duration: 0, width: 0, height: 0, fps: 0, hasVideo: false, hasAudio: false });
  assert.equal(parseProgress('frame=1 time=00:00:31.25 bitrate', 62.5), 0.5);
  assert.equal(parseProgress('time=00:10:00.00', 62.5), 1);
  assert.equal(parseProgress('no', 10), null);
  assert.equal(parseProgress('time=00:00:01.00', 0), null);
});

test('закон: обрезка краёв в процентах - прямоугольник внутри кадра, стороны чётные (зерно 15)', () => {
  const r = rng(15);
  for (let n = 0; n < 2000; n++) {
    const info = { width: r.int(2, 4000), height: r.int(2, 3000) };
    const pct = { left: r.int(0, 60), right: r.int(0, 60), top: r.int(-5, 60), bottom: r.int(0, 120) };
    const c = cropFromPercent(info, pct);
    assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= info.width + 1 && c.y + c.h <= info.height + 1, JSON.stringify({ info, c }));
    assert.equal(c.w % 2, 0); assert.equal(c.h % 2, 0);
  }
  const plan = buildFfmpeg({ input: 'a', output: 'b.mp4', to: 'mp4', info: { width: 1000, height: 500, duration: 2, hasAudio: false }, opts: { cropPct: { left: 10, right: 10 } } });
  assert.ok(plan.passes[0].join(' ').includes('crop=800:500:100:0'));
  assert.ok(!buildFfmpeg({ input: 'a', output: 'b.mp4', to: 'mp4', info: { width: 1000, height: 500, duration: 2 }, opts: { cropPct: {} } }).passes[0].join(' ').includes('crop='));
});
