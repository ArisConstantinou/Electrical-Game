import { execFileSync } from 'node:child_process';
import config from '../vite.config.ts';

// This published commit has the same runtime source as the protected preview
// used to reproduce the bugs. Build it in ignored output without another server.
const ref = process.env.LOADING_BASE_REF ?? '44a589fcc7445275ff353dfabaaf8371b7f18793';
const files = ['src/main.ts', 'src/core/Game.ts', 'src/core/StartupAsset.ts',
  'src/player/WorkerBody.ts', 'src/systems/ApprenticeSystem.ts', 'src/world/MansionCourtyard.ts'];
const originals = new Map(files.map(file =>
  [file, execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8' })]));
config.plugins = [{ name: 'protected-loading-baseline', enforce: 'pre', transform(_code, id) {
  const normalized = id.replaceAll('\\', '/').split('?')[0];
  for (const [file, code] of originals) if (normalized.endsWith(`/${file}`)) return { code, map: null };
}}, ...(config.plugins ?? [])];
config.build = { ...config.build, outDir: 'output/loading-35-recovery/baseline-dist' };
export default config;
