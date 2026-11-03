// Простой текст: запись - читаемый текст (заголовки подчёркнуты, списки с метками, таблица колонками),
// чтение - абзацы по пустым строкам, переносы строк внутри абзаца сохраняются.
import { normBlocks, inlText } from './model.js';

export function parseTxt(text) {
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/).map((para) => para.split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/^\n+|\n+$/g, ''));
  return normBlocks(blocks.map((p) => ({ type: 'p', inl: [{ text: p }] })));
}

const pad = (text, n) => text.split('\n').map((l) => (l ? ' '.repeat(n) + l : l)).join('\n');

function table(rows) {
  const cells = rows.map((r) => r.map((c) => inlText(c).replace(/\n/g, ' ')));
  const cols = Math.max(...cells.map((r) => r.length));
  const width = Array.from({ length: cols }, (_, k) => Math.max(...cells.map((r) => (r[k] ?? '').length)));
  const line = (r) => width.map((w, k) => (r[k] ?? '').padEnd(w)).join(' | ').replace(/\s+$/, '');
  const out = cells.map(line);
  out.splice(1, 0, width.map((w) => '-'.repeat(Math.max(1, w))).join('-+-'));
  return out.join('\n');
}

function block(b) {
  if (b.type === 'h') {
    const t = inlText(b.inl).replace(/\n/g, ' ');
    return b.level <= 2 ? `${t}\n${(b.level === 1 ? '=' : '-').repeat(Math.max(3, t.length))}` : t;
  }
  if (b.type === 'p') return inlText(b.inl);
  if (b.type === 'code') return pad(b.text, 4);
  if (b.type === 'hr') return '* * *';
  if (b.type === 'quote') return blocks(b.blocks).split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
  if (b.type === 'list') {
    return b.items.map((item, k) => {
      const mark = b.ordered ? `${k + 1}. ` : '• ';
      return mark + pad(item.map(block).join('\n'), mark.length).slice(mark.length);
    }).join('\n');
  }
  return table(b.rows);
}

function blocks(list) {
  return list.map(block).join('\n\n');
}

export function writeTxt(list) {
  return `${blocks(list)}\n`;
}
