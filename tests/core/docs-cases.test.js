import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { zipSync, strToU8, unzipSync, strFromU8 } from '../../web/vendor/fflate.js';
import { convertDoc, readDoc, docFormats } from '../../web/core/docs/index.js';
import { parseMd, writeMd, parseInline, writeInline } from '../../web/core/docs/md.js';
import { parseHtml, writeHtml, tokenize } from '../../web/core/docs/html.js';
import { parseTxt, writeTxt } from '../../web/core/docs/txt.js';
import { readDocx, writeDocx } from '../../web/core/docs/docx.js';
import { readOdt, writeOdt } from '../../web/core/docs/odt.js';
import { readPdf, writePdf } from '../../web/core/docs/pdf.js';
import { normInl, collapseRuns, decodeText, decodeEntities, normBlocks, blockTexts } from '../../web/core/docs/model.js';
import * as pdfLib from '../../web/vendor/pdf-lib.js';
import fontkit from '../../web/vendor/fontkit.js';

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const fontBytes = new Uint8Array(fs.readFileSync(new URL('../../web/fonts/DejaVuSans.ttf', import.meta.url)));
const libs = { pdfLib, fontkit, fontBytes, pdfjs };
const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);
const p = (...inl) => ({ type: 'p', inl: inl.map((x) => (typeof x === 'string' ? { text: x } : x)) });

const SAMPLE = [
  { type: 'h', level: 1, inl: [{ text: 'Отчёт о работе' }] },
  p('Обычный ', { text: 'жирный', b: true }, ' и ', { text: 'курсив', i: true }, ', ', { text: 'код', code: true }, ' и ', { text: 'ссылка', href: 'https://example.com/' }, '.'),
  { type: 'list', ordered: true, items: [[p('первый')], [p('второй'), { type: 'list', ordered: false, items: [[p('вложенный')]] }]] },
  { type: 'code', text: 'const a = 1;\n  return a;' },
  { type: 'quote', blocks: [p('цитата')] },
  { type: 'table', rows: [[[{ text: 'Имя' }], [{ text: 'Число' }]], [[{ text: 'Ёж' }], [{ text: '42' }]]] },
  { type: 'hr' },
  p('Конец'),
];

