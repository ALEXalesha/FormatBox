// Порог покрытия по ветвям: ядро (web/core) >= 90 %, весь код без окон (ядро + electron/backend) >= 80 %.
// Читает coverage/coverage-summary.json после `npm run cover`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const summary = JSON.parse(fs.readFileSync(path.join(ROOT, 'coverage', 'coverage-summary.json'), 'utf8'));
const sum = (filter) => {
  let covered = 0, total = 0;
  for (const [file, s] of Object.entries(summary)) {
    if (file === 'total' || !filter(path.relative(ROOT, file).split(path.sep).join('/'))) continue;
    covered += s.branches.covered; total += s.branches.total;
  }
  return total ? (covered / total) * 100 : 100;
};
const core = sum((f) => f.startsWith('web/core/'));
const all = sum((f) => f.startsWith('web/core/') || f.startsWith('electron/backend/'));
console.log(`branches: core ${core.toFixed(2)} % (need 90), all non-window ${all.toFixed(2)} % (need 80)`);
if (core < 90 || all < 80) process.exit(1);
