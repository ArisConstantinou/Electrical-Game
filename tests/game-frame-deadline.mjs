import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual scheduling loop with an independently controlled RAF
// timestamp and execution clock. No renderer or gameplay implementation is mocked into the loop.
const source = process.env.FRAME_TEST_BASE_REF
  ? execFileSync('git', ['show', `${process.env.FRAME_TEST_BASE_REF}:src/core/Game.ts`], { encoding: 'utf8' })
  : await readFile('src/core/Game.ts', 'utf8');
const start = source.indexOf('  private loop = (time: number): void => {');
assert(start >= 0);
const loop = source.slice(start, source.lastIndexOf('\n}'));
assert(loop.trimEnd().endsWith('};'), 'The fixture must contain the complete production loop');
const code = ts.transpileModule(`class LoopFixture { ${loop} } globalThis.LoopFixture = LoopFixture;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText;
let now = 1002, queued = 0, workMs = 4;
const sandbox = { performance: { now: () => now }, document: { hidden: false },
  requestAnimationFrame: () => ++queued, console };
vm.runInNewContext(code, sandbox);
const game = new sandbox.LoopFixture(), steps = [];
Object.assign(game, { lifecyclePaused: false, started: true, levelEditor: { active: false }, modelInspector: { active: false },
  renderer: { framePending: false, recoverFromFrameError: () => false }, waterProTask: false,
  nextGameFrameAt: 1001, lastTime: 980, fpsFrames: 0, fpsWindowStart: 1000, hud: { updateFps: () => {} },
  step: (dt, waterDt, present, bodyDt) => { steps.push({ dt, waterDt, present, bodyDt }); now += workMs; } });

game.loop(1000); // RAF timestamp predates the deadline; execution time has already passed it.
assert.equal(steps.length, 1, 'Do not skip an available frame because its RAF timestamp is older than the finished-frame deadline');
assert.equal(steps[0].dt, .02, 'Keep RAF timestamps for simulation elapsed time');
assert.equal(game.nextGameFrameAt, 1006); assert.equal(queued, 1, 'Yield through RAF after rendering');

game.nextGameFrameAt = 1030; now = 1020; game.loop(1018);
assert.equal(steps.length, 1); assert.equal(game.lastTime, 1000, 'Retain elapsed time during an actual recovery wait');
now = 1031; workMs = 40; game.loop(1025);
assert.equal(steps.length, 2); assert.equal(game.nextGameFrameAt, 1087, 'Retain the existing bounded recovery interval after overloaded work');
now = 1080; game.loop(1078); assert.equal(steps.length, 2);
now = 1088; workMs = 4; game.loop(1085);
assert.equal(steps.length, 4); // 60 ms elapsed remains two bounded physics steps.
assert.equal(steps[2].present, false); assert.equal(steps[3].present, true);

game.renderer.framePending = true; now = 1110; game.loop(1100);
assert.equal(steps.length, 4); assert.equal(game.lastTime, 1085, 'Do not mutate the live scene while GPU passes are pending');
game.renderer.framePending = false; game.nextGameFrameAt = 0;
now = 2100; game.loop(2000);
assert.equal(steps.length, 9); assert(steps.slice(4).every(s => s.dt <= .05));
assert.equal(steps.slice(4).filter(s => s.present).length, 1, 'Render once after bounded catch-up steps');
assert.equal(queued, 7);
console.log('PASS: stale RAF timestamp cannot discard a ready frame; real overload wait, GPU guard, simulation elapsed time, bounded substeps and RAF yielding remain intact.');