test('md: разбор того, что пишут люди', () => {
  const md = [
    'Заголовок', '=====', '', 'Подзаголовок', '---', '',
    '# Закрытый # ##', '', '#без пробела', '',
    'строка один  ', 'строка два\\', 'три', 'ленивая', '',
    '* звёздочки', '+ плюс', '', '1) скобка', '2) вторая', '',
    '- пункт', 'ленивое продолжение', '', '  еще абзац пункта', '- ', '-\tтаб', '',
    '~~~ js', 'код ~~~ внутри', '~~~', '',
    '> цитата', 'не цитата', '',
    '* * *', '___', '',
    'a | b', ':-- | --:', 'c', '',
    'текст <https://example.com/x> и ![картинка **жирная**](img.png) и [ссылка](url "заголовок") [не ссылка] [x](<a b>) [y]( <bad',
    '',
    'сущности &amp; &lt; &#1071; &#x44F; &copy; &bogus; &#0; \\q',
    '',
    '**незакрыто *тоже __и_это snake_case_name **** x ** y',
    '',
    '`` код с ` тиком `` и `незакрытый и ``` длинный',
    '',
    '```', 'незакрытый блок кода',
  ].join('\n');
  const doc = parseMd(md);
  assert.deepEqual(doc.slice(0, 4), [
    { type: 'h', level: 1, inl: [{ text: 'Заголовок' }] },
    { type: 'h', level: 2, inl: [{ text: 'Подзаголовок' }] },
    { type: 'h', level: 1, inl: [{ text: 'Закрытый #' }] },
    p('#без пробела'),
  ]);
  assert.deepEqual(doc[4], p('строка один\nстрока два\nтри ленивая'));
  assert.deepEqual(doc[5], { type: 'list', ordered: false, items: [[p('звёздочки')]] });
  assert.deepEqual(doc[6], { type: 'list', ordered: false, items: [[p('плюс')]] });
  assert.deepEqual(doc[7], { type: 'list', ordered: true, items: [[p('скобка')], [p('вторая')]] });
  assert.deepEqual(doc[8], { type: 'list', ordered: false, items: [[p('пункт ленивое продолжение'), p('еще абзац пункта')], [], [p('таб')]] });
  assert.deepEqual(doc[9], { type: 'code', text: 'код ~~~ внутри' });
  assert.deepEqual(doc[10], { type: 'quote', blocks: [p('цитата')] });
  assert.deepEqual(doc[11], p('не цитата'));
  assert.deepEqual(doc.slice(12, 14), [{ type: 'hr' }, { type: 'hr' }]);
  assert.deepEqual(doc[14], { type: 'table', rows: [[[{ text: 'a' }], [{ text: 'b' }]], [[{ text: 'c' }]]] });
  assert.deepEqual(doc[15].inl, [
    { text: 'текст ' }, { text: 'https://example.com/x', href: 'https://example.com/x' }, { text: ' и картинка ' }, { text: 'жирная', b: true },
    { text: ' и ' }, { text: 'ссылка', href: 'url' }, { text: ' [не ссылка] ' }, { text: 'x', href: 'a b' }, { text: ' [y]( <bad' },
  ]);
  assert.deepEqual(doc[16], p('сущности & < Я я © &bogus; \ufffd \\q'));
  assert.deepEqual(doc[17], p('**незакрыто *тоже __и_это snake_case_name **** x ** y'));
  assert.deepEqual(doc[18].inl, [{ text: 'код с ` тиком', code: true }, { text: ' и `незакрытый и ``` длинный' }]);
  assert.deepEqual(doc[19], { type: 'code', text: 'незакрытый блок кода' });
  assert.equal(doc.length, 20);
});

test('md: строчные мелочи - ***оба***, _подчёркивание_, перенос в коде, ссылка с жирным снаружи', () => {
  assert.deepEqual(parseInline('***оба*** _к_ __ж__ `a\nb` **[ж](u)** [a](u)(b) [t](u \'q\') [t](u "q)'), [
    { text: 'оба', b: true, i: true }, { text: ' ' }, { text: 'к', i: true }, { text: ' ' }, { text: 'ж', b: true }, { text: ' ' },
    { text: 'a b', code: true }, { text: ' ' }, { text: 'ж', b: true, href: 'u' }, { text: ' ' }, { text: 'a', href: 'u' }, { text: '(b) ' },
    { text: 't', href: 'u' }, { text: ' [t](u "q)' },
  ]);
  assert.deepEqual(parseInline('[a](u\\)v) [b](<x\ny>)'), [{ text: 'a', href: 'u)v' }, { text: ' [b](<x y>)' }]);
  assert.deepEqual(parseInline('[a `]` b](u)'), [{ text: 'a ', href: 'u' }, { text: ']', code: true, href: 'u' }, { text: ' b', href: 'u' }]);
  // запись: пробелы по краям жирного уходят наружу, пустая ссылка и спецсимволы в адресе - в <>
  assert.equal(writeInline([{ text: ' жирный ', b: true }]), ' **жирный** ');
  assert.equal(writeInline([{ text: 'a', href: '' }, { text: 'b', href: 'x y' }]), 'a[b](<x y>)');
  assert.equal(writeInline([{ text: '`', code: true }, { text: ' x ', code: true, b: true }]), '`` ` ``**`  x  `**');
  assert.deepEqual(parseInline('`` ` ``**`  x  `**'), [{ text: '`', code: true }, { text: ' x ', code: true, b: true }]);
  assert.equal(writeMd([{ type: 'h', level: 2, inl: [{ text: 'C #' }] }, { type: 'h', level: 1, inl: [{ text: 'a\nb' }] }]), '## C \\#\n\n# a b\n');
  assert.equal(writeMd([{ type: 'code', text: '```\nx' }, { type: 'code', text: '' }]), '````\n```\nx\n````\n\n```\n```\n');
  assert.equal(writeMd([{ type: 'table', rows: [[[{ text: 'a|b' }], [{ text: 'c|d', code: true }]], [[{ text: 'x\ny' }]]] }]), '| a\\|b | `c\\|d` |\n| --- | --- |\n| x y |  |\n');
  assert.deepEqual(parseMd('| a\\|b | `c\\|d` |\n| --- | --- |\n| x y |  |\n'), [{ type: 'table', rows: [[[{ text: 'a|b' }], [{ text: 'c|d', code: true }]], [[{ text: 'x y' }], []]] }]);
});

