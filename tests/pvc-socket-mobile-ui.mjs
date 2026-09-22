import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {installDistOverlay} from './dist-overlay.mjs';

const url='http://127.0.0.1:5365/Electrical-Game/';
const out='output/pvc-socket-mobile';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={url,viewport:'390x844 Chrome touch emulation',errors:[],checks:[]};
try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await blockPointerLock(context);
  const page=await context.newPage();await installDistOverlay(page);
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
  await page.goto(url);await page.locator('#apprentice-count').selectOption('0');
  await page.locator('#start-button').click({timeout:120000});await page.waitForTimeout(500);
  await page.evaluate(()=>{
    const g=window.__wireTheHouse,pvc=g.pvc,Group=pvc.work.constructor,Pipe=pvc.pipe.constructor;
    const bend=new pvc.bend.constructor(.5),root=new Group();
    root.position.set(-3,.03,0);root.userData.studioEntityId='socket-mobile-fixture';root.userData.socketOpen=true;
    root.add(new Pipe());g.renderer.scene.add(root);
    pvc.openSockets.push({root,bend,pointId:'A'});
    pvc.carried={recipe:bend.recipe(),mesh:new Pipe(),cutFrom:0};pvc.phase='carrying';pvc.focused=false;
    g.player.crouched=false;
    const camera=g.renderer.camera;camera.position.set(0,1.65,1);camera.lookAt(0,.03,0);
    g.player.pitch=camera.rotation.x;g.player.yaw=camera.rotation.y;camera.updateMatrixWorld(true);
    window.pvcStep=g.step.bind(g);g.step=()=>{};
  });
  const step=n=>page.evaluate(n=>{for(let i=0;i<n;i++)window.pvcStep(1/60);},n);
  await step(3);
  assert.equal(await page.evaluate(()=>window.__wireTheHouse.pvc.socketTarget()?.pointId??null),'A');
  assert.match(await page.locator('#site-pro-use span').textContent(),/ΕΝΩΣΕ/);
  await page.screenshot({path:`${out}/before.png`});
  await page.locator('#site-pro-use').tap();await step(5);
  const result=await page.evaluate(()=>{const pvc=window.__wireTheHouse.pvc;return{joined:pvc.joinedCount,phase:pvc.phase,carrying:Boolean(pvc.carried),openSockets:pvc.openSockets.length,insertionMm:pvc.openSockets[0]?.root.userData.pvcJoin?.insertionMm};});
  assert.deepEqual(result,{joined:1,phase:'batch',carrying:false,openSockets:1,insertionMm:30});
  await page.screenshot({path:`${out}/after.png`});
  report.checks.push('390x844 touch: aimed socket -> visible ΕΝΩΣΕ USE -> tap inserts 30 mm and consumes held pipe');
  report.result=result;
  assert.equal(report.errors.length,0,report.errors.join('\n'));
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify(report));
