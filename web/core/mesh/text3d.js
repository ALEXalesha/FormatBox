// Объёмный текст: свой пиксельный шрифт -> маска -> выдавливание (silhouette.js).
// Окно может нарисовать текст системным шрифтом на canvas и отдать маску прямо в extrudeMask.
import { glyph, GLYPH_H } from './font.js';
import { dilate } from './contours.js';
import { extrudeMask } from './silhouette.js';
import { emptyMesh } from './common.js';

// Маска текста. pixel - сторона точки шрифта в пикселях маски; точки слегка раздуваются,
// чтобы диагональные касания стали перемычками (иначе буква распадается на куски).
export function textMask(text, opts = {}) {
  const s = Math.max(2, Math.round(opts.pixel ?? 6));
  const letterGap = opts.letterGap ?? 1, lineGap = opts.lineGap ?? 2;
  const lines = String(text).split(/\r?\n/).map((line) => [...line].map((ch) => glyph(ch) ?? glyph('?')));
  const widths = lines.map((g) => g.reduce((w, x) => w + x[0].length, 0) + letterGap * Math.max(0, g.length - 1));
  const cols = Math.max(1, ...widths);
  const rows = lines.length * GLYPH_H + (lines.length - 1) * lineGap;
  const r = Math.max(1, s * 0.15);
  const pad = Math.ceil(r) + 2;
  const width = cols * s + 2 * pad, height = rows * s + 2 * pad;
  const data = new Uint8Array(width * height);
  lines.forEach((glyphs, li) => {
    const shift = opts.align === 'left' ? 0 : Math.floor((cols - widths[li]) / (opts.align === 'right' ? 1 : 2));
    let cx = shift;
    for (const g of glyphs) {
      for (let gy = 0; gy < GLYPH_H; gy++) {
        for (let gx = 0; gx < g[gy].length; gx++) {
          if (!g[gy][gx]) continue;
          const x0 = pad + (cx + gx) * s, y0 = pad + (li * (GLYPH_H + lineGap) + gy) * s;
          for (let y = y0; y < y0 + s; y++) data.fill(1, y * width + x0, y * width + x0 + s);
        }
      }
      cx += g[0].length + letterGap;
    }
  });
  const mask = dilate({ width, height, data }, r);
  return { ...mask, capPx: GLYPH_H * s + 2 * r };
}

// opts: heightMm (высота заглавной), depthMm (выдавливание букв), baseMm (подложка), mode:
// 'plain' - только буквы, 'sign' - табличка, 'keychain' - брелок (подложка по контуру + ушко), 'stencil' - трафарет
export function textToMesh(text, opts = {}) {
  const { heightMm = 10, depthMm = 2 } = opts;
  const mode = opts.mode ?? (opts.baseMm > 0 ? 'sign' : 'plain');
  const mask = textMask(text, opts);
  if (!mask.data.includes(1)) return emptyMesh();
  const pxMm = heightMm / mask.capPx;
  const baseMm = opts.baseMm > 0 ? opts.baseMm : 2;
  const common = { ...opts, pxMm, widthMm: undefined };
  if (mode === 'plain') return extrudeMask(mask, { ...common, mode: 'plain', heightMm: depthMm });
  if (mode === 'stencil') return extrudeMask(mask, { ...common, mode: 'stencil', heightMm: depthMm });
  if (mode === 'sign') return extrudeMask(mask, { ...common, mode: 'sign', baseMm, heightMm: baseMm + depthMm });
  if (mode === 'keychain') {
    return extrudeMask(mask, { ...common, mode: 'sign', plate: 'outline', ring: true, marginMm: opts.marginMm ?? heightMm * 0.25, closeMm: opts.closeMm ?? heightMm * 0.5, baseMm, heightMm: baseMm + depthMm });
  }
  throw new Error(`unknown mode: ${mode}`);
}
