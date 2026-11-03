import test from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../../web/core/rand.js';
import { foldBass, PREVIEW_SECONDS, renderChip, transcribe } from '../../web/core/audio/remix.js';
import { makeSong, pitchAccuracy } from './audio-fixtures.js';
import * as audioApi from '../../web/core/audio/index.js';

const ALL = ['melody', 'bass', 'drums'];
const SONG_SEEDS = [61, 62, 63, 64, 65, 66];
const songs = new Map();
const songOf = (seed) => {
  if (!songs.has(seed)) songs.set(seed, makeSong(seed, { sampleRate: [16000, 22050][seed % 2] }));
  return songs.get(seed);
};
const scores = new Map();
async function scoreOf(seed) {
  if (!scores.has(seed)) scores.set(seed, await transcribe(songOf(seed).audio));
  return scores.get(seed);
}

test('закон: каналов в результате столько, сколько запрошено, и в том же порядке (зерно 60)', async () => {
  const r = rng(60);
  const song = makeSong(60, { sampleRate: 16000, beats: 6 });
  for (let round = 0; round < 8; round++) {
    const names = Array.from({ length: r.int(1, 4) }, () => r.pick(ALL));
    const score = await transcribe(song.audio, { channels: names });
    assert.deepEqual(score.channels.map((c) => c.name), names);
    for (const c of score.channels) assert.ok(['pulse', 'triangle', 'noise'].includes(c.wave) && Array.isArray(c.notes));
  }
  assert.equal((await transcribe(song.audio)).channels.length, 3, 'по умолчанию мелодия, бас, барабаны');
});

test('закон: темп и длительность ±2 % (зерна 61-66)', async () => {
  for (const seed of SONG_SEEDS) {
    const song = songOf(seed), score = await scoreOf(seed);
    assert.ok(Math.abs(score.tempo / song.tempo - 1) <= 0.02, `зерно ${seed}: ${song.tempo} -> ${score.tempo}`);
    assert.ok(Math.abs(score.duration / song.duration - 1) <= 0.02, `зерно ${seed}: ${song.duration} -> ${score.duration}`);
  }
});

test('закон: высота нот мелодии совпадает по MIDI у >= 90 % нот (зерна 61-66)', async () => {
  for (const seed of SONG_SEEDS) {
    const song = songOf(seed), score = await scoreOf(seed);
    const melody = score.channels.find((c) => c.name === 'melody').notes;
    const acc = pitchAccuracy(song.melody, melody);
    assert.ok(acc >= 0.9, `зерно ${seed} (${song.kind}): ${(acc * 100).toFixed(0)} %`);
  }
});

test('закон: предпросмотр не длиннее 10 с (зерно 67)', async () => {
  const r = rng(67);
  const long = makeSong(67, { sampleRate: 16000, beats: 28 }); // ~11..19 с
  assert.ok(long.duration > PREVIEW_SECONDS);
  const score = await transcribe(long.audio, { previewSeconds: PREVIEW_SECONDS });
  assert.ok(score.duration <= PREVIEW_SECONDS);
  for (let round = 0; round < 4; round++) {
    const sampleRate = r.pick([8000, 22050]);
    const full = await scoreOf(SONG_SEEDS[round]);
    const stretched = { ...full, duration: full.duration * 2 };
    const out = renderChip(stretched, { sampleRate, previewSeconds: PREVIEW_SECONDS });
    assert.ok(out.channels[0].length <= PREVIEW_SECONDS * sampleRate);
  }
  const whole = renderChip(await scoreOf(61), { sampleRate: 8000 });
  assert.equal(whole.channels[0].length, Math.round(songOf(61).duration * 8000));
});

test('вход не меняется (зерно 68)', async () => {
  const song = makeSong(68, { sampleRate: 16000, beats: 4 });
  const copy = song.audio.channels[0].slice();
  await transcribe(song.audio);
  assert.deepEqual(song.audio.channels[0], copy);
});

test('бас и барабаны: бас по нотам в своём диапазоне, удары на долях', async () => {
  const song = songOf(61), score = await scoreOf(61);
  const bass = score.channels.find((c) => c.name === 'bass');
  assert.equal(bass.wave, 'triangle');
  assert.ok(pitchAccuracy(song.bass, bass.notes) >= 0.75);
  const drums = score.channels.find((c) => c.name === 'drums').notes;
  const near = song.hits.filter((t) => drums.some((d) => Math.abs(d.start - t) < 0.03)).length;
  assert.ok(near >= song.hits.length * 0.8, `${near} из ${song.hits.length}`);
  for (const d of drums) assert.ok(d.midi >= 0 && d.midi <= 15 && d.dur > 0 && d.dur <= 0.12);
  assert.deepEqual(foldBass([{ midi: 70 }, { midi: 20 }, { midi: 40 }]).map((n) => n.midi), [46, 32, 40]);
});

test('separator: готовые дорожки берутся вместо фильтров, повтор мелодии - другая скважность', async () => {
  const song = makeSong(69, { sampleRate: 16000, beats: 8 });
  const solo = makeSong(69, { sampleRate: 16000, beats: 8, bass: false, drums: false });
  let calls = 0;
  const separator = async (audio) => {
    calls += 1;
    assert.equal(audio.channels.length, 1);
    return { melody: solo.audio, bass: new Float32Array(audio.channels[0].length) };
  };
  const score = await transcribe(song.audio, { channels: ['melody', 'bass', 'melody'], separator });
  assert.equal(calls, 1);
  assert.ok(pitchAccuracy(solo.melody, score.channels[0].notes) >= 0.9);
  assert.deepEqual(score.channels[1].notes, [], 'пустая дорожка баса - нот нет');
  assert.deepEqual([score.channels[0].duty, score.channels[2].duty], [0.5, 0.25]);
  assert.deepEqual(score.channels[2].notes, score.channels[0].notes);
  assert.notEqual(score.channels[2].notes[0], score.channels[0].notes[0], 'ноты - копии');
});

test('ошибки, отмена, прогресс, все экспорты', async () => {
  const song = makeSong(70, { sampleRate: 16000, beats: 4 });
  await assert.rejects(() => transcribe(song.audio, { channels: ['vocals'] }), /channels/);
  await assert.rejects(() => transcribe({ sampleRate: 1, channels: [] }), /audio/);
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(() => transcribe(song.audio, {}, { signal: ctl.signal }), /canceled/);
  const seen = [];
  await transcribe(song.audio, {}, { progress: (v) => seen.push(v) });
  assert.equal(seen.at(-1), 1);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1] - 1e-9, 'прогресс не убывает');
  for (const name of ['decodeWav', 'encodeWav', 'readWavHeader', 'convertPcm', 'chipify', 'detectNotes', 'detectOnsets', 'estimateTempo', 'renderChannels', 'transcribe', 'renderChip']) {
    assert.equal(typeof audioApi[name], 'function', name);
  }
});
