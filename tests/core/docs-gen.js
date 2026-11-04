// Генератор случайных документов (модель) с зерном - для законов о документах.
// rich: true - вложения, которые есть в md и html, но не в docx/odt/pdf (код и цитаты в пунктах списка и т. п.)
import { normInl, makeRun } from '../../web/core/docs/model.js';

export const WORDS = ['Привет', 'мир', 'документ', 'съёмка', 'Ёж', 'щука', 'hello', 'world', 'a<b', 'x&y', '*звезда*', '_под_',
  '`тик`', '5>3', '#тег', '1.', '2)', '|', '\\слэш', '[скобки]', '-тире', '+плюс', '"кавычки"', "'апостроф'", '~тильда', '!', '&amp;',
  'ünïcödé', '-', '#', '+', '~~~', '===', '=равно', '>цитата', 'Юля', 'текст', 'файл', 'данные', 'число', '42', 'end.', 'конец', 'ХОРОШО', '«ёлки»'];
const HREFS = ['https://example.com/', 'https://example.org/путь?a=1&b=2', 'https://example.net/a_b(c)', 'https://example.com/#x y'];
const FORMATS = [{}, {}, {}, {}, { b: true }, { i: true }, { b: true, i: true }, { code: true }, { href: 1 }, { href: 2, b: true }];

export function genInline(r, maxWords = 10) {
  const n = r.int(1, maxWords);
  const runs = [];
  let prev = null;
  for (let k = 0; k < n; k++) {
    const f = { ...r.pick(FORMATS) };
    if (f.href) f.href = r.pick(HREFS);
    const word = r.pick(WORDS);
    if (prev) {
      // между словами с одинаковым оформлением пробел внутри куска, иначе - простой пробел
      const same = !!prev.b === !!f.b && !!prev.i === !!f.i && !!prev.code === !!f.code && prev.href === f.href;
      runs.push(makeRun(' ', same ? f : {}));
    }
    runs.push(makeRun(word, f));
    prev = f;
  }
  return normInl(runs);
}

function genCode(r) {
  return Array.from({ length: r.int(1, 4) }, () => ' '.repeat(r.pick([0, 0, 2, 4])) + Array.from({ length: r.int(0, 5) }, () => r.pick(WORDS)).join(' ')).join('\n');
}

function genTable(r) {
  const cols = r.int(1, 3);
  return { type: 'table', rows: Array.from({ length: r.int(1, 4) }, () => Array.from({ length: cols }, () => (r() < 0.15 ? [] : genInline(r, 4)))) };
}

function genList(r, depth, rich) {
  const items = Array.from({ length: r.int(1, 4) }, () => {
    const item = [{ type: 'p', inl: genInline(r, 6) }];
    if (rich && r() < 0.3) item.push(r() < 0.5 ? { type: 'code', text: genCode(r) } : { type: 'p', inl: genInline(r, 4) });
    if (depth < 2 && r() < 0.35) item.push(genList(r, depth + 1, rich));
    return item;
  });
  return { type: 'list', ordered: r() < 0.5, items };
}

// Соседние списки, цитаты и блоки кода в docx/odt сливаются - генератор их не ставит рядом
export function genDoc(r, { rich = false, maxBlocks = 10 } = {}) {
  const blocks = [];
  const n = r.int(1, maxBlocks);
  while (blocks.length < n) {
    const kind = r.pick(['h', 'p', 'p', 'p', 'list', 'code', 'quote', 'table', 'hr']);
    const last = blocks[blocks.length - 1]?.type;
    if ((kind === 'list' || kind === 'quote' || kind === 'code') && last === kind) continue;
    if (kind === 'h') blocks.push({ type: 'h', level: r.int(1, 6), inl: genInline(r, 6) });
    else if (kind === 'p') blocks.push({ type: 'p', inl: genInline(r) });
    else if (kind === 'list') blocks.push(genList(r, 0, rich));
    else if (kind === 'code') blocks.push({ type: 'code', text: genCode(r) });
    else if (kind === 'table') blocks.push(genTable(r));
    else if (kind === 'hr') blocks.push({ type: 'hr' });
    else {
      const inner = [{ type: 'p', inl: genInline(r) }];
      if (r() < 0.4) inner.push({ type: 'p', inl: genInline(r, 5) });
      if (rich && r() < 0.4) inner.push(r() < 0.5 ? genList(r, 1, rich) : { type: 'code', text: genCode(r) });
      blocks.push({ type: 'quote', blocks: inner });
    }
  }
  return blocks;
}
