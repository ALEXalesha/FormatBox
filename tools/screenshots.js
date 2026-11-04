// Снимки окна для README: веб-версия в Chromium, файлы из tests/fixtures.
//   node tools/screenshots.js
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = (f) => path.join(ROOT, 'tests', 'fixtures', f);
const OUT = (f) => path.join(ROOT, 'docs', 'screenshots', f);

const SHOTS = [
  { name: 'video', theme: 'glass', files: ['clip.mp4', 'photo.jpg', 'tone.wav'], select: 0, opts: { to: 'webm', maxMb: '8' } },
  { name: 'image-light', theme: 'light', files: ['photo.jpg'], select: 0, opts: { to: 'webp', quality: '35' }, wait: '#previewSize' },
  { name: 'mesh', theme: 'formal', files: ['torus.stl'], select: 0, opts: { to: '3mf' }, wait: '#meshStats' },
  { name: 'audio-warm', theme: 'warm', files: ['tone.wav'], select: 0, opts: { to: 'wav', bits: '8', rate: '22050', chip: 'nes' } },
];

const server = await startServer(0);
const browser = await chromium.launch();
for (const lang of ['en', 'ru']) {
  for (const shot of SHOTS) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 720 }, deviceScaleFactor: 2 });
    await page.addInitScript(([l, th]) => { localStorage.setItem('fb.lang', l); localStorage.setItem('fb.theme', th); }, [lang, shot.theme]);
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForSelector('body[data-ready="1"]');
    await page.setInputFiles('#fileInput', shot.files.map(FIX));
    await page.locator('#queue .job').nth(shot.select).click({ position: { x: 10, y: 10 } });
    for (const [id, v] of Object.entries(shot.opts)) {
      const el = page.locator(`#opt-${id}`);
      if (await el.evaluate((e) => e.tagName === 'SELECT')) await el.selectOption(v);
      else { await el.fill(v); await el.dispatchEvent(id === 'quality' ? 'input' : 'change'); }
    }
    if (shot.wait) await page.waitForSelector(shot.wait, { timeout: 30000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: OUT(`${shot.name}-${lang}.png`) });
    await page.close();
  }
}
await browser.close();
server.close();
console.log('screenshots: docs/screenshots');
