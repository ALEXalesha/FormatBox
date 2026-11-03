// Мутанты звуковой части: каждый ломает одно место, ловить его должен свой закон.
const wav = 'web/core/audio/wav.js', convert = 'web/core/audio/convert.js', chip = 'web/core/audio/chip.js';
const pitch = 'web/core/audio/pitch.js', synth = 'web/core/audio/synth.js', remix = 'web/core/audio/remix.js';
const t = (name) => `tests/core/audio-${name}.test.js`;

export default [
  { name: 'audio: 8-bit WAV written signed', file: wav, from: 'view.setUint8(p, toInt(x, 8) + 128)', to: 'view.setUint8(p, toInt(x, 8) & 0xff)', test: t('wav') },
  { name: 'audio: 24-bit sign lost on read', file: wav, from: '(view.getInt8(p + 2) << 16)', to: '(view.getUint8(p + 2) << 16)', test: t('wav') },
  { name: 'audio: odd chunk pad byte ignored', file: wav, from: 'pos = body + size + (size & 1);', to: 'pos = body + size;', test: t('wav') },
  { name: 'audio: streaming data size not clamped', file: wav, from: 'dataSize = Math.min(size, bytes.length - body);', to: 'dataSize = size;', test: t('wav') },
  { name: 'audio: header keeps input sample rate', file: convert, from: 'const result = { sampleRate, channels: out };', to: 'const result = { sampleRate: audio.sampleRate, channels: out };', test: t('convert') },
  { name: 'audio: resampled length off', file: convert, from: 'const outLen = Math.round((samples.length * L) / M);', to: 'const outLen = Math.ceil((samples.length * L) / M) + 1;', test: t('convert') },
  { name: 'audio: quantization skipped', file: convert, from: 'return float ? res : quantize(res, bits, dither, c + 1);', to: 'return res;', test: t('convert') },
  { name: 'audio: dither added without request', file: convert, from: "if (dither !== 'none') {", to: 'if (true) {', test: t('convert') },
  { name: 'audio: resampler kernel phase reversed', file: convert, from: 'const x = k - half + 1 - frac;', to: 'const x = k - half + 1 + frac;', test: t('convert') },
  { name: 'audio: chip has one bit too many', file: chip, from: 'const s = 2 ** (bits - 1);', to: 'const s = 2 ** bits;', test: t('chip') },
  { name: 'audio: chip mono preset ignored', file: chip, from: 'const input = p.mono ? [mixdown(audio)] : audio.channels;', to: 'const input = audio.channels;', test: t('chip') },
  { name: 'audio: chip sample-and-hold off', file: chip, from: 'if (holdRate >= sampleRate) return x;', to: 'if (true) return x;', test: t('chip') },
  { name: 'audio: chip square loses sign', file: chip, from: 'amount * Math.sign(x[i]) * env', to: 'amount * env', test: t('chip') },
  { name: 'audio: chip squarize writes into input', file: chip, from: 'const out = new Float32Array(x.length);\n  const fall', to: 'const out = x;\n  const fall', test: t('chip') },
  { name: 'audio: resample shares input at same rate', file: convert, from: 'if (fromRate === toRate) return Float32Array.from(samples);', to: 'if (fromRate === toRate) return samples;', test: t('convert') },
  { name: 'audio: chip envelope ignored', file: chip, from: 'env = a > env ? a : env * fall;', to: 'env = 0.5;', test: t('chip') },
  { name: 'audio: YIN takes first dip, not its minimum', file: pitch, from: 'while (t + 1 < tauMax && d[t + 1] < d[t]) t++;', to: 'while (false) t++;', test: t('pitch') },
  { name: 'audio: YIN parabola shifted wrong way', file: pitch, from: 'const shift = den > 0 ? (0.5 * (a - c)) / den : 0;', to: 'const shift = den > 0 ? (0.5 * (c - a)) / den : 0;', test: t('pitch') },
  { name: 'audio: YIN threshold ignored', file: pitch, from: 'if (d[t] < threshold) {', to: 'if (d[t] < 1) {', test: t('pitch') },
  { name: 'audio: onset times late', file: pitch, from: 'out.push((f * hop) / sampleRate);', to: 'out.push((f * hop) / sampleRate + 0.02);', test: t('pitch') },
  { name: 'audio: tempo autocorrelation lag off by one', file: pitch, from: 's += x[i] * x[i - l];', to: 's += x[i] * x[i - l + 2];', test: t('pitch') },
  { name: 'audio: repeated note splits on every onset', file: pitch, from: 'rearticulated(f)) { close(); open(f); }', to: 'true) { close(); open(f); }', test: t('pitch') },
  { name: 'audio: pulse duty one step longer', file: synth, from: 'Math.floor(phase * 8) < dutySteps', to: 'Math.floor(phase * 8) <= dutySteps', test: t('synth') },
  { name: 'audio: LFSR short mode wrong tap', file: synth, from: "const tap = mode === 'short' ? 6 : 1;", to: "const tap = mode === 'short' ? 5 : 1;", test: t('synth') },
  { name: 'audio: triangle has 5-bit steps', file: synth, from: '(i < 16 ? 15 - i : i - 16)', to: '(i < 16 ? 31 - 2 * i : 2 * i - 32)', test: t('synth') },
  { name: 'audio: noise silent bit plays half volume', file: synth, from: 'lfsr[Math.floor(noisePos)] ? 0 : level', to: 'lfsr[Math.floor(noisePos)] ? level / 2 : level', test: t('synth') },
  { name: 'audio: mix length off', file: synth, from: 'const len = Math.round(total * sampleRate);', to: 'const len = Math.ceil(total * sampleRate) + 1;', test: t('synth') },
  { name: 'audio: duplicate channels merged', file: remix, from: "const names = opts.channels ?? ['melody', 'bass', 'drums'];", to: "const names = [...new Set(opts.channels ?? ['melody', 'bass', 'drums'])];", test: t('remix') },
  { name: 'audio: note gaps not bridged', file: pitch, from: 'if (cur && ++cur.gap > maxGap) close();', to: 'if (cur) close();', test: t('remix') },
  { name: 'audio: melody without bass filter', file: remix, from: "const x = src ?? filter(full, 'highpass', 250, sr, 4);", to: 'const x = src ?? full;', test: t('remix') },
  { name: 'audio: tempo prior centered too low', file: pitch, from: 'const octaves = Math.log2((60 * fps) / l / 120);', to: 'const octaves = Math.log2((60 * fps) / l / 50);', test: t('remix') },
  { name: 'audio: preview length ignored', file: remix, from: 'const duration = Math.min(score.duration, previewSeconds ?? Infinity);', to: 'const duration = score.duration;', test: t('remix') },
];
