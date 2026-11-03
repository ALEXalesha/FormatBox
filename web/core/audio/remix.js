// «Переиграть» запись на приставке: расшифровка в ноты (мелодия, бас, барабаны) и озвучка синтезом NES.
// Без нейросети: мелодия - YIN по сигналу выше 250 Гц, бас - YIN после ФНЧ 200 Гц (8-й порядок: мелодия
// от 250 Гц не просачивается) на частоте 4 кГц и со сворачиванием в басовый диапазон по октавам,
// барабаны - атаки в полосе выше 4 кГц. Если передан separator(audio) -> { melody, bass, drums }
// (готовые дорожки, например от модели разделения), работаем по ним.
import { checkAudio, checkSignal, filter, mixdown } from './util.js';
import { detectNotes, detectOnsets, estimateTempo } from './pitch.js';
import { resample } from './convert.js';
import { renderChannels } from './synth.js';

export const PREVIEW_SECONDS = 10;
const PARTS = {
  melody: { wave: 'pulse', duty: 0.5 },
  bass: { wave: 'triangle' },
  drums: { wave: 'noise' },
};
const BASS_RATE = 4000; // басу хватает 2 кГц полосы - YIN в 10 раз быстрее
const BASS_RANGE = [28, 55]; // MIDI: E1..G3 - сюда сворачиваем октавные ошибки баса

const trackOf = (source) => (source instanceof Float32Array ? source : mixdown(source));

// Бас: ноты вне диапазона (октавные ошибки YIN - гармоника вместо основного тона или двойной период)
// сворачиваем в диапазон по октавам. Скачки внутри диапазона не трогаем - басовые ходы на октаву бывают.
export function foldBass(notes, [lo, hi] = BASS_RANGE) {
  return notes.map((n) => {
    let midi = n.midi;
    while (midi > hi) midi -= 12;
    while (midi < lo) midi += 12;
    return { ...n, midi };
  });
}

// Удары: каждая атака - короткий шум; период шума по яркости (доля энергии выше 4 кГц).
function drumNotes(band, full, sampleRate) {
  const onsets = detectOnsets(band, sampleRate, { minGap: 0.07 });
  const win = Math.round(sampleRate * 0.03);
  return onsets.map((t, k) => {
    const a = Math.round(t * sampleRate);
    let eb = 0, ef = 1e-12, peak = 0;
    for (let i = a; i < Math.min(band.length, a + win); i++) {
      eb += band[i] ** 2; ef += full[i] ** 2; peak = Math.max(peak, Math.abs(full[i]));
    }
    const bright = Math.min(1, eb / ef);
    const nextT = onsets[k + 1] ?? Infinity;
    return {
      midi: Math.round(12 - bright * 10), // ярче - короче период шума (выше «тарелка»)
      start: t,
      dur: Math.min(0.12, nextT - t),
      vel: Math.max(1, Math.min(127, Math.round(peak * 127))),
    };
  });
}

export async function transcribe(audio, opts = {}, { signal, progress } = {}) {
  checkAudio(audio);
  const names = opts.channels ?? ['melody', 'bass', 'drums'];
  for (const name of names) if (!PARTS[name]) throw new Error(`channels: melody, bass or drums, got ${name}`);
  const sr = audio.sampleRate;
  const limit = Math.round((opts.previewSeconds ?? Infinity) * sr);
  let full = mixdown(audio);
  if (limit < full.length) full = full.slice(0, limit);
  const duration = full.length / sr;
  // Модели отдаём исходные каналы (стерео ей полезно), обрезанные до предпросмотра.
  const clip = { sampleRate: sr, channels: audio.channels.map((c) => c.subarray(0, full.length)) };
  const tracks = opts.separator ? await opts.separator(clip) : {};
  checkSignal(signal);
  const tempo = estimateTempo(full, sr, {}, { signal });
  const step = 1 / (names.length + 1);
  progress?.(step);
  const cache = {};
  const parts = { melody: melodyNotes, bass: bassNotes, drums: drumsOf };
  const channels = [];
  for (const [k, name] of names.entries()) {
    checkSignal(signal);
    const src = tracks[name] ? trackOf(tracks[name]) : null;
    cache[name] ??= parts[name](src, full, sr, { signal, progress: (v) => progress?.(step * (k + 1 + v)) });
    const { wave, duty } = PARTS[name];
    // Повторная мелодия звучит другой скважностью, чтобы каналы не сливались.
    const ch = { name, wave, notes: cache[name].map((n) => ({ ...n })) };
    if (wave === 'pulse') ch.duty = channels.some((c) => c.wave === 'pulse') ? 0.25 : duty;
    channels.push(ch);
  }
  progress?.(1);
  return { tempo, duration, channels };
}

function melodyNotes(src, full, sr, ctl) {
  const x = src ?? filter(full, 'highpass', 250, sr, 4);
  return detectNotes(x, sr, { fmin: 150, fmax: 2000 }, ctl);
}

function bassNotes(src, full, sr, ctl) {
  const low = filter(src ?? full, 'lowpass', 200, sr, 8);
  const rate = Math.min(sr, BASS_RATE);
  const x = resample(low, sr, rate, {}, ctl);
  return foldBass(detectNotes(x, rate, { fmin: 35, fmax: 260, minDur: 0.08 }, ctl));
}

function drumsOf(src, full, sr) {
  return drumNotes(src ?? filter(full, 'highpass', 4000, sr, 4), full, sr);
}

// Озвучка партитуры. previewSeconds - только начало (для предпросмотра, по умолчанию весь трек).
export function renderChip(score, { sampleRate = 44100, previewSeconds } = {}, ctl = {}) {
  const duration = Math.min(score.duration, previewSeconds ?? Infinity);
  const channels = score.channels.map((c) => ({
    wave: c.wave, duty: c.duty, mode: c.mode, envelope: c.envelope,
    notes: c.notes.filter((n) => n.start < duration),
  }));
  return renderChannels(channels, { sampleRate, duration }, ctl);
}
