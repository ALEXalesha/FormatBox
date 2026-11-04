import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, gzipSync } from '../../web/vendor/fflate.js';
import { detectArchive, extract, list, pack, repack, archiveFormats, safePath, normalizeEntries } from '../../web/core/archive/index.js';
import { writeTar, readTar, isTar } from '../../web/core/archive/tar.js';
import { writeZip, readZip, readGzip, peekGzip } from '../../web/core/archive/zip.js';
import { crc32, decodeName, toDate } from '../../web/core/archive/entries.js';

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);
const T = new Date(Date.UTC(2020, 4, 6, 7, 8, 10));

async function sevenZip(files, args) {
  const z = await (await import('../../web/vendor/7zz.js')).default({ print() {}, printErr() {} });
  z.FS.mkdir('/w');
  for (const [name, data] of Object.entries(files)) z.FS.writeFile(`/w/${name}`, data);
  z.FS.chdir('/w');
  assert.equal(z.callMain(args), 0);
  return z.FS.readFile(`/w/${args.find((a) => a.startsWith('out.'))}`);
}

// Настоящий RAR 4 с хранением без сжатия: сжимать в rar нечем, а распаковку проверить надо
function rar4(files) {
  const block = (type, flags, body) => {
    const h = new Uint8Array(7 + body.length);
    const v = new DataView(h.buffer);
    h[2] = type;
    v.setUint16(3, flags, true);
    v.setUint16(5, h.length, true);
    h.set(body, 7);
    v.setUint16(0, crc32(h.subarray(2)) & 0xffff, true);
    return h;
  };
  const parts = [Uint8Array.of(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00), block(0x73, 0, new Uint8Array(6))];
  for (const [name, data] of files) {
    const nb = enc(name);
    const body = new Uint8Array(25 + nb.length);
    const v = new DataView(body.buffer);
    v.setUint32(0, data.length, true);
    v.setUint32(4, data.length, true);
    v.setUint32(9, crc32(data), true);
    v.setUint32(13, (40 << 25) | (5 << 21) | (6 << 16), true);
    body[17] = 20;
    body[18] = 0x30;
    v.setUint16(19, nb.length, true);
    v.setUint32(21, 0x20, true);
    body.set(nb, 25);
    parts.push(block(0x74, 0x8000, body), data);
  }
  parts.push(Uint8Array.of(0xc4, 0x3d, 0x7b, 0x00, 0x40, 0x07, 0x00));
  return Uint8Array.from(parts.flatMap((p) => [...p]));
}

function tarHeader({ name = '', size = 0, type = '0', sizeField, magic = 'ustar\u000000' }) {
  const h = new Uint8Array(512);
  h.set(enc(name).subarray(0, 100), 0);
  h.set(enc('0000644\u0000'), 100);
  h.set(sizeField ?? enc(`${size.toString(8).padStart(11, '0')}\u0000`), 124);
  h.set(enc('00000000000\u0000'), 136);
  h.fill(0x20, 148, 156);
  h[156] = type.charCodeAt(0);
  h.set(enc(magic), 257);
  const sum = h.reduce((s, x) => s + x, 0);
  h.set(enc(`${sum.toString(8).padStart(6, '0')}\u0000 `), 148);
  return h;
}
const block = (data) => { const b = new Uint8Array(Math.ceil(data.length / 512) * 512); b.set(data); return b; };
const join = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]));

