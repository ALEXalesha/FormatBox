// DOCX (Office Open XML). Чтение word/document.xml: абзацы, заголовки по стилям, жирный/курсив/код,
// списки (numPr + numbering.xml), таблицы, гиперссылки (rels), цитаты и код по стилям.
// Запись - минимальный валидный пакет: [Content_Types].xml, _rels, document.xml, styles.xml, numbering.xml.
import { zipSync, unzipSync, strFromU8, strToU8 } from '../../vendor/fflate.js';
import { parseXml, escapeXml, findAll, findFirst } from '../xml.js';
import { normBlocks, makeRun, xmlSafe } from './model.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PR = 'http://schemas.openxmlformats.org/package/2006/relationships';
const MONO = /mono|courier|consolas|menlo|monaco|source code|fixed/i;
const OFF = new Set(['0', 'false', 'off', 'none']);

// ---------- чтение ----------

const local = (n) => n.name.slice(n.name.indexOf(':') + 1);
const kids = (n, name) => (n ? n.children.filter((c) => typeof c !== 'string' && local(c) === name) : []);
const kid = (n, name) => kids(n, name)[0] ?? null;
const val = (n) => n?.attrs['w:val'];
const on = (n) => !!n && !OFF.has(String(val(n) ?? 'true').toLowerCase());

function readStyles(xml) {
  const styles = {};
  if (!xml) return styles;
  for (const s of findAll(parseXml(xml), 'style')) {
    const id = s.attrs['w:styleId'];
    const name = (val(kid(s, 'name')) || id || '').toLowerCase();
    const rPr = kid(s, 'rPr');
    const pPr = kid(s, 'pPr');
    const fonts = kid(rPr, 'rFonts');
    const outline = val(kid(pPr, 'outlineLvl'));
    const hm = /^(?:heading|заголовок)\s*([1-6])$/.exec(name) ?? /^heading([1-6])$/i.exec(id);
    styles[id] = {
      basedOn: val(kid(s, 'basedOn')),
      heading: hm ? Number(hm[1]) : name === 'title' ? 1 : outline !== undefined && Number(outline) < 6 ? Number(outline) + 1 : 0,
      quote: /quot|цитат|block text/.test(name),
      code: /code|verbatim|preformat|source|html.?pre/.test(name) || MONO.test(fonts?.attrs['w:ascii'] ?? ''),
      b: on(kid(rPr, 'b')) ? true : undefined,
      i: on(kid(rPr, 'i')) ? true : undefined,
      numPr: kid(pPr, 'numPr'),
      hr: !!kid(kid(pPr, 'pBdr'), 'bottom'),
    };
  }
  return styles;
}

// свойство стиля с учётом цепочки basedOn
function styleProp(styles, id, key) {
  for (let k = 0, s = styles[id]; s && k < 20; k++, s = styles[s.basedOn]) if (s[key]) return s[key];
  return undefined;
}

function readNumbering(xml) {
  const abstract = {};
  const nums = {};
  if (!xml) return nums;
  const root = parseXml(xml);
  // w:lvlOverride может переопределить уровень целиком (так пишет LibreOffice)
  const fmts = (lvls) => Object.fromEntries(lvls.map((l) => [l.attrs['w:ilvl'], val(kid(l, 'numFmt')) ?? 'decimal']));
  for (const a of findAll(root, 'abstractNum')) abstract[a.attrs['w:abstractNumId']] = fmts(kids(a, 'lvl'));
  for (const n of findAll(root, 'num')) {
    nums[n.attrs['w:numId']] = { ...abstract[val(kid(n, 'abstractNumId'))], ...fmts(kids(n, 'lvlOverride').flatMap((o) => kids(o, 'lvl'))) };
  }
  return nums;
}

function readRels(xml) {
  const rels = {};
  if (xml) for (const r of findAll(parseXml(xml), 'Relationship')) rels[r.attrs.Id] = r.attrs.Target;
  return rels;
}

// Поле HYPERLINK (так пишет ссылки с якорем LibreOffice): адрес из кода поля
function fieldHref(instr) {
  const m = /HYPERLINK\s+"([^"]*)"(?:.*?\\l\s+"([^"]*)")?/.exec(instr);
  if (!m) return undefined;
  return m[1] + (m[2] ? `#${m[2]}` : '');
}

