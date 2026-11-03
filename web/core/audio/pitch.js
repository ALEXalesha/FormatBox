// Высота тона и ритм: YIN по кадрам (разностная функция через БПФ), атаки по росту
// логарифмической энергии, темп - автокорреляция огибающей атак, ноты - сегментация по высоте и атакам.
import { checkSignal, fft, hzToMidi, median, nextPow2 } from './util.js';


// Разностная функция YIN d(τ) = Σ (x_j - x_{j+τ})², j < win, через свёртку на БПФ - O(N log N) на кадр.
function yinFrame(x, start, win, tauMax, size, re, im, ar, ai, sq) {
  ar.fill(0); ai.fill(0); re.fill(0); im.fill(0);
  for (let j = 0; j < win + tauMax; j++) re[j] = x[start + j] || 0;
  for (let j = 0; j < win; j++) ar[j] = re[j];
  sq[0] = 0;
  for (let j = 0; j < win + tauMax; j++) sq[j + 1] = sq[j] + re[j] * re[j];
  fft(re, im); fft(ar, ai);
  for (let k = 0; k < size; k++) {
    const r = ar[k] * re[k] + ai[k] * im[k], i = ar[k] * im[k] - ai[k] * re[k]; // conj(A)·X
    re[k] = r; im[k] = i;
  }
  fft(re, im, true);
  const d = new Float64Array(tauMax + 1);
  const e0 = sq[win];
  for (let t = 1; t <= tauMax; t++) d[t] = Math.max(0, e0 + sq[t + win] - sq[t] - (2 * re[t]) / size);
  return d;
}

// Кадры: f0 (0 - нет тона), ясность 1 - d'(τ), громкость (rms) и время середины окна.
export function trackPitch(samples, sampleRate, opts = {}, { signal, progress } = {}) {
  const fmin = opts.fmin ?? 60, fmax = opts.fmax ?? 1600, threshold = opts.threshold ?? 0.2;
  const hop = opts.hop ?? Math.max(1, Math.round(sampleRate * 0.01));
  const tauMin = Math.max(2, Math.floor(sampleRate / fmax)), tauMax = Math.ceil(sampleRate / fmin);
  const win = Math.max(tauMax, Math.round(sampleRate * 0.02));
  const size = nextPow2(win + tauMax);
  const count = Math.max(0, Math.floor((samples.length - win - tauMax) / hop) + 1);
  const f0 = new Float32Array(count), clarity = new Float32Array(count), rms = new Float32Array(count), times = new Float32Array(count);
  const re = new Float64Array(size), im = new Float64Array(size), ar = new Float64Array(size), ai = new Float64Array(size);
  const sq = new Float64Array(win + tauMax + 1);
  let loud = 0;
  for (let f = 0; f < count; f++) {
    let e = 0;
    for (let j = 0; j < win; j++) e += samples[f * hop + j] ** 2;
    rms[f] = Math.sqrt(e / win);
    loud = Math.max(loud, rms[f]);
  }
  const gate = loud * (opts.gate ?? 0.05);
  for (let f = 0; f < count; f++) {
    if (f % 64 === 0) { checkSignal(signal); progress?.(f / count); }
    times[f] = (f * hop + win / 2) / sampleRate;
    if (rms[f] <= gate) continue;
    const d = yinFrame(samples, f * hop, win, tauMax, size, re, im, ar, ai, sq);
    // Нормированная накопленным средним разность d'(τ): убирает провал на τ = 0 и выбор октавы ниже.
    let acc = 0;
    for (let t = 1; t <= tauMax; t++) { acc += d[t]; d[t] = acc > 0 ? (d[t] * t) / acc : 1; }
    let best = -1;
    for (let t = tauMin; t < tauMax; t++) {
      if (d[t] < threshold) {
        while (t + 1 < tauMax && d[t + 1] < d[t]) t++;
        best = t;
        break;
      }
    }
    if (best < 0) continue;
    // Парабола по трём точкам уточняет период до долей отсчёта.
    const a = d[best - 1], b = d[best], c = d[best + 1];
    const den = a - 2 * b + c;
    const shift = den > 0 ? (0.5 * (a - c)) / den : 0;
    f0[f] = sampleRate / (best + shift);
    clarity[f] = 1 - b;
  }
  progress?.(1);
  return { hop, sampleRate, times, f0, clarity, rms };
}

