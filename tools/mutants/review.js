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
