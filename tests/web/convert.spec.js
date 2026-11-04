import { test, expect } from '@playwright/test';
import { openApp, addFiles, setOpt, selectJob, runSelected, resultBytes } from './helpers.js';

test('видео: сжатие до N МБ в браузере (ffmpeg.wasm) - результат не больше, имена не повторяются', async ({ page }) => {
  const errors = await openApp(page);
  await addFiles(page, 'clip.mp4');
  await setOpt(page, 'to', 'webm');
  await setOpt(page, 'maxMb', 0.04);
  let jobs = await runSelected(page);
  expect(jobs[0].state).toBe('done');
  expect(jobs[0].result.bytes).toBeLessThanOrEqual(0.04 * 1024 * 1024);
  expect(jobs[0].result.name).toBe('clip.webm');
  const bytes = await resultBytes(page, 0);
  expect(bytes.length).toBe(jobs[0].result.bytes);
  expect(bytes.slice(0, 4)).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  jobs = await runSelected(page);
  expect(jobs[0].result.name).toBe('clip (2).webm');
  expect(errors).toEqual([]);
});

test('видео: пиксели не больше заданных, звук из видео, GIF', async ({ page }) => {
  await openApp(page);
  await addFiles(page, 'clip.mp4');
  await setOpt(page, 'maxPx', 'custom');
  await setOpt(page, 'maxPxN', 20000);
  let jobs = await runSelected(page);
  expect(jobs[0].state).toBe('done');
  const info = await page.evaluate(async () => {
    const v = document.createElement('video');
    v.src = window.formatboxApp.jobs[0].result.url;
    await new Promise((r) => { v.onloadedmetadata = r; });
    return { w: v.videoWidth, h: v.videoHeight, d: v.duration };
  });
  expect(info.w * info.h).toBeLessThanOrEqual(20000);
  expect(Math.abs(info.d - 3)).toBeLessThan(0.1);
  await page.click('#queue .job >> nth=0');
  await setOpt(page, 'to', 'mp3');
  jobs = await runSelected(page);
  expect(jobs[0].result.name).toBe('clip.mp3');
});

test('картинка: до 10 КБ, предпросмотр показывает размер, EXIF уходит', async ({ page }) => {
  await openApp(page);
  await addFiles(page, 'photo.jpg');
  await setOpt(page, 'to', 'webp');
  await expect(page.locator('#previewSize')).toContainText('КБ');
  const first = await page.locator('#previewSize').innerText();
  await page.locator('#opt-quality').fill('5');
  await page.locator('#opt-quality').dispatchEvent('input');
  await expect(page.locator('#previewSize')).not.toHaveText(first);
  await setOpt(page, 'maxMb', 0.01);
  const jobs = await runSelected(page);
  expect(jobs[0].state).toBe('done');
  expect(jobs[0].result.bytes).toBeLessThanOrEqual(10 * 1024 * 1.024);
  const bytes = await resultBytes(page, 0);
  expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('WEBP');
});

test('звук: WAV в 8 бит 11 кГц моно - заголовок как выбрано', async ({ page }) => {
  await openApp(page);
  await addFiles(page, 'tone.wav');
  await setOpt(page, 'to', 'wav');
  await setOpt(page, 'bits', 8);
  await setOpt(page, 'rate', 11025);
  await setOpt(page, 'channels', 1);
  const jobs = await runSelected(page);
  expect(jobs[0].state).toBe('done');
  const b = new Uint8Array(await resultBytes(page, 0));
  const dv = new DataView(b.buffer);
  expect(dv.getUint16(22, true)).toBe(1);
  expect(dv.getUint32(24, true)).toBe(11025);
  expect(dv.getUint16(34, true)).toBe(8);
  const levels = new Set(b.subarray(44));
  expect(levels.size).toBeLessThanOrEqual(256);
});

test('звук приставки: предпросмотр 10 с и результат', async ({ page }) => {
  await openApp(page);
  await addFiles(page, 'tone.wav');
  await setOpt(page, 'to', 'wav');
  await setOpt(page, 'chip', 'nes');
  await page.click('#preview10');
  await expect(page.locator('#audioPreview')).toHaveAttribute('src', /blob:/, { timeout: 30000 });
  const jobs = await runSelected(page);
  expect(jobs[0].state).toBe('done');
  expect(jobs[0].result.name).toBe('tone-nes.wav');
});

test('отмена идущего задания и повтор', async ({ page }) => {
  await openApp(page);
  await addFiles(page, 'clip.mp4');
  await setOpt(page, 'to', 'webm');
  await setOpt(page, 'quality', 100);
  await page.click('#startSel');
  await page.waitForFunction(async () => (await import('./app/ffmpeg-web.js')).ffmpegState().loaded && window.formatboxApp.jobs[0].progress > 0);
  await page.click('#queue .job .job-cancel');
  await page.waitForFunction(() => window.formatboxApp.jobs[0].state === 'canceled');
  const loads = () => page.evaluate(async () => (await import('./app/ffmpeg-web.js')).ffmpegState());
  expect(await loads()).toEqual({ loaded: false, loads: 1 });
  await setOpt(page, 'quality', 30);
  const jobs = await runSelected(page);
  expect(jobs[0].state).toBe('done');
  expect(await loads()).toEqual({ loaded: true, loads: 2 });
});
