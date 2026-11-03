import test from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../../web/core/rand.js';
import { detectNotes, detectOnsets, estimateTempo, trackPitch } from '../../web/core/audio/pitch.js';
import { hzToMidi, median } from '../../web/core/audio/util.js';
import { makeSong, noise, pitchAccuracy, sine } from './audio-fixtures.js';

// Периодический сигнал с гармониками: синус, пила, квадрат.
function tone(kind, f, seconds, sampleRate, amp = 0.5) {
  const n = Math.round(seconds * sampleRate);
  return Float32Array.from({ length: n }, (_, i) => {
    let s = 0;
    for (let h = 1; h * f < sampleRate / 2 && h <= (kind === 'sine' ? 1 : 15); h++) {
      if (kind === 'square' && h % 2 === 0) continue;
      s += Math.sin(2 * Math.PI * h * f * (i / sampleRate)) / h;
    }
    return amp * s;
  });
}

function clicks(times, seconds, sampleRate, seed) {
  const x = new Float32Array(Math.round(seconds * sampleRate));
  const r = rng(seed);
  for (const t of times) {
    const a = Math.round(t * sampleRate);
    for (let i = 0; i < 0.04 * sampleRate && a + i < x.length; i++) x[a + i] += 0.6 * Math.exp(-i / (0.008 * sampleRate)) * (2 * r() - 1);
  }
  return x;
}

test('закон: YIN находит основной тон синуса, пилы и квадрата без ошибок в октаву (зерно 51)', () => {
  const r = rng(51);
  for (let round = 0; round < 40; round++) {
    const kind = r.pick(['sine', 'saw', 'square']), sampleRate = r.pick([16000, 22050, 44100]);
    const f = 70 * 2 ** (r() * 4); // 70..1120 Гц
    const x = tone(kind, f, 0.25, sampleRate, 0.1 + r() * 0.8);
    const { f0, times, clarity } = trackPitch(x, sampleRate, { fmin: 60, fmax: 1500 });
    assert.ok(f0.length > 5 && times[1] > times[0]);
    assert.ok(f0.every((v) => v > 0), `${kind} ${f.toFixed(1)} Гц: все кадры с тоном`);
    const err = Math.max(...Array.from(f0, (v) => Math.abs(hzToMidi(v) - hzToMidi(f))));
    assert.ok(err < 0.1, `${kind} ${f.toFixed(1)} Гц при ${sampleRate}: ошибка ${err.toFixed(3)} полутона`);
    assert.ok(median(clarity) > 0.8);
  }
});

test('закон: шум и тишина - без тона (зерно 52)', () => {
  const r = rng(52);
  for (let round = 0; round < 10; round++) {
    const x = noise(8000, r.int(1, 1e6), 0.5);
    const { f0 } = trackPitch(x, 16000, { threshold: 0.1 });
    assert.ok(f0.filter((v) => v > 0).length <= f0.length * 0.1, 'шум почти без тона');
  }
  const silent = trackPitch(new Float32Array(4000), 16000);
  assert.ok(silent.f0.every((v) => v === 0));
  assert.equal(trackPitch(new Float32Array(10), 16000).f0.length, 0);
});

test('закон: атаки находятся с точностью 15 мс, лишних нет (зерно 53)', () => {
  const r = rng(53);
  for (let round = 0; round < 25; round++) {
    const sampleRate = r.pick([16000, 22050, 44100]);
    const times = [];
    for (let t = 0.05 + r() * 0.2; t < 2.8; t += 0.1 + r() * 0.4) times.push(t);
    const found = detectOnsets(clicks(times, 3, sampleRate, round), sampleRate);
    assert.equal(found.length, times.length, `раунд ${round}`);
    found.forEach((t, i) => assert.ok(Math.abs(t - times[i]) < 0.015, `${t} против ${times[i]}`));
  }
});

