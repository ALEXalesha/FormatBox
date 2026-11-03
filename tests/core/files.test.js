import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rng } from '../../web/core/rand.js';
import { saveBytes, saveResult } from '../../electron/backend/files.js';

test('закон: сохранение не перетирает ни один файл папки (зерно 41, 200 случаев)', () => {
  const r = rng(41);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-files-'));
  try {
    for (let n = 0; n < 200; n++) {
      const src = path.join(dir, r.pick(['a.png', 'b.mp4', 'Фото.JPG']));
      if (!fs.existsSync(src)) fs.writeFileSync(src, 'source');
      const before = new Map(fs.readdirSync(dir).map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
      const to = r.pick(['png', 'jpg', 'mp4', 'webp']);
      const res = r() < 0.5
        ? saveBytes(new TextEncoder().encode(`r${n}`), src, to, null, r() < 0.3 ? 'small' : '')
        : (() => { const tmp = path.join(dir, `.tmp${n}`); fs.writeFileSync(tmp, `r${n}`); const out = saveResult(tmp, src, to, dir); fs.unlinkSync(tmp); return out; })();
      assert.ok(!before.has(res.name), `${res.name} перетёрт`);
      for (const [f, text] of before) assert.equal(fs.readFileSync(path.join(dir, f), 'utf8'), text);
      assert.equal(fs.readFileSync(res.path, 'utf8'), `r${n}`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('результат с другого диска копируется (link не работает между устройствами)', { skip: fs.existsSync('/dev/shm') ? false : 'no /dev/shm' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-files-'));
  const tmp = path.join('/dev/shm', `fb-${process.pid}.bin`);
  try {
    fs.writeFileSync(tmp, 'x');
    const res = saveResult(tmp, path.join(dir, 'a.mp4'), 'webm', dir);
    assert.equal(res.name, 'a.webm');
    assert.equal(fs.readFileSync(res.path, 'utf8'), 'x');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(tmp, { force: true }); }
});

test('нет папки - честная ошибка', () => {
  assert.throws(() => saveBytes(new Uint8Array(1), '/nope/a.png', 'jpg', '/nope-dir'), /ENOENT/);
});

test('закон гонки: имя заняли между чтением папки и записью - берётся следующее, чужое цело', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-files-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.jpg'), 'чужой');
    fs.writeFileSync(path.join(dir, 'a (2).jpg'), 'чужой 2');
    let calls = 0;
    const stale = (d) => (calls++ === 0 ? [] : fs.readdirSync(d));
    const res = saveBytes(new Uint8Array([1]), path.join(dir, 'a.png'), 'jpg', null, '', stale);
    assert.equal(res.name, 'a (3).jpg');
    assert.equal(fs.readFileSync(path.join(dir, 'a.jpg'), 'utf8'), 'чужой');
    const tmp = path.join(dir, '.t'); fs.writeFileSync(tmp, 'z');
    let k = 0;
    const res2 = saveResult(tmp, path.join(dir, 'a.png'), 'jpg', dir, '', (d) => (k++ === 0 ? [] : fs.readdirSync(d)));
    assert.equal(res2.name, 'a (4).jpg');
    assert.throws(() => saveBytes(new Uint8Array(1), path.join(dir, 'a.png'), 'jpg', null, '', () => []), /no-free-name/);
    assert.throws(() => saveResult(path.join(dir, 'missing'), path.join(dir, 'a.png'), 'gif', dir), /ENOENT/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
