const T = (name) => `tests/core/image-${name}.test.js`;
const F = (name) => `web/core/image/${name}.js`;

export default [
  // PNG
  { name: 'image: png paeth picks c on tie', file: F('png'), from: 'return pb <= pc ? b : c;', to: 'return pb < pc ? b : c;', test: T('png') },
  { name: 'image: png sub-byte samples read from wrong bit', file: F('png'), from: 'return (row[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);', to: 'return (row[bit >> 3] >> (bit & 7)) & ((1 << depth) - 1);', test: T('png') },
  { name: 'image: png Adam7 pass 4 wrong step', file: F('png'), from: '[2, 0, 4, 4]', to: '[2, 0, 4, 2]', test: T('png') },
  { name: 'image: png palette indices not packed', file: F('png'), from: 'cur[bit >> 3] |= colors.get(k) << (8 - depth - (bit & 7));', to: 'cur[bit >> 3] |= colors.get(k);', test: T('png') },
  // Геометрия
  { name: 'image: resize weights not normalized', file: F('geometry'), from: 'for (let k = 0; k < w.length; k++) w[k] /= sum;', to: '', test: T('geometry') },
  { name: 'image: downscale kernel not stretched (aliasing)', file: F('geometry'), from: 'fs = Math.max(1, scale);', to: 'fs = 1;', test: T('geometry') },
  { name: 'image: area weights ignore partial overlap', file: F('geometry'), from: 'w[j - start] = Math.min(b, j + 1) - Math.max(a, j);', to: 'w[j - start] = 1;', test: T('geometry') },
  { name: 'image: fitToPixels exceeds the limit', file: F('geometry'), from: 'if (n * m <= maxPixels) return', to: 'if (n * m <= maxPixels * 1.2) return', test: T('geometry') },
  { name: 'image: cover mode not exact size', file: F('geometry'), from: "if (mode === 'cover') return resize(cropToAspect(image, W, H), W, H, opts);", to: "if (mode === 'cover') return cropToAspect(image, W, H);", test: T('geometry') },
  { name: 'image: rotate90 maps to wrong place', file: F('geometry'), from: 'remap(image, h, image.width, (x, y) => x * h + (h - 1 - y));', to: 'remap(image, h, image.width, (x, y) => x * h + y);', test: T('geometry') },
  // Сжатие до размера
  { name: 'image: target returns stale bytes', file: F('target'), from: 'if (b.length <= maxBytes) { lo = mid; best = b; } else hi = mid;', to: 'if (b.length <= maxBytes) { lo = mid; } else hi = mid;', test: T('target') },
  { name: 'image: target stops quality search early', file: F('target'), from: 'while (hi - lo > 1) {', to: 'while (hi - lo > 4) {', test: T('target') },
  { name: 'image: target accepts too big minimum', file: F('target'), from: 'if (best.length > maxBytes) return { bytes: null, minBytes: best.length };', to: '', test: T('target') },
  // Метаданные
  { name: 'image: exif APP1 kept in JPEG', file: F('exif'), from: "if (marker === 0xe1 && startsWith(bytes, dataStart, 'Exif\\0')) return 'exif';", to: "if (marker === 0xe1 && startsWith(bytes, dataStart, 'Exif\\0')) return 'image';", test: T('exif') },
  { name: 'image: exif PNG eXIf chunk kept', file: F('exif'), from: "new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'])", to: "new Set(['tEXt', 'zTXt', 'iTXt', 'tIME'])", test: T('exif') },
  { name: 'image: exif WebP RIFF size not updated', file: F('exif'), from: 'new DataView(out.buffer).setUint32(4, out.length - 8, true);', to: '', test: T('exif') },
  { name: 'image: exif WebP VP8X flags left set', file: F('exif'), from: 'if (vp8x) vp8x[8] &= ~flags & 255;', to: '', test: T('exif') },
  { name: 'image: exif TIFF big-endian read as little', file: F('exif'), from: 'const le = t[0] === 0x49 && t[1] === 0x49;', to: 'const le = true;', test: T('exif') },
  { name: 'image: exif JPEG trailer after EOI kept', file: F('exif'), from: 'if (m === 0xd9) return p + 2;', to: 'if (m === 0xd9) return n;', test: T('exif') },
  // BMP, ICO, TIFF
  { name: 'image: bmp rows read top-down', file: F('bmp'), from: 'const row = (y) => data + (topDown ? y : height - 1 - y) * stride;', to: 'const row = (y) => data + y * stride;', test: T('bmp') },
  { name: 'image: bmp alpha mask ignored', file: F('bmp'), from: 'out[o + 3] = ch[3] ? take(v, ch[3]) : 255;', to: 'out[o + 3] = 255;', test: T('bmp') },
  { name: 'image: ico entry count wrong', file: F('ico'), from: 'dv.setUint16(4, list.length, true);', to: 'dv.setUint16(4, 1, true);', test: T('bmp') },
  { name: 'image: tiff LZW code width grows late', file: F('tiff'), from: 'if (next + 1 >= 1 << width && width < 12) width++;', to: 'if (next >= 1 << width && width < 12) width++;', test: T('tiff') },
  { name: 'image: tiff predictor ignored', file: F('tiff'), from: 'if (predictor === 2 && bits >= 8) {', to: 'if (false) {', test: T('tiff') },
  { name: 'image: tiff PackBits run one short', file: F('tiff'), from: 'const k = Math.min(257 - n, size - o);', to: 'const k = Math.min(256 - n, size - o);', test: T('tiff') },
  // Фон
  { name: 'image: background tolerance 0 removes nothing', file: F('background'), from: 'const isBg = (i) => dist[i] <= tolerance;', to: 'const isBg = (i) => dist[i] < tolerance;', test: T('background') },
  { name: 'image: background soft edge eats the figure', file: F('background'), from: 'if (a >= 1 || data[p + 3] === 0) continue;', to: 'if (data[p + 3] === 0) continue;', test: T('background') },
  { name: 'image: background colour not decontaminated', file: F('background'), from: 'for (let c = 0; c < 3; c++) out[p + c] = (data[p + c] - (1 - a) * bg[c]) / a;', to: '', test: T('background') },
  { name: 'image: chroma key only from edges', file: F('background'), from: "if (mode === 'color') {", to: 'if (false) {', test: T('background') },
  // Водяной знак
  { name: 'image: watermark negative opacity not clamped', file: F('watermark'), from: 'const op = Math.max(0, Math.min(1, opacity));', to: 'const op = Math.min(1, Math.abs(opacity));', test: T('watermark') },
  { name: 'image: watermark right anchor offset sign', file: F('watermark'), from: 'const px = a[0] === 1 ? W - sw - x :', to: 'const px = a[0] === 1 ? W - sw + x :', test: T('watermark') },
  { name: 'image: watermark blend ignores base alpha', file: F('watermark'), from: 'const k = (da * (1 - sa)) / oa;', to: 'const k = 1 - sa;', test: T('watermark') },
  { name: 'image: watermark tile grid starts inside', file: F('watermark'), from: 'const startX = (px % stepX) - (px % stepX > 0 ? stepX : 0);', to: 'const startX = px % stepX;', test: T('watermark') },
  { name: 'image: flatten keeps transparent colour', file: F('watermark'), from: 'out[i] = data[i] * a + background[0] * (1 - a);', to: 'out[i] = data[i];', test: T('index') },
  { name: 'image: exif orientation out of range passed through', file: F('exif'), from: 'orientation: o >= 1 && o <= 8 ? o : 1,', to: 'orientation: o ?? 1,', test: T('exif') },
  { name: 'image: tiff encoder drops alpha samples', file: F('tiff'), from: 'if (alpha) raw[i++] = data[p + 3];', to: 'if (alpha) raw[i++] = 255;', test: T('tiff') },
  { name: 'image: ico not recognized by bytes', file: F('index'), from: "if (isIco(bytes)) return 'ico';", to: '', test: T('index') },
];
