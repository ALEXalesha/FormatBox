// Метаданные: чтение главного из EXIF (ориентация, GPS, камера, дата) и удаление метаданных из
// JPEG, PNG и WebP без перекодирования - сжатые данные изображения копируются байт в байт.
import { isPng, readChunks } from './png.js';

const ascii = (b, s, n) => String.fromCharCode(...b.subarray(s, s + n));
const startsWith = (b, s, text) => s + text.length <= b.length && ascii(b, s, text.length) === text;

export function sniffContainer(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (isPng(bytes)) return 'png';
  if (bytes.length >= 12 && startsWith(bytes, 0, 'RIFF') && startsWith(bytes, 8, 'WEBP')) return 'webp';
  return null;
}

// ---------- TIFF / EXIF ----------
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8 };

// Минимальный разбор TIFF IFD (II и MM). Любая порча - не исключение, а пустые поля.
export function parseTiff(t) {
  if (t.length < 8) return null;
  const le = t[0] === 0x49 && t[1] === 0x49;
  if (!le && !(t[0] === 0x4d && t[1] === 0x4d)) return null;
  const u16 = (o) => (o + 2 > t.length ? 0 : le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]);
  const u32 = (o) => (o + 4 > t.length ? 0 : (le ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16) | (t[o + 3] << 24))
    : ((t[o] << 24) | (t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3])) >>> 0);
  if (u16(2) !== 42) return null;
  const ifd = (off) => {
    const tags = new Map();
    if (!off || off + 2 > t.length) return tags;
    const n = u16(off);
    for (let i = 0; i < n && off + 2 + i * 12 + 12 <= t.length; i++) {
      const e = off + 2 + i * 12;
      const type = u16(e + 2), count = u32(e + 4), size = (TYPE_SIZE[type] || 1) * count;
      tags.set(u16(e), { type, count, at: size <= 4 ? e + 8 : u32(e + 8) });
    }
    return tags;
  };
  const num = (tag) => (!tag ? undefined : tag.type === 3 ? u16(tag.at) : tag.type === 4 ? u32(tag.at) : t[tag.at]);
  const str = (tag) => {
    if (!tag || tag.type !== 2 || tag.at + tag.count > t.length) return undefined;
    return ascii(t, tag.at, tag.count).replace(/\0[\s\S]*$/, '').trim() || undefined;
  };
  const rationals = (tag) => {
    if (!tag || tag.type !== 5 || tag.at + tag.count * 8 > t.length) return null;
    return Array.from({ length: tag.count }, (_, i) => u32(tag.at + i * 8) / (u32(tag.at + i * 8 + 4) || 1));
  };
  const ifd0 = ifd(u32(4));
  const exif = ifd(num(ifd0.get(0x8769)));
  const gpsIfd = ifd(num(ifd0.get(0x8825)));
  let gps = null;
  const lat = rationals(gpsIfd.get(2)), lon = rationals(gpsIfd.get(4));
  if (lat?.length === 3 && lon?.length === 3) {
    const deg = (v) => v[0] + v[1] / 60 + v[2] / 3600;
    gps = { lat: deg(lat) * (str(gpsIfd.get(1)) === 'S' ? -1 : 1), lon: deg(lon) * (str(gpsIfd.get(3)) === 'W' ? -1 : 1) };
  }
  const o = num(ifd0.get(0x0112));
  return {
    orientation: o >= 1 && o <= 8 ? o : 1,
    make: str(ifd0.get(0x010f)),
    model: str(ifd0.get(0x0110)),
    software: str(ifd0.get(0x0131)),
    date: str(exif.get(0x9003)) ?? str(ifd0.get(0x0132)),
    hasGps: gpsIfd.size > 0,
    gps,
  };
}

// ---------- JPEG ----------
const u16be = (b, o) => (b[o] << 8) | b[o + 1];

