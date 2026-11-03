// Чтение и запись сеток: STL (ascii/binary), OBJ, PLY (ascii/binary), 3MF и GLB (в io-pack.js).
import { weldExact, num } from './common.js';
import { read3mf, write3mf, readGlb, writeGlb } from './io-pack.js';

export const MESH_FORMATS = ['stl', 'obj', 'ply', '3mf', 'glb'];

const dec = new TextDecoder();
const enc = new TextEncoder();

function normExt(ext) {
  return String(ext).toLowerCase().replace(/^.*\./, '');
}

// opts.merge = false оставляет вершины как в файле (иначе одинаковые координаты сливаются)
export function readMesh(bytes, ext, opts = {}) {
  const kind = normExt(ext);
  const readers = { stl: readStl, obj: readObj, ply: readPly, '3mf': read3mf, glb: readGlb };
  const reader = readers[kind];
  if (!reader) throw new Error(`unsupported mesh format: ${ext}`);
  const mesh = reader(bytes);
  return opts.merge === false ? mesh : weldExact(mesh);
}

export function writeMesh(mesh, ext, opts = {}) {
  const kind = normExt(ext);
  const writers = { stl: writeStl, obj: writeObj, ply: writePly, '3mf': write3mf, glb: writeGlb };
  const writer = writers[kind];
  if (!writer) throw new Error(`unsupported mesh format: ${ext}`);
  return writer(mesh, opts);
}

// ---------- STL ----------
function isBinaryStl(bytes) {
  if (bytes.length < 84) return false;
  const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true);
  if (84 + 50 * n === bytes.length) return true;
  const head = dec.decode(bytes.subarray(0, Math.min(bytes.length, 512))).trimStart();
  return !(head.startsWith('solid') && /facet|endsolid/.test(dec.decode(bytes.subarray(0, Math.min(bytes.length, 4096)))));
}

export function readStl(bytes) {
  if (isBinaryStl(bytes)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = Math.min(view.getUint32(80, true), Math.floor((bytes.length - 84) / 50));
    const positions = new Float32Array(n * 9);
    for (let t = 0; t < n; t++) {
      const off = 84 + 50 * t + 12;
      for (let k = 0; k < 9; k++) positions[9 * t + k] = view.getFloat32(off + 4 * k, true);
    }
    return { positions, indices: Uint32Array.from({ length: n * 3 }, (_, i) => i) };
  }
  const text = dec.decode(bytes);
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  const pos = [];
  for (let m; (m = re.exec(text));) pos.push(+m[1], +m[2], +m[3]);
  pos.length -= pos.length % 9;
  return { positions: Float32Array.from(pos), indices: Uint32Array.from({ length: pos.length / 3 }, (_, i) => i) };
}

