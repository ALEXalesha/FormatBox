// Markdown: свой разбор (подмножество CommonMark + таблицы GFM) и запись.
// Закон: запись -> разбор возвращает ту же модель, поэтому запись экранирует всё спорное.
import { normInl, normBlocks, makeRun, entityAt } from './model.js';

const BLANK = /^\s*$/;
const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const ATX = /^ {0,3}(#{1,6})(?=[ \t]|$)(.*)$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?/;
const ITEM = /^( {0,3})([-+*]|\d{1,9}[.)])([ \t]+|$)/;
const DELIM_ROW = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;

function isTableStart(lines, i) {
  return lines[i].includes('|') && i + 1 < lines.length && DELIM_ROW.test(lines[i + 1]) && lines[i + 1].includes('-');
}

function startsBlock(lines, i) {
  const l = lines[i];
  return FENCE.test(l) || ATX.test(l) || HR.test(l) || QUOTE.test(l) || ITEM.test(l) || isTableStart(lines, i);
}

// Ячейки строки таблицы: делим по неэкранированным '|', '\|' внутри ячейки - это '|'
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '\\|'; i++; continue; }
    if (s[i] === '|') { cells.push(cur); cur = ''; continue; }
    cur += s[i];
  }
  if (cur.trim()) cells.push(cur);
  return cells.map((c) => c.trim().replace(/\\\|/g, '|'));
}

function parseList(lines, i) {
  const first = ITEM.exec(lines[i]);
  const ordered = /\d/.test(first[2]);
  const kind = first[2].slice(-1);
  const items = [];
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]);
    if (!m || /\d/.test(m[2]) !== ordered || m[2].slice(-1) !== kind || HR.test(lines[i])) break;
    const pad = m[3].includes('\t') ? 1 : m[3].length;
    const content = m[1].length + m[2].length + (pad > 4 || pad === 0 ? 1 : pad);
    const body = [lines[i].slice(m[0].length - (pad > 4 ? pad - 1 : 0))];
    i++;
    let lastBlank = false;
    while (i < lines.length) {
      const l = lines[i];
      // пустая строка (пробелы после отступа пункта сохраняем: они могут быть в коде)
      if (BLANK.test(l)) { body.push(l.slice(content)); lastBlank = true; i++; continue; }
      const indent = l.match(/^ */)[0].length;
      if (indent >= content) body.push(l.slice(content));
      else if (!lastBlank && !startsBlock(lines, i) && body.length && !BLANK.test(body[body.length - 1])) body.push(l); // ленивое продолжение абзаца
      else break;
      lastBlank = false;
      i++;
    }
    while (body.length && BLANK.test(body[body.length - 1])) { body.pop(); }
    items.push(parseLines(body));
    // между пунктами могут быть пустые строки
    let j = i;
    while (j < lines.length && BLANK.test(lines[j])) j++;
    if (j < lines.length && ITEM.test(lines[j])) i = j;
    else break;
  }
  return [{ type: 'list', ordered, items }, i];
}

