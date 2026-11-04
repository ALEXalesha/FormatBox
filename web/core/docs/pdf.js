// PDF. Запись - через pdf-lib + fontkit с переданным шрифтом (TTF с кириллицей): перенос строк по ширине,
// заголовки крупнее, списки с метками, код и цитаты с отступом, таблицы сеткой, новые страницы.
// Чтение - текст через pdf.js: строки по положению, абзацы по увеличенным промежуткам, заголовки по размеру.
import { inlText } from './model.js';

const PAGE = [595.28, 841.89]; // A4
const MARGIN = 56;
const BODY = 11;
const HEAD = [22, 18, 15, 13, 12, 11.5];
const LEAD = 1.35; // межстрочный интервал в долях размера шрифта

function layoutCtx(doc, font, rgb) {
  const ctx = { doc, font, rgb, page: null, y: 0, chars: new Set(font.getCharacterSet()) };
  ctx.newPage = () => { ctx.page = doc.addPage(PAGE); ctx.y = PAGE[1] - MARGIN; };
  ctx.need = (h) => { if (!ctx.page || ctx.y - h < MARGIN) ctx.newPage(); };
  ctx.newPage();
  return ctx;
}

// Символы, которых нет в шрифте, - '?', табуляция - пробелы
function clean(ctx, s) {
  let out = '';
  for (const ch of s.replace(/\t/g, '    ')) {
    const cp = ch.codePointAt(0);
    out += ch === '\n' || ch === ' ' || ctx.chars.has(cp) ? ch : cp < 32 ? '' : '?';
  }
  return out;
}

// Куски текста -> строки шириной не больше width; слово длиннее строки режется по буквам
function wrap(ctx, inl, size, width) {
  const lines = [[]];
  let x = 0;
  const w = (t) => ctx.font.widthOfTextAtSize(t, size);
  const push = (text, r) => {
    const line = lines[lines.length - 1];
    const last = line[line.length - 1];
    if (last && last.r === r) last.text += text;
    else line.push({ text, r });
    x += w(text);
  };
  const breakLine = () => { lines.push([]); x = 0; };
  for (const r of inl) {
    for (const piece of clean(ctx, r.text).split(/(\n| +)/)) {
      if (!piece) continue;
      if (piece === '\n') { breakLine(); continue; }
      if (piece[0] === ' ') { if (x > 0) push(' ', r); continue; }
      if (x > 0 && x + w(piece) > width) {
        // пробел в конце строки не нужен
        const line = lines[lines.length - 1];
        const last = line[line.length - 1];
        if (last) last.text = last.text.replace(/ +$/, '');
        breakLine();
      }
      let rest = piece;
      while (w(rest) > width && rest.length > 1) {
        let k = rest.length - 1;
        while (k > 1 && w(rest.slice(0, k)) > width - x) k--;
        push(rest.slice(0, k), r);
        breakLine();
        rest = rest.slice(k);
      }
      push(rest, r);
    }
  }
  return lines;
}

function drawLines(ctx, lines, { size, x0, color, bar }) {
  const lh = size * LEAD;
  for (const line of lines) {
    ctx.need(lh);
    ctx.y -= lh;
    let x = x0;
    for (const seg of line) {
      const c = seg.r.href ? ctx.rgb(0.05, 0.3, 0.75) : seg.r.code ? ctx.rgb(0.55, 0.1, 0.1) : color;
      if (seg.text) ctx.page.drawText(seg.text, { x, y: ctx.y + size * 0.25, size, font: ctx.font, color: c });
      const w = ctx.font.widthOfTextAtSize(seg.text, size);
      if (seg.r.href) ctx.page.drawLine({ start: { x, y: ctx.y + size * 0.1 }, end: { x: x + w, y: ctx.y + size * 0.1 }, thickness: 0.5, color: c });
      x += w;
    }
    if (bar) ctx.page.drawLine({ start: { x: bar, y: ctx.y }, end: { x: bar, y: ctx.y + lh }, thickness: 2, color: ctx.rgb(0.75, 0.75, 0.75) });
  }
}

function drawTable(ctx, rows, x0, width) {
  const cols = Math.max(...rows.map((r) => r.length));
  const cw = width / cols;
  const size = BODY - 1;
  const lh = size * LEAD;
  const line = { thickness: 0.6, color: ctx.rgb(0.5, 0.5, 0.5) };
  for (const row of rows) {
    const cells = Array.from({ length: cols }, (_, k) => wrap(ctx, row[k] ?? [], size, cw - 8));
    const h = Math.max(...cells.map((c) => c.length)) * lh + 6;
    ctx.need(h);
    const top = ctx.y;
    cells.forEach((lines, k) => {
      ctx.y = top - 3;
      drawLines(ctx, lines, { size, x0: x0 + k * cw + 4, color: ctx.rgb(0, 0, 0) });
    });
    ctx.y = top - h;
    for (let k = 0; k <= cols; k++) ctx.page.drawLine({ start: { x: x0 + k * cw, y: top }, end: { x: x0 + k * cw, y: top - h }, ...line });
    ctx.page.drawLine({ start: { x: x0, y: top }, end: { x: x0 + width, y: top }, ...line });
    ctx.page.drawLine({ start: { x: x0, y: top - h }, end: { x: x0 + width, y: top - h }, ...line });
  }
}

