// Мутанты-возвраты находок независимого ревью: каждый закон из tests/core/review.test.js ловит свою ошибку
const T = 'tests/core/review.test.js';
export default [
  { name: 'review: tar negative size loops', file: 'web/core/archive/tar.js', from: "if (!Number.isSafeInteger(size) || size < 0) throw new Error('tar: bad entry size');", to: '', test: T },
  { name: 'review: duplicate names compared with case', file: 'web/core/archive/entries.js', from: 'for (let n = 2; taken.has(path.toLowerCase()); n++)', to: 'for (let n = 2; taken.has(path); n++)', test: T },
  { name: 'review: archive folder ignores taken names', file: 'web/core/names.js', from: '  return uniqueName(stem, taken);\n}', to: '  return uniqueName(stem, new Set());\n}', test: T },
  { name: 'review: mp4 audio-only codec undefined', file: 'web/core/media.js', from: "AUDIO_CODEC[to] || AUDIO_IN_VIDEO[to] || 'aac'", to: 'AUDIO_CODEC[to]', test: T },
  { name: 'review: opus quality ignored', file: 'web/core/media.js', from: "    else out.push('-b:a', `${kbpsForQuality(o.quality)}k`);", to: '', test: T },
  { name: 'review: concat size ignored', file: 'web/core/ffjob.js', from: '  if (!opts.maxBytes) return { bytes: await run(plan), infos, plan };', to: '  return { bytes: await run(plan), infos, plan };', test: T },
];

// Окно и ПК (Playwright)
const W = 'tests/web/review.spec.js';
const A = 'tests/app/app.spec.js';
const appConfig = 'playwright.app.config.js';
export const windowMutants = [
  { name: 'review web: ffmpeg.wasm calls not serialized', file: 'web/app/ffmpeg-web.js', from: '  const run = lock.then(fn, fn);', to: '  const run = fn();', app: W, grep: 'параллельные пробы' },
  { name: 'review web: audio preview lost on redraw', file: 'web/app/panel.js', from: '      if (job.view.audio?.key === key) audio.src = job.view.audio.url;', to: '', app: W, grep: '№1:' },
  { name: 'review web: BMP size ignored', file: 'web/app/worker.js', from: "  if (to === 'ico') return I.encodeIco(img, opts.icoSizes || I.ICO_SIZES);", to: "  if (to === 'ico') return I.encodeIco(img, opts.icoSizes || I.ICO_SIZES);\n  if (to === 'bmp') return I.encodeBmp(img);", app: W, grep: '№3' },
  { name: 'review web: MB field for GIF', file: 'web/app/panel.js', from: "show: (j) => !['gif', 'ico'].includes(j.to) && (", to: 'show: (j) => (', app: W, grep: '№3' },
  { name: 'review web: orientation stripped with EXIF', file: 'web/app/worker.js', from: 'keepIcc: true, keepOrientation: true', to: 'keepIcc: true, keepOrientation: false', app: W, grep: '№8' },
  { name: 'review web: unchecked strip box ignored', file: 'web/app/worker.js', from: '  if (opts.stripMeta === false) return bytes.slice();\n', to: '', app: W, grep: '№8' },
  { name: 'review web: AVIF always offered', file: 'web/app/main.js', from: ".filter((x) => x !== 'avif' || app.caps.avif)", to: '', app: W, grep: '№10' },
  { name: 'review web: WAV forced to 16 bit', file: 'web/app/worker.js', from: '  const bits = a.bits || keep.bits || 16;', to: '  const bits = a.bits || 16;', app: W, grep: '№13' },
  { name: 'review web: join shows every field', file: 'web/app/panel.js', from: " && (job.kind !== 'join' || JOIN_FIELDS.has(f.id))", to: '', app: W, grep: '№2:' },
  { name: 'review web: removed job keeps its preview URLs', file: 'web/app/main.js', from: '  releaseJob(app.jobs[i]);\n', to: '', app: W, grep: '№14' },
  { name: 'review app: window reads any path', file: 'electron/main.js', from: 'new Uint8Array(await fs.promises.readFile(guard.file(p)))', to: 'new Uint8Array(await fs.promises.readFile(p))', app: A, config: appConfig, grep: '№17' },
  { name: 'review app: any target extension', file: 'electron/main.js', from: 'return done(saveBytes(bytes, src, checkTarget(to), dir, checkTag(tag)));', to: 'return done(saveBytes(bytes, src, to, guard.outDir(outDir), checkTag(tag)));', app: A, config: appConfig, grep: '№17' },
  { name: 'review app: text to 3D needs a source file', file: 'electron/main.js', from: "const src = source ? guard.file(source) : path.join(dir || app.getPath('documents'), path.basename(String(name || 'file')));", to: 'const src = guard.file(source);', app: A, config: appConfig, grep: '№6' },
];