function parseLines(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (BLANK.test(line)) { i++; continue; }
    let m;
    if ((m = FENCE.exec(line)) && !(m[2][0] === '`' && m[3].includes('`'))) {
      const indent = m[1].length;
      const fence = m[2];
      const body = [];
      i++;
      while (i < lines.length) {
        const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[i]);
        if (close && close[1][0] === fence[0] && close[1].length >= fence.length) { i++; break; }
        body.push(lines[i].replace(new RegExp(`^ {0,${indent}}`), ''));
        i++;
      }
      out.push({ type: 'code', text: body.join('\n') });
      continue;
    }
    if ((m = ATX.exec(line))) {
      const text = m[2].trim().replace(/(^|[ \t]+)#+$/, '').trim();
      out.push({ type: 'h', level: m[1].length, inl: parseInline(text) });
      i++;
      continue;
    }
    if (HR.test(line)) { out.push({ type: 'hr' }); i++; continue; }
    if (QUOTE.test(line)) {
      const body = [];
      while (i < lines.length && QUOTE.test(lines[i])) body.push(lines[i++].replace(QUOTE, ''));
      out.push({ type: 'quote', blocks: parseLines(body) });
      continue;
    }
    if (ITEM.test(line)) {
      const [list, next] = parseList(lines, i);
      out.push(list);
      i = next;
      continue;
    }
    if (isTableStart(lines, i)) {
      const rows = [splitRow(line)];
      i += 2;
      while (i < lines.length && !BLANK.test(lines[i]) && !startsBlock(lines, i)) rows.push(splitRow(lines[i++]));
      out.push({ type: 'table', rows: rows.map((r) => r.map(parseInline)) });
      continue;
    }
    // абзац: до пустой строки или начала другого блока; подчёркивание = или - делает заголовок
    const para = [line];
    i++;
    let level = 0;
    while (i < lines.length && !BLANK.test(lines[i])) {
      const s = SETEXT.exec(lines[i]);
      if (s) { level = s[1][0] === '=' ? 1 : 2; i++; break; }
      if (startsBlock(lines, i)) break;
      para.push(lines[i++]);
    }
    const inl = parseInline(para.map((l) => l.replace(/^[ \t]+/, '')).join('\n').replace(/[ \t]+$/, ''));
    out.push(level ? { type: 'h', level, inl } : { type: 'p', inl });
  }
  return out;
}

export function parseMd(text) {
  return normBlocks(parseLines(text.replace(/\r\n?/g, '\n').split('\n')));
}

// ---------- строчная разметка ----------

const PUNCT = /[!-/:-@[-`{-~]/;
const isSpace = (c) => c === undefined || /\s/.test(c);
const isWordChar = (c) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

function codeSpanAt(s, i) {
  let n = 0;
  while (s[i + n] === '`') n++;
  for (let j = i + n; j < s.length;) {
    const k = s.indexOf('`', j);
    if (k < 0) break;
    let m = 0;
    while (s[k + m] === '`') m++;
    if (m === n) {
      let text = s.slice(i + n, k).replace(/\n/g, ' ');
      if (text.length > 1 && text[0] === ' ' && text[text.length - 1] === ' ' && text.trim()) text = text.slice(1, -1);
      return [text, k + m];
    }
    j = k + m;
  }
  return [null, i + n];
}

// [текст](адрес) начиная с s[i] === '['; null - не ссылка
function linkAt(s, i) {
  let depth = 0;
  let j = i;
  for (; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') { j++; continue; }
    if (c === '`') { const [code, end] = codeSpanAt(s, j); if (code !== null) j = end - 1; continue; }
    if (c === '[') depth++;
    if (c === ']' && --depth === 0) break;
  }
  if (j >= s.length || s[j + 1] !== '(') return null;
  let k = j + 2;
  while (s[k] === ' ' || s[k] === '\n') k++;
  let href = '';
  if (s[k] === '<') {
    const end = s.indexOf('>', k);
    if (end < 0 || s.slice(k + 1, end).includes('\n')) return null;
    href = s.slice(k + 1, end);
    k = end + 1;
  } else {
    let par = 0;
    for (; k < s.length && !/[\s]/.test(s[k]); k++) {
      if (s[k] === '\\' && PUNCT.test(s[k + 1] ?? '')) { href += s[++k]; continue; }
      if (s[k] === '(') par++;
      if (s[k] === ')' && par-- === 0) break;
      href += s[k];
    }
  }
  while (s[k] === ' ' || s[k] === '\n') k++;
  if (s[k] === '"' || s[k] === "'") {
    const end = s.indexOf(s[k], k + 1);
    if (end < 0) return null;
    k = end + 1;
    while (s[k] === ' ') k++;
  }
  if (s[k] !== ')') return null;
  return { text: s.slice(i + 1, j), href, end: k + 1 };
}

export function parseInline(src) {
  const toks = [];
  const text = (t) => toks.push({ t: 'text', s: t });
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (c === '\\') {
      const n = src[i + 1];
      if (n === '\n') { text('\n'); i += 2; } else if (n !== undefined && PUNCT.test(n)) { text(n); i += 2; } else { text('\\'); i++; }
      continue;
    }
    if (c === '`') {
      const [code, end] = codeSpanAt(src, i);
      if (code === null) text(src.slice(i, end));
      else toks.push({ t: 'code', s: code });
      i = end;
      continue;
    }
    if (c === '*' || c === '_') {
      let n = 0;
      while (src[i + n] === c) n++;
      const before = src[i - 1];
      const after = src[i + n];
      let open = !isSpace(after);
      let close = !isSpace(before);
      if (c === '_') { open = open && !isWordChar(before); close = close && !isWordChar(after); }
      if ((!open && !close) || n > 3) text(src.slice(i, i + n));
      else toks.push({ t: 'delim', ch: c, n, open, close });
      i += n;
      continue;
    }
    if (c === '[' || (c === '!' && src[i + 1] === '[')) {
      const link = linkAt(src, c === '!' ? i + 1 : i);
      if (link) {
        // картинка - только её подпись, без адреса
        toks.push({ t: 'link', inl: parseInline(link.text), href: c === '!' ? '' : link.href });
        i = link.end;
        continue;
      }
      text(c);
      i++;
      continue;
    }
    if (c === '<') {
      const m = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*)>/.exec(src.slice(i));
      if (m) { toks.push({ t: 'link', inl: [makeRun(m[1])], href: m[1] }); i += m[0].length; continue; }
    }
    if (c === '&') {
      const e = entityAt(src, i);
      if (e) { text(e[0]); i += e[1]; continue; }
    }
    if (c === '\n') {
      // два пробела в конце строки - жёсткий перенос, иначе перенос = пробел
      const prev = toks[toks.length - 1];
      const hard = prev?.t === 'text' && / {2,}$/.test(prev.s);
      if (prev?.t === 'text') prev.s = prev.s.replace(/ +$/, '');
      text(hard ? '\n' : ' ');
      i++;
      continue;
    }
    let j = i + 1;
    while (j < src.length && !'\\`*_[!<&\n'.includes(src[j])) j++;
    text(src.slice(i, j));
    i = j;
  }
  return resolve(toks);
}

