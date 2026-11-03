// HTML: свой простой токенайзер (без DOM - работает в Worker и Node) и запись чистого HTML.
import { normBlocks, makeRun, collapseRuns, decodeEntities, inlText } from './model.js';

const VOID = new Set(['br', 'hr', 'img', 'meta', 'link', 'input', 'col', 'area', 'base', 'wbr', 'source', 'embed', 'param', 'track']);
const RAW = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'noscript', 'template']);
const SKIP = new Set(['head', 'script', 'style', 'title', 'template', 'noscript', 'svg', 'math', 'iframe', 'object', 'select', 'button', 'textarea']);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
// Блочные элементы: открытие любого закрывает незакрытый <p>
const BLOCK = new Set(['p', 'div', 'ul', 'ol', 'li', 'pre', 'blockquote', 'table', 'hr', 'section', 'article', 'main', 'header',
  'footer', 'nav', 'aside', 'figure', 'form', 'dl', 'dt', 'dd', 'address', 'fieldset', 'details', 'center', ...HEADINGS]);
const CONTAINER = new Set(['div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside', 'figure', 'form', 'dl', 'dt',
  'dd', 'address', 'fieldset', 'details', 'center', 'body', 'html', 'figcaption', 'summary', 'tbody', 'thead', 'tfoot']);

export function tokenize(html) {
  const out = [];
  let i = 0;
  const text = (s) => { if (s) out.push({ type: 'text', text: decodeEntities(s) }); };
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { text(html.slice(i)); break; }
    text(html.slice(i, lt));
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(lt, lt + 64));
    if (!m) {
      if (html[lt + 1] === '!' || html[lt + 1] === '?') {
        const end = html.indexOf('>', lt);
        i = end < 0 ? html.length : end + 1;
      } else { text('<'); i = lt + 1; }
      continue;
    }
    const name = m[2].toLowerCase();
    // атрибуты: имя="..." | имя='...' | имя=значение | имя
    const attrs = {};
    const re = /\s*([^\s"'>/=]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?|\s*(\/?)>/gy;
    re.lastIndex = lt + m[0].length;
    let selfClose = false;
    let end = html.length;
    for (let a; (a = re.exec(html));) {
      if (a[6] !== undefined) { selfClose = a[6] === '/'; end = re.lastIndex; break; }
      attrs[a[1].toLowerCase()] = decodeEntities(a[3] ?? a[4] ?? a[5] ?? '');
    }
    if (re.lastIndex === 0 || end === html.length) {
      // кривой тег без '>' - пропускаем до ближайшего '>'
      const gt = html.indexOf('>', lt);
      end = gt < 0 ? html.length : gt + 1;
    }
    i = end;
    if (m[1]) { out.push({ type: 'close', name }); continue; }
    out.push({ type: 'open', name, attrs, selfClose });
    if (RAW.has(name) && !selfClose) {
      const close = html.toLowerCase().indexOf(`</${name}`, i);
      const stop = close < 0 ? html.length : close;
      if (name === 'textarea' || name === 'title') text(html.slice(i, stop));
      else out.push({ type: 'text', text: html.slice(i, stop) });
      i = stop;
    }
  }
  return out;
}

// Дерево с правилами неявного закрытия (<p>, <li>, <td>, <tr>), как это делают браузеры
export function buildTree(tokens) {
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const closeUpTo = (names, stopAt) => {
    for (let k = stack.length - 1; k > 0; k--) {
      if (stopAt.has(stack[k].name)) return;
      if (names.has(stack[k].name)) { stack.length = k; return; }
    }
  };
  for (const t of tokens) {
    if (t.type === 'text') { top().children.push(t.text); continue; }
    if (t.type === 'close') {
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].name === t.name) { stack.length = k; break; }
      if (t.name === 'br' || t.name === 'p') top().children.push({ name: t.name, attrs: {}, children: [] });
      continue;
    }
    const { name } = t;
    if (BLOCK.has(name)) closeUpTo(new Set(['p']), new Set(['li', 'td', 'th', 'blockquote', 'div', 'table']));
    if (name === 'li') closeUpTo(new Set(['li']), new Set(['ul', 'ol']));
    if (name === 'dt' || name === 'dd') closeUpTo(new Set(['dt', 'dd']), new Set(['dl']));
    if (name === 'td' || name === 'th') closeUpTo(new Set(['td', 'th']), new Set(['tr', 'table']));
    if (name === 'tr') closeUpTo(new Set(['tr', 'td', 'th']), new Set(['table']));
    const node = { name, attrs: t.attrs, children: [] };
    top().children.push(node);
    if (!VOID.has(name) && !t.selfClose) stack.push(node);
  }
  return root;
}

function rawText(node) {
  return node.children.map((c) => (typeof c === 'string' ? c : c.name === 'br' ? '\n' : rawText(c))).join('');
}

// Строчное содержимое узла: куски с оформлением; блочные элементы внутри (в ячейках) - через пробел
function inlineRuns(node, f, out) {
  for (const c of node.children) {
    if (typeof c === 'string') { out.push(makeRun(c, f)); continue; }
    const n = c.name;
    if (SKIP.has(n)) continue;
    if (n === 'br') { out.push({ ...makeRun('\n', f), literal: true }); continue; }
    if (n === 'img') { if (c.attrs.alt) out.push(makeRun(c.attrs.alt, f)); continue; }
    const g = { ...f };
    if (n === 'b' || n === 'strong') g.b = true;
    else if (n === 'i' || n === 'em' || n === 'cite' || n === 'dfn') g.i = true;
    else if (n === 'code' || n === 'tt' || n === 'kbd' || n === 'samp' || n === 'var') g.code = true;
    else if (n === 'a' && c.attrs.href) g.href = c.attrs.href;
    else if (BLOCK.has(n)) out.push(makeRun(' ', {}));
    inlineRuns(c, g, out);
  }
  return out;
}

