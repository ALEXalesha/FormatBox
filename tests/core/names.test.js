import test from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../../web/core/rand.js';
import { uniqueName, outputName, splitName, cleanStem } from '../../web/core/names.js';

const STEMS = ['фото', 'video', 'a.b', 'CON', 'x?y', ' ', 'song (2)', '..', 'Report.final'];
const EXTS = ['mp4', 'MP4', 'png', '', 'tar.gz', 'jpg'];

test('закон: имя результата не совпадает ни с одним файлом папки и с источником (1000 случаев)', () => {
  const r = rng(101);
  for (let n = 0; n < 1000; n++) {
    const source = `${r.pick(STEMS)}.${r.pick(EXTS) || 'bin'}`;
    const taken = new Set(r() < 0.5 ? [source] : []);
    const ext = r.pick(EXTS);
    for (let k = r.int(0, 6); k > 0; k--) {
      const guess = outputName(source, ext, taken);
      if (r() < 0.7) taken.add(r() < 0.5 ? guess : guess.toUpperCase());
    }
    const out = outputName(source, ext, taken);
    const low = [...taken].map((t) => t.toLowerCase());
    assert.ok(!low.includes(out.toLowerCase()), `${out} уже есть`);
    assert.notEqual(out.toLowerCase(), source.toLowerCase());
    assert.ok(!/[<>:"/\\|?*]/.test(out));
  }
});

test('тот же формат получает метку, другой - нет', () => {
  assert.equal(outputName('a.png', 'png', new Set()), 'a-formatbox.png');
  assert.equal(outputName('a.png', 'jpg', new Set()), 'a.jpg');
  assert.equal(outputName('a.png', 'jpg', new Set(['a.jpg'])), 'a (2).jpg');
  assert.equal(outputName('a.png', 'jpg', new Set(['A.JPG', 'a (2).jpg'])), 'a (3).jpg');
  assert.equal(outputName('clip.mp4', 'mp3', new Set(), 'audio'), 'clip-audio.mp3');
  assert.equal(outputName('noext', '', new Set()), 'noext-formatbox');
});

test('разбор и чистка имени', () => {
  assert.deepEqual(splitName('.bashrc'), { stem: '.bashrc', ext: '' });
  assert.deepEqual(splitName('a.'), { stem: 'a.', ext: '' });
  assert.deepEqual(splitName('a.tar.gz'), { stem: 'a.tar', ext: 'gz' });
  assert.equal(cleanStem('nul'), '_nul');
  assert.equal(cleanStem('  '), 'file');
  assert.equal(cleanStem('a:b*c. '), 'a_b_c');
  assert.equal(cleanStem('x'.repeat(300)).length, 180);
  assert.equal(uniqueName('a.txt', new Set()), 'a.txt');
});
