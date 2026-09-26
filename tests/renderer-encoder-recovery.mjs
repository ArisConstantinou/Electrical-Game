import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('output',{recursive:true});
await build({entryPoints:['src/core/Renderer.ts'],outfile:'output/renderer-encoder-bundle.mjs',bundle:true,format:'esm',platform:'node',external:['three','three/*']});
const {Renderer}=await import('../output/renderer-encoder-bundle.mjs?'+Date.now());
const r=Object.create(Renderer.prototype),events=[];
Object.assign(r,{graphicsErrors:[],faultAttempts:0,graphicsFault:false,recoveryBlocked:false,renderTask:null,recoveryTask:null,deviceLost:false,suspended:false});
const previous=globalThis.window;globalThis.window=new EventTarget();window.addEventListener('wirehouse:graphics-lost',event=>events.push(event.type));
try{
 assert.equal(r.recoverFromFrameError(new Error('Unrelated simulation bug')),false,'Do not reinterpret game bugs as GPU failures');
 for(let attempt=1;attempt<=3;attempt++){
  assert(r.recoverFromFrameError(new DOMException('GPUCommandEncoder.beginRenderPass: Unable to begin render pass.','InvalidStateError')));
  assert(r.framePending);assert.equal(r.recoveryBlocked,attempt>2);
 }
 assert.equal(events.length,3);assert.equal(r.graphicsErrors.length,3);
 await assert.rejects(r.resume(),/repeatedly failed/,'Persistent GPU faults stop instead of restarting forever');
 for(let i=0;i<20;i++)r.recordGraphicsError('GPU validation detail');assert.equal(r.graphicsErrors.length,16,'Diagnostics have a bounded memory budget');
 const logs=[],owner={onError:info=>logs.push(info)};r.gpu=owner;r.bindDeviceLoss();owner.onError({type:'GPUValidationError',message:'attachment mismatch'});
 assert(r.graphicsErrors.at(-1).message.includes('attachment mismatch'));assert.equal(logs.length,1,'Keep Three error reporting');
 await writeFile('output/renderer-encoder-recovery.json',JSON.stringify({passed:true,automaticAttemptLimit:2,diagnosticLimit:16}));
}finally{globalThis.window=previous;}
console.log('Encoder error classification, bounded recovery, and GPU diagnostics passed');
