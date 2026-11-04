// Законы окна на находки независимого ревью (04.11)
import { test, expect } from '@playwright/test';
import { openApp, addFiles, setOpt, selectJob, runSelected, resultBytes } from './helpers.js';

test('ревью №1: предпросмотр звука во время задания не подменяет его файлы в ffmpeg.wasm', async ({ page }) => {
  await openApp(page);
  await addFiles(page, 'clip.mp4', 'short.mp4');
  await selectJob(page, 0);
  await setOpt(page, 'to', 'webm');
  await setOpt(page, 'quality', 100);
  await page.click('#startSel');
  await selectJob(page, 1);
  await setOpt(page, 'to', 'wav');
  await setOpt(page, 'chip', 'nes');
  await page.click('#preview10');
  await page.waitForFunction(() => window.formatboxApp.jobs[0].state === 'done' || window.formatboxApp.jobs[0].state === 'failed', null, { timeout: 120000, polling: 100 });
  await expect(page.locator('#audioPreview')).toHaveAttribute('src', /blob:/, { timeout: 60000 });
  // перерисовка панели (выбор другого файла и обратно) не теряет готовый предпросмотр
  await selectJob(page, 0);
  await selectJob(page, 1);
  await expect(page.locator('#audioPreview')).toHaveAttribute('src', /blob:/);
  const d = await page.evaluate(async () => {
    const v = document.createElement('video');
    v.src = window.formatboxApp.jobs[0].result.url;
    await new Promise((r) => { v.onloadedmetadata = r; });
    if (v.duration === Infinity) { v.currentTime = 1e9; await new Promise((r) => { v.ontimeupdate = r; }); }
    return v.duration;
  });
  expect(Math.abs(d - 3)).toBeLessThan(0.2);
});

test('ревью №3 и №19: BMP «до N МБ» - не больше; у GIF и ICO поля МБ нет', async ({ page }) => {
  await openApp(page);
  await addFiles(page, 'photo.jpg', 'clip.mp4');
  await selectJob(page, 0);
  await setOpt(page, 'to', 'bmp');
  await setOpt(page, 'maxMb', 0.01);
  const jobs = await runSelected(page);
  expect(jobs[0].state).toBe('done');
  expect(jobs[0].result.bytes).toBeLessThanOrEqual(0.01 * 1024 * 1024);
  await setOpt(page, 'to', 'ico');
  await expect(page.locator('#opt-maxMb')).toHaveCount(0);
  await selectJob(page, 1);
  await setOpt(page, 'to', 'gif');
  await expect(page.locator('#opt-maxMb')).toHaveCount(0);
});

test('ревью №8, №9, №21, №22: EXIF и GPS уходят, ориентация остаётся; снятая галочка - файл как есть; размер в предпросмотре честный', async ({ page }) => {
  await openApp(page);
  await addFiles(page, 'photo-exif.jpg');
  await setOpt(page, 'to', 'jpg');
  await expect(page.locator('#previewSize')).toBeVisible();
  let jobs = await runSelected(page);
  const out = await resultBytes(page, 0);
  const exif = await page.evaluate(async (b) => (await import('./core/image/index.js')).readExif(new Uint8Array(b)), out);
  expect(exif.hasGps).toBe(false);
  expect(exif.make).toBeUndefined();
  expect(exif.orientation).toBe(6);
  const shown = await page.locator('#previewSize').innerText();
  const saved = await page.evaluate(async (n) => (await import('./app/i18n.js')).humanSize(n), jobs[0].result.bytes);
  expect(shown).toContain(`${saved} вместо`);
  await setOpt(page, 'stripMeta', false);
  jobs = await runSelected(page);
  const orig = await page.evaluate(async () => [...new Uint8Array(await window.formatboxApp.jobs[0].src.file.arrayBuffer())]);
  expect(await resultBytes(page, 0)).toEqual(orig);
});

test('ревью №10: AVIF предлагается только там, где браузер умеет его кодировать', async ({ page }) => {
  await openApp(page);
  await addFiles(page, 'photo.jpg');
  const can = await page.evaluate(() => document.createElement('canvas').toDataURL('image/avif').startsWith('data:image/avif'));
  const offered = await page.locator('#opt-to option[value="avif"]').count();
  expect(offered).toBe(can ? 1 : 0);
});

test('ревью №13: WAV 24 бита с одной обрезкой остаётся 24-битным', async ({ page }) => {
  await openApp(page);
  await addFiles(page, 'tone24.wav');
  await setOpt(page, 'to', 'wav');
  await setOpt(page, 'trimTo', 0.5);
  const jobs = await runSelected(page);
  expect(jobs[0].state, jobs[0].error).toBe('done');
  const b = new Uint8Array(await resultBytes(page, 0, 64));
  const dv = new DataView(b.buffer);
  expect(dv.getUint16(34, true)).toBe(24);
  expect(dv.getUint32(24, true)).toBe(48000);
});

test('ревью №2: у склейки только те поля, что до неё доходят', async ({ page }) => {
  await openApp(page);
  await addFiles(page, 'clip.mp4', 'short.mp4');
  await selectJob(page, 0);
  await page.locator('#queue .job').nth(1).click({ position: { x: 10, y: 10 }, modifiers: ['Control'] });
  await page.click('#toolsBtn');
  await page.click('#toolJoin');
  const ids = await page.locator('#panelBody [id^="opt-"]').evaluateAll((els) => els.map((e) => e.id));
  for (const id of ids) expect(['opt-to', 'opt-maxMb', 'opt-maxPx', 'opt-maxPxN', 'opt-quality', 'opt-fps']).toContain(id);
  await setOpt(page, 'maxMb', 0.05);
  const jobs = await runSelected(page);
  expect(jobs.at(-1).result.bytes).toBeLessThanOrEqual(0.05 * 1024 * 1024);
});

test('ревью №14 и №23: живых ссылок blob не копится за 20 прогонов с предпросмотром', async ({ page }) => {
  await page.addInitScript(() => {
    const live = new Set();
    const make = URL.createObjectURL.bind(URL), drop = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (b) => { const u = make(b); live.add(u); return u; };
    URL.revokeObjectURL = (u) => { live.delete(u); drop(u); };
    window.liveBlobUrls = () => live.size;
  });
  await openApp(page);
  for (let n = 0; n < 20; n++) {
    await addFiles(page, 'photo.jpg');
    await setOpt(page, 'to', 'webp');
    await expect(page.locator('#previewSize')).toBeVisible();
    expect((await runSelected(page)).at(-1).state).toBe('done');
    await page.click('#clearDone');
    await expect(page.locator('#queue .job')).toHaveCount(0);
  }
  expect(await page.evaluate(() => window.liveBlobUrls())).toBeLessThanOrEqual(1);
});

test('ревью №1: параллельные пробы ffmpeg.wasm не читают чужой журнал (длительность каждого файла своя)', async ({ page }) => {
  await openApp(page);
  await addFiles(page, 'clip.mp4', 'short.mp4');
  const durations = await page.evaluate(async () => {
    const { ffmpegProbe } = await import('./app/ffmpeg-web.js');
    const files = await Promise.all(window.formatboxApp.jobs.map(async (j) => new Uint8Array(await j.src.file.arrayBuffer())));
    const calls = [];
    for (let k = 0; k < 4; k++) for (const b of files) calls.push(ffmpegProbe({ bytes: b, ext: 'mp4' }));
    return (await Promise.all(calls)).map((i) => Math.round(i.duration));
  });
  expect(durations).toEqual([3, 1, 3, 1, 3, 1, 3, 1]);
});
