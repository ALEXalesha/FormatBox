// Очередь заданий: по одному (или N) за раз, отмена любого, ход в процентах.
// run(job, { signal, progress }) - сама работа; очередь только следит за порядком и состояниями.
export function createQueue({ run, concurrency = 1, onChange = () => {} }) {
  const jobs = [];
  let nextId = 1;
  let active = 0;

  const emit = (job) => onChange(job, jobs);

  function pump() {
    while (active < concurrency) {
      const job = jobs.find((j) => j.state === 'waiting');
      if (!job) return;
      start(job);
    }
  }

  async function start(job) {
    active += 1;
    job.state = 'running';
    job.ctl = new AbortController();
    emit(job);
    try {
      const progress = (p) => { job.progress = Math.max(0, Math.min(1, p)); emit(job); };
      job.result = await run(job, { signal: job.ctl.signal, progress });
      job.state = job.ctl.signal.aborted ? 'canceled' : 'done';
      if (job.state === 'done') job.progress = 1;
    } catch (err) {
      job.state = job.ctl.signal.aborted ? 'canceled' : 'failed';
      job.error = err && err.message ? err.message : String(err);
    } finally {
      active -= 1;
      job.ctl = null;
      emit(job);
      pump();
    }
  }

  return {
    add(input) {
      const job = { id: nextId++, input, state: 'waiting', progress: 0, result: null, error: null, ctl: null };
      jobs.push(job);
      emit(job);
      pump();
      return job.id;
    },
    cancel(id) {
      const job = jobs.find((j) => j.id === id);
      if (!job) return false;
      if (job.state === 'waiting') { job.state = 'canceled'; emit(job); return true; }
      if (job.state === 'running' && job.ctl) { job.ctl.abort(); return true; }
      return false;
    },
    cancelAll() { for (const j of jobs) this.cancel(j.id); },
    clearFinished() {
      for (let i = jobs.length - 1; i >= 0; i--) if (!['waiting', 'running'].includes(jobs[i].state)) jobs.splice(i, 1);
    },
    list: () => jobs.slice(),
    get running() { return active; },
    idle() {
      return new Promise((resolve) => {
        const check = () => (jobs.some((j) => j.state === 'waiting' || j.state === 'running') ? setTimeout(check, 5) : resolve());
        check();
      });
    },
  };
}
