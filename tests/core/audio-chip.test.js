import test from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../../web/core/rand.js';
import { CHIP_PRESETS, chipParams, chipify } from '../../web/core/audio/chip.js';
import { distinct, makeSong, noise, sine } from './audio-fixtures.js';

const PRESETS = Object.keys(CHIP_PRESETS);

function randomInput(r) {
  const sampleRate = r.pick([16000, 22050, 44100, 48000]);
  const frames = r.int(1, 4000);
  const channels = Array.from({ length: r.int(1, 3) }, (_, c) => {
    const x = r() < 0.5 ? noise(frames, r.int(1, 1e6), r()) : sine(50 + r() * 3000, frames / sampleRate, sampleRate, r());
    return x.length === frames ? x : Float32Array.from({ length: frames }, (_, i) => x[i] ?? 0);
  });
  return { sampleRate, channels };
}

function randomOpts(r) {
  const opts = { preset: r.pick(PRESETS) };
  if (r() < 0.5) opts.bits = r.int(1, 10);
  if (r() < 0.3) opts.holdRate = r.pick([4000, 8000, 11025, 30000, 96000]);
  if (r() < 0.3) opts.square = r();
  if (r() < 0.3) opts.mono = r() < 0.5;
  return opts;
}

test('закон: уровней в каждом канале не больше 2^bits пресета (зерно 31)', () => {
  const r = rng(31);
  for (let round = 0; round < 60; round++) {
    const opts = randomOpts(r);
    const out = chipify(randomInput(r), opts);
    const bits = chipParams(opts).bits;
    for (const ch of out.channels) assert.ok(distinct(ch) <= 2 ** bits, `${JSON.stringify(opts)}: ${distinct(ch)} > ${2 ** bits}`);
  }
  // Громкий сигнал занимает все уровни, но не больше.
  const loud = chipify({ sampleRate: 44100, channels: [noise(20000, 5, 1.2)] }, { preset: 'gameboy', square: 0 });
  assert.equal(distinct(loud.channels[0]), 16);
});

test('закон: длительность и частота сохраняются, каналы - по mono пресета (зерно 32)', () => {
  const r = rng(32);
  for (let round = 0; round < 40; round++) {
    const input = randomInput(r);
    const opts = randomOpts(r);
    const out = chipify(input, opts);
    assert.equal(out.sampleRate, input.sampleRate);
    assert.equal(out.channels.length, chipParams(opts).mono ? 1 : input.channels.length);
    for (const ch of out.channels) assert.ok(Math.abs(ch.length - input.channels[0].length) <= 1);
  }
});

test('закон: выборка с удержанием - значение меняется не чаще holdRate раз в секунду (зерно 33)', () => {
  const r = rng(33);
  for (let round = 0; round < 30; round++) {
    const sampleRate = r.pick([22050, 44100, 48000]), holdRate = r.int(2000, sampleRate - 1);
    const x = noise(r.int(100, 5000), round, 0.9);
    const y = chipify({ sampleRate, channels: [x] }, { preset: '16bit', holdRate, lowpass: 0 }).channels[0];
    let changes = 0;
    for (let i = 1; i < y.length; i++) if (y[i] !== y[i - 1]) changes += 1;
    assert.ok(changes <= Math.ceil((y.length * holdRate) / sampleRate), `${changes} смен при ${holdRate} Гц`);
  }
});

test('закон: квадратизация сохраняет знак и огибающую громкости (зерно 34)', () => {
  const r = rng(34);
  for (let round = 0; round < 20; round++) {
    const sampleRate = 44100, amp = 0.2 + r() * 0.7;
    const x = sine(100 + r() * 1500, 0.1, sampleRate, amp);
    const y = chipify({ sampleRate, channels: [x] }, { preset: '16bit', square: 1, lowpass: 0, holdRate: sampleRate }).channels[0];
    for (let i = 0; i < x.length; i++) {
      if (Math.abs(x[i]) > 0.01) assert.equal(Math.sign(y[i]), Math.sign(x[i]), `отсчёт ${i}`);
    }
    // После первого периода огибающая держится у амплитуды: квадрат почти той же громкости.
    const tail = y.subarray(2000);
    const peak = tail.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    assert.ok(Math.abs(peak - amp) < 0.01 && tail.every((v) => Math.abs(v) > amp * 0.5), `амплитуда ${amp}`);
  }
});

test('закон: вход не меняется (зерно 35)', () => {
  const r = rng(35);
  for (let round = 0; round < 15; round++) {
    const input = randomInput(r);
    const copy = input.channels.map((c) => c.slice());
    const out = chipify(input, randomOpts(r));
    assert.deepEqual(input.channels, copy);
    for (const ch of out.channels) assert.ok(!input.channels.includes(ch));
  }
});

test('16bit срезает верха, NES сводит в моно 7 бит, пресеты меняются параметрами', () => {
  const hi = sine(15000, 0.2, 44100, 0.5);
  const y = chipify({ sampleRate: 44100, channels: [hi] }, { preset: '16bit' }).channels[0];
  const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
  assert.ok(rms(y) < rms(hi) * 0.7, '15 кГц ослаблен');
  const lo = sine(300, 0.2, 44100, 0.5);
  assert.ok(rms(chipify({ sampleRate: 44100, channels: [lo] }, { preset: '16bit' }).channels[0]) > rms(lo) * 0.95);
  const song = makeSong(3, { beats: 4 }).audio;
  const nes = chipify({ sampleRate: song.sampleRate, channels: [song.channels[0], song.channels[0]] });
  assert.equal(nes.channels.length, 1);
  assert.ok(distinct(nes.channels[0]) <= 128);
  assert.deepEqual(chipParams({ preset: 'gameboy', bits: 2, lowpass: undefined }), { ...CHIP_PRESETS.gameboy, bits: 2 });
  assert.throws(() => chipParams({ preset: 'sega' }), /preset/);
  assert.throws(() => chipParams({ bits: 0 }), /bits/);
  assert.throws(() => chipParams({ bits: 2.5 }), /bits/);
  assert.throws(() => chipParams({ holdRate: 0 }), /holdRate/);
  assert.throws(() => chipParams({ square: 2 }), /square/);
  assert.throws(() => chipify({ sampleRate: 8000, channels: [] }), /audio/);
});

test('отмена и прогресс', () => {
  const input = { sampleRate: 22050, channels: [noise(1000, 1), noise(1000, 2)] };
  const seen = [];
  chipify(input, { preset: 'gameboy' }, { progress: (v) => seen.push(v) });
  assert.deepEqual(seen, [0.5, 1]);
  const ctl = new AbortController();
  ctl.abort();
  assert.throws(() => chipify(input, {}, { signal: ctl.signal }), /canceled/);
});
