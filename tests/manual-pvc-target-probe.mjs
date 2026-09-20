import {chromium} from 'playwright';
import {blockPointerLock} from './browser-safety.mjs';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1366,height:768}});await blockPointerLock(context);
 const page=await context.newPage();await page.goto('http://127.0.0.1:5365/Electrical-Game/');await page.locator('#start-button').click({timeout:120000});
 console.log(JSON.stringify(await page.evaluate(()=>{
  const g=window.__wireTheHouse,c=g.renderer.camera,p=g.mission.points[0],pos=p.boxGroup.getWorldPosition(c.position.clone()),saved=g.step.bind(g);g.step=()=>{};g.player.crouched=true;g.pvc.phase='carrying';
  const rows=[];
  for(const offset of [0,-p.boxGroup.groupHeight/2+.002,p.boxGroup.groupHeight/2-.002]){
   c.position.set(pos.x,.95,pos.z+.95);c.lookAt(pos.x,pos.y+offset,pos.z);g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;c.updateMatrixWorld(true);
   rows.push({offset,before:g.boxPlacement.target(c)?.definition.id,camera:c.position.toArray(),rotation:c.rotation.toArray(),box:pos.toArray(),bounds:[p.boxGroup.groupWidth,p.boxGroup.groupHeight]});
   saved(1/60);rows.at(-1).after={hit:g.boxPlacement.target(c)?.definition.id,camera:c.position.toArray(),rotation:c.rotation.toArray(),player:g.player.workPosition};
  }return rows;
 }),null,2));
}finally{await browser.close();}
