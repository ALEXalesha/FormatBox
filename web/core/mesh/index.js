// 3D-часть ядра FormatBox: всё, что нужно окну и Worker.
export { readMesh, writeMesh, readStl, writeStl, readObj, writeObj, readPly, writePly, MESH_FORMATS } from './io.js';
export { read3mf, write3mf, readGlb, writeGlb } from './io-pack.js';
export { analyzeMesh, repairMesh, isWatertight, weldVertices, loadManifold } from './repair.js';
export { decimate } from './decimate.js';
export { bounds, volume, surfaceArea, meshStats, scaleMesh, convertUnits, printEstimate, UNITS, MATERIALS } from './measure.js';
export { renderPreview } from './preview.js';
export { lithophane, relief, toGray, downsample } from './litho.js';
export { imageToMask, extrudeSilhouette, extrudeMask, despeckle } from './silhouette.js';
export { traceRings, simplifyRing, dilate, erode } from './contours.js';
export { colorChangeHeights, insertColorChanges, findLayers } from './colorlayers.js';
export { textToMesh, textMask } from './text3d.js';
export { hasGlyph } from './font.js';
export { box, sphere, torus, cylinder } from './primitives.js';
export { mergeMeshes, transformMesh, weldExact, emptyMesh } from './common.js';
