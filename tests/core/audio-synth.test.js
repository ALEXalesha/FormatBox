import test from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../../web/core/rand.js';
import { DUTIES, envelopeLevel, nesFrequency, noiseSequence, renderChannel, renderChannels, songLength } from '../../web/core/audio/synth.js';
import { midiToHz } from '../../web/core/audio/util.js';
import { distinct } from './audio-fixtures.js';

// Частота по числу переходов 0 -> не 0 (по одному за период).
function risingEdges(x) {
  let n = 0;
  for (let i = 1; i < x.length; i++) if (x[i] > 0 && x[i - 1] === 0) n += 1;
  return n;
}

test('закон: импульсный канал - доля «включённых» отсчётов = скважности, частота = таймеру NES (зерно 41)', () => {
  const r = rng(41);
  for (let round = 0; round < 40; round++) {
    const duty = r.pick(DUTIES), midi = r.int(45, 84), sampleRate = r.pick([44100, 48000, 96000]);
    const ch = { wave: 'pulse', duty, envelope: { sustain: 1, decay: 0 }, notes: [{ midi, start: 0, dur: 1, vel: 127 }] };
    const x = renderChannel(ch, { sampleRate });
    const on = x.filter((v) => v > 0).length / x.length;
    assert.ok(Math.abs(on - duty) < 0.02, `скважность ${duty}: ${on}`);
    assert.ok(x.every((v) => v === 0 || v === 15));
    const f = nesFrequency(midi, 'pulse');
    assert.ok(Math.abs(risingEdges(x) - f) <= 2, `${midi}: ${risingEdges(x)} против ${f}`);
    assert.ok(Math.abs(Math.log2(f / midiToHz(midi)) * 12) < 0.1, 'таймер почти не сбивает строй');
  }
});

test('закон: треугольник - 16 ступеней по 4 бита, 32 шага за период (зерно 42)', () => {
  const r = rng(42);
  for (let round = 0; round < 20; round++) {
    const midi = r.int(30, 70), sampleRate = 96000;
    const x = renderChannel({ wave: 'triangle', notes: [{ midi, start: 0, dur: 0.5, vel: r.int(1, 127) }] }, { sampleRate });
    assert.ok(x.every((v) => Number.isInteger(v) && v >= 0 && v <= 15));
    assert.equal(distinct(x), 16);
    let mins = 0; // ступень 0 встречается раз за период (два шага подряд)
    for (let i = 1; i < x.length; i++) if (x[i] === 0 && x[i - 1] !== 0) mins += 1;
    const f = nesFrequency(midi, 'triangle');
    assert.ok(Math.abs(mins - f * 0.5) <= 2, `${mins} против ${f * 0.5}`);
  }
});

test('закон: LFSR шума - длинный режим период 32767, короткий 93', () => {
  for (const [mode, period] of [['long', 32767], ['short', 93]]) {
    const s = noiseSequence(mode, period * 2 + 5);
    for (let i = 0; i < period + 5; i++) assert.equal(s[i + period], s[i]);
    // Меньшего периода нет.
    for (const p of [1, 3, 7, 31, 151, 4681].filter((d) => d < period)) assert.ok(s.subarray(0, period).some((v, i) => v !== s[i + p]), `${mode}: период ${p}`);
  }
  const ones = noiseSequence('long').reduce((a, b) => a + b, 0);
  assert.equal(ones, 16384, 'm-последовательность: единиц на одну больше, чем нулей');
});

test('закон: шум - уровни только 0 и громкость огибающей, короткий режим звучит периодично (зерно 43)', () => {
  const r = rng(43);
  for (let round = 0; round < 10; round++) {
    const mode = r.pick(['long', 'short']), period = r.int(0, 15);
    const x = renderChannel({ wave: 'noise', mode, envelope: { decay: 0, sustain: 1 }, notes: [{ midi: period, start: 0, dur: 0.3, vel: 127 }] }, { sampleRate: 44100 });
    assert.deepEqual([...new Set(x)].sort((a, b) => a - b), [0, 15]);
  }
});