test('detectArchive: сигнатуры, расширение уточняет tar, мусор - null', async () => {
  const tar = await pack([{ path: 'a', data: enc('x'), mtime: T }], 'tar');
  assert.equal(detectArchive(await pack([], 'zip')), 'zip');
  assert.equal(detectArchive(tar), 'tar');
  assert.equal(detectArchive(gzipSync(tar), 'a.bin'), 'tar.gz');
  assert.equal(detectArchive(gzipSync(enc('hello world')), 'a.txt.gz'), 'gz');
  assert.equal(detectArchive(gzipSync(enc('hello world')), 'a.TGZ'), 'tar.gz');
  assert.equal(detectArchive(Uint8Array.of(0xfd, 0x37, 0x7a, 0x58, 0x5a, 0, 1), 'x.tar.xz'), 'tar.xz');
  assert.equal(detectArchive(Uint8Array.of(0xfd, 0x37, 0x7a, 0x58, 0x5a, 0, 1), 'x.xz'), 'xz');
  assert.equal(detectArchive(enc('BZh91AY'), 'x.tbz2'), 'tar.bz2');
  assert.equal(detectArchive(enc('BZh91AY'), 'x.bz2'), 'bz2');
  assert.equal(detectArchive(rar4([])), 'rar');
  assert.equal(detectArchive(await pack([], '7z')), '7z');
  assert.equal(detectArchive(enc('just text'), 'a.zip'), null);
  assert.equal(detectArchive(new Uint8Array(0)), null);
  assert.equal(detectArchive(new Uint8Array(1024).fill(1)), null);
  // битый gzip: заглянуть внутрь нельзя - это просто gz
  assert.equal(detectArchive(Uint8Array.of(31, 139, 8, 0, 0, 0, 0, 0, 0, 3, 255, 255, 255, 255, 0, 0, 0, 0)), 'gz');
  assert.equal(peekGzip(gzipSync(new Uint8Array(5000))).length, 1024);
  // старый tar без ustar: узнаём по контрольной сумме
  const v7 = join(tarHeader({ name: 'old.txt', size: 2, magic: '' }), block(enc('hi')), new Uint8Array(1024));
  assert.ok(isTar(v7));
  assert.equal(dec((await extract(v7, 'x'))[0].data), 'hi');
  assert.deepEqual(Object.keys(archiveFormats).filter((f) => archiveFormats[f].write), ['zip', 'tar', 'tar.gz', '7z']);
});

test('rar: распаковка через 7-Zip, упаковка честно отказывает', async () => {
  const bytes = rar4([['привет.txt', enc('Hi')], ['dir/b.bin', Uint8Array.of(1, 2, 3)]]);
  const out = await extract(bytes, 'архив.rar');
  assert.deepEqual(out.map((e) => e.path), ['dir', 'dir/b.bin', 'привет.txt']);
  assert.equal(dec(out[2].data), 'Hi');
  await assert.rejects(pack(out, 'rar'), /rar: packing is not possible/);
  await assert.rejects(repack(bytes, 'a.rar', 'rar'), /rar/);
  await assert.rejects(pack(out, 'gz'), /cannot pack gz/);
  await assert.rejects(pack(out, 'bogus'), /cannot pack bogus/);
});

test('xz, bz2, tar.xz, tar.bz2: распаковка через 7-Zip, имя внутри берётся из имени архива', async () => {
  const text = enc('данные '.repeat(100));
  const xz = await sevenZip({ 'report.csv': text }, ['a', '-txz', 'out.xz', 'report.csv']);
  const fromXz = await extract(xz, 'report.csv.xz');
  assert.equal(fromXz.length, 1);
  assert.equal(fromXz[0].path, 'report.csv');
  assert.deepEqual(fromXz[0].data, text);
  // без расширения в имени: 7-Zip всё равно назовёт файл по имени архива
  assert.equal((await extract(xz, 'noext'))[0].path, 'noext');
  const bz = await sevenZip({ 'a.txt': text }, ['a', '-tbzip2', 'out.bz2', 'a.txt']);
  assert.deepEqual((await extract(bz, 'a.txt.bz2'))[0].data, text);
  const tar = await pack([{ path: 'в/файл.txt', data: text, mtime: T }], 'tar');
  for (const [type, ext] of [['xz', 'tar.xz'], ['bzip2', 'tar.bz2']]) {
    const packed = await sevenZip({ 'a.tar': tar }, ['a', `-t${type}`, `out.${ext}`, 'a.tar']);
    assert.equal(detectArchive(packed, `x.${ext}`), ext);
    const out = await extract(packed, `x.${ext}`);
    assert.deepEqual(out.map((e) => e.path), ['в', 'в/файл.txt']);
    assert.deepEqual(out[1].data, text);
    assert.equal(out[1].mtime.getTime(), T.getTime());
  }
  // сжатый поток без файла внутри
  const emptyXz = await sevenZip({ 'e.tar': new Uint8Array(0) }, ['a', '-txz', 'out.tar.xz', 'e.tar']);
  assert.equal((await extract(emptyXz, 'e.tar.xz')).length, 0);
});

