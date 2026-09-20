import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {blockPointerLock} from './browser-safety.mjs';
const before=process.argv.includes('--before'),out=`output/worker-carry-gait/${before?'before':'after'}`;
await mkdir(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true}),report={errors:[],cases:[]};
try{
 const context=await browser.newContext({viewport:{width:1200,height:900},recordVideo:{dir:out,size:{width:1200,height:900}}});await blockPointerLock(context);
 const page=await context.newPage();await page.routeWebSocket('**',()=>{});page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await page.locator('#start-button').click({timeout:120000});await page.waitForFunction(()=>window.__wireTheHouse.workerBody.loaded);await page.waitForTimeout(800);
 await page.evaluate(()=>{const g=window.__wireTheHouse;g.step=()=>{};g.selectTool('spray');g.workerBody.overview=true;for(const child of g.renderer.scene.children)if(child!==g.workerBody&&!child.isLight&&!child.isCamera)child.visible=false;});
 for(const speed of [.7,2.2])for(const [name,x,z] of [['W',0,-1],['WA',-1,-1],['A',-1,0],['SA',-1,1],['S',0,1],['SD',1,1],['D',1,0],['WD',1,-1]]){
  await page.evaluate(({x,z,speed})=>{const g=window.__wireTheHouse,w=g.workerBody;w.resetPreviewMotion();w.bend=0;g.player.yaw=0;g.player.pitch=0;g.player.crouched=false;g.player.velocity.set(x,0,z).normalize().multiplyScalar(speed);window.gaitFrame=0;}, {x,z,speed});
  const frames=[];
  for(let part=0;part<4;part++){
   frames.push(...await page.evaluate(async()=>{const g=window.__wireTheHouse,w=g.workerBody,c=g.renderer.camera,frames=[];
    for(let i=0;i<15;i++){
     c.position.set(0,1.65,0);c.rotation.set(0,0,0);g.fpsRig.visible=true;c.updateMatrixWorld(true);
     w.update(1/60,c,g.player,g.fpsRig,'spray',false,false);window.gaitFrame++;
     const feet=['L','R'].map(s=>({foot:w.point('foot.'+s).toArray(),knee:w.point('shin.'+s).toArray(),toe:w.point('toe.'+s).toArray()}));
     frames.push({yaw:w.rotation.y,phase:w.phase,feet,grips:w.telemetry.gripReachErrors,activeGrips:g.fpsRig.anatomicalGrips().filter(p=>p.active).length});
     // In-place review of the actual pose, fixed three-quarter camera.
     c.position.set(1.45,1.25,-2.15);c.lookAt(0,.85,0);g.fpsRig.visible=false;g.renderer.render();await new Promise(requestAnimationFrame);
    }return frames;
   }));
   await page.screenshot({path:`${out}/${name}-${speed}-${part}.png`});
  }
  const last=frames.at(-1),length=Math.hypot(x,z),forward=-z/length,side=x/length,desired=-Math.atan2(side*(forward<-.05?-1:1),Math.abs(forward)),error=Math.abs(last.yaw-desired)*180/Math.PI,cycles=(last.phase-frames[0].phase)/(2*Math.PI);
  report.cases.push({name,speed,error,cycles,frames});
  if(!before){assert(error<24,`${name} at ${speed}: pelvis remains ${error.toFixed(1)} degrees away from the walking axis`);assert(cycles<2.8,`${name}: excessive lateral shuffle cadence`);assert(last.activeGrips>0,'Exercise carried-tool gait, not only empty hands');}
 }
 assert.deepEqual(report.errors,[]);await context.close();report.video=await page.video().path();
 console.log(JSON.stringify(report.cases.map(({name,speed,error,cycles})=>({name,speed,error,cycles}))));
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
