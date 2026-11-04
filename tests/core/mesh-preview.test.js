import test from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../../web/core/rand.js';
import { renderPreview, parseColor } from '../../web/core/mesh/preview.js';
import { randomShape, sameMesh, copyMesh, box, mergeMeshes } from './mesh-helpers.js';
import { transformMesh } from '../../web/core/mesh/common.js';

function pixel(img, x, y) {
  const o = 4 * (y * img.width + x);
  return Array.from(img.data.slice(o, o + 4));
}

function borderClean(img, bg) {
  for (let x = 0; x < img.width; x++) for (const y of [0, img.height - 1]) if (pixel(img, x, y).join() !== bg.join()) return false;
  for (let y = 0; y < img.height; y++) for (const x of [0, img.width - 1]) if (pixel(img, x, y).join() !== bg.join()) return false;
  return true;
}

test('закон: сетка целиком в кадре и видна, край кадра - фон (зерно 51, 30 тел)', () => {
  const r = rng(51);
  for (let n = 0; n < 30; n++) {
    const { mesh } = randomShape(r);
    const before = copyMesh(mesh);
    const view = r.pick(['iso', 'front', 'top']);
    const width = r.int(24, 120), height = r.int(24, 120);
    const img = renderPreview(mesh, { width, height, view, background: '#ffffff', color: '#204080' });
    assert.ok(sameMesh(mesh, before));
    assert.equal(img.data.length, width * height * 4);
    assert.ok(borderClean(img, [255, 255, 255, 255]), `#${n} ${view}`);
    // модель вписана: по одной из осей занимает весь кадр без отступов
    let x0 = width, x1 = -1, y0 = height, y1 = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (img.data[4 * (y * width + x)] === 255) continue;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const m = Math.max(2, Math.round(Math.min(width, height) * 0.05));
    assert.ok(x1 - x0 + 1 >= width - 2 * m - 2 || y1 - y0 + 1 >= height - 2 * m - 2, `#${n}: модель не вписана`);
  }
});

test('закон: пустая сетка - ровный фон (зерно 52, 20 размеров)', () => {
  const r = rng(52);
  for (let n = 0; n < 20; n++) {
    const bg = [r.int(0, 255), r.int(0, 255), r.int(0, 255), 255];
    const img = renderPreview({ positions: new Float32Array(0), indices: new Uint32Array(0) }, { width: r.int(1, 50), height: r.int(1, 50), background: bg });
    for (let i = 0; i < img.data.length; i += 4) assert.deepEqual(Array.from(img.data.slice(i, i + 4)), bg);
  }
});

test('картинка: z-буфер - порядок граней не важен, ближняя закрывает дальнюю', () => {
  // повёрнутый маленький куб перед большим: грани разного наклона дают разный оттенок
  const c = Math.SQRT1_2;
  const near = transformMesh(box(2), [c, c, 0, 0, -c, c, 0, 0, 0, 0, 1, 0, 0, -3, 0, 1]);
  const far = { positions: box(10).positions.map((v, i) => (i % 3 === 1 ? v + 10 : v - 4)), indices: box(10).indices };
  for (const view of ['front', 'iso', 'top']) {
    const a = renderPreview(mergeMeshes([near, far]), { width: 64, height: 64, view, color: [200, 0, 0] });
    const b = renderPreview(mergeMeshes([far, near]), { width: 64, height: 64, view, color: [200, 0, 0] });
    assert.deepEqual(a.data, b.data, view);
  }
  const top = renderPreview(box(1, 2, 3), { width: 64, height: 64, view: 'top', margin: 0 });
  assert.equal(pixel(top, 1, 1)[3], 255);
  // одна вершина, вырожденные треугольники - только фон
  const flat = renderPreview({ positions: Float32Array.from([1, 1, 1]), indices: Uint32Array.from([0, 0, 0]) }, { width: 8 });
  assert.equal(flat.height, 8);
  assert.ok(flat.data.every((v, i) => v === [240, 240, 240, 255][i % 4]));
});

test('цвета: #rgb, #rrggbbaa, массивы, мусор', () => {
  assert.deepEqual(parseColor('#f00', null), [255, 0, 0, 255]);
  assert.deepEqual(parseColor('#00ff0080', null), [0, 255, 0, 128]);
  assert.deepEqual(parseColor([1, 2, 3], null), [1, 2, 3, 255]);
  assert.deepEqual(parseColor('red', [9, 9, 9, 9]), [9, 9, 9, 9]);
  assert.deepEqual(parseColor(undefined, [1, 1, 1, 1]), [1, 1, 1, 1]);
  const img = renderPreview(box(1), {});
  assert.equal(img.width, 256);
  assert.equal(img.height, 256);
});
