export default [
  { name: 'names: existing file overwritten', file: 'web/core/names.js', from: 'for (let i = 2; low.has(name.toLowerCase()); i++)', to: 'for (let i = 2; false; i++)', test: 'tests/core/names.test.js' },
  { name: 'names: case ignored on check', file: 'web/core/names.js', from: 'new Set([...taken].map((n) => n.toLowerCase()))', to: 'new Set(taken)', test: 'tests/core/names.test.js' },
  { name: 'queue: no limit on running jobs', file: 'web/core/queue.js', from: 'while (active < concurrency)', to: 'while (true)', test: 'tests/core/queue.test.js' },
  { name: 'queue: canceled job reported as done', file: 'web/core/queue.js', from: "job.state = job.ctl.signal.aborted ? 'canceled' : 'done';", to: "job.state = 'done';", test: 'tests/core/queue.test.js' },
];
