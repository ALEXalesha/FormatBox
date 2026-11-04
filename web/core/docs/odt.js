// ODT (OpenDocument Text). Чтение content.xml: text:h, text:p, text:list, таблицы, span со стилями
// (жирный, курсив, моноширинный), ссылки text:a. Запись - валидный пакет: mimetype первым без сжатия,
// META-INF/manifest.xml, content.xml, styles.xml.
import { zipSync, unzipSync, strFromU8, strToU8 } from '../../vendor/fflate.js';
import { parseXml, escapeXml, findAll, findFirst } from '../xml.js';
import { normBlocks, makeRun, collapseRuns, xmlSafe } from './model.js';

const MIME = 'application/vnd.oasis.opendocument.text';
const MONO = /mono|courier|consolas|menlo|monaco|source code|fixed/i;

// ---------- чтение ----------

const elems = (n) => n.children.filter((c) => typeof c !== 'string');

function readStyles(roots) {
  const styles = {};
  const lists = {};
  for (const root of roots) {
    for (const s of findAll(root, 'style')) {
      if (s.name !== 'style:style') continue;
      const tp = elems(s).find((c) => c.name === 'style:text-properties')?.attrs ?? {};
      const weight = tp['fo:font-weight'];
      const font = `${tp['style:font-name'] ?? ''} ${tp['fo:font-family'] ?? ''}`;
      styles[s.attrs['style:name']] = {
        parent: s.attrs['style:parent-style-name'],
        name: s.attrs['style:display-name'] ?? s.attrs['style:name'],
        b: weight ? weight === 'bold' || Number(weight) >= 600 : undefined,
        i: tp['fo:font-style'] ? tp['fo:font-style'] !== 'normal' : undefined,
        code: MONO.test(font) || undefined,
      };
    }
    for (const l of findAll(root, 'list-style')) {
      lists[l.attrs['style:name']] = Object.fromEntries(elems(l).map((lv) => [lv.attrs['text:level'], lv.name === 'text:list-level-style-number']));
    }
  }
  return { styles, lists };
}

// значение свойства стиля по цепочке родителей (undefined - не задано нигде)
function prop(ctx, name, key) {
  for (let k = 0, s = ctx.styles[name]; s && k < 20; k++, s = ctx.styles[s.parent]) if (s[key] !== undefined) return s[key];
  return undefined;
}

function styleNames(ctx, name) {
  const out = [];
  for (let k = 0, n = name, s = ctx.styles[n]; n && k < 20; k++, n = s?.parent, s = ctx.styles[n]) out.push(n, s?.name ?? '');
  return out.join(' ');
}

function inlineRuns(node, ctx, f, out) {
  for (const c of node.children) {
    if (typeof c === 'string') { out.push(makeRun(c, f)); continue; }
    const n = c.name;
    if (n === 'text:s') out.push({ ...makeRun(' '.repeat(Number(c.attrs['text:c'] ?? 1)), f), literal: true });
    else if (n === 'text:tab') out.push({ ...makeRun('\t', f), literal: true });
    else if (n === 'text:line-break') out.push({ ...makeRun('\n', f), literal: true });
    else if (n === 'text:span') {
      const st = c.attrs['text:style-name'];
      const g = { ...f };
      for (const key of ['b', 'i', 'code']) { const v = prop(ctx, st, key); if (v !== undefined) g[key] = v; }
      if (/source.?text|code/i.test(styleNames(ctx, st))) g.code = true;
      inlineRuns(c, ctx, g, out);
    } else if (n === 'text:a') inlineRuns(c, ctx, { ...f, href: c.attrs['xlink:href'] }, out);
    else if (n === 'text:note' || n === 'office:annotation' || n.startsWith('draw:') || n === 'text:bookmark-ref') continue;
    else inlineRuns(c, ctx, f, out);
  }
  return out;
}

const inlineOf = (node, ctx) => collapseRuns(inlineRuns(node, ctx, {}, []));
const plain = (inl) => inl.map((r) => r.text).join('');