// Огибающая атак - спектральный поток: сумма положительных приростов log(1 + γ|X|) по частотам
// между кадрами f и f-lag (кадры через 5 мс, окно Ханна ~23 мс). Сжатие логарифмом даёт голос
// и шумовым ударам поверх тянущейся ноты, и мягким атакам из тишины. Нормировано к максимуму 1.
export function onsetEnvelope(samples, sampleRate, { hopSec = 0.005, lag = 2, gamma = 100 } = {}, { signal } = {}) {
  const hop = Math.max(1, Math.round(sampleRate * hopSec));
  const size = nextPow2(sampleRate * 0.023);
  const count = Math.floor(samples.length / hop);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const scale = gamma / (peak || 1);
  const bins = size / 2;
  const win = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  const re = new Float64Array(size), im = new Float64Array(size);
  const mags = Array.from({ length: lag + 1 }, () => new Float32Array(bins));
  const flux = new Float32Array(count);
  let top = 0;
  for (let f = 0; f < count; f++) {
    if (f % 256 === 0) checkSignal(signal);
    const a = f * hop - size / 2;
    for (let j = 0; j < size; j++) { re[j] = (samples[a + j] || 0) * win[j]; im[j] = 0; }
    fft(re, im);
    const cur = mags[f % (lag + 1)], old = mags[(f + 1) % (lag + 1)]; // кольцо: old - кадр f-lag
    let sum = 0;
    for (let k = 1; k < bins; k++) {
      cur[k] = Math.log1p(scale * Math.hypot(re[k], im[k]) / bins);
      if (f >= lag) sum += Math.max(0, cur[k] - old[k]);
    }
    flux[f] = sum;
    top = Math.max(top, sum);
  }
  if (top > 0) for (let f = 0; f < count; f++) flux[f] /= top;
  return { hop, flux };
}

// Времена атак (с): пики потока выше порога delta (доля от максимума) над средним по соседству (±0.1 с),
// не чаще minGap.
export function detectOnsets(samples, sampleRate, opts = {}, ctl = {}) {
  const delta = opts.delta ?? 0.2, minGap = opts.minGap ?? 0.05;
  const { hop, flux } = onsetEnvelope(samples, sampleRate, opts, ctl);
  const gap = Math.max(1, Math.round((minGap * sampleRate) / hop));
  const near = Math.max(1, Math.round((0.1 * sampleRate) / hop));
  const out = [];
  let last = -Infinity, sum = 0;
  for (let f = 0; f < Math.min(near, flux.length); f++) sum += flux[f];
  for (let f = 0; f < flux.length; f++) {
    // Скользящее среднее потока по соседним ±near кадрам (~0.1 с).
    sum += (flux[f + near] ?? 0) - (flux[f - near] ?? 0);
    const local = sum / (2 * near);
    let peakHere = flux[f] >= local + delta;
    for (let j = Math.max(0, f - gap); peakHere && j <= Math.min(flux.length - 1, f + gap); j++) if (flux[j] > flux[f]) peakHere = false;
    if (!peakHere || f - last < gap) continue;
    out.push((f * hop) / sampleRate); // пик потока совпадает с началом атаки с точностью ~5 мс
    last = f;
  }
  return out;
}