// Пары разделителей: ** - жирный, * - курсив, *** - оба; непарные остаются текстом
function resolve(toks) {
  const units = [];
  for (const tok of toks) {
    if (tok.t !== 'delim') continue;
    const kinds = tok.n === 3 ? ['b', 'i'] : [tok.n === 2 ? 'b' : 'i'];
    tok.units = kinds.map((k) => ({ key: tok.ch + k, kind: k, open: tok.open, close: tok.close, paired: false }));
    units.push(...tok.units);
  }
  const pending = {};
  for (const u of units) {
    const o = pending[u.key];
    if (o && u.close) { o.paired = u.paired = true; pending[u.key] = null; } else if (u.open) pending[u.key] = u;
  }
  const out = [];
  const state = { b: false, i: false };
  for (const tok of toks) {
    if (tok.t === 'text') out.push(makeRun(tok.s, state));
    else if (tok.t === 'code') out.push(makeRun(tok.s, { ...state, code: true }));
    else if (tok.t === 'link') for (const r of tok.inl) out.push(makeRun(r.text, { ...r, b: r.b || state.b, i: r.i || state.i, href: tok.href || r.href }));
    else {
      let literal = '';
      for (const u of tok.units) {
        if (u.paired) state[u.kind] = !state[u.kind];
        else literal += tok.ch.repeat(u.kind === 'b' ? 2 : 1);
      }
      if (literal) out.push(makeRun(literal, state));
    }
  }
  return normInl(out);
}

// ---------- запись ----------

const escapeText = (s) => s.replace(/[\\`*_[\]<>&|]/g, '\\$&');

function codeSpan(text, inTable) {
  const runs = text.match(/`+/g) ?? [];
  let n = 1;
  while (runs.some((r) => r.length === n)) n++;
  const fence = '`'.repeat(n);
  const pad = text[0] === '`' || text[text.length - 1] === '`' || (text[0] === ' ' && text[text.length - 1] === ' ' && text.trim()) ? ' ' : '';
  return fence + pad + (inTable ? text.replace(/\|/g, '\\|') : text) + pad + fence;
}

