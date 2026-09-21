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
 const listeners={},useListeners={},classes={contains:()=>false,add(){},remove(){}},style={transform:'',removeProperty(){}};
 const action={classList:classes,style,contains:target=>target===action,addEventListener(){},setAttribute(){},setPointerCapture(){},hasPointerCapture:()=>false,getBoundingClientRect:()=>({left:200,top:300,width:120,height:120})};
 const use={classList:classes,addEventListener:(name,fn)=>useListeners[name]=fn,setAttribute(){},setPointerCapture(){},hasPointerCapture:()=>false};
 const movePad={classList:classes,style:{...style},setPointerCapture(){},hasPointerCapture:()=>false,getBoundingClientRect:()=>({left:20,top:300,width:120,height:120})};
 const moveZone={getBoundingClientRect:()=>({left:0,right:180,top:200,bottom:800})};
 const thumb={style:{...style}},moveThumb={style:{...style}};
 const surface={classList:classes,closest:()=>null,addEventListener:(name,fn)=>listeners[name]=fn,querySelectorAll:()=>[],querySelector:selector=>selector==='#look-joystick'?action:selector==='#look-joystick-thumb'?thumb:selector==='#site-pro-use'?use:selector==='#joystick'?movePad:selector==='#joystick-thumb'?moveThumb:selector==='#mobile-move-zone'?moveZone:null};
 const input={actionHeld:false,actionRequested:false,mobileLook:{x:0,y:0},mobileMove:{x:0,y:0},pressed:()=>false,resetMobileLook(){this.mobileLook={x:0,y:0};},resetMobileMove(){this.mobileMove={x:0,y:0};}};
 const player=new PlayerController(new THREE.PerspectiveCamera(),input);player.setWallAssist(false);player.pitch=-.2;
 const controls=new Controls(surface,input,player,()=>false);controls.setAimProfile('fast');
 const event=(x,y,type='pointerdown',id=1,target=action)=>({clientX:x,clientY:y,pointerType:'touch',pointerId:id,target,type,preventDefault(){},stopPropagation(){}});
 const down=(x,y)=>listeners.pointerdown(event(x,y));const move=(x,y)=>listeners.pointermove(event(x,y,'pointermove'));
 const up=()=>controls.onPointerUp(event(0,0,'pointerup'));
 const useDown=()=>useListeners.pointerdown(event(260,500,'pointerdown',2,use));
 const useUp=()=>useListeners.pointerup(event(260,500,'pointerup',2,use));
 const pointerDown=(id,x,y,target=surface)=>listeners.pointerdown(event(x,y,'pointerdown',id,target));
 const pointerMove=(id,x,y,target=surface)=>listeners.pointermove(event(x,y,'pointermove',id,target));
 const pointerUp=id=>controls.onPointerUp(event(0,0,'pointerup',id,surface));
 const useDownId=id=>useListeners.pointerdown(event(300,500,'pointerdown',id,use));
 const useUpId=(id,type='pointerup')=>useListeners[type](event(300,500,type,id,use));
 const hold=()=>{for(let i=0;i<30;i++)player.update(1/60);};
 return{controls,input,player,down,move,up,useDown,useUp,pointerDown,pointerMove,pointerUp,useDownId,useUpId,hold,action,use};
}
if(source){
 await build({stdin:{contents:source,resolveDir:process.cwd()+'/src/player',loader:'ts'},outfile:'output/mobile-stick-neutral-baseline.mjs',bundle:true,platform:'node',format:'esm'});
 const {MobileControls:Old}=await import('../output/mobile-stick-neutral-baseline.mjs?'+Date.now());
 const f=fixture(Old);f.down(278,389);f.hold();report.before={pitch:f.player.pitch,look:f.input.mobileLook};
 assert(f.player.pitch<-.3,'Baseline must reproduce downward rotation from a stationary off-centre press');
}
for(const mode of ['stick','drag'])for(const [x,y] of [[260,360],[278,389],[232,332]]){
 const f=fixture();f.controls.setAimInputMode(mode);f.down(x,y);f.hold();
 assert.equal(f.player.pitch,-.2,`${mode}: stationary off-centre AIM must stay neutral`);assert.deepEqual(f.input.mobileLook,{x:0,y:0});assert(!f.input.actionHeld);
 f.useDown();assert(f.input.actionHeld,'USE press must start work without moving AIM');
 f.move(x+20,y-20);f.hold();assert(f.player.pitch>-.2,'Moving up from the press anchor must aim up');const aimed=f.player.pitch;
 f.up();f.hold();assert.equal(f.player.pitch,aimed,'Releasing AIM must stop stick rotation');assert(f.input.actionHeld,'Releasing AIM must not release USE');assert.deepEqual(f.input.mobileLook,{x:0,y:0});
 f.useUp();assert(!f.input.actionHeld);
 f.down(244,385);f.hold();assert.equal(f.player.pitch,aimed,'Every new press must establish a fresh neutral anchor');f.up();
 report.cases.push({mode,anchor:[x,y],neutralPitch:-.2,aimedPitch:aimed});
}
{
 const f=fixture();
 f.pointerDown(1,80,400);f.pointerMove(1,110,380);f.useDownId(3);
 const yaw=f.player.yaw;f.pointerMove(3,325,492,f.use);
 assert(f.input.mobileMove.x>0&&f.input.actionHeld&&f.player.yaw!==yaw,'Two thumbs must move, aim by dragging USE, and work together');
 f.pointerUp(1);f.useUpId(3);
 report.cases.push({mode:'two-thumb',moveAimUseIndependent:true});
}
{
 const f=fixture();
 f.pointerDown(1,80,400);f.pointerMove(1,110,380);
 f.pointerDown(2,260,360,f.action);f.pointerMove(2,285,350,f.action);
 f.useDownId(3);
 assert(f.input.mobileMove.x>0&&f.input.mobileLook.x>0&&f.input.actionHeld,'Three pointers must move, aim, and use together');
 f.pointerUp(1);assert.deepEqual(f.input.mobileMove,{x:0,y:0});assert(f.input.mobileLook.x>0&&f.input.actionHeld,'Moving finger release must preserve aim and use');
 f.pointerUp(2);assert.deepEqual(f.input.mobileLook,{x:0,y:0});assert(f.input.actionHeld,'Aim finger release must preserve use');
 f.useUpId(3);assert(!f.input.actionHeld,'Use finger release must stop the tool');
 f.useDownId(4);f.useUpId(4,'pointercancel');assert(!f.input.actionHeld&&!f.input.actionRequested,'Canceled use must discard a pending action');
 report.cases.push({mode:'three-pointer',moveAimUseIndependent:true});
}
report.passed=true;await writeFile('output/mobile-stick-neutral.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
