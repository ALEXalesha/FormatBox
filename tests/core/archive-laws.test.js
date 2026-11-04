import test from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../../web/core/rand.js';
import { pack, extract, repack, detectArchive } from '../../web/core/archive/index.js';
import { writeTar } from '../../web/core/archive/tar.js';
import { writeZip } from '../../web/core/archive/zip.js';

const WORDS = ['отчёт', 'фото', 'Data', 'папка с пробелом', 'x y', 'Ёлка', 'notes', 'файл', 'ünï', '1', 'z_z', 'длинное имя '.repeat(9).trim(), 'long_ascii_folder_name_'.repeat(2)];
const EXT = ['', '.txt', '.bin', '.jpg', '.tar', '.дат'];

// Случайное дерево файлов: все папки перечислены явно (как в настоящей папке на диске)
function randomTree(r, { maxFiles = 12, bigChance = 0.1, minYear = 1990, maxYear = 2030 } = {}) {
  const span = Date.UTC(maxYear, 0, 1) - Date.UTC(minYear, 0, 1);
  const time = () => Date.UTC(minYear, 0, 1) + Math.floor(r() * span);
  const dirs = new Map();
  const files = new Map();
  const n = r.int(0, maxFiles);
  for (let k = 0; k < n; k++) {
    const depth = r.int(0, 3);
    const parts = Array.from({ length: depth }, () => r.pick(WORDS));
    const prefixes = parts.map((_, d) => parts.slice(0, d + 1).join('/'));
    if (prefixes.some((p) => files.has(p))) continue;
    for (const p of prefixes) if (!dirs.has(p)) dirs.set(p, time());
    const dirPath = parts.join('/');
    if (r() < 0.15) continue; // только папки, возможно пустые
    const path = [...parts, `${r.pick(WORDS)}${r.pick(EXT)}`].join('/');
    if (dirs.has(path) || files.has(path)) continue;
    const kind = r();
    const size = kind < 0.2 ? 0 : kind < 1 - bigChance ? r.int(1, 300) : r.int(20000, 120000);
    const data = r() < 0.5 ? r.bytes(size) : new TextEncoder().encode('строка текста\n'.repeat(size)).subarray(0, size);
    files.set(path, { data, mtime: time() });
  }
  return [
    ...[...dirs].map(([path, mtime]) => ({ path, data: new Uint8Array(0), mtime, dir: true })),
    ...[...files].map(([path, f]) => ({ path, data: f.data, mtime: f.mtime, dir: false })),
  ];
}

const byPath = (list) => [...list].sort((a, b) => (a.path < b.path ? -1 : 1));

// tol - допуск по времени в мс (точность формата)
function assertSame(got, want, tol, label) {
  const g = byPath(got);
  const w = byPath(want);
  assert.deepEqual(g.map((e) => `${e.dir ? 'D' : 'F'} ${e.path}`), w.map((e) => `${e.dir ? 'D' : 'F'} ${e.path}`), label);
  for (let i = 0; i < g.length; i++) {
    assert.ok(Buffer.from(g[i].data).equals(Buffer.from(w[i].data)), `${label}: ${w[i].path} data`);
    const dt = g[i].mtime.getTime() - new Date(w[i].mtime).getTime();
    assert.ok(Math.abs(dt) < tol, `${label}: ${w[i].path} mtime off by ${dt} ms`);
  }
}

const snapshot = (entries) => entries.map((e) => ({ ...e, data: Uint8Array.from(e.data), mtime: new Date(e.mtime).getTime() }));
const TOL = { zip: 2000, tar: 1000, 'tar.gz': 1000, '7z': 1000 };

for (const [format, seed, cases] of [['zip', 11, 30], ['tar', 12, 30], ['tar.gz', 13, 30], ['7z', 14, 20]]) {
  test(`закон: ${format} туда-обратно байт в байт - содержимое, имена, папки, время (зерно ${seed}, ${cases} наборов)`, async () => {
    const r = rng(seed);
    for (let n = 0; n < cases; n++) {
      const tree = randomTree(r);
      const before = snapshot(tree);
      const bytes = await pack(tree, format, { level: r.int(0, 9) });
      assert.deepEqual(snapshot(tree), before, 'вход pack не меняется');
      assert.equal(detectArchive(bytes, 'archive'), format);
      const copy = bytes.slice();
      const back = await extract(bytes, 'archive');
      assert.deepEqual(bytes, copy, 'архив после распаковки прежний');
      assertSame(back, tree, TOL[format], `${format} #${n}`);
      // изменение результата не трогает исходный архив
      for (const e of back) e.data.fill(0xaa);
      assert.deepEqual(bytes, copy, 'результат не делит память со входом');
    }
  });
}

