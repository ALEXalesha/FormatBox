// Настоящий ffmpeg для версии на ПК: отдельный процесс, отмена, ход работы, подгонка под размер.
// Те же команды строит web/core/media.js - его же использует браузер с ffmpeg.wasm.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildFfmpeg, buildConcat, fitToSize, parseProbe, parseProgress } from '../../web/core/media.js';
import { saveResult } from './files.js';

export function findFfmpeg(env = process.env) {
  const list = [env.FORMATBOX_FFMPEG, 'ffmpeg'].filter(Boolean);
  for (const bin of list) {
    const r = spawnSync(bin, ['-version'], { encoding: 'utf8', env });
    if (r.status === 0) return { bin, version: (/ffmpeg version (\S+)/.exec(r.stdout) || [])[1] || '?' };
  }
  return null;
}

export function runFfmpeg(bin, args, { signal, duration, onProgress, cwd } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('canceled')); return; }
    const child = spawn(bin, args, { cwd, windowsHide: true });
    let tail = '';
    const kill = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', kill, { once: true });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      tail = (tail + text).slice(-8000);
      const p = parseProgress(text, duration);
      if (p != null && onProgress) onProgress(p);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      signal?.removeEventListener('abort', kill);
      if (signal?.aborted) reject(new Error('canceled'));
      else if (code === 0) resolve(tail);
      else reject(Object.assign(new Error('ffmpeg-failed'), { log: tail }));
    });
  });
}

export async function probe(bin, file) {
  const r = spawnSync(bin, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  return parseProbe(r.stderr || '');
}

// Один файл: { input, to, opts, outDir } -> { path, bytes }. Источник не меняется, имя не перетирает чужое.
export async function convertFile(bin, { input, to, opts = {}, outDir, tag = '' }, { signal, progress = () => {} } = {}) {
  const info = await probe(bin, input);
  if (!info.duration && !info.hasVideo && !info.hasAudio) throw new Error('not-media');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'formatbox-'));
  const tmpOut = path.join(work, `out.${to}`);
  try {
    const plan = buildFfmpeg({ input, output: tmpOut, to, info, opts: { ...opts, passlog: path.join(work, 'pass') } });
    if (plan.error) throw new Error(plan.error);
    const runPlan = async (passes) => {
      for (let i = 0; i < passes.length; i++) {
        await runFfmpeg(bin, passes[i], { signal, duration: plan.duration, cwd: work, onProgress: (p) => progress((i + p) / passes.length) });
      }
      return fs.statSync(tmpOut).size;
    };
    if (opts.maxBytes) {
      await fitToSize({
        maxBytes: opts.maxBytes,
        first: plan,
        signal,
        encode: (videoKbps, audioKbps, attempt) => {
          if (attempt === 0) return runPlan(plan.passes);
          const again = buildFfmpeg({ input, output: tmpOut, to, info, opts: { ...opts, passlog: path.join(work, 'pass'), maxBytes: null, ...forced(videoKbps, audioKbps) } });
          return runPlan(again.passes);
        },
      });
    } else await runPlan(plan.passes);
    return saveResult(tmpOut, input, to, outDir, tag);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// Повторная попытка с заданным битрейтом: те же два прохода, но без пересчёта от размера
function forced(videoKbps, audioKbps) {
  return { forceVideoKbps: videoKbps, audioKbps };
}

export async function concatFiles(bin, { inputs, to, opts = {}, outDir }, { signal, progress = () => {} } = {}) {
  const infos = [];
  for (const f of inputs) infos.push(await probe(bin, f));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'formatbox-'));
  const tmpOut = path.join(work, `out.${to}`);
  try {
    const plan = buildConcat({ inputs, infos, output: tmpOut, to, opts });
    await runFfmpeg(bin, plan.passes[0], { signal, duration: plan.duration, onProgress: progress });
    return saveResult(tmpOut, inputs[0], to, outDir, 'joined');
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
