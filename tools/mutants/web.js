// Мутанты окна: ловятся тестами Playwright (веб-версия, невидимый Chromium)
const app = 'tests/web/ui.spec.js';
const conv = 'tests/web/convert.spec.js';
export default [
  { name: 'web: warm theme white text on ochre', file: 'web/app.css', from: ':root[data-theme="warm"] { --on-accent: #1d1610; }', to: '', app, grep: 'тема warm' },
  { name: 'web: narrow window keeps two columns', file: 'web/app.css', from: '  .work { grid-template-columns: 1fr; }', to: '', app, grep: 'узкое окно 380 px \\(glass\\)' },
  { name: 'web: downloads repeat a name', file: 'web/app/platform.js', from: '      produced.add(name);', to: '', app: conv, grep: 'имена не повторяются' },
  { name: 'web: ffmpeg takes the cached source bytes', file: 'web/app/ffmpeg-web.js', from: '  await inst.writeFile(input, bytes.slice());\n  try {\n    const res', to: '  await inst.writeFile(input, bytes);\n  try {\n    const res', app: conv, grep: 'имена не повторяются' },
  { name: 'web: cancel does not stop ffmpeg', file: 'web/app/ffmpeg-web.js', from: "  const stop = () => killFfmpeg();", to: '  const stop = () => {};', app: conv, grep: 'отмена идущего' },
  { name: 'web: language not remembered', file: 'web/app/main.js', from: "store.set('fb.lang', e.target.value);", to: '', app, grep: 'переключение темы' },
  { name: 'web: object URLs never revoked', file: 'web/app/main.js', from: '  app.platform.revoke(app.jobs[i].result);', to: '', app, grep: '20 прогонов' },
  { name: 'web: tools menu under the drop zone', file: 'web/app.css', from: '.top { position: relative; z-index: 30; }', to: '', app: 'tests/web/mesh.spec.js', grep: 'текст в 3D' },
  { name: 'web: lithophane target not switched to STL', file: 'web/app/panel.js', from: "j.to = v ? (MESH_TARGETS.includes(j.to) ? j.to : 'stl')", to: "j.to = v ? j.to", app: 'tests/web/mesh.spec.js', grep: 'литофания' },
];
