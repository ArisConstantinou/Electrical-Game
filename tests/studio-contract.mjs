import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../studio.webgame.json', import.meta.url), 'utf8'));
const source = await readFile(new URL('../src/studio/webGameStudioAdapter.ts', import.meta.url), 'utf8');
const config = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
const failures = [];
if (manifest.format !== 'web-game-studio-linked-game' || manifest.version !== 1) failures.push('linked-game format/version');
if (manifest.runtime.port !== 5362 || manifest.runtime.strictPort !== true) failures.push('strict runtime port');
if (manifest.runtime.entrypoints[0]?.route !== '/Electrical-Game/?studio=1') failures.push('Studio entry route');
for (const capability of ['object-transforms', 'materials', 'cameras-lights', 'animations', 'physics-bodies', 'physics-colliders', 'physics-joints', 'gameplay-state', 'save-overrides']) if (!manifest.adapter.capabilities.includes(capability)) failures.push(`adapter capability ${capability}`);
for (const token of ['studio/hello', 'studio/snapshot-request', 'studio/patch', 'adapter/patch-ack']) if (!source.includes(token)) failures.push(`adapter token ${token}`);
if (!config.includes("base: '/Electrical-Game/'")) failures.push('Vite Pages base');
if (failures.length) throw new Error(`Studio contract failed: ${failures.join(', ')}`);
console.log('Studio linked-game contract: 10/10 checks passed');
