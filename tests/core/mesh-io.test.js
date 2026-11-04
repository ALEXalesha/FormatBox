import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from '../../web/vendor/fflate.js';
import { rng } from '../../web/core/rand.js';
import { readMesh, writeMesh, MESH_FORMATS } from '../../web/core/mesh/io.js';
import { volume, bounds } from '../../web/core/mesh/measure.js';
import { isWatertight } from '../../web/core/mesh/topology.js';
import { randomShape, sameMesh, copyMesh, box } from './mesh-helpers.js';

const enc = new TextEncoder();
const VARIANTS = [['stl', {}], ['stl', { ascii: true }], ['obj', {}], ['ply', {}], ['3mf', {}], ['glb', {}]];

test('закон: туда-обратно между всеми парами форматов сохраняет треугольники, объём и габариты (зерно 21, 8 тел)', () => {
  const r = rng(21);
  for (let n = 0; n < 8; n++) {
    const { kind, mesh } = randomShape(r);
    const v0 = volume(mesh), b0 = bounds(mesh);
    const tol = 2e-6 * Math.max(...b0.max.map(Math.abs), ...b0.min.map(Math.abs));
    for (const [a, oa] of VARIANTS) {
      for (const [b, ob] of VARIANTS) {
        const before = copyMesh(mesh);
        const bytesA = writeMesh(mesh, a, oa);
        assert.ok(sameMesh(mesh, before), 'запись не трогает сетку');
        const copyA = bytesA.slice();
        const midMesh = readMesh(bytesA, a);
        assert.deepEqual(bytesA, copyA, 'чтение не трогает байты');
        const out = readMesh(writeMesh(midMesh, b, ob), b);
        const where = `${kind} #${n}: ${a}${oa.ascii ? '-ascii' : ''} -> ${b}`;
        assert.equal(out.indices.length, mesh.indices.length, where);
        assert.ok(Math.abs(volume(out) - v0) <= 1e-4 * Math.abs(v0), `${where}: объём ${volume(out)} против ${v0}`);
        const bb = bounds(out);
        for (let k = 0; k < 3; k++) {
          assert.ok(Math.abs(bb.min[k] - b0.min[k]) <= tol && Math.abs(bb.max[k] - b0.max[k]) <= tol, `${where}: габарит`);
        }
        assert.ok(isWatertight(out), `${where}: склейка вершин при чтении`);
      }
    }
  }
});

test('закон: текстовые форматы (OBJ, STL ascii, 3MF) хранят float32 без потерь (зерно 22, 297 чисел)', () => {
  const r = rng(22);
  const pos = Float32Array.from({ length: 297 }, () => (r() - 0.5) * 10 ** r.int(-3, 4));
  const mesh = { positions: pos, indices: Uint32Array.from({ length: 99 }, (_, i) => i) };
  for (const [f, o] of [['obj', {}], ['stl', { ascii: true }], ['3mf', {}], ['ply', {}], ['stl', {}]]) {
    const back = readMesh(writeMesh(mesh, f, o), f, { merge: false });
    assert.deepEqual(Array.from(back.positions), Array.from(pos), f);
  }
});

test('STL: двоичный с заголовком «solid», обрезанный, ascii с несколькими телами, нормали', () => {
  const cube = box(2);
  const bin = writeMesh(cube, 'stl');
  bin.set(enc.encode('solid but binary'), 0);
  assert.equal(readMesh(bin, '.STL').indices.length, 36);
  const cut = bin.slice(0, bin.length - 30);
  assert.equal(readMesh(cut, 'stl').indices.length, 33);
  const ascii = 'solid a\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid a\n'
    + 'solid b\nfacet normal 0 0 1\nouter loop\nvertex 0 0 1\nvertex 1 0 1\nvertex 0 1 1\nendloop\nendfacet\nendsolid b\nvertex 9 9 9\n';
  const m = readMesh(enc.encode(ascii), 'stl');
  assert.equal(m.indices.length, 6);
  assert.equal(m.positions.length, 18);
  const raw = readMesh(writeMesh(cube, 'stl'), 'stl', { merge: false });
  assert.equal(raw.positions.length, 36 * 3);
  const view = new DataView(writeMesh(cube, 'stl').buffer);
  const nz = view.getFloat32(84 + 8, true);
  assert.equal(Math.abs(nz), 1);
  assert.match(new TextDecoder().decode(writeMesh(cube, 'stl', { ascii: true, name: 'my part' })), /^solid my_part\n facet normal 0 0 -1/);
  // вырожденный треугольник получает нулевую нормаль, а не NaN
  const flat = { positions: new Float32Array(9), indices: Uint32Array.from([0, 1, 2]) };
  assert.equal(new DataView(writeMesh(flat, 'stl').buffer).getFloat32(84, true), 0);
  assert.equal(readMesh(new Uint8Array(10), 'stl').indices.length, 0);
});

