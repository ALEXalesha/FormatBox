import test from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../../web/core/rand.js';
import { convertPcm, quantize, remapChannels, resample } from '../../web/core/audio/convert.js';
import { decodeWav, readWavHeader } from '../../web/core/audio/wav.js';
import { distinct, noise, sine } from './audio-fixtures.js';

const RATES = [8000, 11025, 16000, 22050, 32000, 44100, 48000, 88200, 96000];

function randomOpts(r) {
  const float = r() < 0.2;
  return {
    sampleRate: r.pick(RATES),
    float,
    bits: float ? r.pick([32, 64]) : r.pick([8, 16, 24, 32]),
    channels: r.pick([1, 2]),
    dither: r.pick(['none', 'tpdf', 'shaped']),
  };
}

function snrDb(ref, x, from, to) {
  let s = 0, e = 0;
  for (let i = from; i < to; i++) { s += ref[i] ** 2; e += (ref[i] - x[i]) ** 2; }
  return 10 * Math.log10(s / e);
}

test('закон: заголовок результата = выбранным битам, частоте и каналам; звук = декодированные байты (зерно 21)', () => {
  const r = rng(21);
  for (let round = 0; round < 40; round++) {
    const inCh = r.int(1, 6), rate = r.pick(RATES), frames = r.int(0, 400);
    const audio = { sampleRate: rate, channels: Array.from({ length: inCh }, (_, c) => noise(frames, round * 10 + c, 0.8)) };
    const opts = randomOpts(r);
    const { bytes, audio: out } = convertPcm(audio, opts);
    const h = readWavHeader(bytes);
    assert.deepEqual([h.sampleRate, h.bits, h.float, h.channelCount], [opts.sampleRate, opts.bits, opts.float, opts.channels]);
    assert.deepEqual(decodeWav(bytes).channels, out.channels);
    assert.equal(out.sampleRate, opts.sampleRate);
  }
});

test('закон: длительность сохраняется ±1 кадр (зерно 22)', () => {
  const r = rng(22);
  for (let round = 0; round < 40; round++) {
    const from = r.pick(RATES), to = r.pick(RATES);
    const frames = r.int(0, 3000);
    const { audio } = convertPcm({ sampleRate: from, channels: [noise(frames, round)] }, { sampleRate: to, bits: 16 });
    assert.ok(Math.abs(audio.channels[0].length - (frames * to) / from) <= 1, `${from} -> ${to}, ${frames} кадров`);
  }
});

test('закон: 8 бит - не больше 256 уровней, 16 бит - не больше 65536 (зерно 23)', () => {
  const r = rng(23);
  for (let round = 0; round < 6; round++) {
    const bits = round % 2 ? 16 : 8;
    const frames = bits === 8 ? 3000 : 70000;
    const audio = { sampleRate: 48000, channels: [noise(frames, round + 1, 1), noise(frames, round + 50, 1)] };
    const opts = { sampleRate: 48000, bits, channels: 2, dither: r.pick(['none', 'tpdf', 'shaped']) };
    const { bytes, audio: out } = convertPcm(audio, opts);
    const all = new Float32Array([...out.channels[0], ...out.channels[1]]);
    assert.ok(distinct(all) <= 2 ** bits, `${bits} бит: ${distinct(all)} уровней`);
    assert.ok(distinct(all) > 2 ** bits / 2, 'уровни используются');
    assert.deepEqual(decodeWav(bytes).channels, out.channels);
  }
});

test('закон: тишина без дизеринга остаётся тишиной при любой частоте, разрядности и каналах (зерно 24)', () => {
  const r = rng(24);
  for (let round = 0; round < 30; round++) {
    const opts = { ...randomOpts(r), dither: 'none' };
    const frames = r.int(1, 2000);
    const audio = { sampleRate: r.pick(RATES), channels: Array.from({ length: r.int(1, 3) }, () => new Float32Array(frames)) };
    const { audio: out } = convertPcm(audio, opts);
    for (const ch of out.channels) assert.ok(ch.every((v) => v === 0), JSON.stringify(opts));
  }
});

test('закон: синус после 44.1 -> 48 -> 44.1 кГц (16 бит) близок к исходному, SNR > 40 дБ (зерно 25)', () => {
  const r = rng(25);
  for (let round = 0; round < 8; round++) {
    const f = 50 + r() * 15000, amp = 0.1 + r() * 0.85;
    const x = sine(f, 0.25, 44100, amp, r() * 6);
    const dither = r.pick(['none', 'tpdf', 'shaped']);
    const up = convertPcm({ sampleRate: 44100, channels: [x] }, { sampleRate: 48000, bits: 16, dither }).audio;
    const back = convertPcm(up, { sampleRate: 44100, bits: 16, dither }).audio.channels[0];
    assert.equal(back.length, x.length);
    const snr = snrDb(x, back, 200, x.length - 200); // края - переходный процесс фильтра
    assert.ok(snr > 40, `${f.toFixed(0)} Гц: SNR ${snr.toFixed(1)} дБ`);
  }
});

test('закон: вход не меняется, результат - новые массивы (зерно 26)', () => {
  const r = rng(26);
  for (let round = 0; round < 20; round++) {
    const rate = r.pick(RATES);
    const audio = { sampleRate: rate, channels: [noise(500, round), noise(500, round + 9)] };
    const copy = audio.channels.map((c) => c.slice());
    const opts = { ...randomOpts(r), channels: 2, float: round % 2 === 0, bits: round % 2 === 0 ? 32 : 16 };
    if (r() < 0.5) opts.sampleRate = rate;
    const { audio: out } = convertPcm(audio, opts);
    assert.deepEqual(audio.channels, copy);
    for (const ch of out.channels) assert.ok(!audio.channels.includes(ch), 'результат не делит память со входом');
  }
});