test('закон: темп по щелчкам на долях - ±2 % (зерно 54)', () => {
  const r = rng(54);
  for (let round = 0; round < 25; round++) {
    const bpm = 70 + r() * 110, sampleRate = r.pick([16000, 22050]);
    const beat = 60 / bpm, start = r() * beat;
    const times = [];
    for (let t = start; t < 8; t += beat) times.push(t);
    const x = clicks(times, 8, sampleRate, round);
    const tempo = estimateTempo(x, sampleRate);
    assert.ok(Math.abs(tempo / bpm - 1) < 0.02, `${bpm.toFixed(1)} -> ${tempo.toFixed(1)}`);
  }
});

test('закон: ноты мелодии без аккомпанемента - высота >= 90 % точно, длительности близки (зерно 55)', () => {
  for (let seed = 55; seed < 61; seed++) {
    const song = makeSong(seed, { sampleRate: 16000, bass: false, drums: false, beats: 12 });
    const notes = detectNotes(song.audio.channels[0], 16000, { fmin: 150, fmax: 2000 });
    assert.ok(pitchAccuracy(song.melody, notes) >= 0.9, `зерно ${seed}`);
    assert.ok(Math.abs(notes.length - song.melody.length) <= song.melody.length * 0.2, `${notes.length} нот из ${song.melody.length}`);
    for (const n of notes) {
      assert.ok(Number.isInteger(n.midi) && n.vel >= 1 && n.vel <= 127 && n.dur > 0 && n.start >= 0);
    }
  }
});

test('повтор одной ноты режется по атаке, удар поверх тянущейся ноты - нет', () => {
  const sr = 16000;
  const note = (dur) => Float32Array.from(tone('saw', 440, dur, sr, 0.4), (v, i) => v * Math.min(1, i / 80, (dur * sr - i) / 400));
  const twice = new Float32Array([...note(0.4), ...note(0.4)]);
  const rep = detectNotes(twice, sr);
  assert.deepEqual(rep.map((n) => n.midi), [69, 69]);
  assert.ok(Math.abs(rep[1].start - 0.4) < 0.03);
  const long = note(0.8);
  const hit = clicks([0.4], 0.8, sr, 9);
  const withHit = long.map((v, i) => v + hit[i]);
  assert.deepEqual(detectNotes(withHit, sr).map((n) => n.midi), [69]);
  // Скольжение-сбой на 1 кадр не делает новую ноту; пауза длиннее 50 мс - делает.
  const gap = new Float32Array([...note(0.3), ...new Float32Array(sr * 0.1), ...note(0.3)]);
  assert.equal(detectNotes(gap, sr, { onsets: [] }).length, 2);
  const blip = long.slice();
  blip.set(tone('sine', 1300, 0.012, sr, 0.8), Math.round(0.4 * sr));
  assert.deepEqual(detectNotes(blip, sr, { onsets: [] }).map((n) => n.midi), [69]);
  assert.deepEqual(detectNotes(note(0.04), sr), [], 'слишком короткая');
  assert.deepEqual(detectNotes(new Float32Array(sr), sr), []);
});

test('темп: короткий сигнал и тишина - 0; отмена и прогресс трекинга', () => {
  assert.equal(estimateTempo(new Float32Array(100), 16000), 0);
  assert.equal(estimateTempo(new Float32Array(16000 * 3), 16000), 0);
  const x = sine(220, 1, 16000);
  const seen = [];
  trackPitch(x, 16000, {}, { progress: (v) => seen.push(v) });
  assert.equal(seen.at(-1), 1);
  assert.ok(seen.length > 1);
  const ctl = new AbortController();
  ctl.abort();
  assert.throws(() => trackPitch(x, 16000, {}, { signal: ctl.signal }), /canceled/);
  assert.throws(() => detectOnsets(x, 16000, {}, { signal: ctl.signal }), /canceled/);
  const stages = [];
  detectNotes(x, 16000, {}, { progress: (v) => stages.push(v) });
  assert.ok(stages.every((v) => v <= 1) && stages.at(-1) === 1);
});