test('OBJ: многоугольники веером, отрицательные индексы, v/vt/vn, мусор', () => {
  const text = [
    '# test', 'o thing', 'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0', 'vt 0 0', 'vn 0 0 1',
    'f 1/1/1 2/1/1 3/1/1 4/1/1', 'f -4//1 -2//1 -1//1', 'f 1 2 99', 'usemtl x', '  v 5 5 5  ', 'f 1 2', '',
  ].join('\r\n');
  const m = readMesh(enc.encode(text), 'obj', { merge: false });
  assert.equal(m.positions.length, 15);
  assert.deepEqual(Array.from(m.indices), [0, 1, 2, 0, 2, 3, 0, 2, 3]);
});

test('PLY: ascii с лишними свойствами и элементами, двоичный big endian, vertex_index', () => {
  const ascii = 'ply\nformat ascii 1.0\ncomment x\nelement vertex 4\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\n'
    + 'element face 2\nproperty list uchar int vertex_indices\nelement edge 1\nproperty int a\nproperty int b\nend_header\n'
    + '0 0 0 255\n1 0 0 255\n1 1 0 255\n0 1 0 255\n4 0 1 2 3\n3 0 1 9\n0 1\n';
  const m = readMesh(enc.encode(ascii), 'ply', { merge: false });
  assert.equal(m.positions.length, 12);
  assert.deepEqual(Array.from(m.indices), [0, 1, 2, 0, 2, 3]);
  // big endian, double координаты, ushort индексы, имя vertex_index, вершины без z
  const head = enc.encode('ply\r\nformat binary_big_endian 1.0\r\nelement vertex 3\r\nproperty double x\r\nproperty double y\r\n'
    + 'element face 1\r\nproperty list uchar ushort vertex_index\r\nend_header\r\n');
  const body = new DataView(new ArrayBuffer(3 * 16 + 1 + 6));
  [[0, 0], [2, 0], [0, 2]].forEach(([x, y], i) => { body.setFloat64(16 * i, x); body.setFloat64(16 * i + 8, y); });
  body.setUint8(48, 3);
  [0, 1, 2].forEach((v, i) => body.setUint16(49 + 2 * i, v));
  const bytes = new Uint8Array(head.length + body.byteLength);
  bytes.set(head);
  bytes.set(new Uint8Array(body.buffer), head.length);
  const b = readMesh(bytes, 'ply');
  assert.deepEqual(Array.from(b.positions), [0, 0, 0, 2, 0, 0, 0, 2, 0]);
  assert.deepEqual(Array.from(b.indices), [0, 1, 2]);
  assert.throws(() => readMesh(enc.encode('not ply'), 'ply'), /PLY/);
  const tail = readMesh(enc.encode('ply\nformat ascii 1.0\nproperty float x\nelement face 0\nend_header\n'), 'ply');
  assert.equal(tail.indices.length, 0);
});

function zip3mf(files) {
  const all = {};
  for (const [k, v] of Object.entries(files)) all[k] = strToU8(v);
  return zipSync(all);
}

const TRI = '<mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices>'
  + '<triangles><triangle v1="0" v2="1" v3="2"/><triangle v1="0" v2="1" v3="7"/></triangles></mesh>';

