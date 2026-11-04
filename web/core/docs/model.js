// Общая модель документа - массив блоков:
//   { type: 'h', level, inl }  { type: 'p', inl }  { type: 'list', ordered, items: [[блоки]] }
//   { type: 'code', text }  { type: 'quote', blocks }  { type: 'table', rows: [[inl]] }  { type: 'hr' }
// inl - [{ text, b, i, code, href }]; в каноническом виде есть только истинные флаги,
// соседние куски с одинаковым оформлением слиты, пустых нет.

export function sameFormat(a, b) {
  return !!a.b === !!b.b && !!a.i === !!b.i && !!a.code === !!b.code && (a.href || '') === (b.href || '');
}

export function makeRun(text, f = {}) {
  const r = { text };
  if (f.b) r.b = true;
  if (f.i) r.i = true;
  if (f.code) r.code = true;
  if (f.href) r.href = f.href;
  return r;
}

export function normInl(inl) {
  const out = [];
  for (const r of inl) {
    if (!r.text) continue;
    const last = out[out.length - 1];
    if (last && sameFormat(last, r)) last.text += r.text;
    else out.push(makeRun(r.text, r));
  }
  return out;
}

// Схлопывание пробелов как в HTML и ODF: подряд идущие пробелы - один, по краям - ничего,
// у переноса строки ('\n') пробелов нет. literal - куски, которые не трогаем (text:s в ODF).
export function collapseRuns(runs, { keepBreaks = false } = {}) {
  const out = [];
  let prev = '\n'; // начало абзаца - как сразу после переноса
  for (const r of runs) {
    let text = r.text;
    const last = out[out.length - 1];
    if (!r.literal) {
      text = text.replace(/[ \t\n\r\f]+/g, ' ');
      if (prev === ' ' || prev === '\n') text = text.slice(text[0] === ' ' ? 1 : 0);
    } else if (text[0] === '\n' && last && !last.literal) {
      last.text = last.text.replace(/ +$/, ''); // пробелы перед переносом строки не видны
    }
    if (!text) continue;
    out.push({ ...makeRun(text, r), literal: r.literal });
    prev = text[text.length - 1];
  }
  const last = out[out.length - 1];
  if (last && !(last.literal && keepBreaks)) last.text = last.text.replace(last.literal ? /\n+$/ : / +$/, '');
  return normInl(out);
}

export function inlText(inl) {
  return inl.map((r) => r.text).join('');
}

// Весь текст документа по порядку (для txt, поиска слов и проверок)
export function blockTexts(blocks, out = []) {
  for (const b of blocks) {
    if (b.type === 'h' || b.type === 'p') out.push(inlText(b.inl));
    else if (b.type === 'code') out.push(b.text);
    else if (b.type === 'quote') blockTexts(b.blocks, out);
    else if (b.type === 'list') for (const item of b.items) blockTexts(item, out);
    else if (b.type === 'table') for (const row of b.rows) for (const cell of row) out.push(inlText(cell));
  }
  return out;
}

export function words(blocks) {
  return blockTexts(blocks).join(' ').split(/\s+/).filter(Boolean);
}

// Канонический вид блоков: inl нормализован, пустые абзацы выброшены
export function normBlocks(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.type === 'p' || b.type === 'h') {
      const inl = normInl(b.inl);
      if (!inl.length) continue;
      out.push(b.type === 'h' ? { type: 'h', level: Math.min(6, Math.max(1, b.level | 0)), inl } : { type: 'p', inl });
    } else if (b.type === 'list') {
      if (b.items.length) out.push({ type: 'list', ordered: !!b.ordered, items: b.items.map(normBlocks) });
    } else if (b.type === 'quote') out.push({ type: 'quote', blocks: normBlocks(b.blocks) });
    else if (b.type === 'table') {
      if (b.rows.length) out.push({ type: 'table', rows: b.rows.map((row) => row.map(normInl)) });
    } else if (b.type === 'code') out.push({ type: 'code', text: b.text });
    else if (b.type === 'hr') out.push({ type: 'hr' });
  }
  return out;
}

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™',
  hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', bull: '•', middot: '·', times: '×',
  deg: '°', euro: '€', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bdquo: '„', shy: '­',
  plusmn: '±', sect: '§', para: '¶', divide: '÷', minus: '−', larr: '←', rarr: '→', thinsp: ' ',
};

// Сущность в начале строки s: [символ, длина] или null
export function entityAt(s, i) {
  const m = /^&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z]{2,8});/.exec(s.slice(i, i + 12));
  if (!m) return null;
  const e = m[1];
  if (e[0] === '#') {
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return [code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '�', m[0].length];
  }
  return NAMED[e] ? [NAMED[e], m[0].length] : null;
}

export function decodeEntities(s) {
  let out = '';
  for (let i = 0; i < s.length;) {
    const e = s[i] === '&' ? entityAt(s, i) : null;
    if (e) { out += e[0]; i += e[1]; } else out += s[i++];
  }
  return out;
}

// Байты текста -> строка: BOM UTF-8/UTF-16, иначе UTF-8, а если байты им не являются - windows-1251
export function decodeText(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder().decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1251').decode(bytes);
  }
}

export const encodeText = (s) => new TextEncoder().encode(s);

// Символы, недопустимые в XML 1.0
export const xmlSafe = (s) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');