// Темп (уд/мин): автокорреляция огибающей атак в диапазоне [min, max], лёгкое предпочтение ~120 уд/мин
// против ошибок в октаву, парабола для точности.
export function estimateTempo(samples, sampleRate, opts = {}, ctl = {}) {
  const min = opts.min ?? 60, max = opts.max ?? 200;
  const { hop, flux } = onsetEnvelope(samples, sampleRate, opts, ctl);
  const fps = sampleRate / hop;
  const n = flux.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += flux[i] / n;
  const x = Float64Array.from(flux, (v) => v - mean);
  const lo = Math.max(1, Math.floor((60 * fps) / max)), hi = Math.min(n - 2, Math.ceil((60 * fps) / min));
  if (hi <= lo) return 0;
  const acf = new Float64Array(hi + 2);
  for (let l = lo - 1; l <= hi + 1; l++) {
    let s = 0;
    for (let i = l; i < n; i++) s += x[i] * x[i - l];
    acf[l] = s;
  }
  let best = -1, bestScore = 0;
  for (let l = lo; l <= hi; l++) {
    if (acf[l] < acf[l - 1] || acf[l] < acf[l + 1]) continue;
    const octaves = Math.log2((60 * fps) / l / 120);
    const score = acf[l] * Math.exp(-0.5 * (octaves / 1.2) ** 2);
    if (score > bestScore) { bestScore = score; best = l; }
  }
  if (best < 0) return 0;
  const a = acf[best - 1], b = acf[best], c = acf[best + 1];
  const den = a - 2 * b + c;
  const lagExact = best + (den < 0 ? (0.5 * (a - c)) / den : 0);
  return (60 * fps) / lagExact;
}

// Ноты { midi, start, dur, vel }: новая нота - при устойчивой смене высоты (stable кадров подряд),
// при повторной атаке или после паузы длиннее maxGap. Короткие обрывки (< minDur) выбрасываются.
export function detectNotes(samples, sampleRate, opts = {}, { signal, progress } = {}) {
  const minDur = opts.minDur ?? 0.06, stable = opts.stable ?? 3, tol = opts.tolerance ?? 0.6;
  const track = trackPitch(samples, sampleRate, opts, { signal, progress: (v) => progress?.(v * 0.9) });
  const onsets = opts.onsets ?? detectOnsets(samples, sampleRate, opts, { signal });
  const { times, f0, rms, hop } = track;
  const step = hop / sampleRate;
  const maxGap = Math.round((opts.maxGap ?? 0.05) / step);
  const midi = Float32Array.from(f0, (f) => (f > 0 ? hzToMidi(f) : NaN));
  const loud = rms.reduce((m, v) => Math.max(m, v), 0) || 1;
  const notes = [];
  let cur = null, split = false, next = 0;
  const close = () => {
    const start = times[cur.first] - step / 2, dur = times[cur.last] + step / 2 - start;
    if (dur >= minDur) {
      const vel = Math.max(1, Math.min(127, Math.round((cur.peak / loud) * 127)));
      notes.push({ midi: Math.round(median(cur.ms)), start: Math.max(0, start), dur, vel });
    }
    cur = null;
  };
  const open = (f) => { cur = { first: f, last: f, ms: [midi[f]], ref: midi[f], peak: rms[f], sum: rms[f], gap: 0 }; };
  // Повтор той же ноты: перед атакой громкость падала ниже 60 % среднего уровня ноты. Удар барабана
  // поверх тянущейся ноты громкость не роняет - такую ноту не режем.
  const rearticulated = (f) => {
    let low = Infinity;
    for (let j = Math.max(0, f - 5); j <= f; j++) low = Math.min(low, rms[j]);
    return low < (0.6 * cur.sum) / cur.ms.length;
  };
  for (let f = 0; f < times.length; f++) {
    while (next < onsets.length && onsets[next] <= times[f]) { split = true; next++; }
    const m = midi[f];
    if (Number.isNaN(m)) {
      if (cur && ++cur.gap > maxGap) close(); // короткие провалы тона (удар, шум) ноту не рвут
      continue;
    }
    if (!cur) open(f);
    else if (split && times[f] - times[cur.first] >= minDur && rearticulated(f)) { close(); open(f); }
    else if (Math.abs(m - cur.ref) > tol) {
      // Смена высоты засчитывается, только если следующие кадры держат новую высоту, иначе это сбой.
      let ok = true;
      for (let j = f + 1; j < f + stable; j++) if (!(Math.abs(midi[j] - m) <= tol)) ok = false;
      if (!ok) continue;
      close(); open(f);
    } else {
      cur.last = f; cur.gap = 0; cur.ms.push(m); cur.sum += rms[f]; cur.peak = Math.max(cur.peak, rms[f]);
      if (cur.ms.length <= 8) cur.ref = median(cur.ms);
    }
    split = false;
  }
  if (cur) close();
  progress?.(1);
  return notes;
}
