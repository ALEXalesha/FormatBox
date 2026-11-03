// Маленький разборщик XML для docx, odt и 3MF: без DOM, работает в Worker и Node.
// Узел: { name, attrs: {}, children: [узел | строка] }. Пространства имён остаются в имени (w:p).
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function unescapeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENT[e] ?? m;
  });
}

export function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function parseXml(text) {
  const root = { name: '#document', attrs: {}, children: [] };
  const stack = [root];
  const attrRe = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    const top = stack[stack.length - 1];
    if (lt < 0) { pushText(top, text.slice(i)); break; }
    if (lt > i) pushText(top, text.slice(i, lt));
    if (text.startsWith('<!--', lt)) { i = end(text, '-->', lt) ; continue; }
    if (text.startsWith('<![CDATA[', lt)) {
      const close = text.indexOf(']]>', lt);
      const stop = close < 0 ? text.length : close;
      top.children.push(text.slice(lt + 9, stop));
      i = stop + 3;
      continue;
    }
    if (text[lt + 1] === '?' || text[lt + 1] === '!') { i = end(text, '>', lt); continue; }
    const gt = text.indexOf('>', lt);
    if (gt < 0) break;
    const body = text.slice(lt + 1, gt);
    if (body[0] === '/') {
      const name = body.slice(1).trim();
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].name === name) { stack.length = k; break; }
    } else {
      const selfClose = body.endsWith('/');
      const inner = selfClose ? body.slice(0, -1) : body;
      const name = inner.split(/\s/, 1)[0];
      const node = { name, attrs: {}, children: [] };
      attrRe.lastIndex = name.length;
      for (let m; (m = attrRe.exec(inner));) node.attrs[m[1]] = unescapeXml(m[3] ?? m[4]);
      top.children.push(node);
      if (!selfClose) stack.push(node);
    }
    i = gt + 1;
  }
  return root;
}

function end(text, marker, from) {
  const k = text.indexOf(marker, from);
  return k < 0 ? text.length : k + marker.length;
}

function pushText(node, raw) {
  if (raw) node.children.push(unescapeXml(raw));
}

// Все потомки с данным именем (без пространства имён тоже: 'p' найдёт 'w:p')
export function findAll(node, name, out = []) {
  for (const c of node.children) {
    if (typeof c === 'string') continue;
    if (c.name === name || c.name.endsWith(`:${name}`)) out.push(c);
    findAll(c, name, out);
  }
  return out;
}

export function findFirst(node, name) {
  for (const c of node.children) {
    if (typeof c === 'string') continue;
    if (c.name === name || c.name.endsWith(`:${name}`)) return c;
    const deep = findFirst(c, name);
    if (deep) return deep;
  }
  return null;
}

export function textOf(node) {
  return node.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
}