test('закон: перепаковка zip -> 7z -> tar -> zip сохраняет всё (зерно 21, 12 наборов)', async () => {
  const r = rng(21);
  for (let n = 0; n < 12; n++) {
    const tree = randomTree(r);
    let bytes = await pack(tree, 'zip');
    for (const [from, to] of [['zip', '7z'], ['7z', 'tar'], ['tar', 'zip']]) {
      const before = bytes.slice();
      const next = await repack(bytes, `a.${from}`, to);
      assert.deepEqual(bytes, before, 'вход repack не меняется');
      assert.equal(detectArchive(next, 'x'), to);
      bytes = next;
    }
    assertSame(await extract(bytes, 'a.zip'), tree, 2000, `цепочка #${n}`);
  }
});

test('закон: время в tar и zip сохраняется с точностью формата и для дат до 1980 и после 2038 (зерно 31)', async () => {
  const r = rng(31);
  for (let n = 0; n < 40; n++) {
    const year = r.pick([1950, 1970, 1979, 1985, 2000, 2037, 2050, 2099]);
    const mtime = Date.UTC(year, r.int(0, 11), r.int(1, 28), r.int(0, 23), r.int(0, 59), r.int(0, 59)) + r.int(0, 999);
    const tree = [{ path: 'a.txt', data: r.bytes(5), mtime, dir: false }, { path: 'd', data: new Uint8Array(0), mtime, dir: true }];
    const tar = await extract(await pack(tree, 'tar'), 'x');
    for (const e of tar) assert.equal(e.mtime.getTime(), Math.floor(mtime / 1000) * 1000, `tar ${year}`);
    // zip хранит время в int32 секунд (поле UT): до 2038 - точно, дальше - как сможет DOS-поле
    if (year < 2038) {
      const zip = await extract(await pack(tree, 'zip'), 'x');
      for (const e of zip) assert.ok(Math.abs(e.mtime.getTime() - mtime) < 2000, `zip ${year}: ${e.mtime.toISOString()}`);
    }
  }
});

const EVIL = ['../evil.txt', '../../etc/passwd', '/abs/path.txt', 'C:\\Windows\\win.ini', 'c:/x.txt', 'a\\..\\..\\b.txt', './././c.txt', 'ok/../../d.txt', '..', 'dup.txt', 'DUP.txt', 'dup.txt', 'папка/../файл.txt'];

test('закон: распаковка не выходит за папку назначения и не теряет файлы-дубли (зерно 41)', async () => {
  const r = rng(41);
  for (let n = 0; n < 40; n++) {
    let raw = Array.from({ length: r.int(1, 8) }, () => ({ path: r.pick(EVIL), data: r.bytes(r.int(0, 20)), mtime: new Date(1e12), dir: false }));
    // пишем «как есть», в обход защиты pack - как злой архив из чужих рук
    // (в zip через fflate одинаковые имена невозможны - дубли там проверяет отдельный пример)
    const asZip = r() < 0.5;
    if (asZip) raw = raw.filter((e, i) => raw.findIndex((x) => x.path === e.path) === i);
    const bytes = asZip ? writeZip(raw) : writeTar(raw);
    const out = await extract(bytes, 'evil');
    const files = out.filter((e) => !e.dir);
    assert.equal(files.length, raw.length, 'ни один файл не потерян');
    const paths = out.map((e) => e.path);
    assert.equal(new Set(paths).size, paths.length, 'все пути разные');
    for (const p of paths) {
      assert.ok(p.length > 0 && !p.startsWith('/') && !p.includes('\\') && !/^[a-z]:/i.test(p), p);
      assert.ok(!p.split('/').some((s) => s === '..' || s === '.' || s === ''), p);
    }
    // содержимое каждого исходного файла нашлось
    const left = files.map((e) => Buffer.from(e.data).toString('hex')).sort();
    assert.deepEqual(left, raw.map((e) => Buffer.from(e.data).toString('hex')).sort());
  }
});
