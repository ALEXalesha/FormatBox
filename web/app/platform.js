// Где работает окно: в браузере (ffmpeg.wasm, скачивание или выбранная папка) или в Electron
// (настоящий ffmpeg, LibreOffice, запись рядом с файлом). Остальное окно одинаково.
import { outputName } from '../core/names.js';

export async function makePlatform() {
  return window.formatbox ? desktopPlatform(window.formatbox) : webPlatform();
}

function webPlatform() {
  const produced = new Set();
  let dir = null;
  return {
    desktop: false,
    info: { ffmpeg: 'wasm', soffice: null, pandoc: null },
    canPickFolder: typeof window.showDirectoryPicker === 'function',
    outLabel: () => (dir ? { key: 'out.folder', name: dir.name } : { key: 'out.downloads' }),
    async pickFolder() { dir = await window.showDirectoryPicker({ mode: 'readwrite' }); return dir.name; },
    resetFolder() { dir = null; },
    async read(job) { return new Uint8Array(await job.src.file.arrayBuffer()); },
    async ffmpeg(job, bytes, ctl) {
      const { ffmpegConvert } = await import('./ffmpeg-web.js');
      const res = await ffmpegConvert({ bytes, ext: job.ext, to: job.to, opts: job.opts }, ctl);
      return this.save(job, res.bytes, job.to, ctl.tag || '');
    },
    async ffmpegBytes(job, bytes, ext, ctl) {
      const { ffmpegConvert } = await import('./ffmpeg-web.js');
      const opts = { audioKbps: job.opts.audioKbps, quality: job.opts.quality, maxBytes: job.opts.maxBytes, audio: { sampleRate: job.opts.audio?.sampleRate, channels: job.opts.audio?.channels } };
      const res = await ffmpegConvert({ bytes, ext, to: job.to, opts }, ctl);
      return this.save(job, res.bytes, job.to, ctl.tag || '');
    },
    async concat(jobs, to, opts, ctl) {
      const { ffmpegConcat } = await import('./ffmpeg-web.js');
      const items = [];
      for (const j of jobs) items.push({ bytes: await this.read(j), ext: j.ext });
      const res = await ffmpegConcat(items, to, opts, ctl);
      return this.save(jobs[0], res.bytes, to, 'joined');
    },
    // Закон имён и здесь: в выбранной папке - по её списку, при скачивании - по уже выданным именам
    async save(job, bytes, to, tag = '') {
      if (dir) {
        const taken = new Set();
        for await (const name of dir.keys()) taken.add(name);
        const name = outputName(job.name, to, taken, tag);
        const handle = await dir.getFileHandle(name, { create: true });
        const w = await handle.createWritable();
        await w.write(bytes);
        await w.close();
        return { name, bytes: bytes.length, folder: dir.name };
      }
      const name = outputName(job.name, to, produced, tag);
      produced.add(name);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
      return { name, bytes: bytes.length, url };
    },
    async extract(job, entries) {
      if (!dir) return null;
      const taken = new Set();
      for await (const name of dir.keys()) taken.add(name);
      const folderName = outputName(job.name.replace(/\.(tar\.(gz|xz|bz2)|[^.]+)$/i, ''), '', taken, '').replace(/-formatbox$/, '');
      const root = await dir.getDirectoryHandle(taken.has(folderName) ? `${folderName} (2)` : folderName, { create: true });
      let files = 0;
      for (const e of entries) {
        const parts = e.path.split('/').filter(Boolean);
        if (!parts.length) continue;
        let d = root;
        for (const p of parts.slice(0, e.dir ? parts.length : -1)) d = await d.getDirectoryHandle(p, { create: true });
        if (e.dir) continue;
        const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable();
        await w.write(e.data); await w.close();
        files += 1;
      }
      return { name: root.name, files };
    },
    revoke(result) { if (result?.url) URL.revokeObjectURL(result.url); },
  };
}

function desktopPlatform(fb) {
  let outDir = null;
  let seq = 0;
  const progressBy = new Map();
  fb.onProgress(({ id, p }) => progressBy.get(id)?.(p));
  const call = async (method, payload, ctl = {}) => {
    const id = `j${++seq}`;
    progressBy.set(id, ctl.progress || (() => {}));
    const stop = () => fb.cancel(id);
    ctl.signal?.addEventListener('abort', stop, { once: true });
    try {
      const res = await fb[method]({ ...payload, id });
      if (!res.ok) throw new Error(ctl.signal?.aborted ? 'canceled' : res.error);
      return res;
    } finally {
      progressBy.delete(id);
      ctl.signal?.removeEventListener('abort', stop);
    }
  };
  const platform = {
    desktop: true,
    info: {},
    canPickFolder: true,
    outLabel: () => (outDir ? { key: 'out.folder', name: outDir } : { key: 'out.next' }),
    async pickFolder() { const p = await fb.pickFolder(); if (p) outDir = p; return p; },
    resetFolder() { outDir = null; },
    async read(job) { return fb.read(job.src.path); },
    async ffmpeg(job, bytes, ctl) {
      return call('ffmpeg', { input: job.src.path, to: job.to, opts: job.opts, outDir, tag: ctl.tag || '' }, ctl);
    },
    async ffmpegBytes(job, bytes, ext, ctl) {
      const opts = { audioKbps: job.opts.audioKbps, quality: job.opts.quality, maxBytes: job.opts.maxBytes, audio: { sampleRate: job.opts.audio?.sampleRate, channels: job.opts.audio?.channels } };
      return call('ffmpegBytes', { bytes, ext, source: job.src.path, to: job.to, opts, outDir, tag: ctl.tag || '' }, ctl);
    },
    async decode(job, opts, ctl) {
      return (await call('decode', { input: job.src.path, opts }, ctl)).bytes;
    },
    async concat(jobs, to, opts, ctl) {
      return call('concat', { inputs: jobs.map((j) => j.src.path), to, opts, outDir }, ctl);
    },
    async office(job, ctl) {
      return call('office', { input: job.src.path, from: job.ext, to: job.to, outDir }, ctl);
    },
    async save(job, bytes, to, tag = '') { return fb.save({ bytes, source: job.src.path, to, outDir, tag }); },
    async extract(job, entries) { return fb.extract({ entries, source: job.src.path, outDir }); },
    show: (p) => fb.show(p),
    getOffice: () => fb.getOffice(),
    async recheck() { Object.assign(platform.info, await fb.recheck()); return platform.info; },
    revoke() {},
  };
  return fb.info().then((info) => { platform.info = info; return platform; });
}