test('7z: ошибки 7-Zip понятны (битый архив, зашифрованный без пароля)', async () => {
  const broken = Uint8Array.of(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4, 1, 2, 3, 4);
  await assert.rejects(extract(broken, 'b.7z'), /^Error: 7z: /);
  const secret = await sevenZip({ 's.txt': enc('секрет') }, ['a', '-t7z', '-psecret', '-mhe=on', 'out.7z', 's.txt']);
  await assert.rejects(extract(secret, 's.7z'), /7z:/);
});

test('gz: один файл, имя из заголовка или из имени архива, время из заголовка', async () => {
  const data = enc('содержимое');
  const named = gzipSync(data, { filename: 'inner.txt', mtime: T });
  const out = await extract(named, 'whatever.gz');
  assert.deepEqual(out.map((e) => [e.path, dec(e.data), e.mtime.getTime()]), [['inner.txt', 'содержимое', T.getTime()]]);
  const anon = gzipSync(data, { mtime: 0 });
  assert.equal((await extract(anon, 'дорога/notes.txt.gz'))[0].path, 'notes.txt');
  assert.equal((await extract(anon, '.gz'))[0].path, 'file');
  // поле FEXTRA перед именем
  const withExtra = join(Uint8Array.of(31, 139, 8, 8 | 4, 0, 0, 0, 0, 0, 3, 2, 0, 9, 9), enc('x.txt\u0000'), named.subarray(10 + 10));
  assert.equal(readGzip(withExtra).name, 'x.txt');
});

test('zip: имена cp866 и UTF-8 без флага, поле Unicode Path, папки по атрибутам', async () => {
  const z = zipSync({ 'ab.txt': enc('1'), 'u.txt': [enc('2'), { extra: { 0x7075: join(Uint8Array.of(1, 0, 0, 0, 0), enc('юникод.txt')) } }] });
  // подменяем имя «ab» на байты cp866 «Пр» в локальном и центральном заголовке
  for (let i = 0; i < z.length - 1; i++) if (z[i] === 0x61 && z[i + 1] === 0x62 && z[i + 2] === 0x2e) { z[i] = 0x8f; z[i + 1] = 0xe0; }
  const out = await extract(z, 'a.zip');
  assert.deepEqual(out.map((e) => e.path), ['Пр.txt', 'юникод.txt']);
  assert.equal(decodeName(enc('файл'), false), 'файл');
  assert.equal(decodeName(Uint8Array.of(0x8f, 0xe0), false), 'Пр');
  const dirByAttr = zipSync({ 'folder': [new Uint8Array(0), { attrs: 0x10 }], 'unixdir': [new Uint8Array(0), { attrs: (0o40755 << 16) >>> 0 }] });
  assert.deepEqual((await extract(dirByAttr, 'd.zip')).map((e) => [e.path, e.dir]), [['folder', true], ['unixdir', true]]);
});

test('zip: одинаковые имена внутри одного архива не теряются', async () => {
  const z = zipSync({ 'a1.txt': enc('one'), 'a2.txt': enc('two'), 'A2.txt': enc('three') });
  // делаем все три имени одинаковыми - «a1.txt»
  for (let i = 0; i < z.length - 2; i++) if ((z[i] === 0x61 || z[i] === 0x41) && z[i + 1] === 0x32 && z[i + 2] === 0x2e) { z[i] = 0x61; z[i + 1] = 0x31; }
  const out = await extract(z, 'dups.zip');
  assert.deepEqual(out.map((e) => [e.path, dec(e.data)]), [['a1 (2).txt', 'two'], ['a1 (3).txt', 'three'], ['a1.txt', 'one']]);
});

