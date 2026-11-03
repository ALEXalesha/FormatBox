import test from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../../web/core/rand.js';
import { createQueue } from '../../web/core/queue.js';

const wait = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); });
});

test('закон: одновременно работает не больше concurrency, каждое задание кончается ровно один раз (зерно 7)', async () => {
  const r = rng(7);
  for (let round = 0; round < 20; round++) {
    const concurrency = r.int(1, 3);
    let now = 0, peak = 0;
    const finished = new Map();
    const q = createQueue({
      concurrency,
      run: async (job, { signal, progress }) => {
        now += 1; peak = Math.max(peak, now);
        try {
          progress(0.5);
          await wait(job.input.ms, signal);
          if (job.input.fail) throw new Error('boom');
          return job.input.ms;
        } finally { now -= 1; }
      },
      onChange: (job) => { if (['done', 'failed', 'canceled'].includes(job.state)) finished.set(job.id, (finished.get(job.id) || 0) + 1); },
    });
    const ids = Array.from({ length: r.int(1, 8) }, () => q.add({ ms: r.int(0, 4), fail: r() < 0.2 }));
    const toCancel = ids.filter(() => r() < 0.3);
    for (const id of toCancel) q.cancel(id);
    await q.idle();
    assert.ok(peak <= concurrency);
    for (const id of ids) assert.equal(finished.get(id), 1, `задание ${id}`);
    for (const job of q.list()) {
      if (toCancel.includes(job.id)) assert.ok(['canceled', 'done', 'failed'].includes(job.state));
      if (job.state === 'done') assert.equal(job.progress, 1);
      if (job.state === 'failed') assert.equal(job.error, 'boom');
    }
  }
});

test('отмена идущего, отмена всего, очистка готовых', async () => {
  const q = createQueue({ run: (job, { signal }) => wait(50, signal) });
  const a = q.add({}); const b = q.add({});
  assert.equal(q.running, 1);
  assert.equal(q.cancel(999), false);
  q.cancelAll();
  await q.idle();
  assert.deepEqual(q.list().map((j) => j.state), ['canceled', 'canceled']);
  assert.equal(q.cancel(a), false);
  q.clearFinished();
  assert.equal(q.list().length, 0);
  assert.ok(b > a);
});

test('ошибка без message и отмена без исключения', async () => {
  const q = createQueue({ run: async (job, { signal }) => { if (job.input.raw) throw 'plain'; job.ctl.abort(); return signal.aborted; } });
  q.add({ raw: true }); q.add({});
  await q.idle();
  const [x, y] = q.list();
  assert.equal(x.error, 'plain');
  assert.equal(y.state, 'canceled');
});