test('3MF: единицы, transform в build и в компонентах, внешний файл модели, без build', () => {
  const rels = '<Relationships><Relationship Target="/3D/main.model" Id="r" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';
  const main = `<model unit="inch" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"><resources>
    <object id="1" type="model">${TRI}</object>
    <object id="2" type="model"><components><component objectid="1" transform="1 0 0 0 1 0 0 0 1 10 0 0"/>
      <component p:path="/3D/Objects/part.model" objectid="5" transform="2 0 0 0 2 0 0 0 2 0 0 0"/></components></object>
  </resources><build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 1"/><item objectid="1" transform="bad"/><item objectid="404"/></build></model>`;
  const part = `<model unit="millimeter"><resources><object id="5" type="model">${TRI}</object></resources></model>`;
  const m = readMesh(zip3mf({ '_rels/.rels': rels, '3D/main.model': main, '3D/Objects/part.model': part }), '3mf', { merge: false });
  assert.equal(m.indices.length, 9);
  const b = bounds(m);
  assert.deepEqual(b.min.map((v) => Math.round(v * 1000) / 1000), [0, 0, 0]);
  assert.deepEqual(b.max.map((v) => Math.round(v * 1000) / 1000), [279.4, 50.8, 25.4]);
  // без rels и без build: берутся все объекты корневой модели; зеркальный transform переворачивает грани
  const plain = `<model unit="centimeter"><resources><object id="1">${TRI}</object>
    <object id="3"><components><component objectid="1" transform="-1 0 0 0 1 0 0 0 1 0 0 0"/></components></object></resources></model>`;
  const p = readMesh(zip3mf({ '3D/3dmodel.model': plain }), '3mf', { merge: false });
  assert.equal(p.indices.length, 6);
  assert.equal(bounds(p).min[0], -10);
  assert.deepEqual(Array.from(p.indices.slice(3)), [3, 5, 4]);
  const unknown = readMesh(zip3mf({ 'x.model': '<model unit="parsec"><resources></resources></model>' }), '3mf');
  assert.equal(unknown.indices.length, 0);
  assert.throws(() => readMesh(zip3mf({ 'a.txt': 'x' }), '3mf'), /model/);
  // имя объекта экранируется
  const named = writeMesh(box(1), '3mf', { name: 'a<b>&"c"' });
  assert.equal(readMesh(named, '3mf').indices.length, 36);
});

function glb(json, bin = new Uint8Array(0)) {
  const j = enc.encode(JSON.stringify(json));
  const jl = Math.ceil(j.length / 4) * 4, bl = Math.ceil(bin.length / 4) * 4;
  const out = new Uint8Array(12 + 8 + jl + (bin.length ? 8 + bl : 0));
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true); v.setUint32(4, 2, true); v.setUint32(8, out.length, true);
  v.setUint32(12, jl, true); v.setUint32(16, 0x4e4f534a, true);
  out.fill(32, 20, 20 + jl); out.set(j, 20);
  if (bin.length) { v.setUint32(20 + jl, bl, true); v.setUint32(24 + jl, 0x004e4942, true); out.set(bin, 28 + jl); }
  return out;
}