function readList(node, ctx, depth, inherited) {
  const own = node.attrs['text:style-name'];
  const style = own ?? inherited;
  const ordered = ctx.lists[style]?.[String(depth + 1)] ?? ctx.lists[style]?.['1'] ?? false;
  const items = elems(node).filter((c) => c.name === 'text:list-item' || c.name === 'text:list-header')
    .map((item) => readBlocks(item, ctx, depth + 1, style));
  return { type: 'list', ordered, items };
}

function readBlocks(node, ctx, depth = 0, listStyle) {
  const out = [];
  for (const c of elems(node)) {
    const n = c.name;
    const last = out[out.length - 1];
    if (n === 'text:h') out.push({ type: 'h', level: Number(c.attrs['text:outline-level'] ?? 1), inl: inlineOf(c, ctx) });
    else if (n === 'text:p') {
      const names = styleNames(ctx, c.attrs['text:style-name']);
      if (/horizontal.?line/i.test(names)) { out.push({ type: 'hr' }); continue; }
      if (/preformatted|source|code/i.test(names) || prop(ctx, c.attrs['text:style-name'], 'code')) {
        // пробелы схлопываются и здесь (так велит ODF), отступы кода приходят через text:s
        const text = plain(collapseRuns(inlineRuns(c, ctx, {}, []), { keepBreaks: true }));
        if (last?.type === 'code') last.text += `\n${text}`;
        else out.push({ type: 'code', text });
        continue;
      }
      const inl = inlineOf(c, ctx);
      if (/quotation|quote|цитат/i.test(names)) {
        if (last?.type === 'quote') last.blocks.push({ type: 'p', inl });
        else out.push({ type: 'quote', blocks: [{ type: 'p', inl }] });
      } else out.push({ type: 'p', inl });
    } else if (n === 'text:list') out.push(readList(c, ctx, depth, listStyle));
    else if (n === 'table:table') {
      const rows = findAll(c, 'table-row').map((row) => elems(row).filter((x) => x.name === 'table:table-cell').map((cell) => {
        const inl = [];
        elems(cell).filter((x) => x.name === 'text:p' || x.name === 'text:h').forEach((p, k) => { if (k) inl.push(makeRun(' ')); inl.push(...inlineOf(p, ctx)); });
        return inl;
      }));
      out.push({ type: 'table', rows });
    } else if (n === 'text:section' || n === 'text:index-body' || n === 'text:table-of-content') out.push(...readBlocks(c, ctx, depth, listStyle));
  }
  return out;
}

export function readOdt(bytes) {
  const files = unzipSync(bytes);
  if (!files['content.xml']) throw new Error('odt: content.xml not found');
  const content = parseXml(strFromU8(files['content.xml']));
  const roots = [content, ...(files['styles.xml'] ? [parseXml(strFromU8(files['styles.xml']))] : [])];
  const ctx = readStyles(roots);
  const text = findFirst(content, 'office:text') ?? findFirst(content, 'text');
  return normBlocks(text ? readBlocks(text, ctx) : []);
}

// ---------- запись ----------

// Пробелы в ODF схлопываются: одиночный пробел между непробельными символами пишем как есть,
// остальные (в начале, в конце, подряд) - через text:s. \t и \n - отдельные элементы.
function spaced(text, before, after) {
  let s = '';
  for (let k = 0; k < text.length;) {
    const ch = text[k];
    if (ch === '\t') { s += '<text:tab/>'; k++; continue; }
    if (ch === '\n') { s += '<text:line-break/>'; k++; continue; }
    if (ch === ' ') {
      let n = 0;
      while (text[k + n] === ' ') n++;
      const prev = k === 0 ? before : text[k - 1];
      const next = k + n < text.length ? text[k + n] : after;
      if (n === 1 && prev && prev !== ' ' && prev !== '\n' && prev !== '\t' && next && !/\s/.test(next)) s += ' ';
      else s += `<text:s${n > 1 ? ` text:c="${n}"` : ''}/>`;
      k += n;
      continue;
    }
    let j = k;
    while (j < text.length && !' \t\n'.includes(text[j])) j++;
    s += escapeXml(xmlSafe(text.slice(k, j)));
    k = j;
  }
  return s;
}