test('zip: редкие методы и zip64 - через 7-Zip; битые архивы - ошибка', async () => {
  const text = enc('сжатие bzip2 '.repeat(50));
  const bz = await sevenZip({ 'b.txt': text }, ['a', '-tzip', '-mm=BZip2', 'out.zip', 'b.txt']);
  assert.deepEqual((await extract(bz, 'b.zip'))[0].data, text);
  const z64 = await pack([{ path: 'x.txt', data: text, mtime: T }], 'zip');
  // EOCD с признаком zip64 (смещение 0xffffffff) уходит в 7-Zip, а тот на подделку ругается
  const fake = z64.slice();
  fake.fill(0xff, fake.length - 6, fake.length - 2);
  await assert.rejects(extract(fake, 'f.zip'), /7z:/);
  const good = await pack([{ path: 'x.txt', data: text, mtime: T }], 'zip', { level: 9 });
  const badCrc = good.slice();
  badCrc[50] ^= 0xff; // внутри сжатых данных
  await assert.rejects(extract(badCrc, 'x.zip'), /zip: damaged entry/);
  const noEnd = good.slice(0, 40);
  await assert.rejects(extract(noEnd, 'x.zip'), /no central directory/);
  const badCd = good.slice();
  const cd = new DataView(badCd.buffer).getUint32(badCd.length - 6, true);
  badCd[cd] = 0;
  await assert.rejects(extract(badCd, 'x.zip'), /damaged central directory/);
  const badLocal = good.slice();
  badLocal[0] = 0x51;
  badLocal[0] = 0x50;
  badLocal[2] = 0x05; badLocal[3] = 0x06; // локальный заголовок испорчен, сигнатура zip ещё узнаётся
  await assert.rejects(extract(badLocal, 'x.zip'), /zip: damaged entry x.txt/);
});

test('tar: GNU длинные имена, pax, base-256, ссылки пропускаются, битая сумма - ошибка', async () => {
  const long = `${'каталог/'.repeat(20)}файл.txt`;
  const gnu = join(
    tarHeader({ name: '././@LongLink', size: enc(long).length + 1, type: 'L' }), block(enc(`${long}\u0000`)),
    tarHeader({ name: 'short', size: 3 }), block(enc('abc')),
    tarHeader({ name: 'link', type: '2' }),
    tarHeader({ name: 'glob', size: 10, type: 'g' }), block(enc('9 a=bcdef\n')),
    tarHeader({ name: 'big', type: '0', sizeField: Uint8Array.of(0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4) }), block(enc('wxyz')),
    tarHeader({ name: 'olddir/', type: '0' }),
    tarHeader({ name: 'nul', type: '\u0000', size: 1 }), block(enc('n')),
    new Uint8Array(1024),
  );
  const out = readTar(gnu);
  assert.deepEqual(out.map((e) => [e.path, e.dir, dec(e.data)]), [[long, false, 'abc'], ['big', false, 'wxyz'], ['olddir/', true, ''], ['nul', false, 'n']]);
  // pax: длинное ASCII-имя, которое нельзя разбить на prefix/name, и время до 1970
  const odd = `${'x'.repeat(130)}.txt`;
  const tar = writeTar([{ path: odd, data: enc('1'), mtime: new Date(-86400000), dir: false }]);
  assert.deepEqual(readTar(tar).map((e) => [e.path, e.mtime.getTime()]), [[odd, -86400000]]);
  const bad = tar.slice();
  bad[100] ^= 1;
  assert.throws(() => readTar(bad), /tar: damaged header/);
  // пустая pax-запись не ломает разбор
  const emptyPax = join(tarHeader({ name: 'p', type: 'x', size: 3 }), block(enc('0 \n')), tarHeader({ name: 'q', size: 0 }), new Uint8Array(1024));
  assert.deepEqual(readTar(emptyPax).map((e) => e.path), ['q']);
});

