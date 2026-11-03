// Вызовы ядра в отдельном потоке. Отмена - поток убивается целиком и при следующем вызове создаётся заново.
let worker = null;
let seq = 0;
const pending = new Map();

function spawn() {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const call = pending.get(data.id);
    if (!call) return;
    if (data.progress != null) { call.progress?.(data.progress); return; }
    pending.delete(data.id);
    if (data.error) call.reject(Object.assign(new Error(data.error), { detail: data.detail }));
    else call.resolve(data.result);
  };
  worker.onerror = (e) => {
    for (const call of pending.values()) call.reject(new Error(e.message || 'worker-crashed'));
    pending.clear();
    worker = null;
  };
}

export function callWorker(op, args, { signal, progress, transfer = [] } = {}) {
  if (signal?.aborted) return Promise.reject(new Error('canceled'));
  if (!worker) spawn();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const kill = () => {
      pending.delete(id);
      reject(new Error('canceled'));
      // остальные вызовы в этом потоке тоже прерываются - очередь их перезапустит
      for (const call of pending.values()) call.reject(new Error('canceled'));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
    signal?.addEventListener('abort', kill, { once: true });
    pending.set(id, {
      progress,
      resolve: (v) => { signal?.removeEventListener('abort', kill); resolve(v); },
      reject: (e) => { signal?.removeEventListener('abort', kill); reject(e); },
    });
    worker.postMessage({ id, op, args }, transfer);
  });
}

export function workerAlive() { return Boolean(worker); }
