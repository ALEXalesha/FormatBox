// FormatBox на ПК: то же окно, что веб-версия (web/), плюс настоящий ffmpeg, LibreOffice и pandoc.
// Окно грузится по своему адресу app://formatbox/ с COOP/COEP (как сайт с coi-sw.js).
import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findFfmpeg, convertFile, convertBytes, decodeToWav, concatFiles, probe } from './backend/ffmpeg.js';
import { findOffice, findPandoc, convertOffice, LIBREOFFICE_URL } from './backend/office.js';
import { saveBytes } from './backend/files.js';
import { createGuard, checkTarget, checkTag } from './backend/guard.js';
import { extractTo } from './backend/extract.js';
import { loadState, saveState, fitToDisplays } from './backend/window-state.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(HERE, '..', 'web');
if (process.env.FORMATBOX_USER_DATA) app.setPath('userData', process.env.FORMATBOX_USER_DATA);
if (process.env.FORMATBOX_DOCUMENTS) app.setPath('documents', process.env.FORMATBOX_DOCUMENTS);

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const tools = { ffmpeg: null, soffice: null, pandoc: null };
const jobs = new Map();
const guard = createGuard();
let toolsReady = null;
let win = null;

function serveWeb() {
  protocol.handle('app', async (req) => {
    const url = new URL(req.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(WEB, rel));
    if (!file.startsWith(WEB + path.sep) && file !== WEB) return new Response('forbidden', { status: 403 });
    const res = await net.fetch(pathToFileURL(file).href);
    const headers = new Headers(res.headers);
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    if (file.endsWith('.js') || file.endsWith('.mjs')) headers.set('Content-Type', 'text/javascript');
    if (file.endsWith('.wasm')) headers.set('Content-Type', 'application/wasm');
    return new Response(res.body, { status: res.status, headers });
  });
}

