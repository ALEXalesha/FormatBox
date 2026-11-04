// Законы на находки независимого ревью (04.11): каждый ловит свою ошибку.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../../web/core/rand.js';
import { archiveFolderName } from '../../web/core/names.js';
import { extract, pack } from '../../web/core/archive/index.js';
import { buildFfmpeg, buildConcat, kbpsForQuality } from '../../web/core/media.js';
import { runConcatJob } from '../../web/core/ffjob.js';

function tarHeader(name, size, type) {
  const h = new Uint8Array(512);
  const put = (off, s) => h.set(new TextEncoder().encode(s), off);
  put(0, name); put(100, '0000644\0'); put(108, '0000000\0'); put(116, '0000000\0');
  put(124, `${size.toString(8).padStart(11, '0')}\0`); put(136, '00000000000\0');
  h[156] = type.charCodeAt(0); put(257, 'ustar\0'); put(263, '00');
  h.fill(32, 148, 156);
  const sum = h.reduce((a, b) => a + b, 0);
  put(148, `${sum.toString(8).padStart(6, '0')}\0 `);
  return h;
}

test('ревью №5: tar с отрицательным размером в pax - ошибка, а не вечный цикл', async () => {
  const rec = ' size=-1536\n';
  const body = `${rec.length + 2}${rec}`;
  const pax = new Uint8Array(512); pax.set(new TextEncoder().encode(body));
  const tar = new Uint8Array([...tarHeader('pax', body.length, 'x'), ...pax, ...tarHeader('a.txt', 0, '0'), ...new Uint8Array(1024)]);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 3000);
  await assert.rejects(extract(tar, 'evil.tar', { signal: ctl.signal }), /bad entry size/);
  clearTimeout(timer);
});

test('закон (ревью №18): после распаковки пути различны без учёта регистра (зерно 71)', async () => {
  const r = rng(71);
  for (let n = 0; n < 40; n++) {
    const entries = Array.from({ length: r.int(2, 8) }, () => ({ path: `${r.pick(['d', 'D', ''])}/${r.pick(['a', 'A'])}.${r.pick(['txt', 'TXT'])}`.replace(/^\//, ''), data: r.bytes(r.int(0, 5)) }));
    const tar = await pack(entries, 'tar');
    const out = await extract(tar, 'x.tar');
    const low = out.filter((e) => !e.dir).map((e) => e.path.toLowerCase());
    assert.equal(new Set(low).size, low.length, low.join(' '));
    assert.equal(out.filter((e) => !e.dir).length, entries.length);
  }
});

test('закон (ревью №4): папка распаковки не совпадает ни с одним именем папки, регистр не важен (зерно 72)', () => {
  const r = rng(72);
  for (let n = 0; n < 1000; n++) {
    const base = r.pick(['photos', 'Photos', 'a.b', 'архив']);
    const name = `${base}.${r.pick(['zip', 'tar.gz', 'TAR.XZ', '7z'])}`;
    const taken = new Set();
    for (let k = r.int(0, 5); k > 0; k--) taken.add(archiveFolderName(name, taken)[r() < 0.5 ? 'toUpperCase' : 'toLowerCase']());
    const got = archiveFolderName(name, taken);
    assert.ok(![...taken].some((t) => t.toLowerCase() === got.toLowerCase()), `${got} занято`);
    assert.ok(!/\.(zip|gz|xz|7z)$/i.test(got));
  }
});

test('ревью №11: mp4 без картинки в mp4 - кодек звука контейнера, а не undefined', () => {
  const info = { duration: 3, hasVideo: false, hasAudio: true };
  for (const to of ['mp4', 'mkv', 'mov', 'webm', 'avi']) {
    const args = buildFfmpeg({ input: 'a', output: 'b', to, info, opts: {} }).passes[0];
    const codec = args[args.indexOf('-c:a') + 1];
    assert.ok(codec && codec !== 'undefined', `${to}: ${codec}`);
  }
});

test('закон (ревью №12): ползунок качества меняет битрейт Opus и M4A, больше качество - не меньше битрейт', () => {
  const info = { duration: 3, hasVideo: false, hasAudio: true };
  for (const to of ['opus', 'm4a']) {
    let prev = 0;
    for (let q = 0; q <= 100; q += 5) {
      const args = buildFfmpeg({ input: 'a', output: 'b', to, info, opts: { quality: q } }).passes[0];
      const kbps = parseInt(args[args.indexOf('-b:a') + 1], 10);
      assert.equal(kbps, kbpsForQuality(q));
      assert.ok(kbps >= prev); prev = kbps;
    }
    assert.ok(kbpsForQuality(5) < kbpsForQuality(95));
  }
});

test('закон (ревью №2): склейка с «до N МБ» - результат не больше (зерно 73, ffmpeg-подделка)', async () => {
  const r = rng(73);
  for (let n = 0; n < 200; n++) {
    const infos = Array.from({ length: r.int(2, 4) }, () => ({ width: r.int(160, 1920), height: r.int(120, 1080), duration: r.int(1, 300), hasAudio: r() < 0.7 }));
    const maxBytes = r.int(500, 50_000) * 1024;
    const noise = 0.7 + r() * 0.8;
    let last = 0;
    const exec = async (args, { duration }) => {
      const kb = (f) => (args.includes(f) ? parseInt(args[args.indexOf(f) + 1], 10) : 0);
      last = Math.floor(((kb('-b:v') || 5000) + kb('-b:a')) * 1000 * duration / 8 * noise) + 20_000;
    };
    try {
      const res = await runConcatJob({ probeAll: async () => infos, exec, outSize: () => last, inputs: infos.map((_, i) => `i${i}`), output: 'o', to: 'mp4', opts: { maxBytes } });
      assert.ok(res.bytes <= maxBytes, `${res.bytes} > ${maxBytes}`);
    } catch (e) { assert.equal(e.message, 'size-unreachable'); }
  }
  const plan = buildConcat({ inputs: ['a', 'b'], infos: [{ width: 640, height: 360, duration: 10 }, { width: 640, height: 360, duration: 10 }], output: 'o', to: 'mp4', opts: { maxBytes: 2e6 } });
  assert.ok(plan.videoKbps > 0 && !plan.passes[0].includes('-crf'));
});