function inlXml(inl, ctx) {
  let s = '';
  const all = inl.map((r) => r.text).join('');
  let pos = 0;
  let open = null;
  for (const r of inl) {
    const before = all[pos - 1] ?? '';
    const after = all[pos + r.text.length] ?? '';
    pos += r.text.length;
    if (open !== (r.href ?? null)) {
      if (open) s += '</text:a>';
      if (r.href) s += `<text:a xlink:type="simple" xlink:href="${escapeXml(xmlSafe(r.href))}">`;
      open = r.href ?? null;
    }
    const body = spaced(r.text, before, after);
    const key = `${r.b ? 'b' : ''}${r.i ? 'i' : ''}${r.code ? 'c' : ''}`;
    if (key) {
      if (!ctx.textStyles.has(key)) ctx.textStyles.set(key, `T${ctx.textStyles.size + 1}`);
      s += `<text:span text:style-name="${ctx.textStyles.get(key)}">${body}</text:span>`;
    } else s += body;
  }
  return open ? `${s}</text:a>` : s;
}

function blockXml(b, ctx) {
  if (b.type === 'h') return `<text:h text:style-name="Heading_20_${b.level}" text:outline-level="${b.level}">${inlXml(b.inl, ctx)}</text:h>`;
  if (b.type === 'p') return `<text:p text:style-name="Standard">${inlXml(b.inl, ctx)}</text:p>`;
  if (b.type === 'hr') return '<text:p text:style-name="Horizontal_20_Line"/>';
  if (b.type === 'code') return `<text:p text:style-name="Preformatted_20_Text">${spaced(b.text, '', '')}</text:p>`;
  if (b.type === 'quote') {
    return b.blocks.map((q) => (q.type === 'p' || q.type === 'h' ? `<text:p text:style-name="Quotations">${inlXml(q.inl, ctx)}</text:p>` : blockXml(q, ctx))).join('');
  }
  if (b.type === 'list') {
    const items = b.items.map((item) => `<text:list-item>${item.map((x) => blockXml(x, ctx)).join('')}</text:list-item>`).join('');
    return `<text:list text:style-name="${b.ordered ? 'LN' : 'LB'}">${items}</text:list>`;
  }
  const cols = Math.max(...b.rows.map((r) => r.length));
  ctx.tables += 1;
  const rows = b.rows.map((row) => `<table:table-row>${Array.from({ length: cols }, (_, k) => `<table:table-cell table:style-name="Cell" office:value-type="string"><text:p text:style-name="Table_20_Contents">${inlXml(row[k] ?? [], ctx)}</text:p></table:table-cell>`).join('')}</table:table-row>`);
  return `<table:table table:name="Table${ctx.tables}" table:style-name="Tbl"><table:table-column table:number-columns-repeated="${cols}"/>${rows.join('')}</table:table>`;
}

const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" '
  + 'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
  + 'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" '
  + 'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.2"';
const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n';
const MONO_PROPS = 'style:font-name="Liberation Mono" fo:font-family="\'Liberation Mono\'" style:font-family-generic="modern" style:font-pitch="fixed"';

function listStyle(name, ordered) {
  const levels = Array.from({ length: 10 }, (_, k) => {
    const pos = `<style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${(k + 1) * 0.635}cm" fo:text-indent="-0.635cm" fo:margin-left="${(k + 1) * 0.635}cm"/></style:list-level-properties>`;
    return ordered
      ? `<text:list-level-style-number text:level="${k + 1}" style:num-suffix="." style:num-format="1">${pos}</text:list-level-style-number>`
      : `<text:list-level-style-bullet text:level="${k + 1}" text:bullet-char="${['•', '◦', '▪'][k % 3]}">${pos}</text:list-level-style-bullet>`;
  });
  return `<text:list-style style:name="${name}">${levels.join('')}</text:list-style>`;
}

