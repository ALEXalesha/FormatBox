// Пересчёт PCM: частота (полифазный оконный sinc), каналы (моно/стерео), разрядность с дизерингом.
import { encodeWav, toInt } from './wav.js';
import { checkAudio, checkSignal } from './util.js';
import { rng } from '../rand.js';

const MAX_PHASES = 4096; // больше фаз не нужно: ошибка по времени < 1/8192 отсчёта
const DITHERS = ['none', 'tpdf', 'shaped'];

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// Модифицированная функция Бесселя I0 - для окна Кайзера.
function besselI0(x) {
  let sum = 1, term = 1;
  for (let k = 1; term > 1e-12 * sum; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
  }
  return sum;
}

// Таблица ядра: для каждой фазы taps коэффициентов, сумма каждой фазы = 1 (постоянная составляющая без искажения).
function kernelTable(phases, half, fc, beta) {
  const taps = 2 * half;
  const table = new Float32Array(phases * taps);
  const norm = besselI0(beta);
  for (let p = 0; p < phases; p++) {
    const frac = p / phases;
    let sum = 0;
    for (let k = 0; k < taps; k++) {
      const x = k - half + 1 - frac; // расстояние от точки вывода до входного отсчёта
      const t = fc * x;
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const r = x / half;
      const w = besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / norm;
      sum += table[p * taps + k] = fc * sinc * w;
    }
    for (let k = 0; k < taps; k++) table[p * taps + k] /= sum;
  }
  return table;
}

// Пересчёт частоты одного канала. Срез фильтра - cutoff от меньшей из частот Найквиста (против наложения).
export function resample(samples, fromRate, toRate, { zeros = 16, beta = 9, cutoff = 0.92 } = {}, { signal } = {}) {
  if (!(fromRate > 0) || !(toRate > 0)) throw new Error('resample: bad sample rate');
  if (fromRate === toRate) return Float32Array.from(samples);
  const g = gcd(Math.round(fromRate), Math.round(toRate));
  const L = Math.round(toRate) / g, M = Math.round(fromRate) / g;
  const outLen = Math.round((samples.length * L) / M);
  const fc = Math.min(1, L / M) * cutoff;
  const half = Math.ceil(zeros / fc);
  const taps = 2 * half;
  const phases = Math.min(L, MAX_PHASES);
  const table = kernelTable(phases, half, fc, beta);
  const out = new Float32Array(outLen);
  const last = samples.length;
  for (let n = 0; n < outLen; n++) {
    if ((n & 4095) === 0) checkSignal(signal);
    const num = n * M;
    let i0 = Math.floor(num / L);
    let p = Math.round(((num - i0 * L) * phases) / L);
    if (p === phases) { p = 0; i0 += 1; }
    const base = i0 - half + 1;
    const k0 = Math.max(0, -base), k1 = Math.min(taps, last - base);
    const row = p * taps;
    let acc = 0;
    for (let k = k0; k < k1; k++) acc += table[row + k] * samples[base + k];
    out[n] = acc;
  }
  return out;
}

// Каналы: в моно - среднее; моно в стерео - копия; многоканальный в стерео - чётные влево, нечётные вправо.
// При том же числе каналов возвращает их же (не копирует): дальше resample всё равно делает новые массивы.
export function remapChannels(channels, count) {
  const n = channels.length, len = channels[0].length;
  if (count === n) return channels;
  const out = Array.from({ length: count }, () => new Float32Array(len));
  if (count === 1) {
    for (const ch of channels) for (let i = 0; i < len; i++) out[0][i] += ch[i] / n;
  } else if (n === 1) {
    out[0].set(channels[0]); out[1].set(channels[0]);
  } else {
    const share = [Math.ceil(n / 2), Math.floor(n / 2)];
    channels.forEach((ch, c) => {
      const dst = out[c % 2], k = 1 / share[c % 2];
      for (let i = 0; i < len; i++) dst[i] += ch[i] * k;
    });
  }
  return out;
}

// Квантование на bits разрядов. tpdf - треугольный шум ±1 МЗР; shaped - то же плюс обратная связь
// по ошибке первого порядка: шум уходит в верхние частоты, где слух к нему менее чувствителен.
export function quantize(samples, bits, dither = 'none', seed = 1) {
  if (!DITHERS.includes(dither)) throw new Error(`dither: one of ${DITHERS.join(', ')}`);
  const s = 2 ** (bits - 1), lsb = 1 / s;
  const r = rng(seed);
  const out = new Float32Array(samples.length);
  let err = 0;
  for (let i = 0; i < samples.length; i++) {
    let x = samples[i];
    if (dither !== 'none') {
      if (dither === 'shaped') x -= err;
      const d = (r() - r()) * lsb;
      const q = toInt(x + d, bits) / s;
      err = Math.max(-2 * lsb, Math.min(2 * lsb, q - x));
      out[i] = q;
    } else {
      out[i] = toInt(x, bits) / s;
    }
  }
  return out;
}

export function convertPcm(audio, opts = {}, { signal, progress } = {}) {
  checkAudio(audio);
  const sampleRate = opts.sampleRate ?? Math.round(audio.sampleRate);
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) throw new Error('sampleRate: integer 8000..96000');
  const float = !!opts.float;
  const bits = opts.bits ?? (float ? 32 : 16);
  if (float ? bits !== 32 && bits !== 64 : ![8, 16, 24, 32].includes(bits)) throw new Error('bits: 8, 16, 24, 32 (float: 32, 64)');
  const channels = opts.channels ?? audio.channels.length;
  if (opts.channels !== undefined && channels !== 1 && channels !== 2) throw new Error('channels: 1 or 2');
  const dither = opts.dither ?? 'none';
  if (!DITHERS.includes(dither)) throw new Error(`dither: one of ${DITHERS.join(', ')}`);
  checkSignal(signal);
  const mapped = remapChannels(audio.channels, channels);
  const out = mapped.map((ch, c) => {
    checkSignal(signal);
    const res = resample(ch, audio.sampleRate, sampleRate, {}, { signal });
    progress?.((c + 1) / channels);
    return float ? res : quantize(res, bits, dither, c + 1);
  });
  const result = { sampleRate, channels: out };
  const bytes = encodeWav(result, { bits, float });
  progress?.(1);
  return { bytes, audio: result };
}