test('html: токенайзер и неявные закрытия как в браузере', () => {
  const html = `<!DOCTYPE html><html><head><title>Т &amp; т</title><style>p{color:red}</style><script>if (a < b) x()</script></head>
  <body>Текст сверху<!-- комментарий --><p>Абзац<p>Второй <B>жирный <I>оба</I></B> <a href=u1>ссылка</a> <a name=x>якорь</a><br/>новая строка
  <div><h3 class='x'>Заголовок</h3><span>в div</span></div>
  <ul><li>один<li>два<ul><li>вложенный</ul></li><ol><li>сразу в ul</ol></ul>
  <ol><ul><li>без li</li></ul></ol>
  <table><thead><tr><th>A<th>B</thead><tbody><tr><td><p>один</p><p>два</p><td><table><tr><td>внутр</td></tr></table>x</tr></tbody></table>
  <pre>\n  код\n<br>строка</pre><blockquote>цитата <em>курсив</em><p>абзац</p></blockquote><hr>
  <img src=a.png alt="подпись"> < 5 &unknown; <tt>tt</tt> <kbd>k</kbd> <p></p></p><button>кнопка</button>
  <x-y data-a="1" disabled>свой тег</x-y> <a href="h" title=t/>а</a> <p attr="бро`;
  const doc = parseHtml(html);
  assert.deepEqual(doc[0], p('Текст сверху'));
  assert.deepEqual(doc[1], p('Абзац'));
  assert.deepEqual(doc[2].inl, [{ text: 'Второй ' }, { text: 'жирный ', b: true }, { text: 'оба', b: true, i: true }, { text: ' ' }, { text: 'ссылка', href: 'u1' }, { text: ' якорь\nновая строка' }]);
  assert.deepEqual(doc[3], { type: 'h', level: 3, inl: [{ text: 'Заголовок' }] });
  assert.deepEqual(doc[4], p('в div'));
  assert.deepEqual(doc[5], { type: 'list', ordered: false, items: [[p('один')], [p('два'), { type: 'list', ordered: false, items: [[p('вложенный')]] }, { type: 'list', ordered: true, items: [[p('сразу в ul')]] }]] });
  assert.deepEqual(doc[6], { type: 'list', ordered: true, items: [[{ type: 'list', ordered: false, items: [[p('без li')]] }]] });
  assert.deepEqual(doc[7], { type: 'table', rows: [[[{ text: 'A' }], [{ text: 'B' }]], [[{ text: 'один два' }], [{ text: 'внутр x' }]]] });
  assert.deepEqual(doc[8], { type: 'code', text: '  код\n\nстрока' });
  assert.deepEqual(doc[9], { type: 'quote', blocks: [p('цитата ', { text: 'курсив', i: true }), p('абзац')] });
  assert.deepEqual(doc[10], { type: 'hr' });
  assert.deepEqual(doc[11].inl, [{ text: 'подпись < 5 &unknown; ' }, { text: 'tt', code: true }, { text: ' ' }, { text: 'k', code: true }]);
  assert.deepEqual(doc[12], p('свой тег ', { text: 'а', href: 'h' }));
  assert.equal(doc.length, 13);
  assert.deepEqual(tokenize('<a b="1" c=\'2\' d=3 e>x</a>')[0].attrs, { b: '1', c: '2', d: '3', e: '' });
  assert.deepEqual(tokenize('<? php ?><!x>t<'), [{ type: 'text', text: 't' }, { type: 'text', text: '<' }]);
  assert.deepEqual(parseHtml('<p>a</br>b<script>x'), [p('a\nb')]);
  assert.match(writeHtml([]), /<title>Document<\/title>/);
  assert.match(writeHtml(SAMPLE), /<meta charset="utf-8">[\s\S]*<title>Отчёт о работе<\/title>/);
  assert.equal(parseHtml(writeHtml([{ type: 'list', ordered: false, items: [[], [{ type: 'code', text: 'x' }, p('y')]] }])).length, 1);
});