test('закон: микс - длина = duration·sampleRate, значения в -1..1, тишина без нот (зерно 44)', () => {
  const r = rng(44);
  for (let round = 0; round < 15; round++) {
    const channels = Array.from({ length: r.int(1, 5) }, () => ({
      wave: r.pick(['pulse', 'triangle', 'noise']),
      duty: r.pick(DUTIES),
      notes: Array.from({ length: r.int(0, 6) }, () => ({ midi: r.int(0, 90), start: r() * 2, dur: r() * 0.5, vel: r.int(1, 127) })),
    }));
    const sampleRate = r.pick([22050, 44100]);
    const duration = r() < 0.5 ? undefined : r() * 3;
    const out = renderChannels(channels, { sampleRate, duration });
    assert.equal(out.channels.length, 1);
    assert.equal(out.channels[0].length, Math.round((duration ?? songLength(channels)) * sampleRate));
    assert.ok(out.channels[0].every((v) => v >= -1 && v <= 1));
  }
  const silent = renderChannels([{ wave: 'pulse', notes: [] }], { duration: 0.1 });
  assert.ok(silent.channels[0].every((v) => v === 0));
});

test('огибающая: атака, спад, удержание, затухание, ступени 1/240 с', () => {
  const env = { attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.1 };
  assert.equal(envelopeLevel(env, 0.05, 1), 0.5);
  assert.equal(envelopeLevel(env, 0.2, 1), 0.75);
  assert.equal(envelopeLevel(env, 0.5, 1), 0.5);
  assert.ok(Math.abs(envelopeLevel(env, 1.05, 1) - 0.25) < 1e-12);
  assert.equal(envelopeLevel(env, 1.2, 1), 0);
  assert.equal(envelopeLevel({ ...env, release: 0 }, 1.01, 1), 0);
  const x = renderChannel({ wave: 'pulse', duty: 0.75, envelope: { attack: 0, decay: 0.5, sustain: 0, release: 0 }, notes: [{ midi: 60, start: 0, dur: 0.5 }] }, { sampleRate: 48000 });
  let steps = 0, prev = 15;
  for (const v of x) if (v > 0 && v !== prev) { assert.ok(v < prev, 'громкость не растёт'); steps += 1; prev = v; }
  assert.ok(steps >= 12 && steps <= 15, `${steps} ступеней громкости`);
});

test('канал одноголосый: следующая нота обрывает предыдущую; ноты сортируются', () => {
  const ch = { wave: 'pulse', envelope: { decay: 0, sustain: 1, release: 0.5 }, notes: [{ midi: 72, start: 0.1, dur: 0.1 }, { midi: 60, start: 0, dur: 1 }] };
  const x = renderChannel(ch, { sampleRate: 44100 });
  const a = x.subarray(0, 4410), b = x.subarray(4410, 8820);
  assert.ok(Math.abs(risingEdges(a) / 0.1 - nesFrequency(60, 'pulse')) < 15);
  assert.ok(Math.abs(risingEdges(b) / 0.1 - nesFrequency(72, 'pulse')) < 15);
  assert.equal(x.length, Math.round(1 * 44100));
  assert.equal(nesFrequency(127, 'pulse'), 1789773 / (16 * 9), 'выше таймера 8 не бывает');
  assert.equal(nesFrequency(0, 'triangle'), 1789773 / (32 * 2048));
});

test('ошибки, отмена, прогресс', () => {
  assert.throws(() => renderChannel({ wave: 'saw', notes: [] }), /wave/);
  assert.throws(() => renderChannel({ wave: 'pulse', duty: 0.3, notes: [] }), /duty/);
  const seen = [];
  renderChannels([{ wave: 'noise', notes: [{ midi: 3, start: 0, dur: 0.01 }] }], { sampleRate: 8000 }, { progress: (v) => seen.push(v) });
  assert.deepEqual(seen, [0.5, 1]);
  const ctl = new AbortController();
  ctl.abort();
  assert.throws(() => renderChannels([{ wave: 'pulse', notes: [] }], { duration: 1 }, { signal: ctl.signal }), /canceled/);
  assert.equal(renderChannels([]).channels[0].length, 0);
});