function runsOf(node, ctx, f, out, field = { depth: 0, instr: '', href: undefined }) {
  for (const c of node.children) {
    if (typeof c === 'string') continue;
    const n = local(c);
    if (n === 'r') {
      for (const x of c.children) {
        if (typeof x === 'string') continue;
        if (local(x) === 'fldChar') {
          const type = x.attrs['w:fldCharType'];
          if (type === 'begin') { field.depth++; field.instr = ''; }
          if (type === 'separate') field.href = fieldHref(field.instr);
          if (type === 'end') { field.depth = Math.max(0, field.depth - 1); field.href = undefined; }
        } else if (local(x) === 'instrText') field.instr += x.children.filter((t) => typeof t === 'string').join('');
      }
      const rPr = kid(c, 'rPr');
      const style = val(kid(rPr, 'rStyle'));
      const font = kid(rPr, 'rFonts')?.attrs['w:ascii'] ?? '';
      const g = { ...f, href: f.href ?? field.href };
      const b = kid(rPr, 'b');
      const i = kid(rPr, 'i');
      g.b = b ? on(b) : f.b || styleProp(ctx.styles, style, 'b');
      g.i = i ? on(i) : f.i || styleProp(ctx.styles, style, 'i');
      g.code = f.code || MONO.test(font) || !!styleProp(ctx.styles, style, 'code');
      for (const t of c.children) {
        if (typeof t === 'string') continue;
        const tn = local(t);
        if (tn === 't') out.push(makeRun(t.children.filter((x) => typeof x === 'string').join(''), g));
        else if (tn === 'tab') out.push(makeRun('\t', g));
        else if (tn === 'br' || tn === 'cr') out.push(makeRun('\n', g));
        else if (tn === 'noBreakHyphen') out.push(makeRun('-', g));
      }
    } else if (n === 'hyperlink') {
      const anchor = c.attrs['w:anchor'] ? `#${c.attrs['w:anchor']}` : '';
      const href = (ctx.rels[c.attrs['r:id']] ?? '') + anchor;
      runsOf(c, ctx, { ...f, href: href || f.href }, out, field);
    } else if (n === 'ins' || n === 'smartTag' || n === 'fldSimple' || n === 'customXml' || n === 'sdt' || n === 'sdtContent') {
      runsOf(c, ctx, f, out, field);
    }
  }
  return out;
}

function paraInfo(p, ctx) {
  const pPr = kid(p, 'pPr');
  const style = val(kid(pPr, 'pStyle')) ?? 'Normal';
  const numPr = kid(pPr, 'numPr') ?? styleProp(ctx.styles, style, 'numPr');
  const numId = val(kid(numPr, 'numId'));
  const ilvl = Number(val(kid(numPr, 'ilvl')) ?? 0);
  const inl = runsOf(p, ctx, {}, []);
  const hr = !!kid(kid(pPr, 'pBdr'), 'bottom') || !!styleProp(ctx.styles, style, 'hr');
  const heading = styleProp(ctx.styles, style, 'heading') ?? 0;
  const fmt = ctx.nums[numId]?.[ilvl] ?? 'bullet';
  return {
    inl,
    heading,
    quote: !!styleProp(ctx.styles, style, 'quote'),
    code: !!styleProp(ctx.styles, style, 'code'),
    // нумерация заголовков (numFmt none) - не список
    list: numId && numId !== '0' && fmt !== 'none' && !heading ? { ilvl, ordered: fmt !== 'bullet' } : null,
    hr,
  };
}

const plain = (inl) => inl.map((r) => r.text).join('');

