// Цветные слои по высоте: где менять пластик и как вставить паузу (M600) в готовый G-code.
import { bounds } from './measure.js';

// Высоты смены цвета. bands: число цветов, список цветов (равные полосы), список высот (мм) или [{ z, color }].
// Высота - верх первого слоя нового цвета, кратна толщине слоя.
export function colorChangeHeights(meshOrMaxZ, bands, layerHeight = 0.2) {
  const maxZ = typeof meshOrMaxZ === 'number' ? meshOrMaxZ : bounds(meshOrMaxZ).size[2];
  if (!(layerHeight > 0)) throw new Error('layerHeight must be positive');
  let raw;
  if (typeof bands === 'number' || (Array.isArray(bands) && typeof bands[0] === 'string')) {
    const n = typeof bands === 'number' ? Math.floor(bands) : bands.length;
    raw = Array.from({ length: Math.max(0, n - 1) }, (_, k) => ({ z: (maxZ * (k + 1)) / n, color: Array.isArray(bands) ? bands[k + 1] : undefined }));
  } else {
    raw = (bands ?? []).map((b) => (typeof b === 'number' ? { z: b } : { z: b.z, color: b.color }));
  }
  const out = [];
  for (const { z, color } of raw.sort((a, b) => a.z - b.z)) {
    const snapped = Math.round(Math.max(1, Math.round(z / layerHeight)) * layerHeight * 1e6) / 1e6;
    // смена на самом верху или повтор того же слоя ничего не даёт
    if (snapped >= maxZ - 1e-9 || out.some((o) => Math.abs(o.z - snapped) < 1e-9)) continue;
    out.push(color === undefined ? { z: snapped } : { z: snapped, color });
  }
  return out;
}

function words(line) {
  const code = line.split(';', 1)[0];
  const out = {};
  for (const m of code.matchAll(/([A-Za-z])\s*([-+]?\d*\.?\d+)/g)) out[m[1].toUpperCase()] = +m[2];
  return out;
}

// Слои G-code: [{ line, z }], line - номер строки, перед которой начинается слой.
// Понимает метки слайсеров (;LAYER_CHANGE + ;Z:, ;LAYER:n); без меток - по Z, на котором впервые пошла экструзия.
export function findLayers(gcode) {
  const lines = typeof gcode === 'string' ? gcode.split('\n') : gcode;
  const layers = [];
  if (lines.some((l) => /^\s*;(LAYER_CHANGE|LAYER:-?\d+)/.test(l))) {
    let pending = null;
    lines.forEach((raw, i) => {
      const l = raw.trim();
      if (/^;(LAYER_CHANGE|LAYER:-?\d+)/.test(l)) { pending = { line: i, z: null }; layers.push(pending); return; }
      if (!pending || pending.z !== null) return;
      const zc = /^;Z:\s*([-+]?\d*\.?\d+)/.exec(l);
      if (zc) { pending.z = +zc[1]; return; }
      const w = words(l);
      if ((w.G === 0 || w.G === 1) && w.Z !== undefined) pending.z = w.Z;
    });
    return layers.filter((x) => x.z !== null);
  }
  let z = 0, zLine = 0, last = -Infinity, e = 0, relative = false;
  lines.forEach((raw, i) => {
    const w = words(raw);
    if (w.M === 82) relative = false;
    else if (w.M === 83) relative = true;
    if (w.G === 92 && w.E !== undefined) e = w.E;
    if (w.G !== 0 && w.G !== 1) return;
    if (w.Z !== undefined && w.Z !== z) { z = w.Z; zLine = i; }
    if (w.E === undefined) return;
    const extrudes = relative ? w.E > 0 : w.E > e;
    if (!relative) e = w.E;
    if (extrudes && z > last + 1e-9) { layers.push({ line: zLine, z }); last = z; }
  });
  return layers;
}

// Вставить command перед первым слоем с Z >= каждой высоты. Остальные строки не трогаем.
// heights: числа или { z, color }. Высоты выше последнего слоя пропускаются.
export function insertColorChanges(gcode, heights, opts = {}) {
  const command = opts.command ?? 'M600';
  const eol = gcode.includes('\r\n') ? '\r\n' : '\n';
  const lines = gcode.split('\n');
  const layers = findLayers(lines);
  const before = new Map();
  for (const h of heights) {
    const z = typeof h === 'number' ? h : h.z;
    const layer = layers.find((l) => l.z >= z - 1e-6);
    if (!layer) continue;
    const text = command + (h.color ? ` ; color: ${h.color}` : '') + eol;
    before.set(layer.line, (before.get(layer.line) ?? '') + text);
  }
  return lines.map((l, i) => (before.get(i) ?? '') + l).join('\n');
}