test('txt: запись читаема, чтение - абзацы по пустым строкам', () => {
  const text = writeTxt(SAMPLE);
  assert.match(text, /^Отчёт о работе\n=+\n/);
  assert.match(text, /1\. первый\n2\. второй\n {3}• вложенный/);
  assert.match(text, /\n {4}const a = 1;\n {6}return a;\n/);
  assert.match(text, /> цитата/);
  assert.match(text, /Имя \| Число\n-+-\+-+\nЁж {2}\| 42/);
  assert.match(text, /\* \* \*/);
  assert.match(writeTxt([{ type: 'h', level: 2, inl: [{ text: 'Ab' }] }, { type: 'h', level: 4, inl: [{ text: 'H4' }] }, { type: 'table', rows: [[[]], [[{ text: 'a' }], [{ text: 'b' }]]] }]), /^Ab\n---\n\nH4\n\n {2}\|\n-+\+-+\na \| b\n$/);
  assert.deepEqual(parseTxt('\r\n\r\nпервый абзац  \nвторая строка\n\n \n\nвторой\r\n'), [p('первый абзац\nвторая строка'), p('второй')]);
});

test('model: схлопывание пробелов, сущности, кодировки текста', () => {
  assert.deepEqual(collapseRuns([{ text: '  a  ' }, { text: ' b', b: true }, { text: '\n', literal: true }, { text: '  c ' }, { text: '\n', literal: true }]), [{ text: 'a ' }, { text: 'b', b: true }, { text: '\nc' }]);
  assert.deepEqual(collapseRuns([{ text: 'x' }, { text: '  ', literal: true }, { text: '\n', literal: true }]), [{ text: 'x  ' }]);
  assert.deepEqual(collapseRuns([{ text: '   ' }]), []);
  assert.equal(decodeEntities('&lt;&#X41;&#99999999;&nbsp;'), '<A&#99999999;\u00a0');
  assert.equal(decodeText(Uint8Array.of(0xef, 0xbb, 0xbf, 0x41)), 'A');
  assert.equal(decodeText(Uint8Array.of(0xff, 0xfe, 0x1f, 0x04)), 'П');
  assert.equal(decodeText(Uint8Array.of(0xfe, 0xff, 0x04, 0x1f)), 'П');
  assert.equal(decodeText(Uint8Array.of(0xcf, 0xf0, 0xe8)), 'При'); // windows-1251
  assert.deepEqual(normInl([{ text: '' }, { text: 'a', b: false, href: '' }, { text: 'b' }]), [{ text: 'ab' }]);
  assert.deepEqual(normBlocks([{ type: 'h', level: 9, inl: [{ text: 'x' }] }, { type: 'list', items: [] }, { type: 'table', rows: [] }, { type: 'zzz' }, p('')]), [{ type: 'h', level: 6, inl: [{ text: 'x' }] }]);
  assert.deepEqual(blockTexts([{ type: 'quote', blocks: [p('q')] }, { type: 'hr' }]), ['q']);
});

