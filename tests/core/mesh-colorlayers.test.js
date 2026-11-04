import test from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../../web/core/rand.js';
import { colorChangeHeights, insertColorChanges, findLayers } from '../../web/core/mesh/colorlayers.js';
import { box } from './mesh-helpers.js';

// Похожий на настоящий G-code: стиль Prusa/Orca (метки), Cura (;LAYER:n) или голые G1 с подъёмами и откатами
function fakeGcode(r, style, layers, lh) {
  const eol = r() < 0.3 ? '\r\n' : '\n';
  const out = ['; generated', 'G21', 'G90', style === 'bare' && r() < 0.5 ? 'M83' : 'M82', 'G92 E0', 'G28'];
  let e = 0;
  const relative = out[3] === 'M83';
  for (let k = 1; k <= layers; k++) {
    const z = +(k * lh).toFixed(3);
    if (style === 'prusa') out.push(';LAYER_CHANGE', `;Z:${z}`, `;HEIGHT:${lh}`, `G1 Z${z} F720`);
    else if (style === 'cura') out.push(`;LAYER:${k - 1}`, `G0 F3000 X10 Y10 Z${z}`);
    else {
      // подъём с откатом и возврат: подъём не должен считаться слоем
      out.push(relative ? 'G1 E-0.8 F2100' : `G1 E${(e - 0.8).toFixed(3)} F2100`, `G1 Z${(z + 0.4).toFixed(3)}`, 'G0 X5 Y5', `G1 Z${z}`);
      if (!relative) out.push(`G1 E${e.toFixed(3)}`);
      else out.push('G1 E0.8');
    }
    for (let m = r.int(1, 4); m > 0; m--) {
      e += 0.5;
      out.push(relative ? `G1 X${r.int(0, 99)} Y${r.int(0, 99)} E0.5 ; ext` : `G1 X${r.int(0, 99)} Y${r.int(0, 99)} E${e.toFixed(3)}`);
    }
    if (r() < 0.2 && !relative) { out.push('G92 E0'); e = 0; }
  }
  out.push('M104 S0', 'M84');
  return { text: out.join(eol) + (r() < 0.5 ? eol : ''), eol };
}

test('закон: вставок столько, сколько смен, каждая перед нужным слоем, остальное байт в байт (зерно 81, 60 файлов)', () => {
  const r = rng(81);
  for (let n = 0; n < 60; n++) {
    const style = ['prusa', 'cura', 'bare'][n % 3];
    const lh = r.pick([0.1, 0.2, 0.28]);
    const count = r.int(5, 60);
    const { text, eol } = fakeGcode(r, style, count, lh);
    const maxZ = count * lh;
    const colors = Array.from({ length: r.int(2, 5) }, (_, i) => `c${i}`);
    const heights = colorChangeHeights(maxZ, colors, lh);
    const out = insertColorChanges(text, heights, { command: 'M600' });
    const lines = out.split(eol);
    const inserted = lines.map((l, i) => [l, i]).filter(([l]) => l.startsWith('M600'));
    assert.equal(inserted.length, heights.length, `#${n} ${style}`);
    // убрали вставки - получили исходник
    assert.equal(lines.filter((l) => !l.startsWith('M600')).join(eol), text, `#${n}: остальные строки`);
    // после каждой вставки первый же слой - нужной высоты
    const layers = findLayers(lines);
    inserted.forEach(([, i], k) => {
      const next = layers.find((l) => l.line > i);
      assert.ok(next, `#${n}: слой после вставки`);
      assert.ok(Math.abs(next.z - heights[k].z) < 1e-6, `#${n} ${style}: слой ${next.z} вместо ${heights[k].z}`);
      assert.ok(lines[i].includes(heights[k].color));
    });
    assert.equal(layers.length, count, `#${n} ${style}: слои`);
  }
});

test('закон: высоты смен - кратны слою, по возрастанию, внутри модели, на одну меньше цветов (зерно 82, 100 случаев)', () => {
  const r = rng(82);
  for (let n = 0; n < 100; n++) {
    const lh = r.pick([0.08, 0.12, 0.2, 0.3]);
    const maxZ = 2 + r() * 100;
    const k = r.int(1, 8);
    const h = colorChangeHeights(maxZ, k, lh);
    assert.equal(h.length, k - 1, `#${n}`);
    h.forEach((x, i) => {
      assert.ok(Math.abs(x.z / lh - Math.round(x.z / lh)) < 1e-6);
      assert.ok(x.z > 0 && x.z < maxZ);
      if (i) assert.ok(x.z > h[i - 1].z);
      assert.ok(Math.abs(x.z - (maxZ * (i + 1)) / k) <= lh / 2 + 1e-6);
    });
  }
});

test('цветные слои: высота сетки, явные высоты, повторы, слишком высоко, без меток', () => {
  assert.deepEqual(colorChangeHeights(box(10, 10, 4), ['red', 'blue'], 0.2), [{ z: 2, color: 'blue' }]);
  assert.deepEqual(colorChangeHeights(10, [3.05, 3.02, 0.01, 50], 0.2), [{ z: 0.2 }, { z: 3 }]);
  assert.deepEqual(colorChangeHeights(10, [{ z: 5, color: 'x' }]), [{ z: 5, color: 'x' }]);
  assert.deepEqual(colorChangeHeights(10, undefined), []);
  assert.throws(() => colorChangeHeights(10, 2, 0), /layerHeight/);
  const g = 'G1 Z0.2\nG1 X1 E1\nG1 Z0.4\nG1 X2 E2\n';
  assert.equal(insertColorChanges(g, [0.4, 9]), 'G1 Z0.2\nG1 X1 E1\nM600\nG1 Z0.4\nG1 X2 E2\n');
  assert.equal(insertColorChanges(g, [{ z: 0.3 }], { command: 'M601' }), 'G1 Z0.2\nG1 X1 E1\nM601\nG1 Z0.4\nG1 X2 E2\n');
  assert.deepEqual(findLayers(';LAYER_CHANGE\n;LAYER_CHANGE\n;Z:0.3\nG1 Z0.3'), [{ line: 1, z: 0.3 }]);
  assert.deepEqual(findLayers('G0 X1\nG1 X2 E1\nG1 Z0.3 ; comment Z9\nG1 X1 E2 ; Z5'), [{ line: 0, z: 0 }, { line: 2, z: 0.3 }]);
});
