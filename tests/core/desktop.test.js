import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rng } from '../../web/core/rand.js';
import { loadState, saveState, fitToDisplays, MIN, DEFAULT } from '../../electron/backend/window-state.js';
import { findOffice, findPandoc, officeRoute, convertOffice } from '../../electron/backend/office.js';

test('закон: окно после восстановления видно на экране и не меньше минимума (зерно 61, 3000 случаев)', () => {
  const r = rng(61);
  for (let n = 0; n < 3000; n++) {
    const displays = Array.from({ length: r.int(1, 3) }, (_, i) => ({ x: i * r.int(800, 3000) - (r() < 0.2 ? 1920 : 0), y: r.int(-500, 500) * (r() < 0.3 ? 1 : 0), width: r.int(800, 3840), height: r.int(600, 2160) }));
    const saved = { width: r.int(-100, 5000), height: r.int(-100, 3000), x: r() < 0.1 ? undefined : r.int(-8000, 8000), y: r.int(-4000, 4000), maximized: r() < 0.2 };
    const s = fitToDisplays(saved, displays);
    const visible = displays.some((d) => Math.min(s.x + s.width, d.x + d.width) - Math.max(s.x, d.x) >= 100 && Math.min(s.y + s.height, d.y + d.height) - Math.max(s.y, d.y) >= 60);
    assert.ok(visible, JSON.stringify({ saved, s, displays }));
    assert.ok(s.width >= Math.min(MIN.width, displays[0].width) && s.height >= Math.min(MIN.height, displays[0].height));
    assert.equal(s.maximized, saved.maximized);
  }
});

test('размер запоминается: сохранить и прочитать, битый файл - по умолчанию', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-win-'));
  try {
    const file = path.join(dir, 'window.json');
    assert.deepEqual(loadState(file), { ...DEFAULT, maximized: false });
    saveState(file, { width: 900.4, height: 700, x: 10, y: 20, maximized: true, junk: 1 });
    assert.deepEqual(loadState(file), { width: 900, height: 700, x: 10, y: 20, maximized: true });
    fs.writeFileSync(file, '{"width":"wide"}');
    assert.deepEqual(loadState(file), { width: undefined, height: undefined, x: undefined, y: undefined, maximized: false });
    const fitted = fitToDisplays(loadState(file), [{ x: 0, y: 0, width: 1920, height: 1080 }]);
    assert.equal(fitted.width, DEFAULT.width);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('маршрут документа: LibreOffice, pandoc или встроенный модуль', async () => {
  const soffice = { bin: 'soffice' }, pandoc = { bin: 'pandoc' };
  assert.equal(officeRoute('docx', 'pdf', { soffice, pandoc }), 'soffice');
  assert.equal(officeRoute('doc', 'docx', { soffice }), 'soffice');
  assert.equal(officeRoute('md', 'docx', { soffice, pandoc }), 'pandoc');
  assert.equal(officeRoute('md', 'pdf', { soffice, pandoc }), 'pandoc+soffice');
  assert.equal(officeRoute('md', 'pdf', { soffice: null, pandoc }), 'builtin');
  assert.equal(officeRoute('docx', 'pdf', {}), 'builtin');
  assert.equal(officeRoute('txt', 'md', { pandoc }), 'builtin');
  assert.equal(officeRoute('pdf', 'pdf', { soffice }), null);
  assert.equal(await findOffice({ FORMATBOX_SOFFICE: '/nope', PATH: '' }, 'linux'), null);
  assert.equal(await findOffice({ PATH: '', ProgramFiles: '/nope' }, 'win32'), null);
  assert.equal(await findOffice({ PATH: '' }, 'darwin'), null);
  assert.equal(await findPandoc({ PATH: '' }), null);
});

const office = await findOffice();
const pandoc = await findPandoc();

test('настоящий LibreOffice и pandoc: результат рядом, источник цел, имя не перетёрто', { skip: office && pandoc ? false : 'no soffice/pandoc', timeout: 180000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-office-'));
  try {
    const md = path.join(dir, 'заметка.md');
    fs.writeFileSync(md, '# Заголовок\n\nПривет, **мир**.\n');
    const tools = { soffice: office, pandoc };
    const docx = await convertOffice({ tools, input: md, from: 'md', to: 'docx' });
    assert.equal(docx.route, 'pandoc');
    assert.equal(docx.name, 'заметка.docx');
    const pdf = await convertOffice({ tools, input: docx.path, from: 'docx', to: 'pdf' });
    assert.equal(pdf.route, 'soffice');
    assert.equal(fs.readFileSync(pdf.path).subarray(0, 5).toString(), '%PDF-');
    const pdf2 = await convertOffice({ tools, input: md, from: 'md', to: 'pdf' });
    assert.equal(pdf2.name, 'заметка (2).pdf');
    assert.equal(fs.readFileSync(md, 'utf8'), '# Заголовок\n\nПривет, **мир**.\n');
    await assert.rejects(convertOffice({ tools, input: md, from: 'md', to: 'md' }), /office-route/);
    const ctl = new AbortController(); ctl.abort();
    await assert.rejects(convertOffice({ tools, input: docx.path, from: 'docx', to: 'odt' }, { signal: ctl.signal }), /canceled/);
    fs.writeFileSync(path.join(dir, 'bad.md'), 'x');
    await assert.rejects(convertOffice({ tools: { pandoc: { bin: office.bin } }, input: path.join(dir, 'bad.md'), from: 'md', to: 'html' }), /office-failed|ENOENT/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('закон (ревью №17): окно трогает только выданные ему файлы и папки (зерно 62)', async () => {
  const { createGuard, checkTarget, checkTag } = await import('../../electron/backend/guard.js');
  const r = rng(62);
  const g = createGuard();
  const given = ['/home/u/a.mp4', '/home/u/b c/фото.jpg'].map((p) => g.allowFile(p));
  g.allowDir('/home/u/out');
  for (let n = 0; n < 500; n++) {
    const p = r.pick(['/etc/passwd', '/home/u/a.mp4', '/home/u/../u/a.mp4', '/home/u/b c/фото.jpg', '/home/u/a.mp4/../evil', 'relative.mp4', '/home/u/out']);
    const ok = given.includes(path.resolve(p));
    if (ok) assert.equal(g.file(p), path.resolve(p));
    else assert.throws(() => g.file(p), /not-allowed/);
  }
  assert.throws(() => g.file(42), /not-allowed/);
  assert.equal(g.outDir(null), null);
  assert.equal(g.outDir('/home/u/out/'), '/home/u/out');
  assert.throws(() => g.outDir('/home/u/.config/autostart'), /not-allowed/);
  assert.throws(() => g.result('/home/u/a.mp4'), /not-allowed/);
  g.allowResult('/home/u/a.webm');
  assert.equal(g.result('/home/u/a.webm'), '/home/u/a.webm');
  for (const bad of ['../x', 'desktop', 'mp4/../../x', '', null, '__proto__', 'constructor']) assert.throws(() => checkTarget(bad), /bad-target/);
  for (const good of ['mp4', 'tar.gz', '3mf', 'gcode']) assert.equal(checkTarget(good), good);
  assert.equal(checkTag('nes'), 'nes');
  assert.equal(checkTag(), '');
  for (const bad of ['../a', 'a/b', 'x'.repeat(30), 5]) assert.throws(() => checkTag(bad), /bad-tag/);
});
