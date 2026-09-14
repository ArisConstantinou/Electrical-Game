import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import * as THREE from 'three';

await mkdir('output',{recursive:true});
globalThis.addEventListener=()=>{};globalThis.window={dispatchEvent:()=>{}};
globalThis.document={hidden:false,addEventListener:()=>{},querySelectorAll:()=>[]};
globalThis.MutationObserver=class{observe(){}};
const source=process.env.QA_COMPARE_HEAD==='1'?execFileSync('git',['show','HEAD:src/player/MobileControls.ts'],{encoding:'utf8'}):null;
await build({stdin:{contents:"export {MobileControls} from './src/player/MobileControls.ts';export {PlayerController} from './src/player/PlayerController.ts';",resolveDir:process.cwd()},outfile:'output/mobile-stick-neutral.mjs',bundle:true,platform:'node',format:'esm',external:['three']});
const {MobileControls,PlayerController}=await import('../output/mobile-stick-neutral.mjs?'+Date.now());
const report={cases:[]};
function fixture(Controls=MobileControls){
 const listeners={},classes={contains:()=>false,add(){},remove(){}},style={transform:'',removeProperty(){}};
 const action={classList:classes,style,contains:target=>target===action,addEventListener(){},setAttribute(){},setPointerCapture(){},hasPointerCapture:()=>false,getBoundingClientRect:()=>({left:200,top:300,width:120,height:120})};
 const thumb={style:{...style}},surface={classList:classes,addEventListener:(name,fn)=>listeners[name]=fn,querySelectorAll:()=>[],querySelector:selector=>selector==='#look-joystick'?action:selector==='#look-joystick-thumb'?thumb:null};
 const input={actionHeld:false,actionRequested:false,mobileLook:{x:0,y:0},mobileMove:{x:0,y:0},pressed:()=>false,resetMobileLook(){this.mobileLook={x:0,y:0};},resetMobileMove(){this.mobileMove={x:0,y:0};}};
 const player=new PlayerController(new THREE.PerspectiveCamera(),input);player.setWallAssist(false);player.pitch=-.2;
 const controls=new Controls(surface,input,player,()=>false);controls.setAimProfile('fast');
 const event=(x,y,type='pointerdown')=>({clientX:x,clientY:y,pointerType:'touch',pointerId:1,target:action,type,preventDefault(){}});
 const down=(x,y)=>listeners.pointerdown(event(x,y));const move=(x,y)=>listeners.pointermove(event(x,y,'pointermove'));
 const up=()=>controls.onPointerUp(event(0,0,'pointerup'));const hold=()=>{for(let i=0;i<30;i++)player.update(1/60);};
 return{controls,input,player,down,move,up,hold};
}
if(source){
 await build({stdin:{contents:source,resolveDir:process.cwd()+'/src/player',loader:'ts'},outfile:'output/mobile-stick-neutral-baseline.mjs',bundle:true,platform:'node',format:'esm'});
 const {MobileControls:Old}=await import('../output/mobile-stick-neutral-baseline.mjs?'+Date.now());
 const f=fixture(Old);f.down(278,389);f.hold();report.before={pitch:f.player.pitch,look:f.input.mobileLook};
 assert(f.player.pitch<-.3,'Baseline must reproduce downward rotation from a stationary off-centre press');
}
for(const mode of ['stick','drag'])for(const [x,y] of [[260,360],[278,389],[232,332]]){
 const f=fixture();f.controls.setAimInputMode(mode);f.down(x,y);f.hold();
 assert.equal(f.player.pitch,-.2,`${mode}: stationary off-centre USE must stay neutral`);assert.deepEqual(f.input.mobileLook,{x:0,y:0});assert(f.input.actionHeld);
 f.move(x+20,y-20);f.hold();assert(f.player.pitch>-.2,'Moving up from the press anchor must aim up');const aimed=f.player.pitch;
 f.up();f.hold();assert.equal(f.player.pitch,aimed,'Releasing USE must stop stick rotation');assert(!f.input.actionHeld);assert.deepEqual(f.input.mobileLook,{x:0,y:0});
 f.down(244,385);f.hold();assert.equal(f.player.pitch,aimed,'Every new press must establish a fresh neutral anchor');f.up();
 report.cases.push({mode,anchor:[x,y],neutralPitch:-.2,aimedPitch:aimed});
}
report.passed=true;await writeFile('output/mobile-stick-neutral.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