function createWindow() {
  const stateFile = path.join(app.getPath('userData'), 'window.json');
  const displays = screen.getAllDisplays().map((d) => d.workArea);
  const primary = screen.getPrimaryDisplay().workArea;
  const state = fitToDisplays(loadState(stateFile), [primary, ...displays.filter((d) => d.x !== primary.x || d.y !== primary.y)]);
  win = new BrowserWindow({
    ...state, minWidth: 380, minHeight: 520, show: !process.env.FORMATBOX_HIDDEN, backgroundColor: '#12101f', title: 'FormatBox',
    icon: path.join(WEB, 'icon.png'),
    skipTaskbar: Boolean(process.env.FORMATBOX_HIDDEN),
    webPreferences: { preload: path.join(HERE, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: !process.env.FORMATBOX_HIDDEN },
  });
  // окно тестов: показано, но полностью прозрачно и без панели задач - так кадры рисуются и
  // requestAnimationFrame идёт (у скрытого окна он стоит), а человек ничего не видит
  if (process.env.FORMATBOX_HIDDEN) { win.setOpacity(0); win.showInactive(); }
  else if (state.maximized) win.maximize();
  win.setMenuBarVisibility(false);
  const remember = () => {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    const b = win.getNormalBounds();
    try { saveState(stateFile, { ...b, maximized: win.isMaximized() }); } catch { /* только чтение */ }
  };
  win.on('resize', remember);
  win.on('move', remember);
  win.on('close', remember);
  // окно никуда не уходит со своего адреса (ссылки - только в браузер)
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://formatbox/')) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL('app://formatbox/index.html');
}

function progressSender(event, id) {
  return (p) => { if (!event.sender.isDestroyed()) event.sender.send('fb:progress', { id, p }); };
}

async function withJob(id, fn) {
  const ctl = new AbortController();
  jobs.set(id, ctl);
  try { return { ok: true, ...(await fn(ctl.signal)) }; }
  catch (err) { return { ok: false, error: err.message, log: err.log }; }
  finally { jobs.delete(id); }
}

// Результат работы: путь запоминается, чтобы «Показать в папке» открывала только его
const done = (res) => { if (res?.path) guard.allowResult(res.path); return res; };
const ffmpegBin = async () => { await toolsReady; if (!tools.ffmpeg) throw new Error('no-ffmpeg'); return tools.ffmpeg.bin; };

function registerIpc() {
  ipcMain.handle('fb:info', async () => {
    await toolsReady;
    return {
      desktop: true, platform: process.platform,
      ffmpeg: tools.ffmpeg ? tools.ffmpeg.version : null,
      soffice: tools.soffice ? tools.soffice.version : null,
      pandoc: tools.pandoc ? tools.pandoc.version : null,
    };
  });
  ipcMain.handle('fb:recheck', async () => {
    [tools.soffice, tools.pandoc] = await Promise.all([findOffice(), findPandoc()]);
    return { soffice: tools.soffice?.version || null, pandoc: tools.pandoc?.version || null };
  });
  ipcMain.handle('fb:pick-files', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
    if (r.canceled) return [];
    return Promise.all(r.filePaths.map(async (p) => ({ path: guard.allowFile(p), name: path.basename(p), size: (await fs.promises.stat(p)).size })));
  });
  ipcMain.handle('fb:pick-folder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : guard.allowDir(r.filePaths[0]);
  });
  // перетаскивание: путь даёт только preload из настоящего File (webUtils), окно его не придумает
  ipcMain.on('fb:allow-dropped', (e, p) => { if (typeof p === 'string' && p) guard.allowFile(p); e.returnValue = true; });
  ipcMain.handle('fb:stat', async (e, p) => { const f = guard.file(p); return { path: f, name: path.basename(f), size: (await fs.promises.stat(f)).size }; });
  ipcMain.handle('fb:read', async (e, p) => new Uint8Array(await fs.promises.readFile(guard.file(p))));
  // начало файла для распознавания формата: не читать гигабайты ради 4 КБ
  ipcMain.handle('fb:head', async (e, p, n = 4096) => {
    const h = await fs.promises.open(guard.file(p), 'r');
    try {
      const buf = Buffer.alloc(Math.max(0, Math.min(65536, n | 0)));
      const { bytesRead } = await h.read(buf, 0, buf.length, 0);
      return new Uint8Array(buf.subarray(0, bytesRead));
    } finally { await h.close(); }
  });
  ipcMain.handle('fb:probe', async (e, p) => probe(await ffmpegBin(), guard.file(p)));
  ipcMain.handle('fb:ffmpeg', (e, { id, input, to, opts, outDir, tag }) => withJob(id, async (signal) => done(await convertFile(await ffmpegBin(), { input: guard.file(input), to: checkTarget(to), opts, outDir: guard.outDir(outDir), tag: checkTag(tag) }, { signal, progress: progressSender(e, id) }))));
  ipcMain.handle('fb:ffmpeg-bytes', (e, { id, bytes, ext, source, to, opts, outDir, tag }) => withJob(id, async (signal) => done(await convertBytes(await ffmpegBin(), { bytes, ext: checkTarget(ext), source: guard.file(source), to: checkTarget(to), opts, outDir: guard.outDir(outDir), tag: checkTag(tag) }, { signal, progress: progressSender(e, id) }))));
  ipcMain.handle('fb:decode', (e, { id, input, opts }) => withJob(id, async (signal) => ({ bytes: await decodeToWav(await ffmpegBin(), { input: guard.file(input), opts }, { signal }) })));
  ipcMain.handle('fb:concat', (e, { id, inputs, to, opts, outDir }) => withJob(id, async (signal) => done(await concatFiles(await ffmpegBin(), { inputs: inputs.map((p) => guard.file(p)), to: checkTarget(to), opts, outDir: guard.outDir(outDir) }, { signal, progress: progressSender(e, id) }))));
  ipcMain.handle('fb:office', (e, { id, input, from, to, outDir }) => withJob(id, async (signal) => { await toolsReady; return done(await convertOffice({ tools, input: guard.file(input), from: checkTarget(from), to: checkTarget(to), outDir: guard.outDir(outDir) }, { signal })); }));
  ipcMain.handle('fb:cancel', (e, id) => { jobs.get(id)?.abort(); return true; });
  // без исходного файла (текст в 3D) результат кладётся в выбранную папку или в «Документы»
  ipcMain.handle('fb:save', (e, { bytes, source, name, to, outDir, tag }) => {
    const dir = guard.outDir(outDir);
    const src = source ? guard.file(source) : path.join(dir || app.getPath('documents'), path.basename(String(name || 'file')));
    return done(saveBytes(bytes, src, checkTarget(to), dir, checkTag(tag)));
  });
  ipcMain.handle('fb:extract', (e, { entries, source, outDir }) => done(extractTo(entries, guard.file(source), guard.outDir(outDir))));
  ipcMain.handle('fb:show', (e, p) => { shell.showItemInFolder(guard.result(p)); return true; });
  ipcMain.handle('fb:get-office', () => shell.openExternal(LIBREOFFICE_URL));
}

app.whenReady().then(() => {
  // поиск ffmpeg, LibreOffice и pandoc идёт в фоне: окно открывается сразу
  toolsReady = Promise.all([findFfmpeg(), findOffice(), findPandoc()]).then(([f, o, p]) => { tools.ffmpeg = f; tools.soffice = o; tools.pandoc = p; });
  serveWeb();
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
