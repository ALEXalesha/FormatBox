// Мост окна к главному процессу: только эти действия, без доступа к Node из окна.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const listeners = new Set();
ipcRenderer.on('fb:progress', (e, msg) => { for (const fn of listeners) fn(msg); });

contextBridge.exposeInMainWorld('formatbox', {
  desktop: true,
  info: () => ipcRenderer.invoke('fb:info'),
  recheck: () => ipcRenderer.invoke('fb:recheck'),
  pickFiles: () => ipcRenderer.invoke('fb:pick-files'),
  pickFolder: () => ipcRenderer.invoke('fb:pick-folder'),
  stat: (p) => ipcRenderer.invoke('fb:stat', p),
  read: (p) => ipcRenderer.invoke('fb:read', p),
  probe: (p) => ipcRenderer.invoke('fb:probe', p),
  ffmpeg: (job) => ipcRenderer.invoke('fb:ffmpeg', job),
  ffmpegBytes: (job) => ipcRenderer.invoke('fb:ffmpeg-bytes', job),
  decode: (job) => ipcRenderer.invoke('fb:decode', job),
  concat: (job) => ipcRenderer.invoke('fb:concat', job),
  office: (job) => ipcRenderer.invoke('fb:office', job),
  cancel: (id) => ipcRenderer.invoke('fb:cancel', id),
  save: (msg) => ipcRenderer.invoke('fb:save', msg),
  extract: (msg) => ipcRenderer.invoke('fb:extract', msg),
  show: (p) => ipcRenderer.invoke('fb:show', p),
  getOffice: () => ipcRenderer.invoke('fb:get-office'),
  onProgress: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  pathFor: (file) => webUtils.getPathForFile(file),
});
