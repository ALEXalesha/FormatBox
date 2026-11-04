// ffmpeg.wasm в браузере: грузится один раз по первой нужде, работает в своём Worker.
// Отмена - terminate(): процесс убивается целиком, следующий вызов загрузит его заново (из кэша).
import { runMediaJob, runConcatJob } from '../core/ffjob.js';
import { parseProbe, parseProgress } from '../core/media.js';

const BASE = new URL('../vendor/', import.meta.url).href;
let ff = null;
let loading = null;
let logTail = '';
let onLine = null;
let loads = 0;
let calls = 0;
let lock = Promise.resolve();

// Один ffmpeg.wasm на всё окно: вызовы идут строго по очереди, у каждого свои имена файлов.
// Без этого предпросмотр звука, начатый во время задания, подменял его вход и выход.
function serial(fn) {
  const run = lock.then(fn, fn);
  lock = run.catch(() => {});
  return run;
}

// сколько раз ffmpeg загружался: после отмены он убит и грузится заново
export const ffmpegState = () => ({ loaded: Boolean(ff), loads });

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
      loads += 1;
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
export function ffmpegConvert(job, ctl = {}) {
  return serial(() => convertNow(job, ctl));
}

async function convertNow({ bytes, ext, to, opts }, { signal, progress, onLoading } = {}) {
  if (signal?.aborted) throw new Error('canceled');
  const inst = await instance(onLoading);
  if (signal?.aborted) throw new Error('canceled');
  const n = ++calls;
  const input = `in${n}.${safeExt(ext)}`;
  const output = `out${n}.${safeExt(to)}`;
  // копия: ffmpeg.wasm забирает буфер в свой поток, а исходные байты нужны окну снова
  await inst.writeFile(input, bytes.slice());
  try {
    const res = await runMediaJob({
      probe: () => probeIn(inst, input),
      exec: (args, { duration, onProgress }) => exec(inst, args, { signal, duration, onProgress }),
      outSize: async () => (await inst.readFile(output)).length,
      input, output, to, opts: { ...opts, wasm: true }, passlog: `fb2pass${n}`, nullOutput: '/dev/null',
    }, { signal, progress });
    const data = await inst.readFile(output);
    return { bytes: data, info: res.info };
  } finally {
    if (ff === inst) {
      for (const name of [input, output]) await inst.deleteFile(name).catch(() => {});
    }
  }
}

export function ffmpegProbe({ bytes, ext }, { onLoading } = {}) {
  return serial(async () => {
    const inst = await instance(onLoading);
    const input = `probe${++calls}.${safeExt(ext)}`;
    await inst.writeFile(input, bytes.slice());
    try { return await probeIn(inst, input); } finally { await inst.deleteFile(input).catch(() => {}); }
  });
}

export function ffmpegConcat(items, to, opts, ctl = {}) {
  return serial(() => concatNow(items, to, opts, ctl));
}

async function concatNow(items, to, opts, { signal, progress, onLoading } = {}) {
  if (signal?.aborted) throw new Error('canceled');
  const inst = await instance(onLoading);
  const n = ++calls;
  const inputs = [];
  for (let i = 0; i < items.length; i++) {
    const name = `j${n}-${i}.${safeExt(items[i].ext)}`;
    await inst.writeFile(name, items[i].bytes.slice());
    inputs.push(name);
  }
  const output = `joined${n}.${safeExt(to)}`;
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
