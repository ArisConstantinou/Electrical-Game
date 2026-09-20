import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
await mkdir('output',{recursive:true});
await build({entryPoints:['src/core/FramePacer.ts'],outfile:'output/frame-pacer.mjs',bundle:true,format:'esm',platform:'node'});
const {FramePacer,readFrameRateLimit}=await import('../output/frame-pacer.mjs?'+Date.now());
for(const hz of [30,60,120,144,240])for(const limit of [15,60,120,0]){
  const pacer=new FramePacer(),times=[];
  for(let i=0;i<hz*10;i++){const t=i*1000/hz;if(pacer.accept(t,limit))times.push(t);}
  const expected=Math.min(hz,limit||hz)*10;
  assert(Math.abs(times.length-expected)<=1,`${hz} Hz / ${limit}: ${times.length}, expected ${expected}`);
  const gaps=times.slice(1).map((t,i)=>t-times[i]);
  assert(Math.max(...gaps)<=Math.ceil(hz/(limit||hz))*1000/hz+.01,'No accumulated drift or skipped cadence');
}
const pacer=new FramePacer();pacer.accept(0,60);assert(pacer.accept(2000,60));
assert(!pacer.accept(2001,60),'No catch-up burst after stall');pacer.reset();assert(pacer.accept(2001,60),'Resume immediately');
for(const saved of [null,'bad','30','Infinity','-1']){globalThis.localStorage={getItem:()=>saved};assert.equal(readFrameRateLimit(),60);}
for(const saved of ['0','60','120']){globalThis.localStorage={getItem:()=>saved};assert.equal(readFrameRateLimit(),Number(saved));}
globalThis.localStorage={getItem(){throw Error('blocked');}};assert.equal(readFrameRateLimit(),60);
console.log('PASS: 20 refresh/cap combinations, stall/reset, missing/corrupt/blocked storage.');