function faceNormal(p, a, b, c) {
  const ux = p[3 * b] - p[3 * a], uy = p[3 * b + 1] - p[3 * a + 1], uz = p[3 * b + 2] - p[3 * a + 2];
  const vx = p[3 * c] - p[3 * a], vy = p[3 * c + 1] - p[3 * a + 1], vz = p[3 * c + 2] - p[3 * a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

export function writeStl(mesh, opts = {}) {
  const p = mesh.positions, idx = mesh.indices;
  const n = idx.length / 3;
  const name = String(opts.name ?? 'formatbox').replace(/\s+/g, '_');
  if (opts.ascii) {
    const lines = [`solid ${name}`];
    for (let t = 0; t < n; t++) {
      const [a, b, c] = [idx[3 * t], idx[3 * t + 1], idx[3 * t + 2]];
      lines.push(` facet normal ${faceNormal(p, a, b, c).map(num).join(' ')}`, '  outer loop');
      for (const v of [a, b, c]) lines.push(`   vertex ${num(p[3 * v])} ${num(p[3 * v + 1])} ${num(p[3 * v + 2])}`);
      lines.push('  endloop', ' endfacet');
    }
    lines.push(`endsolid ${name}`, '');
    return enc.encode(lines.join('\n'));
  }
  const out = new Uint8Array(84 + 50 * n);
  out.set(enc.encode(`binary STL ${name}`.slice(0, 80)));
  const view = new DataView(out.buffer);
  view.setUint32(80, n, true);
  for (let t = 0; t < n; t++) {
    const off = 84 + 50 * t;
    const v = [idx[3 * t], idx[3 * t + 1], idx[3 * t + 2]];
    faceNormal(p, ...v).forEach((x, k) => view.setFloat32(off + 4 * k, x, true));
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) view.setFloat32(off + 12 + 12 * j + 4 * k, p[3 * v[j] + k], true);
  }
  return out;
}

// ---------- OBJ ----------
export function readObj(bytes) {
  const pos = [];
  const idx = [];
  for (const raw of dec.decode(bytes).split('\n')) {
    const line = raw.trim();
    if (line.startsWith('v ')) {
      const [, x, y, z] = line.split(/\s+/);
      pos.push(+x, +y, +z);
    } else if (line.startsWith('f ')) {
      const nv = pos.length / 3;
      const face = [];
      for (const tok of line.split(/\s+/).slice(1)) {
        const i = parseInt(tok, 10);
        const v = i < 0 ? nv + i : i - 1;
        if (Number.isFinite(v) && v >= 0 && v < nv) face.push(v);
      }
      for (let k = 1; k + 1 < face.length; k++) idx.push(face[0], face[k], face[k + 1]);
    }
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}

export function writeObj(mesh) {
  const p = mesh.positions, idx = mesh.indices;
  const lines = ['# FormatBox'];
  for (let i = 0; i < p.length; i += 3) lines.push(`v ${num(p[i])} ${num(p[i + 1])} ${num(p[i + 2])}`);
  for (let i = 0; i < idx.length; i += 3) lines.push(`f ${idx[i] + 1} ${idx[i + 1] + 1} ${idx[i + 2] + 1}`);
  lines.push('');
  return enc.encode(lines.join('\n'));
}

// ---------- PLY ----------
const PLY_TYPES = {
  char: ['Int8', 1], int8: ['Int8', 1], uchar: ['Uint8', 1], uint8: ['Uint8', 1],
  short: ['Int16', 2], int16: ['Int16', 2], ushort: ['Uint16', 2], uint16: ['Uint16', 2],
  int: ['Int32', 4], int32: ['Int32', 4], uint: ['Uint32', 4], uint32: ['Uint32', 4],
  float: ['Float32', 4], float32: ['Float32', 4], double: ['Float64', 8], float64: ['Float64', 8],
};

function plyHeader(bytes) {
  const probe = dec.decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
  const m = /end_header\r?\n/.exec(probe);
  if (!probe.startsWith('ply') || !m) throw new Error('not a PLY file');
  const header = probe.slice(0, m.index);
  const elements = [];
  let format = 'ascii';
  for (const line of header.split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t[0] === 'format') format = t[1];
    else if (t[0] === 'element') elements.push({ name: t[1], count: +t[2], props: [] });
    else if (t[0] === 'property' && elements.length) {
      const el = elements.at(-1);
      if (t[1] === 'list') el.props.push({ name: t[4], list: true, countType: t[2], type: t[3] });
      else el.props.push({ name: t[2], type: t[1] });
    }
  }
  return { format, elements, offset: enc.encode(probe.slice(0, m.index + m[0].length)).length };
}

export function readPly(bytes) {
  const { format, elements, offset } = plyHeader(bytes);
  const pos = [];
  const idx = [];
  const take = (el, values) => {
    if (el.name === 'vertex') {
      pos.push(values.x ?? 0, values.y ?? 0, values.z ?? 0);
    } else if (el.name === 'face') {
      const list = values.vertex_indices ?? values.vertex_index ?? [];
      for (let k = 1; k + 1 < list.length; k++) idx.push(list[0], list[k], list[k + 1]);
    }
  };
  if (format === 'ascii') {
    const tokens = dec.decode(bytes.subarray(offset)).split(/\s+/).filter(Boolean);
    let t = 0;
    for (const el of elements) {
      for (let i = 0; i < el.count; i++) {
        const values = {};
        for (const pr of el.props) {
          if (pr.list) {
            const n = +tokens[t++];
            values[pr.name] = tokens.slice(t, t + n).map(Number);
            t += n;
          } else values[pr.name] = +tokens[t++];
        }
        take(el, values);
      }
    }
  } else {
    const little = format === 'binary_little_endian';
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let o = offset;
    const read = (type) => {
      const [fn, size] = PLY_TYPES[type];
      const v = view[`get${fn}`](o, little);
      o += size;
      return v;
    };
    for (const el of elements) {
      for (let i = 0; i < el.count; i++) {
        const values = {};
        for (const pr of el.props) {
          if (pr.list) {
            const n = read(pr.countType);
            const list = new Array(n);
            for (let k = 0; k < n; k++) list[k] = read(pr.type);
            values[pr.name] = list;
          } else values[pr.name] = read(pr.type);
        }
        take(el, values);
      }
    }
  }
  // грани со ссылками за пределы вершин отбрасываем
  const nv = pos.length / 3;
  const ok = (v) => v >= 0 && v < nv;
  const good = [];
  for (let i = 0; i < idx.length; i += 3) if (ok(idx[i]) && ok(idx[i + 1]) && ok(idx[i + 2])) good.push(idx[i], idx[i + 1], idx[i + 2]);
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(good) };
}

export function writePly(mesh) {
  const p = mesh.positions, idx = mesh.indices;
  const nv = p.length / 3, nf = idx.length / 3;
  const head = enc.encode(`ply\nformat binary_little_endian 1.0\ncomment FormatBox\nelement vertex ${nv}\nproperty float x\nproperty float y\nproperty float z\nelement face ${nf}\nproperty list uchar int vertex_indices\nend_header\n`);
  const out = new Uint8Array(head.length + nv * 12 + nf * 13);
  out.set(head);
  const view = new DataView(out.buffer);
  let o = head.length;
  for (let i = 0; i < p.length; i++, o += 4) view.setFloat32(o, p[i], true);
  for (let f = 0; f < nf; f++) {
    view.setUint8(o, 3);
    for (let k = 0; k < 3; k++) view.setInt32(o + 1 + 4 * k, idx[3 * f + k], true);
    o += 13;
  }
  return out;
}