// Сегменты до первого SOS, начало скана и конец (после EOI). Хвост после EOI - чужие данные.
export function jpegSegments(bytes) {
  const segments = [];
  let p = 2, scan = -1;
  while (p + 4 <= bytes.length && bytes[p] === 0xff) {
    const m = bytes[p + 1];
    if (m === 0xff) { p += 1; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
    if (m === 0xd9) break;
    const end = p + 2 + u16be(bytes, p + 2);
    if (m === 0xda) { scan = p; break; }
    segments.push({ marker: m, start: p, dataStart: p + 4, end: Math.min(end, bytes.length) });
    p = end;
  }
  return { segments, scan, scanEnd: scan < 0 ? -1 : findEoi(bytes, scan) };
}

// Обход сжатых данных: FF 00 и RSTn - данные, другие маркеры (DHT, SOS прогрессива) пропускаются.
function findEoi(bytes, p) {
  const n = bytes.length;
  while (p + 1 < n) {
    const m = bytes[p + 1];
    if (m === 0xd9) return p + 2;
    p += 2;
    if (!(m >= 0xd0 && m <= 0xd7) && m !== 0x01) p += u16be(bytes, p);
    while (p + 1 < n && !(bytes[p] === 0xff && bytes[p + 1] !== 0 && bytes[p + 1] !== 0xff && !(bytes[p + 1] >= 0xd0 && bytes[p + 1] <= 0xd7))) p += 1;
  }
  return n;
}

function jpegKind(bytes, s) {
  const { marker, dataStart } = s;
  if (marker === 0xe1 && startsWith(bytes, dataStart, 'Exif\0')) return 'exif';
  if (marker === 0xe1 && (startsWith(bytes, dataStart, 'http://ns.adobe.com/') || startsWith(bytes, dataStart, '<?xpacket'))) return 'xmp';
  if (marker === 0xe2 && startsWith(bytes, dataStart, 'ICC_PROFILE\0')) return 'icc';
  if (marker === 0xed) return 'iptc';
  if (marker === 0xfe) return 'comment';
  if (marker === 0xe0 && startsWith(bytes, dataStart, 'JFIF\0')) return 'jfif';
  if (marker === 0xee) return 'adobe'; // нужен для правильных цветов (CMYK/YCCK)
  if (marker >= 0xe0 && marker <= 0xef) return 'app';
  return 'image';
}

// Маленький EXIF только с ориентацией - чтобы снимок не «лёг на бок» после очистки.
function orientationApp1(o) {
  const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0, 0, 0];
  const body = [...'Exif\0\0'].map((c) => c.charCodeAt(0)).concat(tiff);
  return Uint8Array.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255, ...body]);
}

// ---------- WebP ----------
export function riffChunks(bytes) {
  const list = [];
  let p = 12;
  const limit = Math.min(bytes.length, 8 + (((bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24)) >>> 0)));
  while (p + 8 <= limit) {
    const size = (bytes[p + 4] | (bytes[p + 5] << 8) | (bytes[p + 6] << 16) | (bytes[p + 7] << 24)) >>> 0;
    const end = Math.min(limit, p + 8 + size + (size & 1));
    list.push({ type: ascii(bytes, p, 4), start: p, dataStart: p + 8, length: Math.min(size, limit - p - 8), end });
    p = end;
  }
  return list;
}

