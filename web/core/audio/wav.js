// WAV: чтение и запись PCM (8/16/24/32 бит) и float (32/64), включая WAVE_FORMAT_EXTENSIBLE.
// 8 бит в WAV беззнаковые (середина 128), остальные целые - знаковые little-endian.
import { checkAudio } from './util.js';

const PCM = 1, FLOAT = 3, EXTENSIBLE = 0xfffe;
const MAX_CHANNELS = 8;
// Раскладки по умолчанию для 1..8 каналов (моно, стерео, 3.0, квадро, 5.0, 5.1, 6.1, 7.1).
const CHANNEL_MASKS = [0x4, 0x3, 0x7, 0x33, 0x37, 0x3f, 0x13f, 0x63f];
// Хвост GUID подформата KSDATAFORMAT_SUBTYPE_*: 0000xxxx-0000-0010-8000-00aa00389b71.
const GUID_TAIL = [0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71];

const fourcc = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

export function readWavHeader(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('bytes: Uint8Array expected');
  if (bytes.length < 12 || fourcc(bytes, 0) !== 'RIFF' || fourcc(bytes, 8) !== 'WAVE') throw new Error('WAV: not a RIFF/WAVE file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fmt = null, dataOffset = -1, dataSize = 0;
  for (let pos = 12; pos + 8 <= bytes.length;) {
    const id = fourcc(bytes, pos), size = view.getUint32(pos + 4, true), body = pos + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > bytes.length) throw new Error('WAV: broken fmt chunk');
      fmt = {
        formatTag: view.getUint16(body, true),
        channelCount: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
      if (fmt.formatTag === EXTENSIBLE) {
        if (size < 40 || body + 26 > bytes.length) throw new Error('WAV: broken extensible fmt chunk');
        fmt.formatTag = view.getUint16(body + 24, true);
      }
    } else if (id === 'data' && dataOffset < 0) {
      // Потоковые и обрезанные файлы пишут размер больше, чем есть на деле - берём сколько есть.
      dataOffset = body;
      dataSize = Math.min(size, bytes.length - body);
    }
    pos = body + size + (size & 1); // чанки выравниваются на чётную границу
  }
  if (!fmt) throw new Error('WAV: no fmt chunk');
  if (dataOffset < 0) throw new Error('WAV: no data chunk');
  const { formatTag, channelCount, sampleRate, bits } = fmt;
  const float = formatTag === FLOAT;
  if (formatTag !== PCM && !float) throw new Error(`WAV: unsupported format ${formatTag}`);
  if (float ? bits !== 32 && bits !== 64 : ![8, 16, 24, 32].includes(bits)) throw new Error(`WAV: unsupported ${bits}-bit ${float ? 'float' : 'PCM'}`);
  if (channelCount < 1 || channelCount > MAX_CHANNELS) throw new Error(`WAV: ${channelCount} channels not supported`);
  if (sampleRate < 1) throw new Error('WAV: bad sample rate');
  const frames = Math.floor(dataSize / (channelCount * (bits / 8)));
  return { sampleRate, channelCount, bits, float, formatTag, dataOffset, dataSize, frames, duration: frames / sampleRate };
}

export function decodeWav(bytes) {
  const h = readWavHeader(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = h.channelCount, step = h.bits / 8;
  const channels = Array.from({ length: n }, () => new Float32Array(h.frames));
  const read = sampleReader(view, h.bits, h.float);
  let p = h.dataOffset;
  for (let i = 0; i < h.frames; i++) {
    for (let c = 0; c < n; c++, p += step) channels[c][i] = read(p);
  }
  return { sampleRate: h.sampleRate, channels, bits: h.bits, float: h.float };
}

function sampleReader(view, bits, float) {
  if (float) return bits === 32 ? (p) => view.getFloat32(p, true) : (p) => view.getFloat64(p, true);
  if (bits === 8) return (p) => (view.getUint8(p) - 128) / 128;
  if (bits === 16) return (p) => view.getInt16(p, true) / 32768;
  if (bits === 24) {
    return (p) => {
      const v = view.getUint8(p) | (view.getUint8(p + 1) << 8) | (view.getInt8(p + 2) << 16);
      return v / 8388608;
    };
  }
  return (p) => view.getInt32(p, true) / 2147483648;
}

// Отсчёт -1..1 в целое со знаком на bits разрядов (с насыщением).
export function toInt(x, bits) {
  const s = 2 ** (bits - 1);
  const v = Math.round(x * s);
  return v >= s ? s - 1 : v < -s ? -s : v || 0; // || 0: NaN и -0 превращаем в 0
}

export function encodeWav(audio, { bits, float = false } = {}) {
  const len = checkAudio(audio);
  const n = audio.channels.length;
  bits ??= float ? 32 : 16;
  if (float ? bits !== 32 && bits !== 64 : ![8, 16, 24, 32].includes(bits)) throw new Error(`WAV: cannot write ${bits}-bit ${float ? 'float' : 'PCM'}`);
  if (n > MAX_CHANNELS) throw new Error(`WAV: ${n} channels not supported`);
  const rate = Math.round(audio.sampleRate);
  const step = bits / 8, dataSize = len * n * step, pad = dataSize & 1;
  // Как ffmpeg: больше двух каналов или целые больше 16 бит - WAVE_FORMAT_EXTENSIBLE.
  const ext = n > 2 || (!float && bits > 16);
  const fmtSize = ext ? 40 : float ? 18 : 16;
  const total = 12 + 8 + fmtSize + 8 + dataSize + pad;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  const tag = (o, s) => { for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i); };
  tag(0, 'RIFF'); view.setUint32(4, total - 8, true); tag(8, 'WAVE');
  tag(12, 'fmt '); view.setUint32(16, fmtSize, true);
  const code = float ? FLOAT : PCM;
  view.setUint16(20, ext ? EXTENSIBLE : code, true);
  view.setUint16(22, n, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * n * step, true);
  view.setUint16(32, n * step, true);
  view.setUint16(34, bits, true);
  if (fmtSize > 16) view.setUint16(36, fmtSize - 18, true); // cbSize
  if (ext) {
    view.setUint16(38, bits, true); // wValidBitsPerSample
    view.setUint32(40, CHANNEL_MASKS[n - 1], true);
    view.setUint16(44, code, true);
    out.set(GUID_TAIL, 46);
  }
  let p = 20 + fmtSize;
  tag(p, 'data'); view.setUint32(p + 4, dataSize, true);
  p += 8;
  const write = sampleWriter(view, bits, float);
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < n; c++, p += step) write(p, audio.channels[c][i]);
  }
  return out;
}

function sampleWriter(view, bits, float) {
  if (float) return bits === 32 ? (p, x) => view.setFloat32(p, x, true) : (p, x) => view.setFloat64(p, x, true);
  if (bits === 8) return (p, x) => view.setUint8(p, toInt(x, 8) + 128);
  if (bits === 16) return (p, x) => view.setInt16(p, toInt(x, 16), true);
  if (bits === 24) {
    return (p, x) => {
      const v = toInt(x, 24);
      view.setUint8(p, v & 0xff); view.setUint8(p + 1, (v >> 8) & 0xff); view.setInt8(p + 2, v >> 16);
    };
  }
  return (p, x) => view.setInt32(p, toInt(x, 32), true);
}