// docx «как из Word»: свои стили по имени, rStyle, поля, sdt, переопределения нумерации
function wordDocx(body, { styles = '', numbering = '', rels = '' } = {}) {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const files = {
    'word/document.xml': `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
    'word/styles.xml': `<w:styles ${W}>${styles}</w:styles>`,
    'word/numbering.xml': `<w:numbering ${W}>${numbering}</w:numbering>`,
    'word/_rels/document.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
}

test('docx: чтение настоящих приёмов Word и LibreOffice', () => {
  const styles = '<w:style w:styleId="1"><w:name w:val="heading 1"/></w:style><w:style w:styleId="a5"><w:name w:val="Title"/></w:style>'
    + '<w:style w:styleId="Out"><w:name w:val="Out"/><w:pPr><w:outlineLvl w:val="2"/></w:pPr></w:style>'
    + '<w:style w:styleId="Strong"><w:name w:val="Strong"/><w:rPr><w:b/></w:rPr></w:style><w:style w:styleId="MyStrong"><w:name w:val="x"/><w:basedOn w:val="Strong"/></w:style>'
    + '<w:style w:styleId="Em"><w:name w:val="Emphasis"/><w:rPr><w:i w:val="1"/></w:rPr></w:style>'
    + '<w:style w:styleId="VerbatimChar"><w:name w:val="Verbatim Char"/></w:style><w:style w:styleId="Mono"><w:name w:val="m"/><w:rPr><w:rFonts w:ascii="Consolas"/></w:rPr></w:style>'
    + '<w:style w:styleId="IntenseQuote"><w:name w:val="Intense Quote"/></w:style><w:style w:styleId="HL"><w:name w:val="Horizontal Line"/><w:pPr><w:pBdr><w:bottom w:val="single"/></w:pBdr></w:pPr></w:style>'
    + '<w:style w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:pPr><w:numPr><w:numId w:val="7"/></w:numPr></w:pPr></w:style>';
  const numbering = '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"/></w:abstractNum>'
    + '<w:num w:numId="7"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="8"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:lvl w:ilvl="0"><w:numFmt w:val="lowerLetter"/></w:lvl></w:lvlOverride></w:num>'
    + '<w:num w:numId="9"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:lvl w:ilvl="0"><w:numFmt w:val="none"/></w:lvl></w:lvlOverride></w:num>';
  const rels = '<Relationship Id="rId5" Target="https://example.com/"/>';
  const r = (t, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t>${t}</w:t></w:r>`;
  const para = (style, inner, pPr = '') => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${pPr}</w:pPr>${inner}</w:p>`;
  const body = [
    para('1', r('Глава')), para('a5', r('Название')), para('Out', r('Уровень три')),
    para('', r('ж', '<w:rStyle w:val="MyStrong"/>') + r('к', '<w:rStyle w:val="Em"/>') + r('не ж', '<w:b w:val="0"/>') + r('false', '<w:b w:val="false"/><w:i/>')),
    para('', r('v', '<w:rStyle w:val="VerbatimChar"/>') + r('m', '<w:rStyle w:val="Mono"/>') + '<w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:cr/><w:noBreakHyphen/><w:sym/></w:r>'),
    para('', `<w:hyperlink r:id="rId5" w:anchor="part">${r('с якорем')}</w:hyperlink> <w:hyperlink w:anchor="top">${r('вверх')}</w:hyperlink><w:ins>${r(' вставка')}</w:ins><w:del><w:r><w:delText>удалено</w:delText></w:r></w:del>`),
    para('', `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> HYPERLINK "https://example.org/" \\l "a%20b" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${r('поле')}<w:r><w:fldChar w:fldCharType="end"/></w:r>${r(' после')}`
      + `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${r('7')}<w:r><w:fldChar w:fldCharType="end"/></w:r>`),
    para('ListBullet', r('из стиля')), para('', r('буква'), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="8"/></w:numPr>'),
    para('', r('без номера'), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="9"/></w:numPr>'),
    para('', r('ноль'), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr>'),
    para('', r('глубже'), '<w:numPr><w:ilvl w:val="1"/><w:numId w:val="7"/></w:numPr>'),
    para('IntenseQuote', r('цитата')), para('HL', ''), para('Code', r('нет такого стиля')),
    `<w:sdt><w:sdtContent>${para('', r('в sdt'))}<w:tbl><w:tr><w:tc>${para('', r('a'))}${para('', r('b'))}</w:tc></w:tr></w:tbl></w:sdtContent></w:sdt>`,
    `<w:customXml>${para('', r('custom'))}</w:customXml><w:bookmarkStart/>`,
  ].join('');
  const doc = readDocx(wordDocx(body, { styles, numbering, rels }));
  assert.deepEqual(doc, [
    { type: 'h', level: 1, inl: [{ text: 'Глава' }] },
    { type: 'h', level: 1, inl: [{ text: 'Название' }] },
    { type: 'h', level: 3, inl: [{ text: 'Уровень три' }] },
    p({ text: 'ж', b: true }, { text: 'к', i: true }, 'не ж', { text: 'false', i: true }),
    p({ text: 'vm', code: true }, 'a\tb\n-'),
    p({ text: 'с якорем', href: 'https://example.com/#part' }, { text: 'вверх', href: '#top' }, ' вставка'),
    p({ text: 'поле', href: 'https://example.org/#a%20b' }, ' после7'),
    { type: 'list', ordered: false, items: [[p('из стиля')]] },
    { type: 'list', ordered: true, items: [[p('буква')]] },
    p('без номера'), p('ноль'),
    { type: 'list', ordered: true, items: [[p('глубже')]] },
    { type: 'quote', blocks: [p('цитата')] },
    { type: 'hr' },
    p('нет такого стиля'),
    p('в sdt'),
    { type: 'table', rows: [[[{ text: 'a b' }]]] },
    p('custom'),
  ]);
  assert.deepEqual(readDocx(zipSync({ 'word/document.xml': strToU8('<w:document/>') })), []);
  assert.throws(() => readDocx(zipSync({ 'x.xml': strToU8('<a/>') })), /word\/document.xml not found/);
});

test('docx: запись - валидный пакет, понятный mammoth; пустой документ и таблица в конце', async () => {
  const bytes = writeDocx(SAMPLE);
  const files = unzipSync(bytes);
  assert.deepEqual(Object.keys(files).sort(), ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/numbering.xml', 'word/styles.xml']);
  assert.match(strFromU8(files['word/styles.xml']), /w:styleId="Heading6"/);
  const mammoth = (await import('mammoth')).default;
  const { value } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  // mammoth понимает стили абзацев и списки; моноширинный шрифт кусков он не переносит
  const back = parseHtml(value);
  assert.deepEqual(back[0], SAMPLE[0]);
  assert.equal(back[1].inl.map((r) => r.text).join(''), 'Обычный жирный и курсив, код и ссылка.');
  assert.match(value, /<ol><li>первый<\/li><li>второй<ul><li>вложенный<\/li><\/ul><\/li><\/ol>/);
  assert.deepEqual(readDocx(writeDocx([])), []);
  const table = [{ type: 'table', rows: [[[{ text: 'x' }]]] }];
  assert.match(strFromU8(unzipSync(writeDocx(table))['word/document.xml']), /<\/w:tbl><w:p\/><w:sectPr>/);
  // пункт без абзаца и блоки внутри пункта
  const odd = [{ type: 'list', ordered: false, items: [[], [p('a'), { type: 'code', text: 'c' }, p('b')]] }, { type: 'quote', blocks: [p('q'), { type: 'code', text: 'k' }] }];
  assert.deepEqual(readDocx(writeDocx(odd)).map((b) => b.type), ['list', 'code', 'p', 'quote', 'code']);
});

function odtPackage(content, styles = '') {
  const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink"';
  const files = { mimetype: strToU8('application/vnd.oasis.opendocument.text'), 'content.xml': strToU8(`<office:document-content ${NS}>${content}</office:document-content>`) };
  if (styles) files['styles.xml'] = strToU8(`<office:document-styles ${NS}><office:styles>${styles}</office:styles></office:document-styles>`);
  return zipSync(files);
}

test('odt: чтение стилей LibreOffice - родители, вес шрифта числом, text:s, разделы, заголовки списка', () => {
  const auto = '<office:automatic-styles>'
    + '<style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="700"/></style:style>'
    + '<style:style style:name="T2" style:family="text" style:parent-style-name="Emph"/>'
    + '<style:style style:name="T3" style:family="text"><style:text-properties fo:font-weight="normal" fo:font-style="normal"/></style:style>'
    + '<style:style style:name="T4" style:family="text" style:parent-style-name="Source_20_Text"/>'
    + '<style:style style:name="P1" style:family="paragraph" style:parent-style-name="Quotations"/>'
    + '<style:style style:name="P2" style:family="paragraph"><style:text-properties style:font-name="DejaVu Sans Mono"/></style:style>'
    + '<text:list-style style:name="L1"><text:list-level-style-number text:level="1"/><text:list-level-style-bullet text:level="2"/></text:list-style>'
    + '</office:automatic-styles>';
  const styles = '<style:style style:name="Emph" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>'
    + '<style:style style:name="Source_20_Text" style:display-name="Source Text" style:family="text"/>';
  const content = `${auto}<office:body><office:text><text:sequence-decls/>`
    + '<text:h>Без уровня</text:h>'
    + '<text:p>  много   пробелов <text:span text:style-name="T1">жир<text:span text:style-name="T3">не</text:span></text:span><text:s text:c="3"/>x<text:tab/>y<text:line-break/>  z<text:note><text:note-body><text:p>сноска</text:p></text:note-body></text:note></text:p>'
    + '<text:p><text:span text:style-name="T2">курсив</text:span> <text:span text:style-name="T4">код</text:span> <text:a xlink:href="u">ссылка</text:a><text:bookmark text:name="b"/><text:soft-page-break/></text:p>'
    + '<text:p text:style-name="P1">цитата</text:p><text:p text:style-name="P2">  моно  <text:s text:c="2"/>код</text:p><text:p text:style-name="P2">вторая</text:p>'
    + '<text:list text:style-name="L1"><text:list-header><text:p>заголовок списка</text:p></text:list-header><text:list-item><text:p>раз</text:p><text:list><text:list-item><text:p>вложенный</text:p></text:list-item></text:list></text:list-item></text:list>'
    + '<text:list><text:list-item><text:p>без стиля</text:p></text:list-item></text:list>'
    + '<text:section><text:p>в разделе</text:p></text:section>'
    + '<table:table><table:table-header-rows><table:table-row><table:table-cell><text:p>a</text:p><text:p>b</text:p></table:table-cell><table:covered-table-cell/></table:table-row></table:table-header-rows></table:table>'
    + '</office:text></office:body>';
  assert.deepEqual(readOdt(odtPackage(content, styles)), [
    { type: 'h', level: 1, inl: [{ text: 'Без уровня' }] },
    p('много пробелов ', { text: 'жир', b: true }, 'не   x\ty\nz'),
    p({ text: 'курсив', i: true }, ' ', { text: 'код', code: true }, ' ', { text: 'ссылка', href: 'u' }),
    { type: 'quote', blocks: [p('цитата')] },
    { type: 'code', text: 'моно   код\nвторая' },
    { type: 'list', ordered: true, items: [[p('заголовок списка')], [p('раз'), { type: 'list', ordered: false, items: [[p('вложенный')]] }]] },
    { type: 'list', ordered: false, items: [[p('без стиля')]] },
    p('в разделе'),
    { type: 'table', rows: [[[{ text: 'a b' }]]] },
  ]);
  assert.deepEqual(readOdt(odtPackage('<office:body/>')), []);
  assert.throws(() => readOdt(zipSync({ mimetype: strToU8('x') })), /content.xml not found/);
});

test('odt: mimetype первым и без сжатия, пробелы в начале и подряд - через text:s', () => {
  const bytes = writeOdt([p(' a  b '), { type: 'code', text: '\tx' }]);
  assert.equal(dec(bytes.subarray(30, 38)), 'mimetype');
  assert.equal(bytes[8], 0, 'метод 0 - без сжатия');
  assert.equal(dec(bytes.subarray(38, 38 + 39)), 'application/vnd.oasis.opendocument.text');
  const content = strFromU8(unzipSync(bytes)['content.xml']);
  assert.match(content, /<text:p text:style-name="Standard"><text:s\/>a<text:s text:c="2"\/>b<text:s\/><\/text:p>/);
  assert.deepEqual(readOdt(bytes), [p(' a  b '), { type: 'code', text: '\tx' }]);
});

test('pdf: страницы, длинные слова режутся, нет глифа - «?», чтение заголовков по размеру', async () => {
  const long = 'Ж'.repeat(150);
  const doc = [
    { type: 'h', level: 1, inl: [{ text: 'Большой' }] }, { type: 'h', level: 2, inl: [{ text: 'Средний' }] },
    p(`${long} хвост`), p('иероглиф 漢 и\tтаб и\nперенос', { text: ' ссылка', href: 'u' }),
    ...Array.from({ length: 70 }, (_, k) => p(`строка ${k}`)),
  ];
  const pdf = await writePdf(doc, libs, 'Свой заголовок');
  const loaded = await pdfLib.PDFDocument.load(pdf);
  assert.ok(loaded.getPageCount() >= 2);
  assert.equal(loaded.getTitle(), 'Свой заголовок');
  const back = await readPdf(pdf, pdfjs);
  assert.deepEqual(back.slice(0, 2), [{ type: 'h', level: 1, inl: [{ text: 'Большой' }] }, { type: 'h', level: 2, inl: [{ text: 'Средний' }] }]);
  const all = back.map((b) => b.inl[0].text).join(' ');
  assert.ok(all.replace(/ /g, '').includes(long), 'длинное слово целиком (по частям на строках)');
  assert.match(all, /иероглиф \? и таб и перенос ссылка/);
  assert.match(all, /строка 69/);
  // пустой документ - одна пустая страница
  assert.deepEqual(await readPdf(await writePdf([], libs), pdfjs), []);
});

test('convertDoc: форматы, псевдонимы, ошибки, нужные библиотеки', async () => {
  assert.deepEqual(docFormats.md, ['html', 'txt', 'docx', 'odt', 'pdf']);
  assert.equal(Object.keys(docFormats).length, 6);
  const md = enc(writeMd(SAMPLE));
  assert.deepEqual(await readDoc(md, '.Markdown'), SAMPLE);
  assert.deepEqual(await readDoc(await convertDoc(md, 'md', 'htm'), 'HTML'), SAMPLE);
  assert.deepEqual(await readDoc(await convertDoc(md, 'md', 'odt'), 'odt'), SAMPLE);
  assert.match(dec(await convertDoc(md, 'md', 'text')), /Отчёт о работе/);
  await assert.rejects(convertDoc(md, 'md', 'rtf'), /format rtf is not supported/);
  await assert.rejects(convertDoc(md, 'md', 'pdf'), /writing pdf needs/);
  await assert.rejects(readDoc(md, 'pdf'), /reading pdf needs/);
  const pdf = await convertDoc(md, 'md', 'pdf', libs);
  assert.match(dec(await convertDoc(pdf, 'pdf', 'txt', libs)), /Отчёт о работе[\s\S]*вложенный[\s\S]*Ёж/);
});

test('LibreOffice открывает созданные docx и odt (если soffice установлен)', { skip: spawnSync('soffice', ['--version']).status !== 0 && 'soffice нет' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-docs-'));
  fs.writeFileSync(path.join(dir, 'a.docx'), writeDocx(SAMPLE));
  fs.writeFileSync(path.join(dir, 'b.odt'), writeOdt(SAMPLE));
  const r = spawnSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', dir, path.join(dir, 'a.docx'), path.join(dir, 'b.odt')], { timeout: 120000 });
  assert.equal(r.status, 0);
  for (const name of ['a.pdf', 'b.pdf']) assert.ok(fs.statSync(path.join(dir, name)).size > 1000, name);
  fs.rmSync(dir, { recursive: true, force: true });
});
