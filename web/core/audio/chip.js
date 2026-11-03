// «Звук приставки» без нот: срез ВЧ, квадратизация с сохранением громкости,
// понижение частоты выборкой-с-удержанием и понижение разрядности. Быстро, один проход.
import { checkAudio, checkSignal, filter, mixdown } from './util.js';

// holdRate - частота удержания (Гц), bits - разрядность ЦАП, square - доля «квадратной» волны 0..1,
// lowpass - срез ВЧ в Гц (0 - без среза), mono - свести в один канал, release - спад огибающей (с).
export const CHIP_PRESETS = {
  nes: { holdRate: 22050, bits: 7, square: 0.8, lowpass: 0, mono: true, release: 0.03 }, // 7-битный ЦАП DMC
  gameboy: { holdRate: 16384, bits: 4, square: 0.6, lowpass: 0, mono: false, release: 0.03 }, // 4-битный волновой канал
  '16bit': { holdRate: 32000, bits: 16, square: 0, lowpass: 12000, mono: false, release: 0.03 }, // SNES/Mega Drive: 32 кГц, мягкие верха
};

export function chipParams(opts = {}) {
  const base = CHIP_PRESETS[opts.preset ?? 'nes'];
  if (!base) throw new Error(`preset: one of ${Object.keys(CHIP_PRESETS).join(', ')}`);
  const p = { ...base };
  for (const k of Object.keys(base)) if (opts[k] !== undefined) p[k] = opts[k];
  if (!Number.isInteger(p.bits) || p.bits < 1 || p.bits > 16) throw new Error('bits: integer 1..16');
  if (!(p.holdRate > 0)) throw new Error('holdRate: positive number');
  if (!(p.square >= 0 && p.square <= 1)) throw new Error('square: 0..1');
  return p;
}

// Огибающая: мгновенная атака, экспоненциальный спад за release секунд.
function squarize(x, amount, sampleRate, release) {
  const out = new Float32Array(x.length);
  const fall = Math.exp(-1 / Math.max(1, release * sampleRate));
  let env = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    env = a > env ? a : env * fall;
    out[i] = (1 - amount) * x[i] + amount * Math.sign(x[i]) * env;
  }
  return out;
}

// Выборка с удержанием: каждый отсчёт берёт значение из начала своей «ступеньки» длиной sampleRate/holdRate.
function sampleHold(x, sampleRate, holdRate) {
  if (holdRate >= sampleRate) return x;
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const step = Math.floor((i * holdRate) / sampleRate);
    out[i] = x[Math.ceil((step * sampleRate) / holdRate)];
  }
  return out;
}

// Ровно 2^bits уровней: целые от -2^(bits-1) до 2^(bits-1)-1.
function crush(x, bits) {
  const s = 2 ** (bits - 1);
  for (let i = 0; i < x.length; i++) x[i] = Math.max(-s, Math.min(s - 1, Math.round(x[i] * s))) / s;
  return x;
}

export function chipify(audio, opts = {}, { signal, progress } = {}) {
  checkAudio(audio);
  const p = chipParams(opts);
  const sr = audio.sampleRate;
  const input = p.mono ? [mixdown(audio)] : audio.channels;
  const channels = input.map((ch, c) => {
    checkSignal(signal);
    let x = p.lowpass > 0 && p.lowpass < sr / 2 ? filter(ch, 'lowpass', p.lowpass, sr, 2) : ch;
    x = squarize(x, p.square, sr, p.release);
    x = crush(sampleHold(x, sr, p.holdRate), p.bits);
    progress?.((c + 1) / input.length);
    return x;
  });
  return { sampleRate: sr, channels };
}
