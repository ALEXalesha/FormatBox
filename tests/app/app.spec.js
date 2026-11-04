import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { launch, workDir, addPaths } from './helpers.js';
import { setOpt, runSelected } from '../web/helpers.js';

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

test('ПК: окно запоминает размер между запусками', async () => {
  const first = await launch();
  await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 40, y: 30, width: 700, height: 600 }));
  await first.page.waitForTimeout(300);
  await first.app.close();
  const saved = JSON.parse(fs.readFileSync(path.join(first.dir, 'window.json'), 'utf8'));
  expect(saved.width).toBe(700);
  const second = await launch({ userData: first.dir });
  const b = await second.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  expect(b.width).toBe(700);
  expect(b.height).toBe(600);
  await second.app.close();
});

test('ПК: настоящий ffmpeg - сжатие до N МБ рядом с файлом, источник цел, имена не перетираются', async () => {
  const { app, page, errors } = await launch();
  const dir = workDir('clip.mp4');
  const src = path.join(dir, 'clip.mp4');
  const before = sha(src);
  fs.writeFileSync(path.join(dir, 'clip-formatbox.mp4'), 'чужой файл');
  const info = await page.evaluate(() => window.formatbox.info());
  test.skip(!info.ffmpeg, 'no ffmpeg');
  await addPaths(page, [src]);
  await setOpt(page, 'to', 'mp4');
  await setOpt(page, 'maxMb', 0.03);
  const jobs = await runSelected(page);
  expect(jobs[0].state).toBe('done');
  expect(jobs[0].result.name).toBe('clip-formatbox (2).mp4');
  const out = path.join(dir, jobs[0].result.name);
  expect(fs.statSync(out).size).toBeLessThanOrEqual(0.03 * 1024 * 1024);
  expect(fs.readFileSync(path.join(dir, 'clip-formatbox.mp4'), 'utf8')).toBe('чужой файл');
  expect(sha(src)).toBe(before);
  await expect(page.locator('#queue .job .job-show')).toBeVisible();
  expect(errors).toEqual([]);
  await app.close();
});

test('ПК: картинка, звук 24 бита, архив и документ - результат рядом', async () => {
  const { app, page } = await launch();
  const dir = workDir('photo.jpg', 'tone.wav');
  fs.writeFileSync(path.join(dir, 'note.md'), '# Привет\n\nТекст **жирный**.\n');
  await addPaths(page, ['photo.jpg', 'tone.wav', 'note.md'].map((f) => path.join(dir, f)));
  await page.locator('#queue .job').nth(0).click({ position: { x: 10, y: 10 } });
  await setOpt(page, 'to', 'png');
  expect((await runSelected(page))[0].state).toBe('done');
  expect(fs.existsSync(path.join(dir, 'photo.png'))).toBe(true);
  await page.locator('#queue .job').nth(1).click({ position: { x: 10, y: 10 } });
  await setOpt(page, 'to', 'wav');
  await setOpt(page, 'bits', 24);
  const j2 = (await runSelected(page))[1];
  expect(j2.state).toBe('done');
  const wav = fs.readFileSync(path.join(dir, j2.result.name));
  expect(wav.readUInt16LE(wav.indexOf('fmt ') + 22)).toBe(24);
  await page.locator('#queue .job').nth(2).click({ position: { x: 10, y: 10 } });
  await setOpt(page, 'to', 'html');
  const j3 = (await runSelected(page))[2];
  expect(j3.state).toBe('done');
  expect(fs.readFileSync(path.join(dir, 'note.html'), 'utf8')).toContain('Привет');
  await app.close();
});

