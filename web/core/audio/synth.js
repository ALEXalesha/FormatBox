// Синтез в духе NES (2A03): импульсные каналы, 4-битный треугольный, шум на 15-битном LFSR,
// громкость 0..15 с огибающей на частоте кадрового счётчика 240 Гц, нелинейный микшер и фильтр постоянки.
import { checkSignal, midiToHz } from './util.js';

export const CPU_HZ = 1789773; // NTSC
export const DUTIES = [0.125, 0.25, 0.5, 0.75];
export const NOISE_PERIODS = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068];
const TRIANGLE = Array.from({ length: 32 }, (_, i) => (i < 16 ? 15 - i : i - 16)); // 15..0, 0..15
const FRAME_HZ = 240;
const ENVELOPES = {
  pulse: { attack: 0, decay: 0.3, sustain: 0.6, release: 0.04 },
  triangle: { attack: 0, decay: 0, sustain: 1, release: 0 },
  noise: { attack: 0, decay: 0.12, sustain: 0, release: 0.02 },
};

// Биты выхода LFSR (1 - канал молчит). Длинный режим - отвод 1 (период 32767), короткий - отвод 6 (93).
export function noiseSequence(mode = 'long', count = 32767) {
  const tap = mode === 'short' ? 6 : 1;
  const out = new Uint8Array(count);
  let reg = 1;
  for (let i = 0; i < count; i++) {
    out[i] = reg & 1;
    const fb = (reg ^ (reg >> tap)) & 1;
    reg = (reg >> 1) | (fb << 14);
  }
  return out;
}

// Частота с учётом 11-битного таймера: импульс CPU/(16(t+1)), треугольник CPU/(32(t+1)), t в 8..2047.
export function nesFrequency(midi, wave) {
  const div = wave === 'triangle' ? 32 : 16;
  const t = Math.min(2047, Math.max(8, Math.round(CPU_HZ / (div * midiToHz(midi))) - 1));
  return CPU_HZ / (div * (t + 1));
}

// Громкость 0..1 через t секунд от начала ноты длиной dur.
export function envelopeLevel(env, t, dur) {
  const held = (u) => (u < env.attack ? u / env.attack : u < env.attack + env.decay ? 1 - ((1 - env.sustain) * (u - env.attack)) / env.decay : env.sustain);
  if (t < dur) return held(t);
  return env.release > 0 ? Math.max(0, held(dur) * (1 - (t - dur) / env.release)) : 0;
}

// Один канал - уровни 0..15 по отсчётам (как ЦАП 2A03 до микшера).
export function renderChannel(channel, { sampleRate = 44100, duration } = {}, { signal } = {}) {
  const wave = channel.wave;
  if (!ENVELOPES[wave]) throw new Error(`wave: pulse, triangle or noise, got ${wave}`);
  const duty = channel.duty ?? 0.5;
  if (wave === 'pulse' && !DUTIES.includes(duty)) throw new Error(`duty: one of ${DUTIES.join(', ')}`);
  const env = { ...ENVELOPES[wave], ...channel.envelope };
  const notes = [...(channel.notes ?? [])].sort((a, b) => a.start - b.start);
  const len = Math.round((duration ?? songLength([channel])) * sampleRate);
  const out = new Float32Array(len);
  const dutySteps = duty * 8;
  const lfsr = noiseSequence(channel.mode === 'short' ? 'short' : 'long', channel.mode === 'short' ? 93 : 32767);
  let phase = 0, triStep = 0, noisePos = 0;
  notes.forEach((note, k) => {
    if (k % 16 === 0) checkSignal(signal);
    const from = Math.max(0, Math.round(note.start * sampleRate));
    const end = Math.min(len, k + 1 < notes.length ? Math.round(notes[k + 1].start * sampleRate) : len); // канал одноголосый
    const volume = Math.max(0, Math.min(1, (note.vel ?? 100) / 127)) * 15;
    const inc = wave === 'noise'
      ? CPU_HZ / NOISE_PERIODS[Math.max(0, Math.min(15, Math.round(note.midi)))] / sampleRate
      : nesFrequency(note.midi, wave) / sampleRate;
    for (let i = from; i < end; i++) {
      const t = Math.floor(((i - from) / sampleRate) * FRAME_HZ) / FRAME_HZ; // огибающая шагает по 1/240 с
      const level = wave === 'triangle' ? (t < note.dur ? 15 : 0) : Math.round(envelopeLevel(env, t, note.dur) * volume);
      if (wave === 'pulse') {
        phase = (phase + inc) % 1;
        out[i] = Math.floor(phase * 8) < dutySteps ? level : 0;
      } else if (wave === 'triangle') {
        if (level) triStep = (triStep + inc * 32) % 32; // без звука треугольник стоит на месте - без щелчков
        out[i] = TRIANGLE[Math.floor(triStep)];
      } else {
        noisePos = (noisePos + inc) % lfsr.length;
        out[i] = lfsr[Math.floor(noisePos)] ? 0 : level;
      }
    }
  });
  return out;
}

export function songLength(channels) {
  let end = 0;
  for (const ch of channels) for (const n of ch.notes ?? []) end = Math.max(end, n.start + n.dur);
  return end;
}

// Все каналы: нелинейный микшер 2A03 (импульсы отдельно от треугольника и шума), затем срез постоянки ~90 Гц.
export function renderChannels(channels, { sampleRate = 44100, duration } = {}, { signal, progress } = {}) {
  const total = duration ?? songLength(channels);
  const len = Math.round(total * sampleRate);
  const pulse = new Float32Array(len), tri = new Float32Array(len), noise = new Float32Array(len);
  channels.forEach((ch, c) => {
    checkSignal(signal);
    const levels = renderChannel(ch, { sampleRate, duration: total }, { signal });
    const bus = ch.wave === 'pulse' ? pulse : ch.wave === 'triangle' ? tri : noise;
    for (let i = 0; i < len; i++) bus[i] += levels[i];
    progress?.((c + 1) / (channels.length + 1));
  });
  const out = new Float32Array(len);
  const k = Math.exp((-2 * Math.PI * 90) / sampleRate);
  let prevIn = 0, prevOut = 0;
  for (let i = 0; i < len; i++) {
    const p = pulse[i] > 0 ? 95.88 / (8128 / pulse[i] + 100) : 0;
    const tn = tri[i] + noise[i] > 0 ? 159.79 / (1 / (tri[i] / 8227 + noise[i] / 12241) + 100) : 0;
    const v = (p + tn) * 1.6;
    prevOut = k * (prevOut + v - prevIn); // фильтр постоянной составляющей первого порядка
    prevIn = v;
    out[i] = Math.max(-1, Math.min(1, prevOut));
  }
  progress?.(1);
  return { sampleRate, channels: [out] };
}
