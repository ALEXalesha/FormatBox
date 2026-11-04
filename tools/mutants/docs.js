const LAWS = 'tests/core/docs-laws.test.js';
const CASES = 'tests/core/docs-cases.test.js';

export default [
  { name: 'docs: md does not escape *', file: 'web/core/docs/md.js', from: "const escapeText = (s) => s.replace(/[\\\\`*_[\\]<>&|]/g, '\\\\$&');", to: "const escapeText = (s) => s.replace(/[\\\\`_[\\]<>&|]/g, '\\\\$&');", test: LAWS },
  { name: 'docs: md nested blocks of list items not indented', file: 'web/core/docs/md.js', from: 'const body = indent(writeBlocks(item), marker.length);', to: 'const body = indent(writeBlocks(item), 0);', test: LAWS },
  { name: 'docs: md line starts like "1." or "#" not escaped', file: 'web/core/docs/md.js', from: ".replace(/^([#>+\\-=~])/, '\\\\$1')", to: '', test: LAWS },
  { name: 'docs: html does not escape <', file: 'web/core/docs/html.js', from: ".replace(/</g, '&lt;')", to: '', test: LAWS },
  { name: 'docs: html entities not decoded', file: 'web/core/docs/html.js', from: "out.push({ type: 'text', text: decodeEntities(s) });", to: "out.push({ type: 'text', text: s });", test: LAWS },
  { name: 'docs: html first newline of code eaten by <pre>', file: 'web/core/docs/html.js', from: '`<pre>\\n<code>${escapeHtml(b.text)}</code></pre>`', to: '`<pre><code>${escapeHtml(b.text)}</code></pre>`', test: LAWS },
  { name: 'docs: docx ordered lists written as bullets', file: 'web/core/docs/docx.js', from: "${ordered ? 'decimal' : 'bullet'}", to: 'bullet', test: LAWS },
  { name: 'docs: docx hyperlink targets lost', file: 'web/core/docs/docx.js', from: "const href = (ctx.rels[c.attrs['r:id']] ?? '') + anchor;", to: 'const href = anchor;', test: LAWS },
  { name: 'docs: odt repeated spaces written raw (collapse on read)', file: 'web/core/docs/odt.js', from: 'else s += `<text:s${n > 1 ? ` text:c="${n}"` : \'\'}/>`;', to: "else s += ' '.repeat(n);", test: LAWS },
  { name: 'docs: odt italic style ignored', file: 'web/core/docs/odt.js', from: "i: tp['fo:font-style'] ? tp['fo:font-style'] !== 'normal' : undefined,", to: 'i: undefined,', test: LAWS },
  { name: 'docs: txt drops tables', file: 'web/core/docs/txt.js', from: 'return table(b.rows);', to: "return '';", test: LAWS },
  { name: 'docs: pdf lines glued without space', file: 'web/core/docs/pdf.js', from: 'if (joins) last.inl[0].text += ` ${text}`;', to: 'if (joins) last.inl[0].text += text;', test: LAWS },
  { name: 'docs: pdf.js detaches the input buffer', file: 'web/core/docs/pdf.js', from: 'data: bytes.slice(),', to: 'data: bytes,', test: LAWS },
  { name: 'docs: docx field hyperlinks ignored', file: 'web/core/docs/docx.js', from: "if (type === 'separate') field.href = fieldHref(field.instr);", to: '', test: CASES },
  { name: 'docs: text in windows-1251 decoded as broken UTF-8', file: 'web/core/docs/model.js', from: "return new TextDecoder('windows-1251').decode(bytes);", to: 'return new TextDecoder().decode(bytes);', test: CASES },
];
