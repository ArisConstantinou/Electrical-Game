import { build } from 'esbuild';
import { mkdir,copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
// This optional maintainer command is not a CI/build prerequisite. CI consumes
// only the compiled, game-specific End Product component, never vendor source.
const vendor=process.argv[2]??resolve('../trials-underwater-fix/vendor/threejs-water-pro');
await mkdir('src/generated',{recursive:true});await mkdir('public/licenses',{recursive:true});
await build({entryPoints:['src/systems/RoomWaterPro.entry.js'],outfile:'src/generated/room-water-runtime.js',bundle:true,minify:true,format:'esm',target:'es2022',platform:'browser',sourcemap:false,legalComments:'inline',external:['three','three/*'],alias:{'threejs-water-pro':resolve(vendor,'build/index.js')},banner:{js:'/*! WIRE THE HOUSE compiled room water component. Includes Water Pro 3.5.1, Copyright 2025-2026 DRG Software Solutions LLC. Licensed for this End Product; see /Electrical-Game/licenses/WATER-PRO-LICENSE.txt. */'}});
await copyFile(resolve(vendor,'LICENSE.md'),'public/licenses/WATER-PRO-LICENSE.txt');
