# FormatBox

**Planned.** A file converter for everything at once: video, audio, images, documents and 3D. Squeeze a file or
a video to a set size in MB or to a set number of pixels, stretch, shrink or crop to the size you need, and see the
result before saving. One code base: a web version (in the browser, no upload) and a desktop version with the real
ffmpeg for big files.

[![Status](https://img.shields.io/badge/status-planned-lightgrey)](#) [![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/docs/Web/JavaScript) [![Electron](https://img.shields.io/badge/Electron-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/) [![Built with Claude Code](https://img.shields.io/badge/Built_with-Claude_Code-D97757?logo=claude&logoColor=white)](https://claude.com/claude-code)

Code, tests and docs are written by Claude (Anthropic) in Claude Code. Ideas, testing and decisions - Alexey.

[Русская версия](README.ru.md)

## Status

There is no code yet. The plan was agreed on 23.10.2026 and the work is queued. This README describes the plan,
not a working program.

## What it will do

| Group | What |
|---|---|
| Video and audio | Any common format to any other, size to N MB (two-pass bitrate), resolution, cut, audio from video |
| Images | Formats including HEIC and WebP, size to N MB or N pixels, stretch / shrink / crop, quality slider with preview |
| Documents | PDF, DOCX, ODT, TXT and others; the desktop version uses LibreOffice (downloaded with one button if missing) |
| 3D | Lithophane from a photo (flat, curved, cylinder night light), relief from a height map, picture outline to an extruded shape (keychain, sign, cookie cutter, stencil), mesh repair (holes, normals, self-intersections, extra shells, watertight) |

## How it will work

- Web version: ffmpeg.wasm and browser APIs, files never leave the computer.
- Desktop version (Electron): the real ffmpeg, LibreOffice for documents, faster and without size limits.
- Heavy work runs in a worker or a separate process and can be cancelled; source files are never changed in place,
  and a result never overwrites an existing file.
- Five themes, Russian and English, a narrow window works.

## License

MIT, see [LICENSE](LICENSE).
