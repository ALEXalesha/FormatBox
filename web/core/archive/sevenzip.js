// 7-Zip (7z-wasm): упаковка и распаковка 7z, распаковка rar, xz, bz2 (и zip64 и прочих редких zip).
// Экземпляр - на каждый вызов: файловая система внутри чистая, а после сбоя wasm не переиспользуется.
import { checkAbort } from './entries.js';

async function load() {
  const errors = [];
  const factory = (await import('../../vendor/7zz.js')).default;
  const z = await factory({ print() {}, printErr(s) { errors.push(s); } });
  z.errors = errors;
  return z;
}

function run(z, args) {
  let code;
  try {
    code = z.callMain(args);
  } catch (e) {
    // при фатальной ошибке wasm бросает число (указатель на исключение C++)
    if (typeof e !== 'number') throw e;
    code = -1;
  }
  if (code !== 0) {
    const msg = z.errors.map((s) => s.trim()).filter(Boolean).join(' ');
    throw new Error(`7z: ${msg || `exit code ${code}`}`);
  }
}

// bytes - архив; fileName - имя с правильным расширением (по нему 7-Zip называет файл внутри .xz/.bz2)
export async function extract7z(bytes, fileName, { signal } = {}) {
  checkAbort(signal);
  const z = await load();
  z.FS.mkdir('/in');
  z.FS.mkdir('/out');
  z.FS.writeFile(`/in/${fileName}`, bytes);
  // -aou: одинаковые имена не перетираются; -p: пустой пароль вместо вопроса в консоль
  run(z, ['x', `/in/${fileName}`, '-o/out', '-aou', '-p', '-bd', '-y']);
  checkAbort(signal);
  return walkAll(z, '/out');
}

function walkAll(z, root) {
  const out = [];
  const visit = (rel) => {
    for (const name of z.FS.readdir(rel ? `${root}/${rel}` : root)) {
      if (name === '.' || name === '..') continue;
      const path = rel ? `${rel}/${name}` : name;
      const st = z.FS.lstat(`${root}/${path}`);
      const mtime = new Date(st.mtime);
      if (z.FS.isDir(st.mode)) {
        out.push({ path, data: new Uint8Array(0), mtime, dir: true });
        visit(path);
      } else if (z.FS.isFile(st.mode)) {
        out.push({ path, data: z.FS.readFile(`${root}/${path}`), mtime, dir: false });
      }
    }
  };
  visit('');
  return out;
}

// entries - нормализованные записи (родительские папки уже есть, пути безопасны)
export async function pack7z(entries, { level = 6, signal, progress } = {}) {
  checkAbort(signal);
  const z = await load();
  z.FS.mkdir('/in');
  for (const [i, e] of entries.entries()) {
    checkAbort(signal);
    progress?.((0.5 * (i + 1)) / entries.length);
    if (e.dir) z.FS.mkdirTree(`/in/${e.path}`);
    else {
      const slash = e.path.lastIndexOf('/');
      if (slash > 0) z.FS.mkdirTree(`/in/${e.path.slice(0, slash)}`);
      z.FS.writeFile(`/in/${e.path}`, e.data);
    }
  }
  // время ставим в конце и от глубоких к верхним: запись файла меняет время папки
  for (const e of [...entries].reverse()) z.FS.utime(`/in/${e.path}`, e.mtime.getTime(), e.mtime.getTime());
  z.FS.chdir('/in');
  run(z, ['a', '-t7z', `-mx=${Math.max(0, Math.min(9, level))}`, '-bd', '-y', '/out.7z', '.']);
  checkAbort(signal);
  return z.FS.readFile('/out.7z');
}
