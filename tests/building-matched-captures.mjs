import {chromium} from 'playwright';
import {routeBuildingDist} from './building-qa-utils.mjs';
import {blockPointerLock} from './browser-safety.mjs';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1366,height:768}});await blockPointerLock(context);await routeBuildingDist(context);
 const page=await context.newPage();await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
 await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart&&!document.querySelector('#start-button')?.disabled,null,{timeout:120000});
 await page.locator('#apprentice-count').selectOption('5');await page.locator('#start-button').click();
 for(const p of [{name:'original-workroom',x:0,y:1.65,z:2,yaw:0,pitch:.15},{name:'foyer-stairs',x:3.8,y:1.65,z:8.5,yaw:-1.5,pitch:.15},{name:'exterior',x:23,y:1.65,z:-14,yaw:2.54,pitch:.15},{name:'ceiling',x:2.8,y:1.65,z:10,yaw:-1.1,pitch:.8},{name:'floor',x:2.8,y:1.65,z:10,yaw:-1.1,pitch:-.9}]){
  await page.evaluate(p=>{const g=window.__wireTheHouse;g.player.camera.position.set(p.x,p.y,p.z);g.player.yaw=p.yaw;g.player.pitch=p.pitch;g.selectTool('spray');},p);
  await page.waitForTimeout(700);await page.screenshot({path:`output/building-performance/desktop-webgl-after-${p.name}.png`});
 }
}finally{await browser.close();}
