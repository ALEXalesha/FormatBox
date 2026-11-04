// Мутанты версии для ПК: ловятся тестами Electron (невидимое окно, нужен дисплей - в CI xvfb-run)
const app = 'tests/app/app.spec.js';
const config = 'playwright.app.config.js';
export default [
  { name: 'app: window size never saved', file: 'electron/main.js', from: '    try { saveState(stateFile, { ...b, maximized: win.isMaximized() }); } catch { /* только чтение */ }', to: '', app, config, grep: 'запоминает размер' },
  { name: 'app: saved size ignored at start', file: 'electron/main.js', from: '    ...state, minWidth: 380', to: '    minWidth: 380', app, config, grep: 'запоминает размер' },
  { name: 'app: folder listing ignored when naming', file: 'electron/backend/files.js', from: 'const name = outputName(path.basename(source), to, new Set(list(dir)), tag);', to: 'const name = outputName(path.basename(source), to, new Set(), tag);', app, config, grep: 'настоящий ffmpeg' },
];
