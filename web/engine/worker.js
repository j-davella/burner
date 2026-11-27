// Web Worker: runs engine/jobs.js off the UI thread. Message in: {id, op, args}.
// Out: {id, progress, stage} while working, then {id, ok, res} or {id, ok:false, err}.
import { runJob, transferables } from './jobs.js';

self.onmessage = e => {
  const { id, op, args } = e.data;
  let last = 0;
  const progress = (f, stage) => {
    const t = performance.now();
    if (t - last < 60 && f < 1) return;          // ~16 updates/s is plenty
    last = t; self.postMessage({ id, progress: f, stage });
  };
  try {
    const res = runJob(op, args, progress);
    self.postMessage({ id, ok: true, res }, transferables(res));
  } catch (err) {
    self.postMessage({ id, ok: false, err: String(err && err.message || err) });
  }
};
