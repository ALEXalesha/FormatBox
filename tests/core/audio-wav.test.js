import test from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../../web/core/rand.js';
import { decodeWav, encodeWav, readWavHeader, toInt } from '../../web/core/audio/wav.js';

const FORMATS = [[8, false], [16, false], [24, false], [32, false], [32, true], [64, true]];

function randomAudio(r, { channels = r.int(1, 8), frames = r.int(0, 300), sampleRate = r.pick([8000, 22050, 44100, 48000, 96000]) } = {}) {
  return { sampleRate, channels: Array.from({ length: channels }, () => Float32Array.from({ length: frames }, () => r() * 2 - 1)) };
}

// Ручная сборка WAV: чанки как есть, нечётные дополняются нулём.
function riff(chunks) {
  const parts = [];
  for (const [id, body] of chunks) {
    const head = new Uint8Array(8);
    for (let i = 0; i < 4; i++) head[i] = id.charCodeAt(i);
    new DataView(head.buffer).setUint32(4, body.length, true);
    parts.push(head, body);
    if (body.length & 1) parts.push(new Uint8Array(1));
  }
  const size = parts.reduce((s, p) => s + p.length, 4);
  const out = new Uint8Array(8 + size);
  out.set([82, 73, 70, 70]); new DataView(out.buffer).setUint32(4, size, true); out.set([87, 65, 86, 69], 8);
  let o = 12;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function fmtChunk({ tag = 1, channels = 1, rate = 8000, bits = 16, ext = null }) {
  const body = new Uint8Array(ext === null ? 16 : 40);
  const v = new DataView(body.buffer);
  v.setUint16(0, ext === null ? tag : 0xfffe, true); v.setUint16(2, channels, true); v.setUint32(4, rate, true);
  v.setUint32(8, (rate * channels * bits) / 8, true); v.setUint16(12, (channels * bits) / 8, true); v.setUint16(14, bits, true);
  if (ext !== null) { v.setUint16(16, 22, true); v.setUint16(18, bits, true); v.setUint32(20, 3, true); v.setUint16(24, ext, true); }
  return body;
}

test('закон: decode(encode(звук)) = звук с точностью до шага квантования, заголовок совпадает (зерно 11)', () => {
  const r = rng(11);
  for (let round = 0; round < 120; round++) {
    const audio = randomAudio(r);
    const [bits, float] = r.pick(FORMATS);
    const bytes = encodeWav(audio, { bits, float });
    const h = readWavHeader(bytes);
    assert.deepEqual([h.sampleRate, h.channelCount, h.bits, h.float, h.frames], [audio.sampleRate, audio.channels.length, bits, float, audio.channels[0].length]);
    const back = decodeWav(bytes);
    assert.equal(back.channels.length, audio.channels.length);
    for (let c = 0; c < audio.channels.length; c++) {
      for (let i = 0; i < audio.channels[c].length; i++) {
        const x = audio.channels[c][i];
        const want = float ? x : toInt(x, bits) / 2 ** (bits - 1);
        assert.equal(back.channels[c][i], Math.fround(want), `${bits} бит, канал ${c}, отсчёт ${i}`);
        assert.ok(Math.abs(back.channels[c][i] - x) <= 2 ** (1 - bits) + 1e-7);
      }
    }
  }
});

test('закон: encode(decode(файл)) = файл байт в байт (зерно 12)', () => {
  const r = rng(12);
  for (let round = 0; round < 60; round++) {
    const [bits, float] = r.pick(FORMATS);
    const bytes = encodeWav(randomAudio(r), { bits, float });
    const copy = bytes.slice();
    const again = encodeWav(decodeWav(bytes), { bits, float });
    assert.deepEqual(again, bytes);
    assert.deepEqual(bytes, copy, 'вход не изменился');
  }
});

test('закон: чужие чанки любой длины (и нечётной) не мешают, данные те же (зерно 13)', () => {
  const r = rng(13);
  for (let round = 0; round < 80; round++) {
    const channels = r.int(1, 4), bits = r.pick([8, 16, 24]), frames = r.int(1, 33);
    const data = r.bytes((frames * channels * bits) / 8);
    const junk = () => [r.pick(['LIST', 'junk', 'bext', 'id3 ', 'smpl']), r.bytes(r.int(0, 9))];
    const fmt = ['fmt ', fmtChunk({ channels, bits, rate: 11025 })];
    const plain = decodeWav(riff([fmt, ['data', data]]));
    const before = Array.from({ length: r.int(0, 3) }, junk), between = Array.from({ length: r.int(0, 3) }, junk), after = Array.from({ length: r.int(0, 2) }, junk);
    const messy = decodeWav(riff([...before, fmt, ...between, ['data', data], ...after]));
    assert.deepEqual(messy, plain);
    assert.equal(plain.channels[0].length, frames);
  }
});

test('8 бит беззнаковые: тишина - байт 128, -1 - байт 0, почти +1 - байт 255', () => {
  const bytes = encodeWav({ sampleRate: 8000, channels: [Float32Array.of(0, -1, 0.999, 2, -3, NaN)] }, { bits: 8 });
  assert.deepEqual([...bytes.subarray(44, 50)], [128, 0, 255, 255, 0, 128]);
  assert.equal(bytes.length, 44 + 6);
  const back = decodeWav(bytes).channels[0];
  assert.deepEqual([...back], [0, -1, 127 / 128, 127 / 128, -1, 0]);
});

test('24 бит: знак и порядок байт, нечётный размер данных дополнен байтом', () => {
  const bytes = riff([['fmt ', fmtChunk({ bits: 24, rate: 44100 })], ['data', Uint8Array.of(0xff, 0xff, 0xff, 0x00, 0x00, 0x80, 0xff, 0xff, 0x7f)]]);
  const { channels, bits, float, sampleRate } = decodeWav(bytes);
  assert.deepEqual([bits, float, sampleRate], [24, false, 44100]);
  assert.deepEqual([...channels[0]], [-1 / 8388608, -1, 8388607 / 8388608]);
  const enc = encodeWav({ sampleRate: 8000, channels: [new Float32Array(3)] }, { bits: 24 });
  assert.equal(enc.length % 2, 0);
  assert.equal(readWavHeader(enc).dataSize, 9);
});

test('EXTENSIBLE: float и PCM подформаты, маска каналов, много каналов', () => {
  const data = new Uint8Array(8);
  new DataView(data.buffer).setFloat32(0, 0.25, true); new DataView(data.buffer).setFloat32(4, -0.5, true);
  const f = decodeWav(riff([['fmt ', fmtChunk({ channels: 2, bits: 32, ext: 3 })], ['data', data]]));
  assert.equal(f.float, true);
  assert.deepEqual([f.channels[0][0], f.channels[1][0]], [0.25, -0.5]);
  const p = decodeWav(riff([['fmt ', fmtChunk({ channels: 1, bits: 16, ext: 1 })], ['data', Uint8Array.of(0, 0x40)]]));
  assert.deepEqual([...p.channels[0]], [0.5]);
  const six = encodeWav({ sampleRate: 48000, channels: Array.from({ length: 6 }, () => new Float32Array(2)) });
  const v = new DataView(six.buffer);
  assert.equal(v.getUint16(20, true), 0xfffe);
  assert.equal(v.getUint32(40, true), 0x3f);
  assert.equal(readWavHeader(six).formatTag, 1);
  const stereoFloat = encodeWav({ sampleRate: 8000, channels: [new Float32Array(1), new Float32Array(1)] }, { float: true });
  assert.equal(new DataView(stereoFloat.buffer).getUint16(20, true), 3);
  assert.equal(readWavHeader(stereoFloat).bits, 32);
});

test('обрезанный и потоковый файл: размер данных больше файла - читаем сколько есть', () => {
  const bytes = encodeWav({ sampleRate: 8000, channels: [Float32Array.of(0.5, -0.5, 0.25)] });
  new DataView(bytes.buffer).setUint32(40, 0xffffffff, true);
  const cut = bytes.slice(0, bytes.length - 1); // последний отсчёт обрезан наполовину
  const h = readWavHeader(cut);
  assert.equal(h.frames, 2);
  assert.equal(h.duration, 2 / 8000);
  assert.deepEqual([...decodeWav(cut).channels[0]], [0.5, -0.5]);
  const sub = new Uint8Array(bytes.length + 10);
  sub.set(bytes, 10);
  assert.equal(decodeWav(sub.subarray(10)).channels[0].length, 3, 'кусок большого буфера со смещением');
});

test('ошибки: не WAV, нет fmt/data, неподдерживаемые форматы и разрядности', () => {
  const fmt = (o) => ['fmt ', fmtChunk(o)];
  const d = ['data', new Uint8Array(4)];
  assert.throws(() => readWavHeader([1, 2, 3]), /Uint8Array/);
  assert.throws(() => decodeWav(new TextEncoder().encode('RIFF....AVI LIST')), /RIFF/);
  assert.throws(() => decodeWav(new Uint8Array(4)), /RIFF/);
  assert.throws(() => decodeWav(riff([d])), /no fmt/);
  assert.throws(() => decodeWav(riff([fmt({})])), /no data/);
  assert.throws(() => decodeWav(riff([['fmt ', new Uint8Array(14)], d])), /broken fmt/);
  assert.throws(() => decodeWav(riff([fmt({}), d]).slice(0, 30)), /broken fmt/);
  const shortExt = fmtChunk({}); new DataView(shortExt.buffer).setUint16(0, 0xfffe, true);
  assert.throws(() => decodeWav(riff([['fmt ', shortExt], d])), /extensible/);
  assert.throws(() => decodeWav(riff([fmt({ tag: 2 }), d])), /unsupported format 2/);
  assert.throws(() => decodeWav(riff([fmt({ bits: 12 }), d])), /12-bit PCM/);
  assert.throws(() => decodeWav(riff([fmt({ tag: 3, bits: 16 }), d])), /16-bit float/);
  assert.throws(() => decodeWav(riff([fmt({ channels: 9 }), d])), /9 channels/);
  assert.throws(() => decodeWav(riff([fmt({ channels: 0 }), d])), /0 channels/);
  assert.throws(() => decodeWav(riff([fmt({ rate: 0 }), d])), /sample rate/);
  const one = { sampleRate: 8000, channels: [new Float32Array(1)] };
  assert.throws(() => encodeWav(one, { bits: 12 }), /12-bit PCM/);
  assert.throws(() => encodeWav(one, { bits: 16, float: true }), /16-bit float/);
  assert.throws(() => encodeWav({ sampleRate: 8000, channels: Array.from({ length: 9 }, () => new Float32Array(1)) }), /9 channels/);
  assert.throws(() => encodeWav({ sampleRate: 8000, channels: [] }), /audio/);
  assert.throws(() => encodeWav({ sampleRate: 8000, channels: [new Float32Array(1), new Float32Array(2)] }), /equal length/);
  assert.throws(() => encodeWav({ sampleRate: 8000, channels: [[0]] }), /equal length/);
});