function drawBlocks(ctx, blocks, x0, opts = {}) {
  const width = PAGE[0] - MARGIN - x0;
  const black = ctx.rgb(0, 0, 0);
  for (const b of blocks) {
    if (b.type === 'h') {
      const size = HEAD[b.level - 1];
      ctx.y -= size * 0.5;
      drawLines(ctx, wrap(ctx, b.inl, size, width), { size, x0, color: black });
    } else if (b.type === 'p') {
      drawLines(ctx, wrap(ctx, b.inl, BODY, width), { size: BODY, x0, color: opts.color ?? black, bar: opts.bar });
    } else if (b.type === 'code') {
      const size = BODY - 1.5;
      drawLines(ctx, wrap(ctx, [{ text: b.text }], size, width - 8), { size, x0: x0 + 8, color: ctx.rgb(0.25, 0.25, 0.3) });
    } else if (b.type === 'quote') {
      drawBlocks(ctx, b.blocks, x0 + 14, { color: ctx.rgb(0.3, 0.3, 0.3), bar: x0 + 4 });
    } else if (b.type === 'list') {
      b.items.forEach((item, k) => {
        const mark = b.ordered ? `${k + 1}.` : '•';
        ctx.need(BODY * LEAD);
        // метка - на уровне первой строки пункта
        ctx.page.drawText(mark, { x: x0 + 2, y: ctx.y - BODY * LEAD + BODY * 0.25, size: BODY, font: ctx.font, color: black });
        drawBlocks(ctx, item, x0 + 20, { ...opts, tight: true });
      });
    } else if (b.type === 'table') {
      drawTable(ctx, b.rows, x0, width);
    } else if (b.type === 'hr') {
      ctx.need(BODY);
      ctx.y -= BODY * 0.6;
      ctx.page.drawLine({ start: { x: x0, y: ctx.y }, end: { x: x0 + width, y: ctx.y }, thickness: 0.8, color: ctx.rgb(0.6, 0.6, 0.6) });
    }
    // промежуток после блока - по нему чтение отличает абзацы
    ctx.y -= BODY * (opts.tight && b.type === 'p' ? 0.35 : 0.7);
  }
}

// libs: { pdfLib, fontkit, fontBytes }
export async function writePdf(blocks, { pdfLib, fontkit, fontBytes }, title = '') {
  const doc = await pdfLib.PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, { subset: true });
  const h = blocks.find((b) => b.type === 'h');
  doc.setTitle(title || (h ? inlText(h.inl) : 'Document'));
  doc.setProducer('FormatBox');
  doc.setCreator('FormatBox');
  drawBlocks(layoutCtx(doc, font, pdfLib.rgb), blocks, MARGIN);
  return doc.save();
}

// ---------- чтение ----------

export async function readPdf(bytes, pdfjs) {
  // pdf.js забирает (detach) буфер - отдаём копию, вход не трогаем
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  const lines = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    let cur = null;
    for (const it of tc.items) {
      if (typeof it.str !== 'string') continue;
      const [, , , d, x, y] = it.transform;
      const size = Math.abs(d) || it.height || 1;
      if (it.str) {
        const sameLine = cur && Math.abs(cur.y - y) < size * 0.5;
        if (!sameLine) { cur = { text: '', y, size, end: x, page: n }; lines.push(cur); }
        // заметный промежуток между кусками одной строки - пробел
        if (cur.text && x - cur.end > size * 0.2 && !cur.text.endsWith(' ') && !it.str.startsWith(' ')) cur.text += ' ';
        cur.text += it.str;
        cur.end = x + it.width;
        cur.size = Math.max(cur.size, size);
      }
      if (it.hasEOL) cur = null;
    }
  }
  await doc.destroy();
  // основной размер - самый частый; крупнее - заголовки (по убыванию размера: h1, h2, ...)
  const count = new Map();
  for (const l of lines) count.set(Math.round(l.size), (count.get(Math.round(l.size)) ?? 0) + l.text.length);
  const body = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? BODY;
  const big = [...new Set(lines.map((l) => Math.round(l.size)).filter((s) => s > body * 1.15))].sort((a, b) => b - a);
  const blocks = [];
  let prev = null;
  for (const l of lines) {
    const text = l.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const level = big.indexOf(Math.round(l.size)) + 1;
    const gap = prev && prev.page === l.page ? prev.y - l.y : 0;
    const last = blocks[blocks.length - 1];
    const joins = last && prev && gap > 0 && gap < prev.size * 1.6 && Math.round(prev.size) === Math.round(l.size);
    if (joins) last.inl[0].text += ` ${text}`;
    else if (level) blocks.push({ type: 'h', level: Math.min(6, level), inl: [{ text }] });
    else blocks.push({ type: 'p', inl: [{ text }] });
    prev = l;
  }
  return blocks;
}