// Пробелы по краям жирного/курсива выносим наружу: «** a**» не было бы жирным
function trimFormatting(inl) {
  const out = [];
  for (const r of normInl(inl)) {
    if ((r.b || r.i) && !r.code) {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(r.text);
      const plain = { ...r, b: false, i: false };
      out.push(makeRun(m[1], plain), makeRun(m[2], r), makeRun(m[3], plain));
    } else out.push(r);
  }
  return normInl(out);
}

function writeRuns(runs, inTable) {
  let s = '';
  const st = { b: false, i: false };
  const toggle = (want) => {
    let marks = '';
    if (st.i && !want.i) marks += '*';
    if (st.b && !want.b) marks += '**';
    if (!st.b && want.b) marks += '**';
    if (!st.i && want.i) marks += '*';
    st.b = !!want.b;
    st.i = !!want.i;
    return marks;
  };
  // в таблице '|' экранируется и внутри кода (так требует GFM), а перенос строки - пробел
  for (const r of runs) {
    const text = inTable ? r.text.replace(/\n/g, ' ') : r.text;
    s += toggle(r) + (r.code ? codeSpan(text, inTable) : escapeText(text).replace(/\n/g, '\\\n'));
  }
  return s + toggle({});
}

function linkDest(href) {
  return /[\s()<>\\]/.test(href) || href === '' ? `<${href.replace(/[<>\n]/g, encodeURIComponent)}>` : href;
}

export function writeInline(inl, inTable = false) {
  const runs = trimFormatting(inl);
  let s = '';
  for (let i = 0; i < runs.length;) {
    const href = runs[i].href;
    let j = i;
    while (j < runs.length && runs[j].href === href) j++;
    const part = writeRuns(runs.slice(i, j), inTable);
    s += href ? `[${part}](${linkDest(href)})` : part;
    i = j;
  }
  return s;
}

// Начало строки, которое разбор принял бы за блок, экранируем
function escapeLineStarts(s) {
  return s.split('\n').map((l) => l.replace(/^([#>+\-=~])/, '\\$1').replace(/^(\d+)([.)])/, '$1\\$2')).join('\n');
}

function indent(text, n) {
  const pad = ' '.repeat(n);
  return text.split('\n').map((l) => (l ? pad + l : l)).join('\n');
}

function writeBlock(b) {
  if (b.type === 'h') {
    // заголовок - одна строка; '#' в конце разбор счёл бы закрывающими
    const text = writeInline(b.inl.map((r) => ({ ...r, text: r.text.replace(/\n/g, ' ') })));
    return `${'#'.repeat(b.level)} ${text.replace(/(^|[ \t])(#+)$/, '$1\\$2')}`;
  }
  if (b.type === 'p') return escapeLineStarts(writeInline(b.inl));
  if (b.type === 'hr') return '---';
  if (b.type === 'code') {
    const longest = Math.max(2, ...(b.text.match(/^ {0,3}`+/gm) ?? []).map((m) => m.trim().length));
    const fence = '`'.repeat(longest + 1);
    return `${fence}\n${b.text}${b.text ? '\n' : ''}${fence}`;
  }
  if (b.type === 'quote') {
    return writeBlocks(b.blocks).split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
  }
  if (b.type === 'list') {
    return b.items.map((item, k) => {
      const marker = b.ordered ? `${k + 1}. ` : '- ';
      const body = indent(writeBlocks(item), marker.length);
      return marker + body.slice(marker.length);
    }).join('\n');
  }
  // таблица: первая строка - заголовок, ширина - по самой длинной строке
  const cols = Math.max(...b.rows.map((r) => r.length));
  const row = (r) => `| ${Array.from({ length: cols }, (_, k) => writeInline(r[k] ?? [], true)).join(' | ')} |`;
  return [row(b.rows[0]), `|${' --- |'.repeat(cols)}`, ...b.rows.slice(1).map(row)].join('\n');
}

function writeBlocks(blocks) {
  return blocks.map(writeBlock).join('\n\n');
}

export function writeMd(blocks) {
  return `${writeBlocks(blocks)}\n`;
}
