import test from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../../web/core/rand.js';
import { textToMesh, textMask } from '../../web/core/mesh/text3d.js';
import { hasGlyph, glyph } from '../../web/core/mesh/font.js';
import { bounds, volume } from '../../web/core/mesh/measure.js';
import { isWatertight } from '../../web/core/mesh/topology.js';
import { analyzeMesh } from '../../web/core/mesh/repair.js';
import * as mesh3d from '../../web/core/mesh/index.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcxyzАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвёжщя0123456789.,!?-+=:;\'"()/\\#@&*%_<>[]$^~|♥№«» ';

test('закон: текст водонепроницаем, брелок одним куском, ширина растёт с длиной (зерно 91, 25 строк)', () => {
  const r = rng(91);
  for (let n = 0; n < 25; n++) {
    const mode = ['plain', 'sign', 'keychain', 'stencil'][n % 4];
    const heightMm = 4 + r() * 10, depthMm = 0.5 + r() * 2;
    let text = '';
    let prev = 0;
    for (let k = 0; k < 4; k++) {
      // слова через пробел: брелок обязан срастить их в один кусок
      text += (k && r() < 0.4 ? ' ' : '') + Array.from({ length: r.int(1, 3) }, () => r.pick([...ALPHABET.trim()])).join('');
      const m = textToMesh(text, { heightMm, depthMm, mode });
      const where = `#${n} ${mode} ${JSON.stringify(text)}`;
      assert.ok(isWatertight(m), where);
      assert.ok(volume(m) > 0, where);
      const b = bounds(m);
      assert.ok(b.size[0] > prev, `${where}: ширина ${b.size[0]} после ${prev}`);
      prev = b.size[0];
      if (mode === 'plain') assert.ok(Math.abs(b.max[2] - depthMm) < 1e-5);
      if (mode === 'keychain') assert.equal(analyzeMesh(m).shells, 1, `${where}: брелок одним куском`);
    }
  }
});

test('текст: высота заглавной, строки, выравнивание, неизвестные знаки, пробелы', () => {
  const h = bounds(textToMesh('H', { heightMm: 10 })).size[1];
  assert.ok(Math.abs(h - 10) < 0.3, `высота ${h}`);
  const two = bounds(textToMesh('A\nB', { heightMm: 10 })).size[1];
  assert.ok(two > 20 && two < 30);
  assert.equal(textToMesh('   ').indices.length, 0);
  assert.ok(hasGlyph('ж') && hasGlyph('Q') && !hasGlyph('漢'));
  assert.deepEqual(glyph('漢'), null);
  // незнакомый знак рисуется как «?»
  assert.deepEqual(textMask('漢').data, textMask('?').data);
  const left = textMask('AAA\nB', { align: 'left' }), right = textMask('AAA\nB', { align: 'right' });
  assert.notDeepEqual(left.data, right.data);
  assert.equal(left.width, right.width);
  const based = textToMesh('Hi', { baseMm: 1.5, depthMm: 1 });
  assert.ok(Math.abs(bounds(based).max[2] - 2.5) < 1e-5);
  assert.throws(() => textToMesh('x', { mode: 'neon' }), /unknown mode/);
});

test('index: всё нужное окну экспортируется', () => {
  for (const name of ['readMesh', 'writeMesh', 'repairMesh', 'analyzeMesh', 'isWatertight', 'decimate', 'scaleMesh', 'convertUnits',
    'printEstimate', 'renderPreview', 'lithophane', 'relief', 'extrudeSilhouette', 'extrudeMask', 'colorChangeHeights',
    'insertColorChanges', 'textToMesh', 'box', 'sphere', 'loadManifold']) {
    assert.equal(typeof mesh3d[name], 'function', name);
  }
});
