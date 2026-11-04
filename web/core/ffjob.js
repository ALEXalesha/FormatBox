// Одно задание ffmpeg - одинаково для ffmpeg.wasm (браузер) и настоящего ffmpeg (ПК).
// Платформа даёт три действия: probe() -> info, exec(args, { duration, onProgress }), outSize() -> байты результата.
import { buildFfmpeg, buildConcat, fitToSize } from './media.js';

export async function runMediaJob({ probe, exec, outSize, input, output, to, opts = {}, passlog = 'fb2pass', nullOutput = '-' }, { signal, progress = () => {} } = {}) {
  const info = await probe();
  if (!info.duration && !info.hasVideo && !info.hasAudio) throw new Error('not-media');
  const make = (extra) => {
    const plan = buildFfmpeg({ input, output, to, info, opts: { ...opts, passlog, nullOutput, ...extra } });
    if (plan.error) throw new Error(plan.error);
    return plan;
  };
  const runPlan = async (plan) => {
    for (let i = 0; i < plan.passes.length; i++) {
      if (signal?.aborted) throw new Error('canceled');
      await exec(plan.passes[i], { duration: plan.duration, onProgress: (p) => progress((i + p) / plan.passes.length) });
    }
    return outSize();
  };
  const first = make({});
  if (!opts.maxBytes) {
    const bytes = await runPlan(first);
    return { bytes, info, plan: first };
  }
  const fit = await fitToSize({
    maxBytes: opts.maxBytes,
    first,
    signal,
    encode: (videoKbps, audioKbps, attempt) => runPlan(attempt === 0 ? first : make({ maxBytes: null, forceVideoKbps: videoKbps, audioKbps })),
  });
  return { bytes: fit.bytes, info, plan: first, tries: fit.tries };
}

export async function runConcatJob({ probeAll, exec, outSize, inputs, output, to, opts = {} }, { signal, progress = () => {} } = {}) {
  const infos = await probeAll();
  const plan = buildConcat({ inputs, infos, output, to, opts });
  const run = async (p) => {
    if (signal?.aborted) throw new Error('canceled');
    await exec(p.passes[0], { duration: p.duration, onProgress: progress });
    return outSize();
  };
  if (!opts.maxBytes) return { bytes: await run(plan), infos, plan };
  const fit = await fitToSize({
    maxBytes: opts.maxBytes, first: plan, signal,
    encode: (videoKbps, audioKbps, attempt) => run(attempt === 0 ? plan : buildConcat({ inputs, infos, output, to, opts: { ...opts, forceVideoKbps: videoKbps, audioKbps } })),
  });
  return { bytes: fit.bytes, infos, plan };
}
