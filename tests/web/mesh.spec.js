import { test, expect } from '@playwright/test';
import { openApp, addFiles, setOpt, runSelected, resultBytes } from './helpers.js';

const triangles = (stl) => new DataView(new Uint8Array(stl).buffer).getUint32(80, true);

test('3D: превью и вес, починка и 3MF, меньше полигонов', async ({ page }) => {
  const errors = await openApp(page);
  await addFiles(page, 'torus.stl');
  await expect(page.locator('#meshStats')).toContainText('2304');
  await expect(page.locator('#meshPreview')).toBeVisible();
  await setOpt(page, 'to', '3mf');
  await setOpt(page, 'repair', true);
  let jobs = await runSelected(page);
  expect(jobs[0].state).toBe('done');
  expect((await resultBytes(page, 0)).slice(0, 2)).toEqual([0x50, 0x4b]);
  await setOpt(page, 'to', 'stl');
  await setOpt(page, 'decimate', 25);
  jobs = await runSelected(page);
  expect(jobs[0].result.name).toBe('torus-formatbox.stl');
  expect(triangles(await resultBytes(page, 0, 84))).toBeLessThanOrEqual(2304 * 0.25);
  expect(errors).toEqual([]);
});

test('картинка в 3D: литофания и брелок из силуэта', async ({ page }) => {
  await openApp(page);
  await addFiles(page, 'photo.jpg', 'logo.svg');
  await page.locator('#queue .job').nth(0).click({ position: { x: 10, y: 10 } });
  await setOpt(page, 'to3d', 'litho');
  await expect(page.locator('#opt-to')).toHaveValue('stl');
  await setOpt(page, 'widthMm', 80);
  let jobs = await runSelected(page);
  expect(jobs[0].state).toBe('done');
  expect(triangles(await resultBytes(page, 0, 84))).toBeGreaterThan(1000);
  await page.locator('#queue .job').nth(1).click({ position: { x: 10, y: 10 } });
  await setOpt(page, 'to3d', 'keychain');
  jobs = await runSelected(page);
  expect(jobs[1].state).toBe('done');
  expect(jobs[1].result.name).toBe('logo.stl');
});

test('текст в 3D и смена пластика M600 в G-code', async ({ page }) => {
  await openApp(page);
  await page.click('#toolsBtn');
  await page.click('#toolText3d');
  await page.fill('#text3dText', 'Привет 3D');
  await page.click('#text3dMake');
  await expect(page.locator('#queue .job')).toHaveCount(1);
  await expect(page.locator('#queue .job.sel')).toHaveCount(1);
  let jobs = await runSelected(page);
  expect(jobs[0].state).toBe('done');
  expect(jobs[0].result.name).toBe('Привет 3D.stl');
  await addFiles(page, 'part.gcode');
  await page.locator('#queue .job').nth(1).click({ position: { x: 10, y: 10 } });
  await setOpt(page, 'm600', '0.4, 0.8');
  jobs = await runSelected(page);
  expect(jobs[1].state).toBe('done');
  const text = new TextDecoder().decode(new Uint8Array(await resultBytes(page, 1)));
  expect(text.match(/^M600/gm)).toHaveLength(2);
  expect(text.indexOf('M600')).toBeLessThan(text.indexOf('G1 Z0.4'));
});
