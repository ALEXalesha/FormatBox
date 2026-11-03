// Картинки: все экспорты части и общий вход для окна/Worker - что умеем читать и писать, кто это делает.
//   read/write: 'core' - этот модуль; 'canvas' - окно через canvas (createImageBitmap / toBlob);
//   'module' - отдельный модуль окна (heic2any); null - не умеем.
import { decodePng, encodePng, isPng } from './png.js';
import { decodeBmp, encodeBmp, isBmp } from './bmp.js';
import { decodeIcoLargest, encodeIco, isIco } from './ico.js';
import { decodeTiff, encodeTiff, isTiff } from './tiff.js';
import { flatten } from './watermark.js';

export { decodePng, encodePng, readChunks, crc32, isPng } from './png.js';
export { decodeBmp, encodeBmp, decodeDib, isBmp } from './bmp.js';
export { decodeIco, decodeIcoLargest, encodeIco, isIco, ICO_SIZES } from './ico.js';
export { decodeTiff, encodeTiff, isTiff } from './tiff.js';
export {
  resize, fitToPixels, scaleByPercent, cropRect, cropToAspect, containSize, fitInto,
  rotate90, rotate180, rotate270, flipH, flipV, applyOrientation,
} from './geometry.js';
export { encodeToSize } from './target.js';
export { readExif, stripMetadata, sniffContainer } from './exif.js';
export { removeBackground, estimateBackground, deltaE } from './background.js';
export { overlay, stampPosition, flatten } from './watermark.js';

export const imageFormats = [
  { id: 'png', exts: ['png'], mime: 'image/png', read: 'core', write: 'core', alpha: true, lossy: false },
  { id: 'jpg', exts: ['jpg', 'jpeg', 'jfif', 'jpe'], mime: 'image/jpeg', read: 'canvas', write: 'canvas', alpha: false, lossy: true },
  { id: 'webp', exts: ['webp'], mime: 'image/webp', read: 'canvas', write: 'canvas', alpha: true, lossy: true },
  { id: 'avif', exts: ['avif'], mime: 'image/avif', read: 'canvas', write: 'canvas', alpha: true, lossy: true, note: 'write only where the browser can encode AVIF' },
  { id: 'bmp', exts: ['bmp', 'dib'], mime: 'image/bmp', read: 'core', write: 'core', alpha: true, lossy: false },
  { id: 'gif', exts: ['gif'], mime: 'image/gif', read: 'canvas', write: null, alpha: true, lossy: false, note: 'first frame only' },
  { id: 'ico', exts: ['ico'], mime: 'image/x-icon', read: 'core', write: 'core', alpha: true, lossy: false, note: 'reads the largest icon' },
  { id: 'heic', exts: ['heic', 'heif'], mime: 'image/heic', read: 'module', write: null, alpha: false, lossy: true },
  { id: 'tiff', exts: ['tif', 'tiff'], mime: 'image/tiff', read: 'core', write: 'core', alpha: true, lossy: false, note: 'none, PackBits, LZW, Deflate' },
];

export function formatById(id) {
  const key = String(id).toLowerCase().replace(/^\./, '');
  return imageFormats.find((f) => f.id === key || f.exts.includes(key)) ?? null;
}

// Формат по первым байтам (расширению верить нельзя).
export function sniffImage(bytes) {
  const s = (o, n) => String.fromCharCode(...bytes.subarray(o, o + n));
  if (isPng(bytes)) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 12 && s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'webp';
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(s(0, 6))) return 'gif';
  if (isTiff(bytes)) return 'tiff';
  if (isIco(bytes)) return 'ico';
  if (isBmp(bytes)) return 'bmp';
  if (bytes.length >= 12 && s(4, 4) === 'ftyp') {
    const brand = s(8, 4);
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return 'heic';
  }
  return null;
}

// Чтение форматами ядра. Остальное - ошибка с code 'NEEDS_CANVAS' / 'NEEDS_MODULE': окно читает само.
export function decodeImage(bytes) {
  const id = sniffImage(bytes);
  const decoders = { png: decodePng, bmp: decodeBmp, ico: decodeIcoLargest, tiff: decodeTiff };
  if (decoders[id]) return decoders[id](bytes);
  const fmt = formatById(id);
  const err = new Error(fmt ? `${id}: decoded by the window` : 'unknown image format');
  err.code = fmt ? (fmt.read === 'module' ? 'NEEDS_MODULE' : 'NEEDS_CANVAS') : 'UNKNOWN_FORMAT';
  throw err;
}

// Запись: свои форматы - здесь; jpg/webp/avif - через encode(image, quality 1..100, mime) из окна.
// У формата без альфы прозрачность ложится на background (по умолчанию белый, а не чёрный canvas).
export async function encodeImage(image, format, { quality = 90, encode, background = [255, 255, 255], level, compression, sizes } = {}) {
  const fmt = formatById(format);
  if (!fmt || !fmt.write) throw new Error(`cannot write ${format}`);
  if (fmt.id === 'png') return encodePng(image, { level });
  if (fmt.id === 'bmp') return encodeBmp(image);
  if (fmt.id === 'ico') return encodeIco(image, sizes);
  if (fmt.id === 'tiff') return encodeTiff(image, { compression });
  if (!encode) throw new Error(`${fmt.id}: needs an encoder from the window`);
  return encode(fmt.alpha ? image : flatten(image, background), quality, fmt.mime);
}
