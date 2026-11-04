import { test, expect } from '@playwright/test';
import { openApp, addFiles, setOpt, runSelected, resultBytes } from './helpers.js';

test('документ: Markdown в PDF (кириллица), DOCX и обратно в текст', async ({ page }) => {
  const errors = await openApp(page);
  await addFiles(page, 'note.md');
  await setOpt(page, 'to', 'pdf');
  let jobs = await runSelected(page);
  expect(jobs[0].state).toBe('done');
  const pdf = await resultBytes(page, 0);
  expect(String.fromCharCode(...pdf.slice(0, 5))).toBe('%PDF-');
  const text = await page.evaluate(async (bytes) => {
    const pdfjs = await import('./vendor/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', location.href).href;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
    const pg = await doc.getPage(1);
    return (await pg.getTextContent()).items.map((i) => i.str).join(' ');
  }, pdf);
  expect(text).toContain('Заметка');
  expect(text).toContain('мир');
  await setOpt(page, 'to', 'docx');
  jobs = await runSelected(page);
  expect(jobs[0].result.name).toBe('note.docx');
  const docx = await resultBytes(page, 0);
  expect(docx.slice(0, 2)).toEqual([0x50, 0x4b]);
  expect(errors).toEqual([]);
});

test('архив: список внутри, перепаковка в 7z и tar.gz', async ({ page }) => {
  await openApp(page);
  await addFiles(page, 'pack.zip');
  await expect(page.locator('#archiveList')).toContainText('readme.txt');
  await expect(page.locator('#archiveList')).toContainText('Фото/a.bin');
  await setOpt(page, 'to', '7z');
  let jobs = await runSelected(page);
  expect(jobs[0].state).toBe('done');
  expect((await resultBytes(page, 0)).slice(0, 2)).toEqual([0x37, 0x7a]);
  await setOpt(page, 'to', 'tar.gz');
  jobs = await runSelected(page);
  expect(jobs[0].result.name).toBe('pack.tar.gz');
});
