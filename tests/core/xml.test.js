import test from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../../web/core/rand.js';
import { parseXml, escapeXml, unescapeXml, findAll, findFirst, textOf } from '../../web/core/xml.js';

test('закон: текст и атрибуты переживают escape -> разбор (зерно 3, 500 случаев)', () => {
  const r = rng(3);
  const alphabet = ['a', 'Я', '<', '>', '&', '"', "'", ' ', '\n', '😀', '&amp;', ']]'];
  for (let n = 0; n < 500; n++) {
    const text = Array.from({ length: r.int(1, 12) }, () => r.pick(alphabet)).join('');
    const attr = Array.from({ length: r.int(0, 6) }, () => r.pick(alphabet)).join('');
    const doc = parseXml(`<?xml version="1.0"?><w:doc><w:p w:val="${escapeXml(attr)}">${escapeXml(text)}</w:p></w:doc>`);
    const p = findFirst(doc, 'p');
    assert.equal(p.attrs['w:val'], attr);
    assert.equal(textOf(p), text);
  }
});

test('разбор: CDATA, комментарии, одиночные теги, числовые сущности, кривой конец', () => {
  const doc = parseXml("<!DOCTYPE x><a k='1'><!-- c --><b/><b x=\"2\">&#1071;&#x44f;&bogus;&#0;</b><![CDATA[<raw>]]></a><c>tail");
  const a = findFirst(doc, 'a');
  assert.equal(a.attrs.k, '1');
  assert.equal(findAll(doc, 'b').length, 2);
  assert.equal(textOf(findAll(doc, 'b')[1]), 'Яя&bogus;&#0;');
  assert.equal(a.children.at(-1), '<raw>');
  assert.equal(textOf(findFirst(doc, 'c')), 'tail');
  assert.equal(findFirst(doc, 'zzz'), null);
  assert.equal(unescapeXml('&lt;&gt;'), '<>');
  assert.equal(parseXml('<a><![CDATA[x').children[0].children[0], 'x');
  assert.equal(parseXml('<a').children.length, 0);
  assert.equal(parseXml('<a></b></a>x').children.length, 2);
  assert.equal(parseXml('<!-- open').children.length, 0);
});