test('safePath и normalizeEntries: обезвреживание путей, родительские папки, дубли', () => {
  assert.equal(safePath('../../a/./b\\c'), 'a/b/c');
  assert.equal(safePath('C:\\Windows\\x'), 'Windows/x');
  assert.equal(safePath('/etc/\u0001passwd'), 'etc/passwd');
  assert.equal(safePath('a/C:/b'), 'a/C:/b');
  const t = (ms) => new Date(ms);
  const out = normalizeEntries([
    { path: 'a/b/c.txt', data: enc('1'), mtime: 5000 },
    { path: 'a/b/c.txt', data: enc('2'), mtime: 1000 },
    { path: 'a/x', data: enc('3'), mtime: 9000, dir: false },
    { path: 'a/x', mtime: 2000, dir: true },
    { path: 'a/x/', mtime: 3000, dir: true },
    { path: 'a/q/', mtime: 7000, dir: true },
    { path: '../', mtime: 0, dir: true },
    { path: 'noext', mtime: 0 },
    { path: 'noext', mtime: 0 },
    { path: '..', data: enc('4'), mtime: NaN },
  ]);
  assert.deepEqual(out.map((e) => [e.path, e.dir, e.mtime.getTime()]), [
    ['a', true, 9000], ['a/b', true, 5000], ['a/b/c (2).txt', false, 1000], ['a/b/c.txt', false, 5000],
    ['a/q', true, 7000], ['a/x', true, 2000], ['a/x (2)', false, 9000], ['file', false, 0], ['noext', false, 0], ['noext (2)', false, 0],
  ]);
  assert.equal(out.find((e) => e.path === 'noext').data.length, 0);
  assert.equal(toDate(t(5)).getTime(), 5);
});

test('list, progress и отмена', async () => {
  const entries = [{ path: 'd/a.txt', data: enc('abc'), mtime: T }];
  const bytes = await pack(entries, 'zip');
  assert.deepEqual(await list(bytes, 'a.zip'), [
    { path: 'd', size: 0, mtime: T, dir: true },
    { path: 'd/a.txt', size: 3, mtime: T, dir: false },
  ]);
  for (const format of ['zip', 'tar', 'tar.gz', '7z']) {
    const seen = [];
    const b = await pack(entries, format, { progress: (p) => seen.push(p) });
    assert.equal(seen.at(-1), 1, format);
    const seen2 = [];
    await extract(b, 'x', { progress: (p) => seen2.push(p) });
    assert.equal(seen2.at(-1), 1);
  }
  const stop = new AbortController();
  stop.abort();
  await assert.rejects(pack(entries, 'zip', { signal: stop.signal }), /canceled/);
  await assert.rejects(extract(bytes, 'a.zip', { signal: stop.signal }), /canceled/);
  await assert.rejects(extract(enc('???'), 'a.zip'), /unknown format/);
  // отмена посреди работы: сигнал срабатывает после первого шага
  for (const format of ['zip', 'tar', '7z']) {
    const mid = new AbortController();
    await assert.rejects(pack([...entries, { path: 'b', data: enc('x'), mtime: T }], format, { signal: mid.signal, progress: () => mid.abort() }), /canceled/, format);
  }
  const many = await pack([{ path: 'a', data: enc('1'), mtime: T }, { path: 'b', data: enc('2'), mtime: T }], 'tar');
  const counter = { n: 0, get aborted() { return ++this.n > 1; } };
  assert.throws(() => readTar(many, { signal: counter }), /canceled/);
  assert.throws(() => readZip(bytes, { signal: { n: 0, get aborted() { return ++this.n > 1; } } }), /canceled/);
  const z7 = await pack(entries, '7z');
  await assert.rejects(extract(z7, 'a.7z', { signal: { n: 0, get aborted() { return ++this.n > 2; } } }), /canceled/);
});

test('zip: время вне диапазона DOS, уровень 0 хранит без сжатия, writeZip пишет UTF-8 флаг', async () => {
  const old = writeZip(normalizeEntries([{ path: 'стар.txt', data: enc('x'), mtime: Date.UTC(1975, 0, 1) }]));
  assert.equal(old[7] & 0x08, 0x08, 'бит 11 - имя в UTF-8');
  assert.equal((await extract(old, 'o.zip'))[0].mtime.getTime(), Date.UTC(1975, 0, 1));
  const stored = await pack([{ path: 's.txt', data: enc('aaaaaaaaaaaaaaaa'), mtime: T }], 'zip', { level: 0 });
  assert.equal(stored[8], 0, 'метод 0 - хранение');
  assert.equal(dec((await extract(stored, 's.zip'))[0].data), 'aaaaaaaaaaaaaaaa');
});
