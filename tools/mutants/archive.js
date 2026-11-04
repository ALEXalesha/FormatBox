const LAWS = 'tests/core/archive-laws.test.js';
const CASES = 'tests/core/archive-cases.test.js';

export default [
  { name: 'archive: tar loses non-ASCII names (no pax path)', file: 'web/core/archive/tar.js', from: "if (!split) pax.push(paxRecord('path', path));", to: "if (false) pax.push(paxRecord('path', path));", test: LAWS },
  { name: 'archive: tar ustar prefix ignored on read', file: 'web/core/archive/tar.js', from: 'if (prefix) path = `${prefix}/${path}`;', to: 'if (false) path = `${prefix}/${path}`;', test: LAWS },
  { name: 'archive: tar mtime not written', file: 'web/core/archive/tar.js', from: 'putOctal(h, 136, 12, mtimeSec);', to: 'putOctal(h, 136, 12, 0);', test: LAWS },
  { name: 'archive: zip exact time field (UT) ignored on read', file: 'web/core/archive/zip.js', from: 'if (extra[0x5455]?.length >= 5 && (extra[0x5455][0] & 1)) {', to: 'if (false) {', test: LAWS },
  { name: 'archive: zip exact time field (UT) not written', file: 'web/core/archive/zip.js', from: 'extra: { 0x5455: utField(ms) },', to: 'extra: {},', test: LAWS },
  { name: 'archive: zip folders read as files', file: 'web/core/archive/zip.js', from: "const dir = path.endsWith('/') || (attrs & 0x10) !== 0 || ((attrs >>> 16) & 0o170000) === 0o40000;", to: 'const dir = false;', test: LAWS },
  { name: 'archive: zip stored data shares memory with the input', file: 'web/core/archive/zip.js', from: 'method === 0 ? raw.slice() :', to: 'method === 0 ? raw :', test: LAWS },
  { name: 'archive: zip-slip - .. kept in paths', file: 'web/core/archive/entries.js', from: "if (p === '' || p === '.' || p === '..') continue;", to: "if (p === '' || p === '.') continue;", test: LAWS },
  { name: 'archive: zip-slip - backslashes kept', file: 'web/core/archive/entries.js', from: "String(raw).replace(/\\\\/g, '/').split('/')", to: "String(raw).split('/')", test: LAWS },
  { name: 'archive: duplicate names overwrite each other', file: 'web/core/archive/entries.js', from: 'for (let n = 2; taken.has(path.toLowerCase()); n++) path = withSuffix(f.path, n);', to: '', test: LAWS },
  { name: 'archive: 7z times not set before packing', file: 'web/core/archive/sevenzip.js', from: 'for (const e of [...entries].reverse()) z.FS.utime(', to: 'for (const e of []) z.FS.utime(', test: LAWS },
  { name: 'archive: 7z empty folders lost', file: 'web/core/archive/sevenzip.js', from: "out.push({ path, data: new Uint8Array(0), mtime, dir: true });\n        visit(path);", to: 'visit(path);', test: LAWS },
  { name: 'archive: tar.gz not recognized without a name', file: 'web/core/archive/index.js', from: "named(name, 'tar.gz') || isTar(peekGzip(bytes))", to: "named(name, 'tar.gz')", test: LAWS },
  { name: 'archive: repack ignores the target format', file: 'web/core/archive/index.js', from: 'return pack(await extract(bytes, name, { signal: opts.signal }), toFormat, opts);', to: "return pack(await extract(bytes, name, { signal: opts.signal }), 'zip', opts);", test: LAWS },
  { name: 'archive: zip CRC not checked', file: 'web/core/archive/zip.js', from: 'if (data.length !== size || crc32(data) !== crc)', to: 'if (data.length !== size)', test: CASES },
  { name: 'archive: cp866 names decoded as latin1', file: 'web/core/archive/entries.js', from: "return new TextDecoder('ibm866').decode(bytes);", to: "return new TextDecoder('latin1').decode(bytes);", test: CASES },
  { name: 'archive: rar packing pretends to work', file: 'web/core/archive/index.js', from: "if (format === 'rar') throw new Error(", to: "if (format === 'rar') format = 'zip'; if (false) throw new Error(", test: CASES },
];