test('ПК: 20 прогонов без роста памяти окна', async () => {
  const { app, page } = await launch();
  const dir = workDir('photo.jpg');
  const heap = () => page.evaluate(async () => { for (let i = 0; i < 3; i++) { window.gc?.(); await new Promise((r) => setTimeout(r, 30)); } return performance.memory.usedJSHeapSize; });
  let base = 0;
  for (let n = 0; n < 20; n++) {
    await addPaths(page, [path.join(dir, 'photo.jpg')]);
    await setOpt(page, 'to', 'webp');
    const jobs = await runSelected(page);
    expect(jobs.at(-1).state).toBe('done');
    await page.click('#clearDone');
    if (n === 4) base = await heap();
  }
  expect((await heap()) - base).toBeLessThan(8 * 1024 * 1024);
  expect(fs.readdirSync(dir).filter((f) => f.endsWith('.webp')).length).toBe(20);
  await app.close();
});

for (const theme of ['glass', 'light']) {
  test(`ПК: узкое окно (${theme}) без горизонтальной прокрутки`, async () => {
    const { app, page } = await launch();
    await page.evaluate((th) => { localStorage.setItem('fb.theme', th); }, theme);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(380, 700));
    await page.reload();
    await page.waitForSelector('body[data-ready="1"]');
    const dir = workDir('clip.mp4');
    await addPaths(page, [path.join(dir, 'clip.mp4')]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await app.close();
  });
}

test('ПК, ревью №17: окно не читает и не пишет чужие пути', async () => {
  const { app, page } = await launch();
  const dir = workDir('photo.jpg');
  const outside = path.join(dir, 'photo.jpg');
  const tries = await page.evaluate(async (p) => {
    const fb = window.formatbox;
    const res = {};
    for (const [k, fn] of Object.entries({
      read: () => fb.read(p), head: () => fb.head(p), stat: () => fb.stat(p), probe: () => fb.probe(p),
      saveEvil: () => fb.save({ bytes: new Uint8Array([1]), source: null, name: 'evil', to: '../../x', outDir: null }),
      saveDir: () => fb.save({ bytes: new Uint8Array([1]), source: null, name: 'evil', to: 'txt', outDir: '/tmp' }),
      show: () => fb.show(p),
    })) { try { await fn(); res[k] = 'allowed'; } catch (e) { res[k] = /not-allowed|bad-target/.test(e.message) ? 'refused' : e.message; } }
    return res;
  }, outside);
  for (const [k, v] of Object.entries(tries)) expect(v, k).toBe('refused');
  await addPaths(page, [outside]);
  expect(await page.evaluate((p) => window.formatbox.head(p, 3).then((b) => [...b]), outside)).toEqual([0xff, 0xd8, 0xff]);
  await app.close();
});

test('ПК, ревью №6: текст в 3D кладётся в «Документы», склейка и «до N МБ» работают', async () => {
  const { app, page, docs } = await launch();
  await page.click('#toolsBtn');
  await page.click('#toolText3d');
  await page.fill('#text3dText', 'FB');
  await page.click('#text3dMake');
  await expect(page.locator('#queue .job.sel')).toHaveCount(1);
  let jobs = await runSelected(page);
  expect(jobs[0].state, jobs[0].error).toBe('done');
  expect(fs.existsSync(path.join(docs, 'FB.stl'))).toBe(true);
  const dir = workDir('clip.mp4', 'short.mp4');
  await addPaths(page, [path.join(dir, 'clip.mp4'), path.join(dir, 'short.mp4')]);
  await page.locator('#queue .job').nth(1).click({ position: { x: 10, y: 10 } });
  await page.locator('#queue .job').nth(2).click({ position: { x: 10, y: 10 }, modifiers: ['Control'] });
  await page.click('#toolsBtn');
  await page.click('#toolJoin');
  await setOpt(page, 'maxMb', 0.05);
  jobs = await runSelected(page);
  const joined = jobs.at(-1);
  expect(joined.state, joined.error).toBe('done');
  expect(fs.statSync(path.join(dir, joined.result.name)).size).toBeLessThanOrEqual(0.05 * 1024 * 1024);
  await app.close();
});
