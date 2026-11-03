// ffmpeg.wasm в браузере: грузится один раз по первой нужде, работает в своём Worker.
// Отмена - terminate(): процесс убивается целиком, следующий вызов загрузит его заново (из кэша).
import { runMediaJob, runConcatJob } from '../core/ffjob.js';
import { parseProbe, parseProgress } from '../core/media.js';

const BASE = new URL('../vendor/', import.meta.url).href;
let ff = null;
let loading = null;
let logTail = '';
let onLine = null;

async function instance(onLoading) {
  if (ff) return ff;
  if (!loading) {
    loading = (async () => {
      onLoading?.();
      const { FFmpeg } = await import('../vendor/ffmpeg/index.js');
      const inst = new FFmpeg();
      inst.on('log', ({ message }) => {
        logTail = (logTail + message + '\n').slice(-12000);
        onLine?.(message);
      });
      await inst.load({ coreURL: `${BASE}ffmpeg-core/ffmpeg-core.js`, wasmURL: `${BASE}ffmpeg-core/ffmpeg-core.wasm` });
      ff = inst;
      return inst;
    })().finally(() => { loading = null; });
  }
  return loading;
}

export function killFfmpeg() {
  if (ff) { try { ff.terminate(); } catch { /* уже мёртв */ } }
  ff = null;
}

async function exec(inst, args, { signal, duration, onProgress }) {
  if (signal?.aborted) throw new Error('canceled');
  const stop = () => killFfmpeg();
  signal?.addEventListener('abort', stop, { once: true });
  onLine = (line) => { const p = parseProgress(line, duration); if (p != null) onProgress?.(p); };
  logTail = '';
  try {
    const code = await inst.exec(args);
    if (signal?.aborted) throw new Error('canceled');
    if (code !== 0) throw Object.assign(new Error('ffmpeg-failed'), { log: logTail });
  } catch (err) {
    if (signal?.aborted) throw new Error('canceled');
    throw err;
  } finally {
    signal?.removeEventListener('abort', stop);
    onLine = null;
  }
}

async function probeIn(inst, name) {
  logTail = '';
  await inst.exec(['-hide_banner', '-i', name]);
  return parseProbe(logTail);
}

const safeExt = (ext) => String(ext || 'bin').replace(/[^a-z0-9.]/gi, '');

// bytes -> { bytes: Uint8Array результата, info }
export async function ffmpegConvert({ bytes, ext, to, opts }, { signal, progress, onLoading } = {}) {
  const inst = await instance(onLoading);
  const input = `in.${safeExt(ext)}`;
  const output = `out.${safeExt(to)}`;
  await inst.writeFile(input, bytes);
  try {
    const res = await runMediaJob({
      probe: () => probeIn(inst, input),
      exec: (args, { duration, onProgress }) => exec(inst, args, { signal, duration, onProgress }),
      outSize: async () => (await inst.readFile(output)).length,
      input, output, to, opts: { ...opts, wasm: true }, passlog: 'fb2pass', nullOutput: '/dev/null',
    }, { signal, progress });
    const data = await inst.readFile(output);
    return { bytes: data, info: res.info };
  } finally {
    if (ff === inst) {
      for (const name of [input, output]) await inst.deleteFile(name).catch(() => {});
    }
  }
}

export async function ffmpegProbe({ bytes, ext }, { onLoading } = {}) {
  const inst = await instance(onLoading);
  const input = `probe.${safeExt(ext)}`;
  await inst.writeFile(input, bytes);
  try { return await probeIn(inst, input); } finally { await inst.deleteFile(input).catch(() => {}); }
}

export async function ffmpegConcat(items, to, opts, { signal, progress, onLoading } = {}) {
  const inst = await instance(onLoading);
  const inputs = [];
  for (let i = 0; i < items.length; i++) {
    const name = `j${i}.${safeExt(items[i].ext)}`;
    await inst.writeFile(name, items[i].bytes);
    inputs.push(name);
  }
  const output = `joined.${safeExt(to)}`;
  try {
    await runConcatJob({
      probeAll: async () => { const list = []; for (const n of inputs) list.push(await probeIn(inst, n)); return list; },
      exec: (args, { duration, onProgress }) => exec(inst, args, { signal, duration, onProgress }),
      outSize: async () => (await inst.readFile(output)).length,
      inputs, output, to, opts: { ...opts, wasm: true },
    }, { signal, progress });
    return { bytes: await inst.readFile(output) };
  } finally {
    if (ff === inst) for (const n of [...inputs, output]) await inst.deleteFile(n).catch(() => {});
  }
}
