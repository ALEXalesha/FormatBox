// tar: ustar + pax-заголовки для длинных и не-ASCII имён, отрицательного или огромного времени и размера.
// Чтение понимает ustar, pax (x), GNU-длинные имена (L) и размер в base-256.
import { checkAbort, concat, utf8 } from './entries.js';

const BLOCK = 512;
const MAX_OCTAL = 0o77777777777; // 11 восьмеричных цифр

function putString(h, off, len, s) {
  const b = utf8(s);
  h.set(b.subarray(0, len), off);
}

function putOctal(h, off, len, n) {
  putString(h, off, len, n.toString(8).padStart(len - 1, '0'));
}

function paxRecord(key, value) {
  const body = utf8(` ${key}=${value}\n`).length;
  let len = body + 1;
  while (String(len).length + body !== len) len = String(len).length + body;
  return utf8(`${len} ${key}=${value}\n`);
}

// Разбить ASCII-путь на prefix (до 155) и name (до 100) по '/'; null - если нельзя
function splitUstar(path) {
  if (!/^[\x20-\x7e]*$/.test(path)) return null;
  if (path.length <= 100) return ['', path];
  for (let k = path.indexOf('/'); k > 0; k = path.indexOf('/', k + 1)) {
    if (k <= 155 && path.length - k - 1 <= 100 && path.length - k - 1 > 0) return [path.slice(0, k), path.slice(k + 1)];
  }
  return null;
}

function header(name, prefix, size, mtimeSec, type, mode) {
  const h = new Uint8Array(BLOCK);
  putString(h, 0, 100, name);
  putOctal(h, 100, 8, mode);
  putOctal(h, 108, 8, 0);
  putOctal(h, 116, 8, 0);
  putOctal(h, 124, 12, size);
  putOctal(h, 136, 12, mtimeSec);
  h.fill(0x20, 148, 156);
  h[156] = type.charCodeAt(0);
  putString(h, 257, 8, 'ustar\u000000');
  putString(h, 345, 155, prefix);
  let sum = 0;
  for (const b of h) sum += b;
  putString(h, 148, 8, `${sum.toString(8).padStart(6, '0')}\u0000 `);
  return h;
}

function pad(n) {
  return new Uint8Array((BLOCK - (n % BLOCK)) % BLOCK);
}

// entries - уже нормализованные записи (см. normalizeEntries)
export function writeTar(entries, { signal, progress } = {}) {
  const parts = [];
  entries.forEach((e, i) => {
    checkAbort(signal);
    const path = e.dir ? `${e.path}/` : e.path;
    const size = e.dir ? 0 : e.data.length;
    const ms = e.mtime.getTime();
    const sec = Math.floor(ms / 1000);
    const split = splitUstar(path);
    const pax = [];
    if (!split) pax.push(paxRecord('path', path));
    if (sec < 0 || sec > MAX_OCTAL) pax.push(paxRecord('mtime', String(sec)));
    if (size > MAX_OCTAL) pax.push(paxRecord('size', String(size)));
    if (pax.length) {
      const body = concat(pax);
      const short = path.replace(/[^\x20-\x7e]/g, '_').slice(-80);
      parts.push(header(`PaxHeader/${short}`, '', body.length, 0, 'x', 0o644), body, pad(body.length));
    }
    const [prefix, name] = split ?? ['', path.replace(/[^\x20-\x7e]/g, '_').slice(-100)];
    const okSize = size > MAX_OCTAL ? 0 : size;
    const okSec = sec < 0 || sec > MAX_OCTAL ? 0 : sec;
    parts.push(header(name, prefix, okSize, okSec, e.dir ? '5' : '0', e.dir ? 0o755 : 0o644));
    if (!e.dir) parts.push(e.data, pad(size));
    progress?.((i + 1) / entries.length);
  });
  parts.push(new Uint8Array(BLOCK * 2));
  return concat(parts);
}

function readString(b, off, len) {
  let end = off;
  while (end < off + len && b[end] !== 0) end++;
  return new TextDecoder().decode(b.subarray(off, end));
}

function readNumber(b, off, len) {
  if (b[off] & 0x80) {
    // base-256 (GNU): большое число в двоичном виде
    let n = b[off] & 0x7f;
    for (let i = off + 1; i < off + len; i++) n = n * 256 + b[i];
    return n;
  }
  const s = readString(b, off, len).trim();
  return s ? parseInt(s, 8) : 0;
}

export function checksumOk(h) {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
  return sum === readNumber(h, 148, 8);
}

export function isTar(b) {
  if (b.length < BLOCK) return false;
  if (readString(b, 257, 5) === 'ustar') return true;
  // пустой tar - только нулевые блоки
  if (b.length >= BLOCK * 2 && b.length % BLOCK === 0 && b.every((x) => x === 0)) return true;
  return b.subarray(0, BLOCK).some((x) => x !== 0) && checksumOk(b.subarray(0, BLOCK));
}

function parsePax(data) {
  // запись: "<длина в байтах> ключ=значение\n"
  const out = {};
  for (let i = 0; i < data.length;) {
    const rec = new TextDecoder().decode(data.subarray(i, i + 24));
    const len = parseInt(rec, 10);
    if (!(len > 0)) break;
    const text = new TextDecoder().decode(data.subarray(i, i + len));
    const eq = text.indexOf('=');
    out[text.slice(text.indexOf(' ') + 1, eq)] = text.slice(eq + 1, -1);
    i += len;
  }
  return out;
}

export function readTar(b, { signal } = {}) {
  const out = [];
  let pax = {};
  let longName = null;
  for (let off = 0; off + BLOCK <= b.length;) {
    checkAbort(signal);
    const h = b.subarray(off, off + BLOCK);
    if (h.every((x) => x === 0)) break;
    if (!checksumOk(h)) throw new Error('tar: damaged header');
    const type = String.fromCharCode(h[156] || 48);
    let size = readNumber(h, 124, 12);
    if (pax.size !== undefined) size = Number(pax.size);
    const start = off + BLOCK;
    const data = b.subarray(start, start + size);
    off = start + Math.ceil(size / BLOCK) * BLOCK;
    if (type === 'x') { pax = parsePax(data); continue; }
    if (type === 'L') { longName = readString(data, 0, data.length); continue; }
    if (type === 'g' || type === 'K') continue;
    let path = readString(h, 0, 100);
    if (readString(h, 257, 5) === 'ustar') {
      const prefix = readString(h, 345, 155);
      if (prefix) path = `${prefix}/${path}`;
    }
    path = pax.path ?? longName ?? path;
    const mtime = new Date(pax.mtime !== undefined ? Math.round(parseFloat(pax.mtime) * 1000) : readNumber(h, 136, 12) * 1000);
    pax = {};
    longName = null;
    const dir = type === '5' || (type === '0' && path.endsWith('/') && size === 0);
    if (dir) out.push({ path, data: new Uint8Array(0), mtime, dir: true });
    else if (type === '0' || type === '7') out.push({ path, data: data.slice(), mtime, dir: false });
    // ссылки, устройства и прочее пропускаем: в модели записей их нет
  }
  return out;
}
