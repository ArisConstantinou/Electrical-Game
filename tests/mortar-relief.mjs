import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {blockPointerLock} from './browser-safety.mjs';
const baseline=process.env.BASELINE==='1',out=`output/mortar-relief/${baseline?'before':'after'}`;
await mkdir(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true}),report={errors:[],views:[]};
try{
 const context=await browser.newContext({viewport:{width:1200,height:900}});await blockPointerLock(context);const page=await context.newPage();await page.routeWebSocket('**',()=>{});page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await page.locator('#start-button').click({timeout:120000});await page.waitForFunction(()=>window.__wireTheHouse.workerBody.loaded);await page.waitForTimeout(800);
 await page.evaluate(()=>{const g=window.__wireTheHouse,w=g.mixing.wheelbarrow;g.step=()=>{};g.fpsRig.visible=false;g.workerBody.visible=false;w.mortarSlump.reset(3185);w.model.group.position.set(1.2,0,-.8);w.yaw=0;w.model.group.rotation.set(0,0,0);w.update(0);window.mortarOriginal=w.model.mortar.material;});
 for(const [name,offset,plain] of [['detail',[0,.93,-.43],false],['plain',[0,.93,-.43],true],['grazing',[.65,.30,-.65],true]]){
  const data=await page.evaluate(async({offset,plain,name})=>{const g=window.__wireTheHouse,w=g.mixing.wheelbarrow,c=g.renderer.camera,m=w.model.mortar;
   if(plain){m.material=window.mortarOriginal.clone();m.material.map=null;m.material.bumpMap=null;m.material.color.setHex(0xaaa49c);m.material.needsUpdate=true;}else m.material=window.mortarOriginal;
   const center=w.model.group.localToWorld(c.position.clone().set(0,.65,0));c.position.copy(center).add({x:offset[0],y:offset[1],z:offset[2]});c.lookAt(center);g.renderer.render();await g.renderer.waitForFrame();
   const p=m.geometry.getAttribute('position'),samples=[];for(let i=0;i<p.count;i++)if(Math.abs(p.getX(i))<.24&&p.getZ(i)<-.14&&p.getZ(i)>-.34)samples.push([p.getX(i),p.getY(i),p.getZ(i)]);
   return{name,vertices:p.count,triangles:m.geometry.index.count/3,samples,textured:!!m.material.map,bump:!!m.material.bumpMap};
  },{offset,plain,name});report.views.push(data);await page.screenshot({path:`${out}/${name}.png`});
 }
 assert.deepEqual(report.errors,[]);
 if(!baseline){assert(report.views[1].textured===false&&report.views[1].bump===false);assert(report.views[0].vertices<18000,'Keep the relief bounded');}
 console.log(JSON.stringify(report.views.map(({name,vertices,triangles})=>({name,vertices,triangles}))));
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
