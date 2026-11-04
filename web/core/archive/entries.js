// Записи архива: { path, data: Uint8Array, mtime: Date, dir: boolean }.
// Здесь - обезвреживание путей (zip-slip), дубли, недостающие папки и общие мелочи.

const EMPTY = new Uint8Array(0);

// Путь внутри архива -> безопасный относительный путь с '/' или '' (если ничего не осталось).
// Обратные слэши, буквы дисков, '..', '.', ведущие '/' и управляющие символы убираются.
export function safePath(raw) {
  const parts = String(raw).replace(/\\/g, '/').split('/');
  const out = [];
  for (let p of parts) {
    p = p.replace(/[\u0000-\u001f]/g, '');
    if (out.length === 0) p = p.replace(/^[a-z]:/i, '');
    if (p === '' || p === '.' || p === '..') continue;
    out.push(p);
  }
  return out.join('/');
}

export function toDate(t) {
  if (t instanceof Date) return new Date(t.getTime());
  return new Date(Number.isFinite(t) ? t : 0);
}

function withSuffix(path, n) {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  if (dot > slash + 1) return `${path.slice(0, dot)} (${n})${path.slice(dot)}`;
  return `${path} (${n})`;
}

// Готовит список записей: безопасные пути, все родительские папки, без потерь при дублях
// (второй файл с тем же путём получает « (2)»), папки-дубли сливаются. Вход не меняется.
export function normalizeEntries(entries) {
  const dirs = new Map();
  const files = [];
  for (const e of entries) {
    const path = safePath(e.path);
    const mtime = toDate(e.mtime);
    if (e.dir) {
      if (path && !dirs.has(path)) dirs.set(path, mtime);
    } else {
      files.push({ path: path || 'file', data: e.data ?? EMPTY, mtime });
    }
  }
  // Родительские папки, которых нет в списке, - со временем самого нового содержимого
  const parents = new Map();
  for (const p of [...dirs.keys(), ...files.map((f) => f.path)]) {
    for (let k = p.indexOf('/'); k > 0; k = p.indexOf('/', k + 1)) parents.set(p.slice(0, k), true);
  }
  // без учёта регистра: на Windows и macOS A.txt и a.txt - один файл, вторая запись обрывала распаковку
  const taken = new Set([...dirs.keys(), ...parents.keys()].map((p) => p.toLowerCase()));
  const out = [];
  for (const f of files) {
    let path = f.path;
    for (let n = 2; taken.has(path.toLowerCase()); n++) path = withSuffix(f.path, n);
    taken.add(path.toLowerCase());
    out.push({ path, data: f.data, mtime: f.mtime, dir: false });
  }
  for (const p of parents.keys()) {
    if (dirs.has(p)) continue;
    let newest = 0;
    for (const e of out) if (e.path.startsWith(`${p}/`)) newest = Math.max(newest, e.mtime.getTime());
    for (const [d, t] of dirs) if (d.startsWith(`${p}/`)) newest = Math.max(newest, t.getTime());
    dirs.set(p, new Date(newest));
  }
  for (const [path, mtime] of dirs) out.push({ path, data: EMPTY, mtime, dir: true });
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function checkAbort(signal) {
  if (signal?.aborted) throw new Error('canceled');
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes) {
  let c = ~0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}

export const utf8 = (s) => new TextEncoder().encode(s);

// Имена в старых архивах: UTF-8, если байты им являются, иначе cp866 (русский DOS/Windows-zip)
export function decodeName(bytes, isUtf8) {
  if (isUtf8 || bytes.every((b) => b < 0x80)) return new TextDecoder().decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('ibm866').decode(bytes);
  }
}

export function concat(parts) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