const inlineOf = (node) => collapseRuns(inlineRuns(node, {}, []));

function blocksOf(node) {
  const out = [];
  let pending = { name: '#inline', attrs: {}, children: [] };
  const flush = () => {
    const inl = inlineOf(pending);
    if (inl.length) out.push({ type: 'p', inl });
    pending = { name: '#inline', attrs: {}, children: [] };
  };
  for (const c of node.children) {
    if (typeof c === 'string' || !(BLOCK.has(c.name) || CONTAINER.has(c.name) || SKIP.has(c.name) || c.name === 'tr')) {
      pending.children.push(c);
      continue;
    }
    flush();
    const n = c.name;
    if (SKIP.has(n)) continue;
    if (n === 'p') out.push({ type: 'p', inl: inlineOf(c) });
    else if (HEADINGS.has(n)) out.push({ type: 'h', level: Number(n[1]), inl: inlineOf(c) });
    else if (n === 'hr') out.push({ type: 'hr' });
    else if (n === 'pre') out.push({ type: 'code', text: rawText(c).replace(/^\n/, '').replace(/\r\n?/g, '\n') });
    else if (n === 'blockquote') out.push({ type: 'quote', blocks: blocksOf(c) });
    else if (n === 'ul' || n === 'ol') out.push({ type: 'list', ordered: n === 'ol', items: listItems(c) }); else if (n === 'table') out.push({ type: 'table', rows: tableRows(c, []).map((tr) => tr.children.filter((x) => typeof x !== 'string' && (x.name === 'td' || x.name === 'th')).map(inlineOf)) });
    else out.push(...blocksOf(c)); // div, section, li вне списка и прочие контейнеры
  }
  flush();
  return out;
}

// Пункты списка; вложенный <ul> прямо в <ul> (частая ошибка разметки) - продолжение последнего пункта
function listItems(node) {
  const items = [];
  for (const c of node.children) {
    if (typeof c === 'string') continue;
    if (c.name === 'li') items.push(blocksOf(c));
    else if (c.name === 'ul' || c.name === 'ol') {
      const list = { type: 'list', ordered: c.name === 'ol', items: listItems(c) };
      if (items.length) items[items.length - 1].push(list);
      else items.push([list]);
    }
  }
  return items;
}

function tableRows(node, out) {
  for (const c of node.children) {
    if (typeof c === 'string' || c.name === 'table') continue;
    if (c.name === 'tr') out.push(c);
    else tableRows(c, out);
  }
  return out;
}

export function parseHtml(html) {
  return normBlocks(blocksOf(buildTree(tokenize(html))));
}

// ---------- запись ----------

export const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function writeRun(r) {
  let s = escapeHtml(r.text).replace(/\n/g, '<br>\n');
  if (r.code) s = `<code>${s}</code>`;
  if (r.i) s = `<em>${s}</em>`;
  if (r.b) s = `<strong>${s}</strong>`;
  return s;
}

export function writeInlineHtml(inl) {
  let s = '';
  for (let i = 0; i < inl.length;) {
    const href = inl[i].href;
    let j = i;
    let part = '';
    while (j < inl.length && inl[j].href === href) part += writeRun(inl[j++]);
    s += href ? `<a href="${escapeHtml(href)}">${part}</a>` : part;
    i = j;
  }
  return s;
}

function writeBlock(b) {
  if (b.type === 'h') return `<h${b.level}>${writeInlineHtml(b.inl)}</h${b.level}>`;
  if (b.type === 'p') return `<p>${writeInlineHtml(b.inl)}</p>`;
  if (b.type === 'hr') return '<hr>';
  // перевод строки сразу после <pre> браузер отбрасывает - ставим его сами, чтобы код начинался как есть
  if (b.type === 'code') return `<pre>\n<code>${escapeHtml(b.text)}</code></pre>`;
  if (b.type === 'quote') return `<blockquote>\n${writeBlocks(b.blocks)}\n</blockquote>`;
  if (b.type === 'list') {
    const tag = b.ordered ? 'ol' : 'ul';
    const items = b.items.map((item) => {
      // первый абзац пункта - прямо в <li>, остальное - блоками
      const [first, ...rest] = item;
      const head = first?.type === 'p' ? writeInlineHtml(first.inl) : first ? writeBlock(first) : '';
      return `<li>${head}${rest.length ? `\n${writeBlocks(rest)}\n` : ''}</li>`;
    });
    return `<${tag}>\n${items.join('\n')}\n</${tag}>`;
  }
  const rows = b.rows.map((row, k) => {
    const tag = k === 0 ? 'th' : 'td';
    return `<tr>${row.map((cell) => `<${tag}>${writeInlineHtml(cell)}</${tag}>`).join('')}</tr>`;
  });
  return `<table>\n${rows.join('\n')}\n</table>`;
}

function writeBlocks(blocks) {
  return blocks.map(writeBlock).join('\n');
}

const STYLE = 'body{font-family:system-ui,sans-serif;max-width:46em;margin:2em auto;padding:0 1em;line-height:1.5}'
  + 'pre{background:#f4f4f4;padding:.6em;overflow:auto}blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:1em;color:#444}'
  + 'table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:.2em .5em}';

export function writeHtml(blocks, title = '') {
  const h = blocks.find((b) => b.type === 'h');
  const name = title || (h ? inlText(h.inl) : '') || 'Document';
  return `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>${escapeHtml(name)}</title>\n<style>${STYLE}</style>\n</head>\n<body>\n${writeBlocks(blocks)}\n</body>\n</html>\n`;
}
