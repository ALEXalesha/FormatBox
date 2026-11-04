import { test, expect } from '@playwright/test';
import { openApp, addFiles, setOpt, runSelected, selectJob } from './helpers.js';

const THEMES = ['glass', 'formal', 'light', 'night', 'warm'];

// Контраст по WCAG: текст на непрозрачной основе темы (стекло поверх неё почти не меняет яркость)
async function contrasts(page) {
  return page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d');
    const rgb = (css) => { ctx.fillStyle = '#000'; ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data; return { r, g, b, a: a / 255 }; };
    const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
    const lum = ({ r, g, b }) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    const base = rgb(v('--app-base'));
    const glass = over(rgb(v('--glass-bg')), base);
    return {
      text: ratio(over(rgb(v('--text')), glass), glass),
      dim: ratio(over(rgb(v('--text-dim')), glass), glass),
      primary: ratio(rgb(v('--on-accent')), rgb(v('--accent'))),
      danger: ratio(rgb(v('--danger')), glass),
      success: ratio(rgb(v('--success')), glass),
    };
  });
}

for (const theme of THEMES) {
  test(`тема ${theme}: применяется и читается (контраст текста >= 4.5, второстепенного >= 3)`, async ({ page }) => {
    const errors = await openApp(page, { theme });
    await expect(page.locator('#themeSel')).toHaveValue(theme);
    const c = await contrasts(page);
    expect(c.text).toBeGreaterThanOrEqual(4.5);
    expect(c.dim).toBeGreaterThanOrEqual(3);
    expect(c.primary).toBeGreaterThanOrEqual(3);
    expect(c.danger).toBeGreaterThanOrEqual(3);
    expect(c.success).toBeGreaterThanOrEqual(3);
    expect(errors).toEqual([]);
  });
}

test('переключение темы и языка запоминается', async ({ page }) => {
  await openApp(page, { lang: 'en' });
  await expect(page.locator('#addFiles')).toHaveText('Add files');
  await page.selectOption('#langSel', 'ru');
  await expect(page.locator('#addFiles')).toHaveText('Добавить файлы');
  await page.selectOption('#themeSel', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await page.waitForSelector('body[data-ready="1"]');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('#addFiles')).toHaveText('Добавить файлы');
  await expect(page.locator('#themeSel option')).toHaveCount(5);
});

for (const theme of ['glass', 'light']) {
  test(`узкое окно 380 px (${theme}): нет горизонтальной прокрутки, панель под очередью`, async ({ page }) => {
    await page.setViewportSize({ width: 380, height: 760 });
    await openApp(page, { theme });
    await addFiles(page, 'clip.mp4', 'photo.jpg', 'tone.wav');
    for (const i of [0, 1, 2]) {
      await selectJob(page, i);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over).toBeLessThanOrEqual(0);
    }
    const q = await page.locator('.queue').boundingBox();
    const p = await page.locator('#panel').boundingBox();
    expect(p.y).toBeGreaterThanOrEqual(q.y + q.height - 1);
    for (const sel of ['#addFiles', '#startAll', '#opt-to']) {
      const b = await page.locator(sel).boundingBox();
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(380);
    }
  });
}

test('20 прогонов без роста памяти', async ({ page }) => {
  await openApp(page);
  const heap = async () => page.evaluate(async () => { for (let i = 0; i < 3; i++) { window.gc?.(); await new Promise((r) => setTimeout(r, 50)); } return performance.memory.usedJSHeapSize; });
  let base = 0;
  for (let n = 0; n < 20; n++) {
    await addFiles(page, 'photo.jpg');
    await setOpt(page, 'to', 'png');
    const jobs = await runSelected(page);
    expect(jobs.at(-1).state).toBe('done');
    const url = await page.evaluate(() => window.formatboxApp.jobs.at(-1).result.url);
    await page.click('#clearDone');
    expect(await page.evaluate((u) => fetch(u).then(() => 'alive', () => 'revoked'), url)).toBe('revoked');
    await expect(page.locator('#queue .job')).toHaveCount(0);
    if (n === 4) base = await heap();
  }
  const end = await heap();
  expect(end - base).toBeLessThan(8 * 1024 * 1024);
});

test('склейка двух видео и текст в 3D через меню инструментов', async ({ page }) => {
  await openApp(page);
  await addFiles(page, 'clip.mp4', 'clip.mp4');
  await page.locator('#queue .job').nth(0).click({ position: { x: 10, y: 10 } });
  await page.locator('#queue .job').nth(1).click({ position: { x: 10, y: 10 }, modifiers: ['Control'] });
  await page.click('#toolsBtn');
  await page.click('#toolJoin');
  const jobs = await runSelected(page);
  const joined = jobs.at(-1);
  expect(joined.state).toBe('done');
  expect(joined.result.name).toBe('clip-joined.mp4');
  const d = await page.evaluate(async () => {
    const v = document.createElement('video');
    v.src = window.formatboxApp.jobs.at(-1).result.url;
    await new Promise((r) => { v.onloadedmetadata = r; });
    return v.duration;
  });
  expect(Math.abs(d - 6)).toBeLessThan(0.3);
});