function readBody(body, ctx) {
  const out = [];
  let lists = []; // стек открытых списков: { block, ilvl }
  // абзацы и таблицы по порядку, в том числе внутри элементов управления содержимым (sdt)
  const items = [];
  const collect = (node) => {
    for (const c of node?.children ?? []) {
      if (typeof c === 'string') continue;
      const n = local(c);
      if (n === 'p' || n === 'tbl') items.push([n, c]);
      else if (n === 'sdt') collect(kid(c, 'sdtContent'));
      else if (n === 'customXml') collect(c);
    }
  };
  collect(body);
  for (const [n, c] of items) {
    if (n === 'tbl') {
      lists = [];
      const rows = kids(c, 'tr').map((tr) => kids(tr, 'tc').map((tc) => {
        const inl = [];
        kids(tc, 'p').forEach((p, k) => { if (k) inl.push(makeRun(' ')); inl.push(...runsOf(p, ctx, {}, [])); });
        return inl;
      }));
      out.push({ type: 'table', rows });
      continue;
    }
    const info = paraInfo(c, ctx);
    const last = out[out.length - 1];
    if (info.list) {
      while (lists.length && lists[lists.length - 1].ilvl > info.list.ilvl) lists.pop();
      let top = lists[lists.length - 1];
      // на том же уровне список другого вида - новый список (numId у пунктов одного списка бывает разным)
      if (top && top.ilvl === info.list.ilvl && top.block.ordered !== info.list.ordered) { lists.pop(); top = lists[lists.length - 1]; }
      if (!top || top.ilvl < info.list.ilvl) {
        const block = { type: 'list', ordered: info.list.ordered, items: [] };
        if (top) {
          const parent = top.block.items[top.block.items.length - 1] ?? (top.block.items[0] = []);
          parent.push(block);
        } else out.push(block);
        lists.push({ block, ilvl: info.list.ilvl });
        top = lists[lists.length - 1];
      }
      top.block.items.push([{ type: 'p', inl: info.inl }]);
      continue;
    }
    lists = [];
    if (info.hr && !plain(info.inl).trim()) out.push({ type: 'hr' });
    else if (info.heading) out.push({ type: 'h', level: info.heading, inl: info.inl });
    else if (info.code) {
      const text = plain(info.inl);
      if (last?.type === 'code') last.text += `\n${text}`;
      else out.push({ type: 'code', text });
    } else if (info.quote) {
      if (last?.type === 'quote') last.blocks.push({ type: 'p', inl: info.inl });
      else out.push({ type: 'quote', blocks: [{ type: 'p', inl: info.inl }] });
    } else out.push({ type: 'p', inl: info.inl });
  }
  return out;
}

export function readDocx(bytes) {
  const files = unzipSync(bytes);
  const text = (name) => (files[name] ? strFromU8(files[name]) : '');
  const doc = text('word/document.xml');
  if (!doc) throw new Error('docx: word/document.xml not found');
  const ctx = {
    styles: readStyles(text('word/styles.xml')),
    nums: readNumbering(text('word/numbering.xml')),
    rels: readRels(text('word/_rels/document.xml.rels')),
  };
  const body = findFirst(parseXml(doc), 'body');
  return normBlocks(body ? readBody(body, ctx) : []);
}

// ---------- запись ----------

const t = (s) => `<w:t xml:space="preserve">${escapeXml(xmlSafe(s))}</w:t>`;

function runXml(r) {
  const props = [];
  if (r.href) props.push('<w:rStyle w:val="Hyperlink"/>');
  if (r.code) props.push('<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/>');
  if (r.b) props.push('<w:b/><w:bCs/>');
  if (r.i) props.push('<w:i/><w:iCs/>');
  const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : '';
  // перенос строки и табуляция - отдельные элементы
  const parts = r.text.split(/(\n|\t)/).filter(Boolean).map((p) => (p === '\n' ? '<w:br/>' : p === '\t' ? '<w:tab/>' : t(p)));
  return `<w:r>${rPr}${parts.join('')}</w:r>`;
}

function inlXml(inl, ctx) {
  let s = '';
  for (let i = 0; i < inl.length;) {
    const href = inl[i].href;
    let j = i;
    let part = '';
    while (j < inl.length && inl[j].href === href) part += runXml(inl[j++]);
    if (href) {
      if (!ctx.links.has(href)) ctx.links.set(href, `rIdL${ctx.links.size + 1}`);
      s += `<w:hyperlink r:id="${ctx.links.get(href)}" w:history="1">${part}</w:hyperlink>`;
    } else s += part;
    i = j;
  }
  return s;
}

