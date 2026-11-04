import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIX = path.join(ROOT, 'tests', 'fixtures');

// Невидимое окно (FORMATBOX_HIDDEN), своя папка настроек на каждый тест
export async function launch({ userData, env = {} } = {}) {
  const dir = userData || fs.mkdtempSync(path.join(os.tmpdir(), 'fb-app-'));
  const docs = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-docs-'));
  const app = await electron.launch({
    args: [ROOT, '--no-sandbox', '--js-flags=--expose-gc'],
    env: { ...process.env, FORMATBOX_HIDDEN: '1', FORMATBOX_USER_DATA: dir, FORMATBOX_DOCUMENTS: docs, ...env },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('body[data-ready="1"]');
  return { app, page, dir, docs, errors };
}

export function workDir(...files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-work-'));
  for (const f of files) fs.copyFileSync(path.join(FIX, f), path.join(dir, f));
  return dir;
}

// Файлы как от пользователя (поле выбора -> File с путём): только такие главный процесс разрешает трогать
export async function addPaths(page, paths) {
  const before = await page.locator('#queue .job').count();
  await page.setInputFiles('#fileInput', paths);
  await page.waitForFunction((n) => document.querySelectorAll('#queue .job').length >= n, before + paths.length);
}
