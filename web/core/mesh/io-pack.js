// Упакованные форматы: 3MF (zip + XML) и GLB (glTF 2.0 binary).
import { unzipSync, zipSync, strToU8, strFromU8 } from '../../vendor/fflate.js';
import { parseXml, escapeXml, findAll, findFirst } from '../xml.js';
import { mergeMeshes, transformMesh, multiply, IDENTITY, emptyMesh, num } from './common.js';
import { scaleMesh, UNITS } from './measure.js';

const dec = new TextDecoder();
const enc = new TextEncoder();

// ---------- 3MF ----------
const UNIT_3MF = { micron: UNITS.um, millimeter: 1, centimeter: UNITS.cm, inch: UNITS.in, foot: UNITS.ft, meter: UNITS.m };

// "m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32" (строки - оси) -> 4x4 по столбцам
function matrix3mf(text) {
  if (!text) return IDENTITY;
  const m = text.trim().split(/\s+/).map(Number);
  if (m.length !== 12 || m.some((v) => !Number.isFinite(v))) return IDENTITY;
  return [m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, m[9], m[10], m[11], 1];
}

function childrenNamed(node, name) {
  return node.children.filter((c) => typeof c !== 'string' && (c.name === name || c.name.endsWith(`:${name}`)));
}

function attrEnding(attrs, name) {
  const key = Object.keys(attrs).find((k) => k === name || k.endsWith(`:${name}`));
  return key ? attrs[key] : undefined;
}

