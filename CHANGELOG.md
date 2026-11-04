# Changelog

## 0.1.0 - not released

First version, written in one go in the cloud; waits for Alexey's check on a real computer.

- Web version (browser, offline after the first visit) and desktop version (Electron) from one code base.
- Video: any format to any, size up to N MB (two passes and retries), pixels up to N, resize, crop, part, rotate,
  mirror, mute, speed, frame rate, join, audio from video.
- Audio: bit depth 8/16/24/32 float, 8-96 kHz, mono/stereo, dither; console sound (NES, Game Boy, 16 bit);
  replay on a console (melody, bass, drums -> notes -> NES channels) with a 10-second preview.
- Images: PNG, JPG, WebP, AVIF, BMP, ICO, TIFF and HEIC input; size up to N bytes; quality slider with preview;
  background removal; watermark; EXIF removal without recompression.
- Documents: PDF, DOCX, ODT, MD, HTML, TXT built in; LibreOffice and pandoc on the desktop.
- Archives: ZIP, 7z, TAR, TAR.GZ pack and unpack; RAR, XZ, BZ2 unpack.
- 3D: STL, OBJ, 3MF, PLY, GLB; repair, decimation, units, weight and cost, preview; lithophane, relief, silhouette
  (keychain, sign, cookie cutter, stencil), color layers with M600, text to 3D.
- Queue with cancel, presets, five themes, Russian and English, narrow window, desktop window remembers its size.
- Tests: laws with seeds, branch coverage gate, mutants, Playwright for the web and Electron.
