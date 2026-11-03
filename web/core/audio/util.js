// Общие мелочи звуковой части: проверка звука, сведение в моно, фильтры, БПФ, ноты.
// Звук везде один: { sampleRate, channels: Float32Array[] }, значения -1..1.

export function checkSignal(signal) {
  if (signal?.aborted) throw new Error('canceled');
}

export function checkAudio(audio) {
  if (!audio || !(audio.sampleRate > 0) || !Array.isArray(audio.channels) || audio.channels.length === 0) {
    throw new TypeError('audio: { sampleRate, channels: Float32Array[] } expected');
  }
  const len = audio.channels[0].length;
  for (const ch of audio.channels) {
    if (!(ch instanceof Float32Array) || ch.length !== len) throw new TypeError('audio: channels must be Float32Array of equal length');
  }
  return len;
}

// Среднее по каналам - новый массив, вход не трогаем.
export function mixdown(audio) {
  const len = checkAudio(audio);
  const out = new Float32Array(len);
  const k = 1 / audio.channels.length;
  for (const ch of audio.channels) for (let i = 0; i < len; i++) out[i] += ch[i] * k;
  return out;
}

export const midiToHz = (midi) => 440 * 2 ** ((midi - 69) / 12);
export const hzToMidi = (hz) => 69 + 12 * Math.log2(hz / 440);

// Биквад по формулам RBJ (Audio EQ Cookbook).
export function biquad(type, freq, sampleRate, q = Math.SQRT1_2) {
  const w = (2 * Math.PI * freq) / sampleRate;
  const cos = Math.cos(w), alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b1 = type === 'lowpass' ? 1 - cos : -(1 + cos);
  const b0 = Math.abs(b1) / 2;
  return { b0: b0 / a0, b1: b1 / a0, b2: b0 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

// Каскад биквадов (order - чётный порядок: 2, 4, 6...). Батерворт по Q звеньев.
export function filter(samples, type, freq, sampleRate, order = 4) {
  let out = Float32Array.from(samples);
  const n = order / 2;
  for (let s = 0; s < n; s++) {
    const q = 1 / (2 * Math.cos((Math.PI * (2 * s + 1)) / (4 * n)));
    const { b0, b1, b2, a1, a2 } = biquad(type, freq, sampleRate, q);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < out.length; i++) {
      const x = out[i];
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      out[i] = y;
    }
  }
  return out;
}

export const nextPow2 = (n) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

// БПФ по основанию 2 на месте; inverse - без деления на n.
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (sign * 2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

export function median(list) {
  const s = Array.from(list).sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
