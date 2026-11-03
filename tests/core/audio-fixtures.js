// Тестовые сигналы с зерном: синусы, мелодии из случайных нот (синус/пила/квадрат) с басом и шумовыми ударами.
import { rng } from '../../web/core/rand.js';
import { midiToHz } from '../../web/core/audio/util.js';

export function sine(freq, seconds, sampleRate, amp = 0.5, phase = 0) {
  const n = Math.round(seconds * sampleRate);
  return Float32Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * freq * (i / sampleRate) + phase));
}

export function noise(n, seed, amp = 0.5) {
  const r = rng(seed);
  return Float32Array.from({ length: n }, () => amp * (2 * r() - 1));
}

export const distinct = (arr) => new Set(arr).size;

// Волна с ограниченной полосой: гармоники только ниже частоты Найквиста.
function wave(kind, freq, sampleRate) {
  if (kind === 'sine') return (ph) => Math.sin(ph);
  const harm = [];
  for (let h = 1; h * freq < sampleRate * 0.45 && h <= 24; h++) {
    if (kind === 'square' && h % 2 === 0) continue;
    harm.push([h, (kind === 'square' ? 4 / Math.PI : 2 / Math.PI) / h * (kind === 'saw' && h % 2 === 0 ? -1 : 1)]);
  }
  return (ph) => { let s = 0; for (const [h, a] of harm) s += a * Math.sin(h * ph); return s; };
}

// Нота с огибающей: атака 5 мс, спад к 0.6 за 80 мс, затухание в последние 25 мс.
function addNote(out, sampleRate, { midi, start, dur }, kind, amp) {
  const f = midiToHz(midi), w = wave(kind, f, sampleRate);
  const a = Math.round(start * sampleRate), n = Math.round(dur * sampleRate);
  for (let i = 0; i < n && a + i < out.length; i++) {
    const t = i / sampleRate;
    let env = t < 0.005 ? t / 0.005 : Math.max(0.6, 1 - (0.4 * (t - 0.005)) / 0.08);
    env *= Math.min(1, (dur - t) / 0.025);
    out[a + i] += amp * env * w(2 * Math.PI * f * t);
  }
}

export function makeSong(seed, { sampleRate = 22050, beats = 16, drums = true, bass = true } = {}) {
  const r = rng(seed);
  const tempo = r.int(90, 150);
  const beat = 60 / tempo;
  const duration = beats * beat;
  const kind = r.pick(['sine', 'saw', 'square']);
  const melody = [];
  for (let b = 0; b < beats;) {
    const len = Math.min(beats - b, r.pick([0.5, 1, 1, 1.5, 2]));
    melody.push({ midi: r.int(60, 81), start: b * beat, dur: len * beat });
    b += len;
  }
  const bassNotes = [];
  for (let b = 0; b < beats; b += 2) bassNotes.push({ midi: r.int(33, 50), start: b * beat, dur: 2 * beat });
  const out = new Float32Array(Math.round(duration * sampleRate));
  const amp = kind === 'sine' ? 0.4 : 0.25;
  for (const n of melody) addNote(out, sampleRate, n, kind, amp);
  if (bass) for (const n of bassNotes) addNote(out, sampleRate, n, 'sine', 0.3);
  const hits = [];
  if (drums) {
    const nr = rng(seed + 1000);
    for (let b = 0; b < beats; b++) {
      hits.push(b * beat);
      const a = Math.round(b * beat * sampleRate);
      for (let i = 0; i < 0.08 * sampleRate && a + i < out.length; i++) out[a + i] += 0.35 * Math.exp(-i / (0.025 * sampleRate)) * (2 * nr() - 1);
    }
  }
  return { audio: { sampleRate, channels: [out] }, tempo, duration, kind, melody, bass: bassNotes, hits };
}

// Доля нот-эталонов, у которых в середине звучит найденная нота с тем же MIDI-номером.
export function pitchAccuracy(truth, found) {
  let ok = 0;
  for (const n of truth) {
    const mid = n.start + n.dur / 2;
    const hit = found.find((m) => m.start <= mid && m.start + m.dur >= mid);
    if (hit && hit.midi === n.midi) ok += 1;
  }
  return ok / truth.length;
}
