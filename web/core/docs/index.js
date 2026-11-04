// Документы: convertDoc(bytes, from, to, libs) - чтение в общую модель и запись в нужный формат.
// libs нужны только pdf: { pdfLib, fontkit, fontBytes } для записи и { pdfjs } для чтения.
import { decodeText, encodeText, normBlocks, words } from './model.js';
import { parseMd, writeMd } from './md.js';
import { parseHtml, writeHtml } from './html.js';
import { parseTxt, writeTxt } from './txt.js';
import { readDocx, writeDocx } from './docx.js';
import { readOdt, writeOdt } from './odt.js';
import { readPdf, writePdf } from './pdf.js';

export { words, normBlocks };

const ALL = ['md', 'html', 'txt', 'docx', 'odt', 'pdf'];
// Что во что: из любого читаемого - в любой другой
export const docFormats = Object.fromEntries(ALL.map((f) => [f, ALL.filter((t) => t !== f)]));

const ALIAS = { markdown: 'md', htm: 'html', xhtml: 'html', text: 'txt' };
const fmt = (f) => {
  const k = String(f).toLowerCase().replace(/^\./, '');
  const name = ALIAS[k] ?? k;
  if (!ALL.includes(name)) throw new Error(`docs: format ${f} is not supported`);
  return name;
};

export async function readDoc(bytes, from, libs = {}) {
  const f = fmt(from);
  if (f === 'md') return parseMd(decodeText(bytes));
  if (f === 'html') return parseHtml(decodeText(bytes));
  if (f === 'txt') return parseTxt(decodeText(bytes));
  if (f === 'docx') return readDocx(bytes);
  if (f === 'odt') return readOdt(bytes);
  if (!libs.pdfjs) throw new Error('docs: reading pdf needs libs.pdfjs');
  return readPdf(bytes, libs.pdfjs);
}

export async function writeDoc(blocks, to, libs = {}) {
  const f = fmt(to);
  if (f === 'md') return encodeText(writeMd(blocks));
  if (f === 'html') return encodeText(writeHtml(blocks));
  if (f === 'txt') return encodeText(writeTxt(blocks));
  if (f === 'docx') return writeDocx(blocks);
  if (f === 'odt') return writeOdt(blocks);
  if (!libs.pdfLib || !libs.fontkit || !libs.fontBytes) throw new Error('docs: writing pdf needs libs.pdfLib, libs.fontkit and libs.fontBytes');
  return writePdf(blocks, libs);
}

export async function convertDoc(bytes, from, to, libs = {}) {
  return writeDoc(await readDoc(bytes, from, libs), to, libs);
}