export function read3mf(bytes) {
  const files = unzipSync(bytes);
  const names = Object.keys(files);
  const get = (path) => {
    const want = path.replace(/^\//, '').toLowerCase();
    const key = names.find((k) => k.toLowerCase() === want);
    return key ? files[key] : null;
  };
  let root = null;
  const rels = get('_rels/.rels');
  if (rels) {
    const rel = findAll(parseXml(strFromU8(rels)), 'Relationship').find((r) => /3dmodel$/.test(r.attrs.Type || ''));
    if (rel && get(rel.attrs.Target)) root = rel.attrs.Target;
  }
  root ??= names.find((k) => /\.model$/i.test(k));
  if (!root) throw new Error('3MF without a model');

  const models = new Map();
  const loadModel = (path) => {
    const key = path.replace(/^\//, '').toLowerCase();
    if (!models.has(key)) {
      const data = get(path);
      const doc = data ? parseXml(strFromU8(data)) : { children: [] };
      const objects = new Map();
      for (const o of findAll(doc, 'object')) objects.set(o.attrs.id, o);
      models.set(key, { doc, objects, unit: findFirst(doc, 'model')?.attrs.unit });
    }
    return models.get(key);
  };
  const top = loadModel(root);
  const scale = UNIT_3MF[top.unit] ?? 1;
  const parts = [];
  const addObject = (path, id, m, depth) => {
    const obj = loadModel(path).objects.get(id);
    if (!obj || depth > 16) return;
    const mesh = childrenNamed(obj, 'mesh')[0];
    if (mesh) {
      const pos = [];
      for (const v of findAll(mesh, 'vertex')) pos.push(+v.attrs.x, +v.attrs.y, +v.attrs.z);
      const nv = pos.length / 3;
      const idx = [];
      for (const t of findAll(mesh, 'triangle')) {
        const tri = [+t.attrs.v1, +t.attrs.v2, +t.attrs.v3];
        if (tri.every((v) => Number.isInteger(v) && v >= 0 && v < nv)) idx.push(...tri);
      }
      parts.push(transformMesh({ positions: Float32Array.from(pos), indices: Uint32Array.from(idx) }, m));
    }
    for (const holder of childrenNamed(obj, 'components')) {
      for (const c of childrenNamed(holder, 'component')) {
        addObject(attrEnding(c.attrs, 'path') ?? path, c.attrs.objectid, multiply(m, matrix3mf(c.attrs.transform)), depth + 1);
      }
    }
  };
  const items = findAll(top.doc, 'item');
  if (items.length) {
    for (const it of items) addObject(attrEnding(it.attrs, 'path') ?? root, it.attrs.objectid, matrix3mf(it.attrs.transform), 0);
  } else {
    for (const id of top.objects.keys()) addObject(root, id, IDENTITY, 0);
  }
  const all = parts.length ? mergeMeshes(parts) : emptyMesh();
  return scale === 1 ? all : scaleMesh(all, scale);
}

export function write3mf(mesh, opts = {}) {
  const p = mesh.positions, idx = mesh.indices;
  const vs = [];
  for (let i = 0; i < p.length; i += 3) vs.push(`<vertex x="${num(p[i])}" y="${num(p[i + 1])}" z="${num(p[i + 2])}"/>`);
  const ts = [];
  for (let i = 0; i < idx.length; i += 3) ts.push(`<triangle v1="${idx[i]}" v2="${idx[i + 1]}" v3="${idx[i + 2]}"/>`);
  const name = escapeXml(opts.name ?? 'FormatBox');
  const model = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n'
    + '<metadata name="Application">FormatBox</metadata>\n'
    + `<resources><object id="1" type="model" name="${name}"><mesh>\n<vertices>\n${vs.join('\n')}\n</vertices>\n<triangles>\n${ts.join('\n')}\n</triangles>\n</mesh></object></resources>\n`
    + '<build><item objectid="1"/></build>\n</model>\n';
  const types = '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';
  return zipSync({
    '[Content_Types].xml': strToU8(types),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(model),
  }, { level: 6, mtime: new Date(2020, 0, 1) });
}

// ---------- GLB ----------
// glTF: Y вверх и метры; у нас Z вверх и миллиметры
const FROM_GLTF = [1000, 0, 0, 0, 0, 0, 1000, 0, 0, -1000, 0, 0, 0, 0, 0, 1];
const COMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const CTYPE = { 5120: ['Int8', 1, 127], 5121: ['Uint8', 1, 255], 5122: ['Int16', 2, 32767], 5123: ['Uint16', 2, 65535], 5125: ['Uint32', 4, 0], 5126: ['Float32', 4, 0] };

function base64(s) {
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function trs(node) {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

export function readGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file');
  let json = null, bin = null;
  for (let o = 12; o + 8 <= bytes.length;) {
    const len = view.getUint32(o, true), type = view.getUint32(o + 4, true);
    const chunk = bytes.subarray(o + 8, o + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(dec.decode(chunk));
    else if (type === 0x004e4942) bin = chunk;
    o += 8 + len;
  }
  if (!json) throw new Error('GLB without JSON');
  const buffers = (json.buffers ?? []).map((b) => {
    if (b.uri === undefined) return bin;
    const m = /^data:[^,]*;base64,(.*)$/.exec(b.uri);
    if (!m) throw new Error('GLB with an external buffer');
    return base64(m[1]);
  });
  const accessor = (i) => {
    const acc = json.accessors[i];
    const comps = COMP[acc.type];
    const out = new Float64Array(acc.count * comps);
    if (acc.bufferView === undefined) return { data: out, comps };
    const bv = json.bufferViews[acc.bufferView];
    const buf = buffers[bv.buffer];
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const [fn, size, norm] = CTYPE[acc.componentType];
    const stride = bv.byteStride || comps * size;
    const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    for (let e = 0; e < acc.count; e++) {
      for (let k = 0; k < comps; k++) {
        let v = dv[`get${fn}`](base + e * stride + k * size, true);
        if (acc.normalized && norm) v = Math.max(v / norm, -1);
        out[e * comps + k] = v;
      }
    }
    return { data: out, comps };
  };
  const parts = [];
  const addMesh = (mi, m) => {
    for (const prim of json.meshes[mi]?.primitives ?? []) {
      const mode = prim.mode ?? 4;
      if (prim.attributes?.POSITION === undefined || ![4, 5, 6].includes(mode)) continue;
      const pos = accessor(prim.attributes.POSITION).data;
      const nv = pos.length / 3;
      const order = prim.indices !== undefined ? Array.from(accessor(prim.indices).data) : Array.from({ length: nv }, (_, i) => i);
      let idx = [];
      if (mode === 4) for (let i = 0; i + 2 < order.length; i += 3) idx.push(order[i], order[i + 1], order[i + 2]);
      else if (mode === 5) for (let i = 0; i + 2 < order.length; i++) idx.push(...(i % 2 ? [order[i + 1], order[i], order[i + 2]] : [order[i], order[i + 1], order[i + 2]]));
      else for (let i = 1; i + 1 < order.length; i++) idx.push(order[0], order[i], order[i + 1]);
      if (idx.some((v) => v >= nv)) idx = [];
      parts.push(transformMesh({ positions: Float32Array.from(pos), indices: Uint32Array.from(idx) }, m));
    }
  };
  const nodes = json.nodes ?? [];
  const walk = (ni, parent, depth) => {
    const node = nodes[ni];
    if (!node || depth > 64) return;
    const m = multiply(parent, trs(node));
    if (node.mesh !== undefined) addMesh(node.mesh, m);
    for (const c of node.children ?? []) walk(c, m, depth + 1);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  if (scene) for (const n of scene.nodes ?? []) walk(n, FROM_GLTF, 0);
  else if (nodes.length) {
    const child = new Set(nodes.flatMap((n) => n.children ?? []));
    nodes.forEach((_, i) => { if (!child.has(i)) walk(i, FROM_GLTF, 0); });
  } else (json.meshes ?? []).forEach((_, i) => addMesh(i, FROM_GLTF));
  return parts.length ? mergeMeshes(parts) : emptyMesh();
}

export function writeGlb(mesh) {
  const p = mesh.positions, idx = mesh.indices;
  const nv = p.length / 3;
  const pos = new Float32Array(p.length);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    pos[i] = p[i] / 1000; pos[i + 1] = p[i + 2] / 1000; pos[i + 2] = -p[i + 1] / 1000;
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]); }
  }
  const posBytes = pos.byteLength, idxBytes = idx.length * 4;
  const binLen = posBytes + idxBytes;
  const json = {
    asset: { version: '2.0', generator: 'FormatBox' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: nv, type: 'VEC3', ...(nv ? { min, max } : { min: [0, 0, 0], max: [0, 0, 0] }) },
      { bufferView: 1, componentType: 5125, count: idx.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962 },
      { buffer: 0, byteOffset: posBytes, byteLength: idxBytes, target: 34963 },
    ],
    buffers: [{ byteLength: binLen }],
  };
  const jsonBytes = enc.encode(JSON.stringify(json));
  const jsonLen = Math.ceil(jsonBytes.length / 4) * 4;
  const total = 12 + 8 + jsonLen + 8 + binLen;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLen, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jsonLen);
  out.set(jsonBytes, 20);
  const o = 20 + jsonLen;
  view.setUint32(o, binLen, true);
  view.setUint32(o + 4, 0x004e4942, true);
  out.set(new Uint8Array(pos.buffer), o + 8);
  out.set(new Uint8Array(Uint32Array.from(idx).buffer), o + 8 + posBytes);
  return out;
}