function stylesXml() {
  const sizes = ['130%', '115%', '101%', '95%', '85%', '85%'];
  const heading = (n) => `<style:style style:name="Heading_20_${n}" style:display-name="Heading ${n}" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard" style:default-outline-level="${n}" style:class="text">`
    + `<style:paragraph-properties fo:margin-top="0.4cm" fo:margin-bottom="0.2cm" fo:keep-with-next="always"/><style:text-properties fo:font-size="${sizes[n - 1]}" fo:font-weight="bold"/></style:style>`;
  return `${HEAD}<office:document-styles ${NS}><office:styles>`
    + '<style:default-style style:family="paragraph"><style:text-properties style:font-name="Liberation Serif" fo:font-family="\'Liberation Serif\'" fo:font-size="12pt" fo:language="ru" fo:country="RU"/></style:default-style>'
    + '<style:style style:name="Standard" style:family="paragraph" style:class="text"><style:paragraph-properties fo:margin-bottom="0.2cm"/></style:style>'
    + [1, 2, 3, 4, 5, 6].map(heading).join('')
    + '<style:style style:name="Quotations" style:family="paragraph" style:parent-style-name="Standard" style:class="html"><style:paragraph-properties fo:margin-left="1cm" fo:margin-right="1cm"/><style:text-properties fo:color="#404040"/></style:style>'
    + `<style:style style:name="Preformatted_20_Text" style:display-name="Preformatted Text" style:family="paragraph" style:parent-style-name="Standard" style:class="html"><style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0cm" fo:background-color="#f2f2f2"/><style:text-properties ${MONO_PROPS} fo:font-size="10pt"/></style:style>`
    + '<style:style style:name="Horizontal_20_Line" style:display-name="Horizontal Line" style:family="paragraph" style:parent-style-name="Standard" style:class="html"><style:paragraph-properties fo:margin-bottom="0.5cm" fo:border-bottom="0.06pt solid #808080" fo:padding="0cm"/><style:text-properties fo:font-size="6pt"/></style:style>'
    + '<style:style style:name="Table_20_Contents" style:display-name="Table Contents" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"/>'
    + '</office:styles></office:document-styles>';
}

function contentXml(body, ctx) {
  const text = [...ctx.textStyles].map(([key, name]) => `<style:style style:name="${name}" style:family="text"><style:text-properties${key.includes('b') ? ' fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"' : ''}${key.includes('i') ? ' fo:font-style="italic" style:font-style-asian="italic" style:font-style-complex="italic"' : ''}${key.includes('c') ? ` ${MONO_PROPS}` : ''}/></style:style>`);
  const auto = text.join('') + listStyle('LB', false) + listStyle('LN', true)
    + '<style:style style:name="Tbl" style:family="table"><style:table-properties style:width="17cm" table:align="margins"/></style:style>'
    + '<style:style style:name="Cell" style:family="table-cell"><style:table-cell-properties fo:padding="0.1cm" fo:border="0.5pt solid #000000"/></style:style>';
  return `${HEAD}<office:document-content ${NS}><office:automatic-styles>${auto}</office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`;
}

export function writeOdt(blocks) {
  const ctx = { textStyles: new Map(), tables: 0 };
  const body = blocks.map((b) => blockXml(b, ctx)).join('');
  const manifest = `${HEAD}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">`
    + `<manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="${MIME}"/>`
    + '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'
    + '<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/></manifest:manifest>';
  const mtime = new Date(Date.UTC(2000, 0, 1));
  // mimetype - первым и без сжатия: по нему программы узнают формат
  return zipSync({
    mimetype: [strToU8(MIME), { level: 0 }],
    'content.xml': strToU8(contentXml(body, ctx)),
    'styles.xml': strToU8(stylesXml()),
    'META-INF/manifest.xml': strToU8(manifest),
  }, { level: 6, mtime });
}
