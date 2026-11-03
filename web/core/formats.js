// Какие форматы знает программа, как узнать формат по первым байтам и во что его можно превратить.
// kind: video, audio, image, doc, archive, mesh, gcode.

export const FORMATS = {
  mp4: { kind: 'video', mime: 'video/mp4' },
  mkv: { kind: 'video', mime: 'video/x-matroska' },
  webm: { kind: 'video', mime: 'video/webm' },
  mov: { kind: 'video', mime: 'video/quicktime' },
  avi: { kind: 'video', mime: 'video/x-msvideo' },
  gif: { kind: 'video', mime: 'image/gif' },
  mpg: { kind: 'video', mime: 'video/mpeg' },
  ts: { kind: 'video', mime: 'video/mp2t' },
  flv: { kind: 'video', mime: 'video/x-flv' },
  wmv: { kind: 'video', mime: 'video/x-ms-wmv' },
  '3gp': { kind: 'video', mime: 'video/3gpp' },
  mp3: { kind: 'audio', mime: 'audio/mpeg' },
  wav: { kind: 'audio', mime: 'audio/wav' },
  flac: { kind: 'audio', mime: 'audio/flac' },
  ogg: { kind: 'audio', mime: 'audio/ogg' },
  opus: { kind: 'audio', mime: 'audio/opus' },
  m4a: { kind: 'audio', mime: 'audio/mp4' },
  aac: { kind: 'audio', mime: 'audio/aac' },
  aiff: { kind: 'audio', mime: 'audio/aiff' },
  wma: { kind: 'audio', mime: 'audio/x-ms-wma' },
  png: { kind: 'image', mime: 'image/png' },
  jpg: { kind: 'image', mime: 'image/jpeg' },
  webp: { kind: 'image', mime: 'image/webp' },
  avif: { kind: 'image', mime: 'image/avif' },
  bmp: { kind: 'image', mime: 'image/bmp' },
  ico: { kind: 'image', mime: 'image/x-icon' },
  heic: { kind: 'image', mime: 'image/heic' },
  tiff: { kind: 'image', mime: 'image/tiff' },
  svg: { kind: 'image', mime: 'image/svg+xml' },
  pdf: { kind: 'doc', mime: 'application/pdf' },
  docx: { kind: 'doc', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  odt: { kind: 'doc', mime: 'application/vnd.oasis.opendocument.text' },
  rtf: { kind: 'doc', mime: 'application/rtf' },
  doc: { kind: 'doc', mime: 'application/msword' },
  md: { kind: 'doc', mime: 'text/markdown' },
  html: { kind: 'doc', mime: 'text/html' },
  txt: { kind: 'doc', mime: 'text/plain' },
  zip: { kind: 'archive', mime: 'application/zip' },
  '7z': { kind: 'archive', mime: 'application/x-7z-compressed' },
  tar: { kind: 'archive', mime: 'application/x-tar' },
  'tar.gz': { kind: 'archive', mime: 'application/gzip' },
  gz: { kind: 'archive', mime: 'application/gzip' },
  rar: { kind: 'archive', mime: 'application/vnd.rar' },
  'tar.xz': { kind: 'archive', mime: 'application/x-xz' },
  'tar.bz2': { kind: 'archive', mime: 'application/x-bzip2' },
  xz: { kind: 'archive', mime: 'application/x-xz' },
  bz2: { kind: 'archive', mime: 'application/x-bzip2' },
  stl: { kind: 'mesh', mime: 'model/stl' },
  obj: { kind: 'mesh', mime: 'model/obj' },
  '3mf': { kind: 'mesh', mime: 'model/3mf' },
  ply: { kind: 'mesh', mime: 'application/ply' },
  glb: { kind: 'mesh', mime: 'model/gltf-binary' },
  gcode: { kind: 'gcode', mime: 'text/x-gcode' },
};

const ALIAS = { jpeg: 'jpg', jpe: 'jpg', tif: 'tiff', htm: 'html', markdown: 'md', tgz: 'tar.gz', mpeg: 'mpg', m4v: 'mp4', heif: 'heic', aif: 'aiff', oga: 'ogg', text: 'txt', gco: 'gcode', g: 'gcode', txz: 'tar.xz', tbz2: 'tar.bz2' };

export function extOf(name) {
  const low = String(name).toLowerCase();
  for (const two of ['tar.gz', 'tar.xz', 'tar.bz2']) if (low.endsWith(`.${two}`)) return two;
  const dot = low.lastIndexOf('.');
  const ext = dot < 0 ? '' : low.slice(dot + 1);
  return ALIAS[ext] || ext;
}

const ascii = (b, at, len) => String.fromCharCode(...b.subarray(at, at + len));
const starts = (b, sig, at = 0) => sig.every((v, i) => b[at + i] === v);

// По содержимому; null - не узнали (тогда решает расширение)
export function sniff(bytes) {
  const b = bytes;
  if (b.length < 4) return null;
  if (starts(b, [0x89, 0x50, 0x4e, 0x47])) return 'png';
  if (starts(b, [0xff, 0xd8, 0xff])) return 'jpg';
  if (ascii(b, 0, 4) === 'GIF8') return 'gif';
  if (ascii(b, 0, 4) === 'RIFF' && b.length >= 12) {
    const sub = ascii(b, 8, 4);
    return { WEBP: 'webp', WAVE: 'wav', 'AVI ': 'avi' }[sub] || null;
  }
  if (ascii(b, 0, 4) === 'FORM' && b.length >= 12 && /^AIF[FC]$/.test(ascii(b, 8, 4))) return 'aiff';
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    if (/^(heic|heix|hevc|mif1|msf1|heim|heis)$/.test(brand)) return 'heic';
    if (/^avi[fs]$/.test(brand)) return 'avif';
    if (brand === 'qt  ') return 'mov';
    if (/^(M4A |M4B |F4A )$/.test(brand)) return 'm4a';
    if (/^3g/.test(brand)) return '3gp';
    return 'mp4';
  }
  if (starts(b, [0x1a, 0x45, 0xdf, 0xa3])) return ascii(b, 0, Math.min(b.length, 64)).includes('webm') ? 'webm' : 'mkv';
  if (ascii(b, 0, 3) === 'ID3') return 'mp3';
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return 'aac';
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0) return 'mp3';
  if (ascii(b, 0, 4) === 'fLaC') return 'flac';
  if (ascii(b, 0, 4) === 'OggS') return ascii(b, 0, Math.min(b.length, 64)).includes('OpusHead') ? 'opus' : 'ogg';
  if (starts(b, [0x30, 0x26, 0xb2, 0x75])) return 'wmv';
  if (ascii(b, 0, 3) === 'FLV') return 'flv';
  if (b[0] === 0x47 && b.length > 188 && b[188] === 0x47) return 'ts';
  if (starts(b, [0x00, 0x00, 0x01, 0xba])) return 'mpg';
  if (ascii(b, 0, 5) === '%PDF-') return 'pdf';
  if (ascii(b, 0, 5) === '{\\rtf') return 'rtf';
  if (starts(b, [0xd0, 0xcf, 0x11, 0xe0])) return 'doc';
  if (starts(b, [0x50, 0x4b, 0x03, 0x04]) || starts(b, [0x50, 0x4b, 0x05, 0x06])) return zipKind(b);
  if (starts(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return '7z';
  if (ascii(b, 0, 4) === 'Rar!') return 'rar';
  if (starts(b, [0x1f, 0x8b])) return 'gz';
  if (starts(b, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return 'xz';
  if (ascii(b, 0, 3) === 'BZh') return 'bz2';
  if (b.length > 262 && ascii(b, 257, 5) === 'ustar') return 'tar';
  if (ascii(b, 0, 2) === 'BM' && b.length > 14) return 'bmp';
  if (starts(b, [0x49, 0x49, 0x2a, 0x00]) || starts(b, [0x4d, 0x4d, 0x00, 0x2a])) return 'tiff';
  if (starts(b, [0x00, 0x00, 0x01, 0x00]) && b[4] > 0 && b[5] === 0) return 'ico';
  if (ascii(b, 0, 4) === 'glTF') return 'glb';
  if (ascii(b, 0, 4) === 'ply\n' || ascii(b, 0, 5) === 'ply\r\n') return 'ply';
  if (b.length >= 84) {
    const tris = b[80] | (b[81] << 8) | (b[82] << 16) | (b[83] << 24);
    if (tris > 0 && b.length === 84 + tris * 50) return 'stl';
  }
  const head = new TextDecoder().decode(b.subarray(0, 512)).replace(/^﻿/, '').trimStart();
  if (/^solid\s/i.test(head) && /facet\s/i.test(head)) return 'stl';
  if (/^<\?xml[^>]*>\s*<svg|^<svg[\s>]/i.test(head)) return 'svg';
  if (/^(<!doctype html|<html)/i.test(head)) return 'html';
  return null;
}

// Zip внутри может быть docx, odt, 3mf: смотрим имена первых записей
function zipKind(b) {
  const head = ascii(b, 0, Math.min(b.length, 4096));
  if (head.includes('mimetypeapplication/vnd.oasis.opendocument.text')) return 'odt';
  if (head.includes('word/')) return 'docx';
  if (head.includes('3D/3dmodel.model') || head.includes('3D/')) return '3mf';
  return 'zip';
}

export function detect(bytes, name = '') {
  const byName = extOf(name);
  const byBytes = sniff(bytes);
  // gz с именем .tar.gz - это tar.gz; zip с именем .docx и т. п. - доверяем имени, если оно того же семейства
  let ext = byBytes || byName;
  if (byBytes === 'gz' && byName === 'tar.gz') ext = 'tar.gz';
  if (byBytes === 'xz' && byName === 'tar.xz') ext = 'tar.xz';
  if (byBytes === 'bz2' && byName === 'tar.bz2') ext = 'tar.bz2';
  if (byBytes === 'zip' && FORMATS[byName] && ['docx', 'odt', '3mf'].includes(byName)) ext = byName;
  if (byBytes === 'mp4' && ['m4a', 'mov'].includes(byName)) ext = byName;
  if (byBytes === 'ogg' && byName === 'opus') ext = 'opus';
  if (byBytes === 'mkv' && byName === 'webm') ext = 'webm';
  if (!byBytes && byName === 'obj') ext = 'obj';
  const info = FORMATS[ext];
  return { ext: info ? ext : byName, kind: info ? info.kind : 'unknown', sure: Boolean(byBytes) };
}

const VIDEO_OUT = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'gif'];
const AUDIO_OUT = ['mp3', 'wav', 'flac', 'ogg', 'opus', 'm4a', 'aiff'];
const IMAGE_OUT = ['png', 'jpg', 'webp', 'avif', 'bmp', 'ico'];
const DOC_OUT = ['pdf', 'docx', 'odt', 'md', 'html', 'txt'];
const ARCHIVE_OUT = ['zip', '7z', 'tar', 'tar.gz'];
const MESH_OUT = ['stl', 'obj', '3mf', 'ply', 'glb'];

// Во что можно превратить. desktop - есть ли настоящие ffmpeg и LibreOffice (больше документов)
export function targetsFor(ext, { desktop = false } = {}) {
  const kind = FORMATS[ext]?.kind;
  const without = (list) => list.filter((x) => x !== ext);
  switch (kind) {
    case 'video': return [...without(VIDEO_OUT), ...AUDIO_OUT];
    case 'audio': return without(AUDIO_OUT);
    case 'image': return ext === 'svg' ? IMAGE_OUT : without(IMAGE_OUT);
    case 'doc': {
      const builtin = ['pdf', 'docx', 'odt', 'md', 'html', 'txt'];
      if (!builtin.includes(ext) && !desktop) return [];
      return without(desktop ? [...DOC_OUT, 'rtf'] : DOC_OUT);
    }
    case 'archive': return without(ARCHIVE_OUT);
    case 'mesh': return without(MESH_OUT);
    default: return [];
  }
}

export function kindOf(ext) {
  return FORMATS[ext]?.kind || 'unknown';
}
