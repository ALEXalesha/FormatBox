// FormatBox на ПК: то же окно, что веб-версия (web/), плюс настоящий ffmpeg, LibreOffice и pandoc.
// Окно грузится по своему адресу app://formatbox/ с COOP/COEP (как сайт с coi-sw.js).
import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findFfmpeg, convertFile, concatFiles, probe } from './backend/ffmpeg.js';
import { findOffice, findPandoc, convertOffice, LIBREOFFICE_URL } from './backend/office.js';
import { saveBytes } from './backend/files.js';
import { extractTo } from './backend/extract.js';
import { loadState, saveState, fitToDisplays } from './backend/window-state.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(HERE, '..', 'web');
if (process.env.FORMATBOX_USER_DATA) app.setPath('userData', process.env.FORMATBOX_USER_DATA);

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const tools = { ffmpeg: null, soffice: null, pandoc: null };
const jobs = new Map();
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
    webPreferences: { preload: path.join(HERE, 'preload.cjs'), contextIsolation: true, sandbox: false },
  });
  if (state.maximized && !process.env.FORMATBOX_HIDDEN) win.maximize();
  win.setMenuBarVisibility(false);
  const remember = () => {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    const b = win.getNormalBounds();
    try { saveState(stateFile, { ...b, maximized: win.isMaximized() }); } catch { /* только чтение */ }
  };
  win.on('resize', remember);
  win.on('move', remember);
  win.on('close', remember);
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

function registerIpc() {
  ipcMain.handle('fb:info', () => ({
    desktop: true, platform: process.platform,
    ffmpeg: tools.ffmpeg ? tools.ffmpeg.version : null,
    soffice: tools.soffice ? tools.soffice.version : null,
    pandoc: tools.pandoc ? tools.pandoc.version : null,
  }));
  ipcMain.handle('fb:recheck', () => {
    tools.soffice = findOffice();
    tools.pandoc = findPandoc();
    return { soffice: tools.soffice?.version || null, pandoc: tools.pandoc?.version || null };
  });
  ipcMain.handle('fb:pick-files', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
    return r.canceled ? [] : r.filePaths.map((p) => ({ path: p, name: path.basename(p), size: fs.statSync(p).size }));
  });
  ipcMain.handle('fb:pick-folder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('fb:stat', (e, p) => ({ path: p, name: path.basename(p), size: fs.statSync(p).size }));
  ipcMain.handle('fb:read', (e, p) => new Uint8Array(fs.readFileSync(p)));
  ipcMain.handle('fb:probe', (e, p) => (tools.ffmpeg ? probe(tools.ffmpeg.bin, p) : null));
  ipcMain.handle('fb:ffmpeg', (e, { id, input, to, opts, outDir, tag }) => withJob(id, (signal) => {
    if (!tools.ffmpeg) throw new Error('no-ffmpeg');
    return convertFile(tools.ffmpeg.bin, { input, to, opts, outDir, tag }, { signal, progress: progressSender(e, id) });
  }));
  ipcMain.handle('fb:concat', (e, { id, inputs, to, opts, outDir }) => withJob(id, (signal) => {
    if (!tools.ffmpeg) throw new Error('no-ffmpeg');
    return concatFiles(tools.ffmpeg.bin, { inputs, to, opts, outDir }, { signal, progress: progressSender(e, id) });
  }));
  ipcMain.handle('fb:office', (e, { id, input, from, to, outDir }) => withJob(id, (signal) => convertOffice({ tools, input, from, to, outDir }, { signal })));
  ipcMain.handle('fb:cancel', (e, id) => { jobs.get(id)?.abort(); return true; });
  ipcMain.handle('fb:save', (e, { bytes, source, to, outDir, tag }) => saveBytes(bytes, source, to, outDir, tag));
  ipcMain.handle('fb:extract', (e, { entries, source, outDir }) => extractTo(entries, source, outDir));
  ipcMain.handle('fb:show', (e, p) => { shell.showItemInFolder(p); return true; });
  ipcMain.handle('fb:get-office', () => shell.openExternal(LIBREOFFICE_URL));
}

app.whenReady().then(() => {
  tools.ffmpeg = findFfmpeg();
  tools.soffice = findOffice();
  tools.pandoc = findPandoc();
  serveWeb();
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