test('пересчёт частоты гасит то, что выше новой частоты Найквиста (антиалиасинг)', () => {
  const x = sine(7000, 0.2, 44100, 0.8);
  const y = resample(x, 44100, 8000);
  let e = 0;
  for (let i = 100; i < y.length - 100; i++) e += y[i] ** 2;
  assert.ok(Math.sqrt(e / (y.length - 200)) < 0.01, 'тон 7 кГц не отражается в 1 кГц');
  const low = resample(sine(500, 0.2, 44100, 0.8), 44100, 8000);
  assert.ok(snrDb(sine(500, 0.2, 8000, 0.8), low, 100, low.length - 100) > 40);
  assert.deepEqual(resample(x, 44100, 44100), x);
  assert.notEqual(resample(x, 44100, 44100), x);
  assert.throws(() => resample(x, 0, 8000), /sample rate/);
  // Частоты без общего делителя: фаз больше 4096 - работает через ближайшую фазу.
  const odd = resample(sine(440, 0.1, 44101, 0.5), 44101, 47999);
  assert.ok(snrDb(sine(440, 0.1, 47999, 0.5), odd, 200, odd.length - 200) > 60);
});

test('каналы: стерео -> моно среднее, моно -> стерео копия, 5.1 -> стерео', () => {
  const a = Float32Array.of(1, 0), b = Float32Array.of(0, 1);
  assert.deepEqual(remapChannels([a, b], 1), [Float32Array.of(0.5, 0.5)]);
  assert.deepEqual(remapChannels([a], 2), [a, a]);
  const six = Array.from({ length: 6 }, (_, c) => Float32Array.of(c));
  const [l, r] = remapChannels(six, 2);
  assert.deepEqual([l[0], r[0]], [(0 + 2 + 4) / 3, (1 + 3 + 5) / 3]);
  assert.deepEqual(remapChannels([a, b], 2), [a, b]);
  const { audio } = convertPcm({ sampleRate: 8000, channels: six.map((c) => new Float32Array(10).fill(c[0] / 10)) });
  assert.equal(audio.channels.length, 6, 'без channels - как было');
});

test('дизеринг: shaped уводит шум квантования в верха, tpdf - ровный', () => {
  const x = sine(200, 0.5, 44100, 0.3);
  const lowBand = (q) => {
    // Сумма ошибки по 16 соседним отсчётам - грубый ФНЧ: у shaped ошибка - разность, сумма телескопируется.
    const e = Float64Array.from(q, (v, i) => v - x[i]);
    let s = 0;
    for (let i = 16; i < e.length; i++) { let w = 0; for (let k = 0; k < 16; k++) w += e[i - k]; s += w * w; }
    return s;
  };
  const tpdf = lowBand(quantize(x, 8, 'tpdf', 3)), shaped = lowBand(quantize(x, 8, 'shaped', 3));
  assert.ok(shaped < tpdf / 3, `${shaped} < ${tpdf}/3`);
  assert.throws(() => quantize(x, 8, 'pink'), /dither/);
  assert.deepEqual(quantize(x, 8, 'tpdf', 5), quantize(x, 8, 'tpdf', 5), 'зерно - тот же результат');
});

test('ошибки параметров, float 64, отмена и прогресс', () => {
  const audio = { sampleRate: 44100, channels: [sine(440, 0.05, 44100)] };
  assert.throws(() => convertPcm(audio, { sampleRate: 7999 }), /sampleRate/);
  assert.throws(() => convertPcm(audio, { sampleRate: 96001 }), /sampleRate/);
  assert.throws(() => convertPcm(audio, { sampleRate: 22050.5 }), /sampleRate/);
  assert.throws(() => convertPcm(audio, { channels: 3 }), /channels/);
  assert.throws(() => convertPcm(audio, { bits: 12 }), /bits/);
  assert.throws(() => convertPcm(audio, { float: true, bits: 16 }), /bits/);
  assert.throws(() => convertPcm(audio, { dither: 'pink' }), /dither/);
  assert.throws(() => convertPcm({ sampleRate: 0, channels: [] }), /audio/);
  const f64 = convertPcm(audio, { float: true, bits: 64 });
  assert.equal(readWavHeader(f64.bytes).bits, 64);
  assert.deepEqual(decodeWav(f64.bytes).channels, f64.audio.channels);
  const def = convertPcm(audio);
  assert.deepEqual([readWavHeader(def.bytes).bits, def.audio.sampleRate], [16, 44100]);
  const seen = [];
  convertPcm({ sampleRate: 44100, channels: [audio.channels[0], audio.channels[0]] }, { sampleRate: 48000 }, { progress: (v) => seen.push(v) });
  assert.deepEqual(seen, [0.5, 1, 1]);
  const ctl = new AbortController();
  ctl.abort();
  assert.throws(() => convertPcm(audio, {}, { signal: ctl.signal }), /canceled/);
  let calls = 0;
  const signal = { get aborted() { calls += 1; return calls > 3; } };
  assert.throws(() => convertPcm({ sampleRate: 44100, channels: [noise(20000, 1)] }, { sampleRate: 48000 }, { signal }), /canceled/);
});
