import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import os from 'node:os';import {pathToFileURL} from 'node:url';
import {blockPointerLock} from './browser-safety.mjs';
import {routeBuildingDist} from './building-qa-utils.mjs';
const helper=path.join(process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),'skills/develop-web-game/scripts/browser_lifecycle.mjs');
const {launchManagedBrowser,runManagedClient}=await import(pathToFileURL(helper).href);
const fixture=JSON.parse(await readFile(new URL('./fixtures/mansion-neighbor-contact.json',import.meta.url),'utf8'));
const out=path.resolve(process.env.QA_OUTPUT??'output/mansion-neighbor-contact');await mkdir(out,{recursive:true});
const s=await launchManagedBrowser(chromium,{channel:'chrome',headless:true,screenshotDir:out}),report={cases:[],errors:[]};
try{await runManagedClient(s,300000,async()=>{for(const mobile of [false,true]){
 const context=await s.browser.newContext({viewport:mobile?{width:390,height:844}:{width:1920,height:1080},deviceScaleFactor:mobile?3:1,isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);await routeBuildingDist(context);
 const p=await context.newPage();p.on('pageerror',e=>report.errors.push(e.message));await p.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await p.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,null,{timeout:120000});await p.locator('#apprentice-count').selectOption('0');await p.locator('#start-button').click();
 const result=await p.evaluate(f=>{
 const g=window.__wireTheHouse,w=g.room.mansionWing.masonryDemolition.get(f.wall),group=w.group,V=g.renderer.camera.position.constructor,camera=g.renderer.camera;
 g.step=()=>{};w.reset();w.restoreDamage(f.damage);group.matrixWorldAutoUpdate=true;group.matrixAutoUpdate=true;
 const originalInverse=group.matrixWorld.clone().invert(),localOrigin=new V(...f.origin).applyMatrix4(originalInverse),localDirection=new V(...f.direction).transformDirection(originalInverse);
 const query=(o,d,range)=>w.aim(camera,range,o,d,.001),check=(condition,message)=>{if(!condition)throw new Error(message);};
 const first=query(new V(...f.origin),new V(...f.direction),f.range);check(first?.index===292,'Original front owner is empty but adjacent brick292 must remain reachable');
 check(!query(new V(...f.origin),new V(...f.direction),first.distance-.0001),'World reach exceeded');let comparisons=0;
 for(const yaw of [0,.7,-1.4])for(const scale of [[1,1,1],[2.4,.75,.42],[.5,1.6,2.1]]){
  group.rotation.y=yaw;group.scale.set(...scale);group.position.set(3,2,-4);group.updateMatrixWorld(true);w.obstacle.segments=[];
  const origin=localOrigin.clone().applyMatrix4(group.matrixWorld),direction=localDirection.clone().transformDirection(group.matrixWorld),hit=query(origin,direction,2.4);
  check(hit?.index===292,'Rotated or scaled shaft lost adjacent contact');check(!query(origin,direction,hit.distance-.0001),'Local metres widened world reach');comparisons++;
 }
 for(const sign of [-1,1])for(const dx of [-.02,0,.02])for(const dy of [-.02,0,.02]){
  const o=localOrigin.clone();o.x+=dx;o.y+=dy;o.z=sign*.18;const d=new V(localDirection.x,localDirection.y,-sign*.99).normalize();
  const worldO=o.clone().applyMatrix4(group.matrixWorld),worldD=d.clone().transformDirection(group.matrixWorld),hit=query(worldO,worldD,2.4);let nearest=null;
  for(let index=0;index<w.remaining.length;index++){if(!w.remaining[index])continue;const b=w.broken.get(index)??w.pristineBrick(index),q=b.rotation.clone().invert(),bo=o.clone().sub(b.origin).applyQuaternion(q),bd=d.clone().applyQuaternion(q),joint=w.jointContact(b,bo,bd,20)?.contact,clay=b.volume.raycast(bo,bd,20),contact=joint&&(!clay||joint.distance<clay.distance)?joint:clay;
   if(contact){const point=new V(contact.point.x,contact.point.y,contact.point.z).applyQuaternion(b.rotation).add(b.origin).applyMatrix4(group.matrixWorld),distance=point.distanceTo(worldO);if(distance>=.001&&distance<=2.4&&(!nearest||distance<nearest.distance))nearest={index,distance};}}
  check((hit?.index??null)===(nearest?.index??null),'Face/angle differs from exhaustive nearest material '+JSON.stringify({sign,dx,dy,hit:hit?{index:hit.index,distance:hit.distance}:null,nearest,origin:o.toArray(),direction:d.toArray()}));if(hit)check(Math.abs(hit.distance-nearest.distance)<1e-8,'Nearest distance differs');comparisons++;
 }
 w.strike(292);check(query(localOrigin.clone().applyMatrix4(group.matrixWorld),localDirection.clone().transformDirection(group.matrixWorld),2.4)?.index!==292,'Deleted brick still owns ray');
 return{first:{index:first.index,distance:first.distance},comparisons,cacheEntries:w.pristineAim.size,error:g.renderer.renderError};
 },fixture);report.cases.push({mobile,...result});assert.equal(result.comparisons,27);assert.equal(result.error,'');assert(result.cacheEntries<=32);console.log(JSON.stringify(report.cases.at(-1)));await context.close();
}assert.deepEqual(report.errors,[]);});}catch(e){report.failure=String(e.stack??e);throw e;}finally{await writeFile(out+'/report.json',JSON.stringify(report,null,2));}
