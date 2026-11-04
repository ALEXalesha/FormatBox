// Мутанты 3D-части: каждый закон из tests/core/mesh-*.test.js ловит свою поломку
const T = (name) => `tests/core/mesh-${name}.test.js`;
const F = (name) => `web/core/mesh/${name}.js`;

export default [
  // чтение и запись
  { name: 'mesh: float32 is written with 6 digits only', file: F('common'), from: 'if (Math.fround(+s) === x) return String(+s);', to: 'return String(+s);', test: T('io') },
  { name: 'mesh: GLB mirrors the model on write', file: F('io-pack'), from: 'pos[i + 2] = -p[i + 1] / 1000;', to: 'pos[i + 2] = p[i + 1] / 1000;', test: T('io') },
  { name: 'mesh: 3MF inch unit ignored', file: F('io-pack'), from: 'inch: UNITS.in,', to: 'inch: 1,', test: T('io') },
  { name: 'mesh: STL faces not welded on read', file: F('io'), from: 'return opts.merge === false ? mesh : weldExact(mesh);', to: 'return mesh;', test: T('io') },
  { name: 'mesh: OBJ polygon fan loses triangles', file: F('io'), from: 'for (let k = 1; k + 1 < face.length; k++) idx.push(face[0], face[k], face[k + 1]);', to: 'if (face.length >= 3) idx.push(face[0], face[1], face[2]);', test: T('io') },
  // ремонт
  { name: 'mesh: repair does not fill holes', file: F('repair'), from: "if (opts.fillHoles !== false) {", to: 'if (false) {', test: T('repair') },
  { name: 'mesh: repair does not turn shells outward', file: F('repair'), from: 'const turn = (s.volume < 0) !== (s.depth % 2 === 1);', to: 'const turn = false;', test: T('repair') },
  { name: 'mesh: repair keeps duplicate faces', file: F('repair'), from: 'if (dup[f]) { report.removedDuplicates += 1; continue; }', to: '', test: T('repair') },
  { name: 'mesh: repair welds nothing by default', file: F('repair'), from: 'opts.tolerance ?? diag * 1e-5', to: 'opts.tolerance ?? 0', test: T('repair') },
  { name: 'mesh: repair drops intact small meshes', file: F('repair'), from: 'const minFaces = opts.minShellFaces ?? 4;', to: 'const minFaces = opts.minShellFaces ?? 100;', test: T('repair') },
  { name: 'mesh: watertight check ignores missing reverse edge', file: F('topology'), from: 'if (count(u, v) !== 1 || count(v, u) !== 1) return false;', to: 'if (count(u, v) !== 1) return false;', test: T('repair') },
  { name: 'mesh: overlapping shells not merged', file: F('repair'), from: "if (mode === true || (mode === 'auto' && crossing)) {", to: 'if (mode === true) {', test: T('repair') },
  // упрощение
  { name: 'mesh: decimate stops above the target', file: F('decimate'), from: 'while (alive > goal && heap.size) {', to: 'while (alive > goal + 8 && heap.size) {', test: T('decimate') },
  { name: 'mesh: decimate ignores the link condition', file: F('decimate'), from: 'if (common !== shared) return false;', to: '', test: T('decimate') },
  { name: 'mesh: decimate quadrics without weight', file: F('decimate'), from: 'for (let k = 0; k < 3; k++) addPlane(Q, F[3 * f + k], a, b, c, d, len / 2);', to: '', test: T('decimate') },
  // обмеры
  { name: 'mesh: inch is 25 mm', file: F('measure'), from: 'in: 25.4, inch', to: 'in: 25, inch', test: T('measure') },
  { name: 'mesh: full infill misses walls', file: F('measure'), from: 'const used = shell + (vol - shell) * fill;', to: 'const used = shell * fill + (vol - shell) * fill;', test: T('measure') },
  { name: 'mesh: infill above walls only', file: F('measure'), from: 'const shell = Math.min(vol, surfaceArea(mesh) * Math.max(0, wallMm));', to: 'const shell = surfaceArea(mesh) * Math.max(0, wallMm);', test: T('measure') },
  // картинка
  { name: 'mesh: preview without margin', file: F('preview'), from: 'const margin = opts.margin ?? Math.max(2, Math.round(Math.min(W, H) * 0.05));', to: 'const margin = opts.margin ?? 0;', test: T('preview') },
  { name: 'mesh: preview without z-buffer', file: F('preview'), from: 'if (z <= zbuf[k]) continue;', to: '', test: T('preview') },
  { name: 'mesh: preview paints empty mesh', file: F('preview'), from: 'for (let i = 0; i < W * H; i++) data.set(bg, 4 * i);', to: 'for (let i = 1; i < W * H; i++) data.set(bg, 4 * i);', test: T('preview') },
  // литофан
  { name: 'mesh: lithophane side walls missing', file: F('litho'), from: 'b.quad(T(0, j), T(0, j + 1), B(0, j + 1), B(0, j));', to: '', test: T('litho') },
  { name: 'mesh: lithophane thickness overshoots', file: F('litho'), from: '((invert ? v : 255 - v) / 255) * (maxMm - minMm)', to: '((invert ? v : 255 - v) / 200) * (maxMm - minMm)', test: T('litho') },
  { name: 'mesh: lithophane width ignores border', file: F('litho'), from: 'const inner = widthMm - 2 * borderMm;', to: 'const inner = widthMm - borderMm;', test: T('litho') },
  { name: 'mesh: lithophane never downsamples', file: F('litho'), from: 'if (!maxPixels || w * h <= maxPixels) return img;', to: 'return img;', test: T('litho') },
  { name: 'mesh: cylinder radius ignores thickness', file: F('litho'), from: 'const R = widthMm / 2 - maxMm;', to: 'const R = widthMm / 2;', test: T('litho') },
  { name: 'mesh: relief height ignores base', file: F('litho'), from: 'const value = (v) => baseMm + ((invert ? 255 - v : v) / 255) * heightMm;', to: 'const value = (v) => 1 + ((invert ? 255 - v : v) / 255) * heightMm;', test: T('litho') },
  // силуэт
  { name: 'mesh: silhouette wall triangle missing', file: F('silhouette'), from: 'b.tri(hi[j], lo[i], lo[j]);', to: '', test: T('silhouette') },
  { name: 'mesh: silhouette height short', file: F('silhouette'), from: 'let base = m, top = null, baseH = heightMm, topH = 0;', to: 'let base = m, top = null, baseH = heightMm * 0.9, topH = 0;', test: T('silhouette') },
  { name: 'mesh: silhouette scale off by a pixel', file: F('silhouette'), from: '(opts.widthMm ?? 50) / (box.x1 - box.x0 + 1)', to: '(opts.widthMm ?? 50) / (box.x1 - box.x0 + 3)', test: T('silhouette') },
  { name: 'mesh: holes lose their outline', file: F('contours'), from: 'if (owner) polys.get(owner).holes.push(hole);', to: '', test: T('silhouette') },
  { name: 'mesh: distance transform keeps first parabola', file: F('contours'), from: 'while (z[k + 1] < q) k += 1;', to: 'while (z[k + 1] < q - 1) k += 1;', test: T('silhouette') },
  { name: 'mesh: cookie flange touches the wall', file: F('silhouette'), from: 'erode(m, 1.5), (a, b) => a & (1 - b));', to: 'erode(m, 0.5), (a, b) => a & (1 - b));', test: T('silhouette') },
  // цветные слои
  { name: 'mesh: color change one layer late', file: F('colorlayers'), from: 'const layer = layers.find((l) => l.z >= z - 1e-6);', to: 'const layer = layers.find((l) => l.z > z + 1e-6);', test: T('colorlayers') },
  { name: 'mesh: retraction counted as extrusion', file: F('colorlayers'), from: 'const extrudes = relative ? w.E > 0 : w.E > e;', to: 'const extrudes = true;', test: T('colorlayers') },
  { name: 'mesh: one color change too many', file: F('colorlayers'), from: 'Array.from({ length: Math.max(0, n - 1) }', to: 'Array.from({ length: Math.max(0, n) }', test: T('colorlayers') },
  // текст
  { name: 'mesh: text letters drawn on top of each other', file: F('text3d'), from: 'cx += g[0].length + letterGap;', to: 'cx += letterGap;', test: T('text') },
  { name: 'mesh: text plate touches the letters', file: F('silhouette'), from: 'return combine(erode(dilate(m, margin + 0.5 + c), c), dilate(m, margin + 0.5), (a, b) => a | b);', to: 'return combine(erode(dilate(m, c), c), m, (a, b) => a | b);', test: T('text') },
  { name: 'mesh: keychain text falls apart', file: F('text3d'), from: 'closeMm: opts.closeMm ?? heightMm * 0.5,', to: 'closeMm: opts.closeMm ?? 0,', test: T('text') },
];
