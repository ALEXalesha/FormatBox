// Проверка проверок: нарочно ломаем код в одном месте и ждём, что упадёт нужный тест.
// Мутант, после которого тесты зелёные, - дыра в законах. Файл всегда возвращается назад.
//   node tools/mutate.js          все мутанты
//   node tools/mutate.js audio    только те, где в имени есть «audio»
// Списки мутантов - tools/mutants/*.js (у каждой части свой). Мутант с полем app проверяется
// тестом окна (Playwright) с отбором -g grep, остальные - node --test одним файлом.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'tools', 'mutants');
const MUTANTS = [];
for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.js')).sort()) {
  const mod = await import(pathToFileURL(path.join(DIR, f)).href);
  MUTANTS.push(...mod.default, ...(mod.windowMutants || []));
}

const filter = process.argv[2] || '';
let caught = 0, total = 0;
const missed = [];
for (const m of MUTANTS) {
  if (filter && !m.name.includes(filter)) continue;
  total += 1;
  const file = path.join(ROOT, m.file);
  const orig = fs.readFileSync(file, 'utf8');
  const count = orig.split(m.from).length - 1;
  if (count !== 1) { console.log(`??  ${m.name}: pattern found ${count} times - fix the mutant`); missed.push(m.name); continue; }
  try {
    fs.writeFileSync(file, orig.replace(m.from, m.to));
    const args = m.app
      ? [path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', `--config=${m.config || 'playwright.web.config.js'}`, '--workers=1', '--retries=0', m.app, '-g', m.grep]
      : ['--test', '--test-concurrency=1', m.test];
    const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout: 900000 });
    if (r.status !== 0) { caught += 1; console.log(`ok  ${m.name}`); }
    else { console.log(`!!  ${m.name}: tests stayed green`); missed.push(m.name); }
  } finally {
    fs.writeFileSync(file, orig);
  }
}
console.log(`${caught}/${total} mutants caught`);
process.exit(caught === total ? 0 : 1);
