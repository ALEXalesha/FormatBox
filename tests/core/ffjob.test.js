import test from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../../web/core/rand.js';
import { runMediaJob, runConcatJob } from '../../web/core/ffjob.js';

// ffmpeg-подделка: размер результата = битрейт из команды * длительность * шум
function fakeFfmpeg(info, noise) {
  let last = 0;
  const exec = async (args, { duration, onProgress }) => {
    const kb = (flag) => { const i = args.indexOf(flag); return i < 0 ? 0 : parseInt(args[i + 1], 10); };
    const v = kb('-b:v'), a = kb('-b:a');
    const isFirstPass = args.includes('-pass') && args[args.indexOf('-pass') + 1] === '1';
    if (!isFirstPass) last = v || a ? Math.floor(((v + a) * 1000 * duration) / 8 * noise) + 30_000 : 5_000_000;
    onProgress(0.5);
  };
  return { probe: async () => info, exec, outSize: () => last };
}

test('закон: задание ffmpeg с размером в МБ кончается файлом <= цели (зерно 51, 300 случаев)', async () => {
  const r = rng(51);
  for (let n = 0; n < 300; n++) {
    const info = { width: r.int(160, 3840), height: r.int(120, 2160), duration: r.int(2, 900), fps: 30, hasVideo: true, hasAudio: r() < 0.8 };
    const maxBytes = r.int(300, 100_000) * 1024;
    const noise = 0.7 + r() * 0.8;
    const fake = fakeFfmpeg(info, noise);
    const steps = [];
    try {
      const res = await runMediaJob({ ...fake, input: 'in', output: 'out', to: r.pick(['mp4', 'webm', 'mkv']), opts: { maxBytes } }, { progress: (p) => steps.push(p) });
      assert.ok(res.bytes <= maxBytes, `${res.bytes} > ${maxBytes}`);
      assert.ok(steps.every((p) => p >= 0 && p <= 1));
    } catch (e) {
      assert.equal(e.message, 'size-unreachable');
      assert.ok(maxBytes < 30_000 + (info.duration * 8 * 1000) / 8 * 1.5 + 200_000, `сдался на достижимой цели ${maxBytes}`);
    }
  }
});

test('без размера - один проход; не медиа; ошибка плана; отмена', async () => {
  const fake = fakeFfmpeg({ width: 640, height: 480, duration: 10, hasVideo: true, hasAudio: true }, 1);
  const res = await runMediaJob({ ...fake, input: 'i', output: 'o', to: 'mp4', opts: { quality: 50 } });
  assert.ok(res.bytes > 0);
  assert.equal(res.plan.passes.length, 1);
  await assert.rejects(runMediaJob({ ...fakeFfmpeg({ duration: 0, hasVideo: false, hasAudio: false }, 1), input: 'i', output: 'o', to: 'mp4' }), /not-media/);
  await assert.rejects(runMediaJob({ ...fake, input: 'i', output: 'o', to: 'gif', opts: { maxBytes: 1e6 } }), /size-not-for-gif/);
  const ctl = new AbortController(); ctl.abort();
  await assert.rejects(runMediaJob({ ...fake, input: 'i', output: 'o', to: 'mp4' }, { signal: ctl.signal }), /canceled/);
  const infos = [{ width: 320, height: 240, duration: 1, hasAudio: true }, { width: 320, height: 240, duration: 2, hasAudio: true }];
  const joined = await runConcatJob({ probeAll: async () => infos, exec: async () => {}, outSize: () => 7, inputs: ['a', 'b'], output: 'o', to: 'mp4' });
  assert.equal(joined.bytes, 7);
  assert.equal(joined.plan.duration, 3);
  await assert.rejects(runConcatJob({ probeAll: async () => infos, exec: async () => {}, outSize: () => 7, inputs: ['a', 'b'], output: 'o', to: 'mp4' }, { signal: ctl.signal }), /canceled/);
});