// ---------- общий интерфейс ----------
export function readExif(bytes) {
  const format = sniffContainer(bytes);
  const info = { format, orientation: 1, hasExif: false, hasGps: false, gps: null, hasXmp: false, hasIptc: false, hasIcc: false, hasText: false };
  const addTiff = (tiff) => {
    info.hasExif = true;
    const t = parseTiff(tiff);
    if (t) {
      for (const [k, v] of Object.entries(t)) if (v !== undefined) info[k] = v;
    }
  };
  if (format === 'jpeg') {
    for (const s of jpegSegments(bytes).segments) {
      const kind = jpegKind(bytes, s);
      if (kind === 'exif') addTiff(bytes.subarray(s.dataStart + 6, s.end));
      else if (kind === 'xmp') info.hasXmp = true;
      else if (kind === 'icc') info.hasIcc = true;
      else if (kind === 'iptc') info.hasIptc = true;
      else if (kind === 'comment') info.hasText = true;
    }
  } else if (format === 'png') {
    for (const c of readChunks(bytes)) {
      const d = bytes.subarray(c.dataStart, c.dataStart + c.length);
      if (c.type === 'eXIf') addTiff(d);
      else if (c.type === 'iCCP') info.hasIcc = true;
      else if (/^(tEXt|zTXt|iTXt)$/.test(c.type)) {
        if (startsWith(d, 0, 'XML:com.adobe.xmp') || startsWith(d, 0, 'Raw profile type xmp')) info.hasXmp = true;
        else if (startsWith(d, 0, 'Raw profile type')) info.hasExif = true;
        else info.hasText = true;
      }
    }
  } else if (format === 'webp') {
    for (const c of riffChunks(bytes)) {
      const d = bytes.subarray(c.dataStart, c.dataStart + c.length);
      if (c.type === 'EXIF') addTiff(startsWith(d, 0, 'Exif\0\0') ? d.subarray(6) : d);
      else if (c.type === 'XMP ') info.hasXmp = true;
      else if (c.type === 'ICCP') info.hasIcc = true;
    }
  }
  return info;
}

const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

// Удаляет метаданные. Возвращает { bytes, orientation (исходная, 1 - нет), removed: [виды] }.
// keepIcc - оставить цветовой профиль; keepOrientation (JPEG) - оставить только тег ориентации.
export function stripMetadata(bytes, { keepIcc = true, keepOrientation = false } = {}) {
  const format = sniffContainer(bytes);
  const { orientation } = readExif(bytes);
  const removed = new Set();
  const parts = [];
  if (format === 'jpeg') {
    const { segments, scan, scanEnd } = jpegSegments(bytes);
    if (scan < 0) throw new Error('JPEG: no image data');
    parts.push(bytes.subarray(0, 2));
    let pending = keepOrientation && orientation !== 1;
    for (const s of segments) {
      const kind = jpegKind(bytes, s);
      if (kind === 'image' || kind === 'jfif' || kind === 'adobe' || (kind === 'icc' && keepIcc)) {
        // Ориентацию ставим сразу после JFIF (или первой), как пишут камеры.
        if (pending && kind !== 'jfif') { parts.push(orientationApp1(orientation)); pending = false; }
        parts.push(bytes.subarray(s.start, s.end));
      } else removed.add(kind);
    }
    if (pending) parts.push(orientationApp1(orientation));
    parts.push(bytes.subarray(scan, scanEnd));
    if (scanEnd < bytes.length) removed.add('trailer');
  } else if (format === 'png') {
    parts.push(bytes.subarray(0, 8));
    for (const c of readChunks(bytes)) {
      if (PNG_DROP.has(c.type) || (c.type === 'iCCP' && !keepIcc)) removed.add(c.type);
      else parts.push(bytes.subarray(c.start, c.end));
    }
  } else if (format === 'webp') {
    const drop = { EXIF: 0x08, 'XMP ': 0x04, ICCP: keepIcc ? 0 : 0x20 };
    let flags = 0;
    parts.push(new Uint8Array(12));
    for (const c of riffChunks(bytes)) {
      if (drop[c.type]) { flags |= drop[c.type]; removed.add(c.type.trim()); continue; }
      // Чанк копируется заново: у обрезанного файла длина в заголовке поправляется по факту.
      const piece = new Uint8Array(8 + c.length + (c.length & 1));
      piece.set(bytes.subarray(c.start, c.start + 4));
      new DataView(piece.buffer).setUint32(4, c.length, true);
      piece.set(bytes.subarray(c.dataStart, c.dataStart + c.length), 8);
      parts.push(piece);
    }
    const vp8x = parts.find((p, i) => i > 0 && startsWith(p, 0, 'VP8X'));
    if (vp8x) vp8x[8] &= ~flags & 255;
  } else throw new Error('unsupported image format');
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  if (format === 'webp') {
    out.set([0x52, 0x49, 0x46, 0x46], 0);
    new DataView(out.buffer).setUint32(4, out.length - 8, true);
    out.set([0x57, 0x45, 0x42, 0x50], 8);
  }
  return { bytes: out, orientation, removed: [...removed] };
}