const para = (style, inl, ctx, extra = '') => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>${inlXml(inl, ctx)}</w:p>`;

function listXml(list, ilvl, ctx) {
  ctx.nums.push(list.ordered ? 2 : 1);
  const numId = ctx.nums.length;
  const numPr = `<w:numPr><w:ilvl w:val="${Math.min(8, ilvl)}"/><w:numId w:val="${numId}"/></w:numPr>`;
  let s = '';
  for (const item of list.items) {
    let first = true;
    for (const b of item) {
      if (b.type === 'list') s += listXml(b, ilvl + 1, ctx);
      else if (first && b.type === 'p') s += para('ListParagraph', b.inl, ctx, numPr);
      else s += blockXml(b, ctx, ilvl);
      first = false;
    }
    if (!item.length) s += para('ListParagraph', [], ctx, numPr);
  }
  return s;
}

function blockXml(b, ctx, ilvl = -1) {
  // отступ для блоков внутри пункта списка (кроме первого абзаца)
  const ind = ilvl >= 0 ? `<w:ind w:left="${720 * (ilvl + 1)}"/>` : '';
  if (b.type === 'h') return para(`Heading${b.level}`, b.inl, ctx);
  if (b.type === 'p') return para(ilvl >= 0 ? 'ListParagraph' : '', b.inl, ctx, ind);
  if (b.type === 'hr') return para('', [], ctx, '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr>');
  if (b.type === 'code') return para('Code', [{ text: b.text }], ctx, ind);
  if (b.type === 'quote') {
    return b.blocks.map((q) => (q.type === 'p' || q.type === 'h' ? para('Quote', q.inl, ctx) : blockXml(q, ctx, ilvl))).join('');
  }
  if (b.type === 'list') return listXml(b, Math.max(0, ilvl), ctx);
  const cols = Math.max(...b.rows.map((r) => r.length));
  const width = Math.floor(9638 / cols);
  const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`;
  const rows = b.rows.map((row) => `<w:tr>${Array.from({ length: cols }, (_, k) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${para('', row[k] ?? [], ctx)}</w:tc>`).join('')}</w:tr>`);
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders><w:tblLook w:val="04A0"/></w:tblPr>`
    + `<w:tblGrid>${`<w:gridCol w:w="${width}"/>`.repeat(cols)}</w:tblGrid>${rows.join('')}</w:tbl>`;
}

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function stylesXml() {
  const sizes = [32, 28, 26, 24, 22, 22];
  const heading = (n) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>`
    + `<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="${sizes[n - 1]}"/><w:szCs w:val="${sizes[n - 1]}"/></w:rPr></w:style>`;
  return `${HEAD}<w:styles xmlns:w="${W}">`
    + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Liberation Serif" w:hAnsi="Liberation Serif" w:eastAsia="Liberation Serif" w:cs="Liberation Serif"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="ru-RU" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>'
    + '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + [1, 2, 3, 4, 5, 6].map(heading).join('')
    + '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:spacing w:after="0"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="29"/><w:qFormat/><w:pPr><w:ind w:left="567" w:right="567"/></w:pPr><w:rPr><w:color w:val="404040"/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>'
    + '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>'
    + '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>'
    + '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
    + '</w:styles>';
}

function numberingXml(nums) {
  const level = (ordered, k) => `<w:lvl w:ilvl="${k}"><w:start w:val="1"/><w:numFmt w:val="${ordered ? 'decimal' : 'bullet'}"/>`
    + `<w:lvlText w:val="${ordered ? `%${k + 1}.` : ['•', '◦', '▪'][k % 3]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (k + 1)}" w:hanging="360"/></w:pPr></w:lvl>`;
  const abstract = (id, ordered) => `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${Array.from({ length: 9 }, (_, k) => level(ordered, k)).join('')}</w:abstractNum>`;
  // каждый список - свой w:num: нумерация каждого нумерованного списка начинается с 1
  const instances = nums.map((abs, k) => `<w:num w:numId="${k + 1}"><w:abstractNumId w:val="${abs}"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`);
  return `${HEAD}<w:numbering xmlns:w="${W}">${abstract(1, false)}${abstract(2, true)}${instances.join('')}</w:numbering>`;
}

export function writeDocx(blocks) {
  const ctx = { links: new Map(), nums: [] };
  let body = blocks.map((b) => blockXml(b, ctx)).join('');
  // Word ждёт абзац последним элементом перед sectPr
  if (!blocks.length || blocks[blocks.length - 1].type === 'table') body += '<w:p/>';
  const document = `${HEAD}<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}`
    + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>';
  const links = [...ctx.links].map(([href, id]) => `<Relationship Id="${id}" Type="${R}/hyperlink" Target="${escapeXml(xmlSafe(href))}" TargetMode="External"/>`);
  const files = {
    '[Content_Types].xml': `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
      + '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>',
    '_rels/.rels': `${HEAD}<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/document.xml': document,
    'word/styles.xml': stylesXml(),
    'word/numbering.xml': numberingXml(ctx.nums),
    'word/_rels/document.xml.rels': `${HEAD}<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${R}/styles" Target="styles.xml"/>`
      + `<Relationship Id="rId2" Type="${R}/numbering" Target="numbering.xml"/>${links.join('')}</Relationships>`,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])), { level: 6, mtime: new Date(Date.UTC(2000, 0, 1)) });
}
