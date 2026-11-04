import { expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
export const fixture = (name) => path.join(FIX, name);

export async function openApp(page, { lang = 'ru', theme } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(([l, th]) => {
    try {
      if (sessionStorage.getItem('fb.init')) return;
      sessionStorage.setItem('fb.init', '1');
      localStorage.setItem('fb.lang', l); if (th) localStorage.setItem('fb.theme', th);
    } catch { /* */ }
  }, [lang, theme]);
  await page.goto('/');
  await page.waitForSelector('body[data-ready="1"]');
  return errors;
}

export async function addFiles(page, ...names) {
  const before = await page.locator('#queue .job').count();
  await page.setInputFiles('#fileInput', names.map(fixture));
  await expect(page.locator('#queue .job')).toHaveCount(before + names.length);
}

export async function setOpt(page, id, value) {
  const el = page.locator(`#opt-${id}`);
  const kind = await el.evaluate((e) => (e.tagName === 'SELECT' ? 'select' : e.type));
  if (kind === 'select') await el.selectOption(String(value));
  else if (kind === 'checkbox') { if (value) await el.check(); else await el.uncheck(); }
  else { await el.fill(String(value)); await el.dispatchEvent('change'); }
}

export async function selectJob(page, index) {
  await page.locator('#queue .job').nth(index).click({ position: { x: 10, y: 10 } });
}

// Задание до конца; возвращает состояние и (в браузере) размер результата
export async function runSelected(page, timeout = 120000) {
  const ids = await page.evaluate(() => [...window.formatboxApp.selected]);
  const runs = await page.evaluate((list) => list.map((id) => window.formatboxApp.jobs.find((j) => j.id === id).runs || 0), ids);
  await page.click('#startSel');
  await page.waitForFunction(([list, before]) => list.every((id, k) => {
    const j = window.formatboxApp.jobs.find((x) => x.id === id);
    return (j.runs || 0) > before[k] && !['waiting', 'running'].includes(j.state);
  }), [ids, runs], { timeout, polling: 100 });
  return page.evaluate(() => window.formatboxApp.jobs.map((j) => ({ name: j.name, state: j.state, error: j.error, result: j.result && { name: j.result.name, bytes: j.result.bytes } })));
}

export async function resultBytes(page, index) {
  return page.evaluate(async (i) => {
    const url = window.formatboxApp.jobs[i].result.url;
    return [...new Uint8Array(await (await fetch(url)).arrayBuffer())];
  }, index);
}
