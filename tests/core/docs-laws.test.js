import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { rng } from '../../web/core/rand.js';
import { genDoc } from './docs-gen.js';
import { convertDoc, readDoc, writeDoc, docFormats, words } from '../../web/core/docs/index.js';
import { parseMd, writeMd } from '../../web/core/docs/md.js';
import * as pdfLib from '../../web/vendor/pdf-lib.js';
import fontkit from '../../web/vendor/fontkit.js';

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const fontBytes = new Uint8Array(fs.readFileSync(new URL('../../web/fonts/DejaVuSans.ttf', import.meta.url)));
const libs = { pdfLib, fontkit, fontBytes, pdfjs };

// каждое слово модели нашлось в тексте (с учётом повторов)
function assertHasWords(gotWords, doc, label) {
  const bag = new Map();
  for (const w of gotWords) bag.set(w, (bag.get(w) ?? 0) + 1);
  const missing = words(doc).filter((w) => {
    const c = bag.get(w);
    if (!c) return true;
    bag.set(w, c - 1);
    return false;
  });
  assert.deepEqual(missing, [], label);
}

test('закон: md -> модель -> md -> модель стабильно, и запись md точно обратима (зерно 101, 300 документов)', () => {
  const r = rng(101);
  for (let n = 0; n < 300; n++) {
    const doc = genDoc(r, { rich: n % 2 === 0 });
    const md = writeMd(doc);
    const m1 = parseMd(md);
    assert.deepEqual(m1, doc, `#${n}\n${md}`);
    const m2 = parseMd(writeMd(m1));
    assert.deepEqual(m2, m1, `#${n}: второй круг`);
  }
});

for (const [format, seed, rich] of [['html', 102, true], ['docx', 103, false], ['odt', 104, false]]) {
  test(`закон: модель -> ${format} -> модель сохраняет структуру и текст (зерно ${seed}, 200 документов)`, async () => {
    const r = rng(seed);
    for (let n = 0; n < 200; n++) {
      const doc = genDoc(r, { rich: rich && n % 2 === 0 });
      const bytes = await writeDoc(doc, format);
      assert.deepEqual(await readDoc(bytes, format), doc, `${format} #${n}`);
    }
  });
}

test('закон: модель -> txt сохраняет все слова (зерно 105, 200 документов)', async () => {
  const r = rng(105);
  for (let n = 0; n < 200; n++) {
    const doc = genDoc(r, { rich: n % 2 === 0 });
    const text = new TextDecoder().decode(await writeDoc(doc, 'txt'));
    assertHasWords(text.split(/\s+/), doc, `txt #${n}`);
    // и прочитанный обратно txt - тоже
    assertHasWords(words(await readDoc(new TextEncoder().encode(text), 'txt')), doc, `txt->модель #${n}`);
  }
});

test('закон: модель -> pdf -> текст через pdf.js содержит все слова (зерно 106, 14 документов)', async () => {
  const r = rng(106);
  for (let n = 0; n < 14; n++) {
    // первый документ длинный - несколько страниц
    const doc = genDoc(r, { maxBlocks: n === 0 ? 70 : 12 });
    const pdf = await writeDoc(doc, 'pdf', libs);
    assert.equal(new TextDecoder().decode(pdf.subarray(0, 5)), '%PDF-');
    assertHasWords(words(await readDoc(pdf, 'pdf', libs)), doc, `pdf #${n}`);
  }
});

test('закон: вход не меняется при любом преобразовании (зерно 107)', async () => {
  const r = rng(107);
  const doc = genDoc(r, { maxBlocks: 8 });
  for (const from of Object.keys(docFormats)) {
    const bytes = await writeDoc(doc, from, libs);
    const copy = bytes.slice();
    for (const to of docFormats[from]) {
      const out = await convertDoc(bytes, from, to, libs);
      assert.ok(out instanceof Uint8Array && out.length > 0, `${from} -> ${to}`);
      assert.deepEqual(bytes, copy, `${from} -> ${to}: вход изменился`);
    }
  }
  const before = JSON.stringify(doc);
  for (const to of Object.keys(docFormats)) await writeDoc(doc, to, libs);
  assert.equal(JSON.stringify(doc), before, 'модель не меняется при записи');
});
