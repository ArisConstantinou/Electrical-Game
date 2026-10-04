import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('output/loading-35-recovery', { recursive: true });
await build({ entryPoints: ['src/core/StartupAsset.ts'], outfile: 'output/loading-35-recovery/startup-asset.mjs', format: 'esm', platform: 'node' });
const { loadStartupAsset, StartupAssetError } = await import('../output/loading-35-recovery/startup-asset.mjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const reports = [];

// A never-settling request must terminate all three attempts and cancel each one.
{
  const signals = [], urls = [];
  let guard;
  try {
    await assert.rejects(Promise.race([
      loadStartupAsset('/tree.glb', 'Courtyard tree', (url, signal) => {
        urls.push(url); signals.push(signal);
        return new Promise(() => {});
      }, { timeoutMs: 20 }),
      new Promise((_, reject) => { guard = setTimeout(() => reject(new Error('BUG: pending asset never reaches failure')), 2500); }),
    ]), error => error instanceof StartupAssetError && /Courtyard tree/.test(error.message));
  } finally { clearTimeout(guard); }
  assert.equal(urls.length, 3);
  assert(signals.every(signal => signal.aborted));
  assert.equal(new Set(urls).size, 3, 'A retry must not join the earlier pending request');
  reports.push('hung requests cancel after three bounded attempts');
}
{
  let attempts = 0;
  const signals = [];
  const value = await loadStartupAsset('/tree.glb', 'Courtyard tree', (_url, signal) => {
    signals.push(signal);
    if (++attempts === 1) return new Promise(resolve => setTimeout(() => resolve('late retired asset'), 80));
    return Promise.resolve('fresh asset');
  }, { timeoutMs: 20 });
  assert.equal(value, 'fresh asset');
  assert.equal(attempts, 2);
  assert.equal(signals[0].aborted, true);
  await delay(30);
  assert.equal(signals[1].aborted, false, 'Successful attempt deadline must be cleared');
  reports.push('transient deadline recovers and late completion stays retired');
}
{
  const cause = new Error('invalid GLB');
  let attempts = 0;
  await assert.rejects(loadStartupAsset('/tree.glb', 'Courtyard tree', async () => {
    attempts++; throw cause;
  }, { timeoutMs: 20 }), error => error instanceof StartupAssetError && error.cause === cause);
  assert.equal(attempts, 3);
  reports.push('ordinary parse/network failures retain bounded retries and cause');
}
{
  // Existing callers without deadlines retain their established load contract.
  assert.equal(await loadStartupAsset('/worker.glb', 'Worker model', async () => 'worker'), 'worker');
  reports.push('existing loaders remain compatible');
}
console.log(JSON.stringify({ passed: reports.length, cases: reports }));
