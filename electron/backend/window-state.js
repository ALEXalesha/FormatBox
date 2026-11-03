// Размер и место окна между запусками. Закон: окно всегда видно хотя бы на одном экране и не меньше минимума.
import fs from 'node:fs';

export const MIN = { width: 380, height: 520 };
export const DEFAULT = { width: 1180, height: 800 };

export function loadState(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    const num = (v) => (Number.isFinite(v) ? Math.round(v) : undefined);
    return { width: num(s.width), height: num(s.height), x: num(s.x), y: num(s.y), maximized: s.maximized === true };
  } catch {
    return { ...DEFAULT, maximized: false };
  }
}

export function saveState(file, state) {
  const { width, height, x, y, maximized } = state;
  fs.writeFileSync(file, JSON.stringify({ width, height, x, y, maximized: Boolean(maximized) }));
}

const overlap = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

// displays - рабочие области экранов [{ x, y, width, height }], первый - основной
export function fitToDisplays(state, displays) {
  const main = displays[0];
  let width = Math.min(Math.max(state.width || DEFAULT.width, MIN.width), Math.max(...displays.map((d) => d.width)));
  let height = Math.min(Math.max(state.height || DEFAULT.height, MIN.height), Math.max(...displays.map((d) => d.height)));
  let { x, y } = state;
  const box = { x, y, width, height };
  const best = Number.isFinite(x) && Number.isFinite(y) ? displays.reduce((acc, d) => (overlap(box, d) > overlap(box, acc) ? d : acc), displays[0]) : null;
  // видна меньше чем на 100x60 - ставим по центру основного экрана
  if (!best || overlap(box, best) < 100 * 60) {
    width = Math.min(width, main.width); height = Math.min(height, main.height);
    x = Math.round(main.x + (main.width - width) / 2);
    y = Math.round(main.y + (main.height - height) / 2);
  } else {
    width = Math.min(width, best.width); height = Math.min(height, best.height);
    x = Math.min(Math.max(x, best.x), best.x + best.width - width);
    y = Math.min(Math.max(y, best.y), best.y + best.height - height);
  }
  return { width, height, x, y, maximized: Boolean(state.maximized) };
}
