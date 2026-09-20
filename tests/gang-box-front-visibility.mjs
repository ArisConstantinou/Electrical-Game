import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const url=process.argv[2]??'http://127.0.0.1:5365/Electrical-Game/';
const out=resolve(process.argv[3]??'output/gang-box-front-visibility');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:2048,height:1154},deviceScaleFactor:1});
const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
try{
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__wireTheHouse&&!document.querySelector('#start-button')?.disabled,{timeout:30000});
  await page.click('#start-button');
  await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.room.brickWall.waitForGeometry();await g.mortar.waitForGeometry();for(let i=0;i<12;i++)g.step(1/60,0,false);});
  const points=await page.evaluate(()=>window.__wireTheHouse.mission.points.map(point=>point.definition.id));
  const cases=[];
  for(const id of points){
    const result=await page.evaluate(async id=>{
      const g=window.__wireTheHouse,point=g.mission.points.find(item=>item.definition.id===id),camera=g.renderer.camera,rig=g.fpsRig;
      rig.visible=false;point.updateWorldMatrix(true,true);const centre=point.boxGroup.getWorldPosition(camera.position.clone());
      camera.position.set(centre.x,centre.y,g.room.brickWall.volume.frontZ+.48);camera.lookAt(centre);camera.updateMatrixWorld(true);g.renderer.render();await g.renderer.waitForFrame();
      const visible=g.renderer.webgl.domElement.toDataURL('image/png');
      point.boxGroup.visible=false;g.renderer.render();await g.renderer.waitForFrame();const hidden=g.renderer.webgl.domElement.toDataURL('image/png');
      point.boxGroup.visible=true;g.renderer.render();await g.renderer.waitForFrame();
      return{visible,hidden,centre:centre.toArray(),boxCount:point.boxGroup.boxes.length};
    },id);
    const visible=Buffer.from(result.visible.split(',')[1],'base64'),hidden=Buffer.from(result.hidden.split(',')[1],'base64');
    await writeFile(join(out,`${id}-straight.png`),visible);
    const changed=await page.evaluate(async({visible,hidden})=>{
      const decode=async b64=>createImageBitmap(new Blob([Uint8Array.from(atob(b64),c=>c.charCodeAt(0))],{type:'image/png'}));
      const a=await decode(visible),b=await decode(hidden),canvas=new OffscreenCanvas(a.width,a.height),ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(a,0,0);const one=ctx.getImageData(0,0,a.width,a.height).data;ctx.clearRect(0,0,a.width,a.height);ctx.drawImage(b,0,0);const two=ctx.getImageData(0,0,a.width,a.height).data;let count=0;for(let i=0;i<one.length;i+=4)if(Math.abs(one[i]-two[i])+Math.abs(one[i+1]-two[i+1])+Math.abs(one[i+2]-two[i+2])>24)count++;a.close();b.close();return count;
    },{visible:result.visible.split(',')[1],hidden:result.hidden.split(',')[1]});
    cases.push({id,changedPixels:changed,centre:result.centre,boxCount:result.boxCount});
  }
  const held=await page.evaluate(async()=>{
    const g=window.__wireTheHouse,camera=g.renderer.camera;
    g.selectTool('fitting');g.boxAssembly.reset('2G');g.syncBoxAssembly();
    const sideSurface=g.room.intactPracticeWall.localToWorld(camera.position.clone().set(0,1.65,g.room.intactPracticeWall.volume.frontZ));
    camera.position.set(-1.72,1.65,-.58);g.player.yaw=0;g.player.pitch=0;g.player.velocity.set(0,0,0);g.player.workPosition.locked=false;g.player.workPosition.released=true;
    for(let i=0;i<50;i++)g.step(1/60,0,false);g.renderer.render();await g.renderer.waitForFrame();
    const tool=g.fpsRig.tools.get('fitting'),bounds=g.fpsRig.heldToolBoundsWorld(),visible=g.renderer.webgl.domElement.toDataURL('image/png');
    tool.visible=false;g.renderer.render();await g.renderer.waitForFrame();const hidden=g.renderer.webgl.domElement.toDataURL('image/png');tool.visible=true;g.renderer.render();await g.renderer.waitForFrame();
    const roots=[g.fpsRig.fittingAssemblyRoot,g.fpsRig.fittingCandidateRoot,g.fpsRig.fittingZonesRoot],renderables=[];
    for(const root of roots)root.traverse(object=>{if(object.geometry)renderables.push({name:object.name||object.type,frustumCulled:object.frustumCulled});});
    return{visible,hidden,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},wallFrontZ:g.room.brickWall.volume.frontZ,sideSurfaceX:sideSurface.x,camera:camera.position.toArray(),renderables};
  });
  await writeFile(join(out,'held-straight.png'),Buffer.from(held.visible.split(',')[1],'base64'));
  assert(held.renderables.length>8,'Expected the live assembly, candidate and attachment-zone renderables');
  assert(held.renderables.every(item=>!item.frustumCulled),JSON.stringify(held.renderables.filter(item=>item.frustumCulled)));
  assert.deepEqual(errors,[]);await writeFile(join(out,'report.json'),JSON.stringify({url,cases,held:{bounds:held.bounds,wallFrontZ:held.wallFrontZ,sideSurfaceX:held.sideSurfaceX,camera:held.camera,renderables:held.renderables},errors},null,2));console.log(JSON.stringify({cases,held:{bounds:held.bounds,wallFrontZ:held.wallFrontZ,sideSurfaceX:held.sideSurfaceX,camera:held.camera,renderables:held.renderables.length}}));
}finally{await browser.close();}