test('GLB: узлы с TRS и матрицей, полосы и веера, без индексов, нормированные байты, data URI', () => {
  // квадрат из 4 вершин (метры, Y вверх) и индексы ushort
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, -1, 0, 0, -1]);
  const idx = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const bin = new Uint8Array(pos.byteLength + idx.byteLength);
  bin.set(new Uint8Array(pos.buffer)); bin.set(new Uint8Array(idx.buffer), pos.byteLength);
  const base = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 48 }, { buffer: 0, byteOffset: 48, byteLength: 12 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 4, type: 'VEC3' }, { bufferView: 1, componentType: 5123, count: 6, type: 'SCALAR' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }, { attributes: { POSITION: 0 }, mode: 5 }, { attributes: { POSITION: 0 }, mode: 6 }, { attributes: { POSITION: 0 }, mode: 1 }, { attributes: {} }] }],
  };
  const withNodes = { ...base, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [2, 2, 2], children: [1] }, { mesh: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.5, 0, 0, 1] }] };
  const m = readMesh(glb(withNodes, bin), 'glb', { merge: false });
  assert.equal(m.indices.length, 18);
  const b = bounds(m);
  assert.deepEqual(b.min.map(Math.round), [1000, 0, 0]);
  assert.deepEqual(b.max.map(Math.round), [3000, 2000, 0]);
  // без сцен: корни - узлы, которые ничьи не дети; без узлов - все меши
  const noScene = { ...withNodes, scenes: undefined, scene: undefined };
  assert.equal(readMesh(glb(noScene, bin), 'glb').indices.length, 18);
  assert.equal(readMesh(glb(base, bin), 'glb').indices.length, 18);
  // поворот кватернионом на 90° вокруг Y
  const rot = { ...base, nodes: [{ mesh: 0, rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] }], scenes: [{ nodes: [0] }] };
  const rb = bounds(readMesh(glb(rot, bin), 'glb'));
  assert.ok(Math.abs(rb.min[0] + 1000) < 1e-3 && Math.abs(rb.max[1] - 1000) < 1e-3);
  // нормированные байтовые координаты и буфер в data URI
  const bytes = new Int8Array([0, 0, 0, 127, 0, 0, 0, 127, 0]);
  const uri = `data:application/octet-stream;base64,${Buffer.from(bytes.buffer).toString('base64')}`;
  const q = {
    asset: { version: '2.0' }, buffers: [{ byteLength: 9, uri }], bufferViews: [{ buffer: 0, byteLength: 9, byteStride: 3 }],
    accessors: [{ bufferView: 0, componentType: 5120, normalized: true, count: 3, type: 'VEC3' }, { componentType: 5126, count: 3, type: 'VEC3' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }, { attributes: { POSITION: 1 } }] }],
  };
  const qm = readMesh(glb(q), 'glb', { merge: false });
  assert.equal(qm.indices.length, 6);
  assert.equal(bounds(qm).max[0], 1000);
  // индексы за пределами вершин - примитив пропускается
  const badIdx = new Uint16Array([0, 1, 9]);
  const bin2 = new Uint8Array(48 + 6);
  bin2.set(new Uint8Array(pos.buffer)); bin2.set(new Uint8Array(badIdx.buffer), 48);
  const broken = { ...base, bufferViews: [base.bufferViews[0], { buffer: 0, byteOffset: 48, byteLength: 6 }], accessors: [base.accessors[0], { ...base.accessors[1], count: 3 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }] };
  assert.equal(readMesh(glb(broken, bin2), 'glb').indices.length, 0);
  assert.throws(() => readMesh(glb({ ...q, buffers: [{ byteLength: 9, uri: 'file.bin' }] }), 'glb'), /external/);
  assert.throws(() => readMesh(new Uint8Array(40), 'glb'), /GLB/);
  const noJson = glb({});
  new DataView(noJson.buffer).setUint32(16, 0x1234, true);
  assert.throws(() => readMesh(noJson, 'glb'), /JSON/);
  assert.equal(readMesh(glb({ asset: { version: '2.0' } }), 'glb').indices.length, 0);
  assert.equal(readMesh(glb({ asset: { version: '2.0' }, nodes: [{ children: [5] }] }), 'glb').indices.length, 0);
});

test('форматы: список, неизвестное расширение, пустая сетка', () => {
  assert.deepEqual(MESH_FORMATS, ['stl', 'obj', 'ply', '3mf', 'glb']);
  assert.throws(() => readMesh(new Uint8Array(1), 'fbx'), /unsupported/);
  assert.throws(() => writeMesh(box(1), 'dae'), /unsupported/);
  const empty = { positions: new Float32Array(0), indices: new Uint32Array(0) };
  for (const f of MESH_FORMATS) assert.equal(readMesh(writeMesh(empty, f), f).indices.length, 0, f);
});
