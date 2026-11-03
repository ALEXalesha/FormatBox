// Документы на ПК: LibreOffice (soffice) и pandoc, если они есть. Нет - окно пользуется встроенным модулем
// и предлагает докачать LibreOffice кнопкой.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { saveResult } from './files.js';
import { officeRoute } from '../../web/core/docroute.js';

export const LIBREOFFICE_URL = 'https://www.libreoffice.org/download/download-libreoffice/';

function works(bin, args, env) {
  const r = spawnSync(bin, args, { encoding: 'utf8', env, timeout: 30000, windowsHide: true });
  return r.status === 0 ? (r.stdout || '').trim().split('\n')[0] : null;
}

export function findOffice(env = process.env, platform = process.platform) {
  const candidates = [env.FORMATBOX_SOFFICE, 'soffice', 'libreoffice'];
  if (platform === 'win32') candidates.push(path.join(env.ProgramFiles || 'C:\\Program Files', 'LibreOffice', 'program', 'soffice.exe'));
  if (platform === 'darwin') candidates.push('/Applications/LibreOffice.app/Contents/MacOS/soffice');
  for (const bin of candidates.filter(Boolean)) {
    const v = works(bin, ['--version'], env);
    if (v) return { bin, version: v };
  }
  return null;
}

export function findPandoc(env = process.env) {
  for (const bin of [env.FORMATBOX_PANDOC, 'pandoc'].filter(Boolean)) {
    const v = works(bin, ['--version'], env);
    if (v) return { bin, version: v };
  }
  return null;
}

const SOFFICE_OUT = { pdf: 'pdf', docx: 'docx:MS Word 2007 XML', odt: 'odt', rtf: 'rtf', html: 'html:XHTML Writer File:UTF8', txt: 'txt:Text (encoded):UTF8' };
export { officeRoute };

function run(bin, args, { signal, cwd } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('canceled')); return; }
    const child = spawn(bin, args, { cwd, windowsHide: true });
    let err = '';
    const kill = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', kill, { once: true });
    child.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    child.on('error', reject);
    child.on('close', (code) => {
      signal?.removeEventListener('abort', kill);
      if (signal?.aborted) reject(new Error('canceled'));
      else if (code === 0) resolve();
      else reject(Object.assign(new Error('office-failed'), { log: err }));
    });
  });
}

async function viaSoffice(bin, input, to, work, signal) {
  // свой профиль: не мешает открытому LibreOffice и не ждёт его
  const profile = pathToFileURL(path.join(work, 'profile')).href;
  const copy = path.join(work, `in${path.extname(input)}`);
  fs.copyFileSync(input, copy);
  await run(bin, [`-env:UserInstallation=${profile}`, '--headless', '--norestore', '--convert-to', SOFFICE_OUT[to], '--outdir', path.join(work, 'out'), copy], { signal, cwd: work });
  const produced = fs.readdirSync(path.join(work, 'out'))[0];
  if (!produced) throw new Error('office-failed');
  return path.join(work, 'out', produced);
}

async function viaPandoc(bin, input, from, to, work, signal) {
  const out = path.join(work, `out.${to}`);
  const fmt = (f) => ({ md: 'markdown', txt: 'plain' }[f] || f);
  await run(bin, ['-f', fmt(from), '-t', fmt(to), '-s', '-o', out, input], { signal, cwd: work });
  return out;
}

export async function convertOffice({ tools, input, from, to, outDir }, { signal } = {}) {
  const route = officeRoute(from, to, { soffice: tools.soffice, pandoc: tools.pandoc });
  if (!route || route === 'builtin') throw new Error('office-route');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'formatbox-doc-'));
  try {
    let out;
    if (route === 'soffice') out = await viaSoffice(tools.soffice.bin, input, to, work, signal);
    else if (route === 'pandoc') out = await viaPandoc(tools.pandoc.bin, input, from, to, work, signal);
    else {
      const mid = await viaPandoc(tools.pandoc.bin, input, from, 'odt', work, signal);
      out = await viaSoffice(tools.soffice.bin, mid, 'pdf', work, signal);
    }
    return { ...saveResult(out, input, to, outDir), route };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
