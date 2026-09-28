import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {serveTaskBuild} from './serve-task-build.mjs';

const url='http://127.0.0.1:5365/Electrical-Game/';
const live=process.argv.includes('--live');
const out=process.env.PVC_REBEND_OUT??'output/pvc-rebend-floor-pickup/after';
await mkdir(out,{recursive:true});
const report={url,live,errors:[],cases:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  for(const viewport of (process.argv.includes('--desktop-only')?[{width:1095,height:1139}]:[{width:1095,height:1139},{width:390,height:844},{width:844,height:390}])){
    const mobile=viewport.width!==1095,name=!mobile?'desktop':viewport.width<500?'portrait':'landscape';
    const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile});
    await blockPointerLock(context);if(!live)await serveTaskBuild(context,url);
    const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
    try{
      await page.goto(url);await page.locator('#apprentice-count').selectOption('0');
      await page.locator('#start-button').click({timeout:120000});
      await page.waitForFunction(()=>window.__wireTheHouse.started);
      await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.workerBody.ready;window.rebendTick=g.step.bind(g);g.step=()=>{};g.player.update=()=>{};g.mixing.finished=true;g.mixing.setActive(false);
        const p=g.pvc,c=g.renderer.camera,point=g.mission.points[1],box=point.boxGroup.getWorldPosition(c.position.clone());
        p.bend=new p.bend.constructor(.9);p.bend.angles.fill(90/16);p.bend.revision++;p.quantity=1;p.phase='extracting';p.elapsed=1.5;p.animate(.01);
        p.target=point;p.cutFrom=.35;p.cutS=.35;p.carried.cutFrom=.35;p.carried.mesh.update(p.bend,.35);p.transition('cut');p.setFocus();
        c.position.set(box.x,.95,box.z+.95);c.lookAt(box);g.player.crouched=true;g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;c.updateMatrixWorld(true);
      });
      const tick=n=>page.evaluate(n=>{for(let i=0;i<n;i++)window.rebendTick(1/60,0,false);},n);
      const state=()=>page.evaluate(()=>window.__wireTheHouse.pvc.telemetry);
      const key=async code=>{await page.keyboard.down(code);await tick(2);await page.keyboard.up(code);await tick(2);};
      const snap=async label=>{await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${name}-${label}.png`});};
      await tick(50);const initial=await state();assert.equal(initial.phase,'cut');assert.equal(initial.totalAll,100);await snap('before');
      assert.equal(await page.locator('#pvc-new-bend').isVisible(),true,'A cut pipe needs a visible new-bend action');
      if(mobile)await page.locator('#pvc-new-bend').tap();else await page.locator('#pvc-new-bend').click();
      await tick(5);const marking=await state();assert.equal(marking.phase,'marking');assert.equal(marking.dropped,1);assert.equal(marking.carrying,false);assert.equal(marking.totalAll,100);
      assert.equal(marking.angle,0,'The new pipe starts straight');await snap('new-marking');
      if(mobile)await page.locator('#pvc-mark-confirm').tap();else await key('KeyE');
      await tick(60);assert.equal((await state()).phase,'spring');
      if(mobile)await page.locator('[data-bend-action="use"]').tap();else await page.locator('[data-bend-action="use"]').click();
      await tick(100);assert.equal((await state()).phase,'bending');
      await page.evaluate(()=>{const p=window.__wireTheHouse.pvc;p.bend.angles.fill(90/16);p.bend.revision++;});await tick(3);
      if(mobile)await page.locator('[data-bend-action="confirm"]').tap();else await key('KeyE');
      await tick(3);assert.equal((await state()).phase,'review');
      if(mobile)await page.locator('[data-bend-action="confirm"]').tap();else await key('KeyE');
      await tick(100);const ready=await state();assert.equal(ready.phase,'carrying');assert.equal(ready.dropped,1);assert.equal(ready.totalAll,100);
      const ids=await page.evaluate(()=>{const p=window.__wireTheHouse.pvc;return{newPipe:p.carried.mesh.uuid,oldPipe:p.dropped[0].mesh.uuid};});
      assert.notEqual(ids.newPipe,ids.oldPipe,'Bending must produce a different held pipe');await snap('new-held');
      assert.equal(ready.floorAimed,false,'A held pipe cannot be exchanged directly');
      await page.evaluate(id=>{const g=window.__wireTheHouse,p=g.pvc,c=g.renderer.camera,m=p.dropped.find(item=>item.mesh.uuid===id).mesh,position=m.geometry.getAttribute('position'),V=c.position.constructor,a=80*m.sides,b=a+m.sides/2;
        const target=m.localToWorld(new V((position.getX(a)+position.getX(b))/2,(position.getY(a)+position.getY(b))/2,(position.getZ(a)+position.getZ(b))/2));
        c.position.copy(target).add(new V(0,.9,.05));const direction=target.sub(c.position).normalize();g.player.pitch=Math.asin(direction.y);g.player.yaw=Math.atan2(-direction.x,-direction.z);c.rotation.set(g.player.pitch,g.player.yaw,0);c.updateMatrixWorld(true);},ids.oldPipe);
      await tick(3);assert.equal(await page.evaluate(()=>window.__wireTheHouse.pvc.floorTarget(true)?.mesh.uuid),ids.oldPipe);
      if(!mobile)await key('KeyE');
      assert.equal(await page.evaluate(()=>window.__wireTheHouse.pvc.carried?.mesh.uuid),ids.newPipe,'E never exchanges a held pipe with one on the floor');
      assert.equal((await state()).dropped,1);
      if(mobile)await page.locator('#pvc-drop-pipe').tap();else await page.locator('#pvc-drop-pipe').click();
      await tick(180);const empty=await state();assert.equal(empty.carrying,false);assert.equal(empty.dropped,2);assert.equal(empty.totalAll,100);
      const aimDropped=async(id,capture=true)=>{await page.evaluate(id=>{const g=window.__wireTheHouse,p=g.pvc,c=g.renderer.camera,m=p.dropped.find(item=>item.mesh.uuid===id).mesh,position=m.geometry.getAttribute('position'),V=c.position.constructor,a=80*m.sides,b=a+m.sides/2;
        const target=m.localToWorld(new V((position.getX(a)+position.getX(b))/2,(position.getY(a)+position.getY(b))/2,(position.getZ(a)+position.getZ(b))/2));
        c.position.copy(target).add(new V(0,.9,.05));const direction=target.clone().sub(c.position).normalize();g.player.pitch=Math.asin(direction.y);g.player.yaw=Math.atan2(-direction.x,-direction.z);c.rotation.set(g.player.pitch,g.player.yaw,0);c.updateMatrixWorld(true);},id);await tick(3);if(capture)await snap('floor-target');const detail=await page.evaluate(id=>{const g=window.__wireTheHouse,p=g.pvc,c=g.renderer.camera,m=p.dropped.find(item=>item.mesh.uuid===id).mesh,position=m.geometry.getAttribute('position'),V=c.position.constructor,a=80*m.sides,b=a+m.sides/2,target=m.localToWorld(new V((position.getX(a)+position.getX(b))/2,(position.getY(a)+position.getY(b))/2,(position.getZ(a)+position.getZ(b))/2)),projected=target.clone().project(c);return{phase:p.phase,carried:p.carried?.mesh.uuid,aimed:p.floorTarget()?.mesh.uuid,stock:Boolean(p.stockTarget()),projected:projected.toArray(),camera:c.position.toArray(),pitch:g.player.pitch,yaw:g.player.yaw,dropped:p.dropped.map(pipe=>({uuid:pipe.mesh.uuid,position:pipe.mesh.position.toArray()})),expected:id};},id);assert.equal(detail.aimed,id,`The chosen dropped pipe must be targetable: ${JSON.stringify(detail)}`);};
      await aimDropped(ids.oldPipe);
      if(mobile){await page.locator('#pvc-prompt').tap();await tick(3);}else await key('KeyE');
      const picked=await state();assert.equal(picked.phase,'carrying');assert.equal(picked.dropped,1);assert.equal(picked.totalAll,100);
      const heldAfter=await page.evaluate(()=>window.__wireTheHouse.pvc.carried?.mesh.uuid);
      assert.equal(heldAfter,ids.oldPipe,'E picks the selected old pipe with empty hands');await snap('old-held');
      if(mobile)await page.locator('#pvc-drop-pipe').tap();else await page.locator('#pvc-drop-pipe').click();await tick(180);assert.equal((await state()).carrying,false);
      await aimDropped(ids.newPipe);if(mobile){await page.locator('#pvc-prompt').tap();await tick(3);}else await key('KeyE');
      assert.equal(await page.evaluate(()=>window.__wireTheHouse.pvc.carried.mesh.uuid),ids.newPipe,'E picks the individually selected new pipe');
      assert.equal((await state()).totalAll,100);
      let tenFloor=null;
      if(!mobile){
        await page.locator('#pvc-drop-pipe').click();await tick(180);
        await page.evaluate(()=>{const p=window.__wireTheHouse.pvc,Tube=p.pipe.constructor;
          while(p.dropped.length<10){const mesh=new Tube(p.pipe.material);mesh.update(p.bend);p.rawCount--;
            p.dropPipe({recipe:p.bend.recipe(),mesh,cutFrom:0,bundle:p.activeBundle,originBundle:p.activeBundle});}
        });await tick(180);
        const floor=await page.evaluate(()=>{const p=window.__wireTheHouse.pvc;return{total:p.telemetry.totalAll,uuids:p.dropped.map(item=>item.mesh.uuid),highlights:p.dropped.map(item=>({visible:item.highlight?.visible,color:item.highlight?.material.color.getHex()})),bounds:p.dropped.map(item=>{item.mesh.updateMatrixWorld(true);const box=item.mesh.geometry.boundingBox.clone().applyMatrix4(item.mesh.matrixWorld);return[box.min.x,box.max.x,box.min.z,box.max.z];})};});
        assert.equal(floor.total,100);assert.equal(floor.uuids.length,10);assert.equal(new Set(floor.uuids).size,10);
        assert(floor.highlights.every(item=>item.visible&&[0xffd43b,0x36a8ff].includes(item.color)),'All ten floor pipes need visible outlines');
        assert(floor.bounds.every(([x0,x1,z0,z1])=>x0>=-3.8&&x1<=3.8&&z0>=-3.6&&z1<=3.6),'Dropped pipe geometry must stay within the room');
        await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera,V=c.position.constructor,target=new V(1.8,.07,1.2);
          c.position.set(-.5,1.72,2.75);const direction=target.sub(c.position).normalize();g.player.pitch=Math.asin(direction.y);g.player.yaw=Math.atan2(-direction.x,-direction.z);c.rotation.set(g.player.pitch,g.player.yaw,0);c.updateMatrixWorld(true);});
        await tick(3);await snap('ten-floor-pipes');
        await aimDropped(floor.uuids[0],false);
        const queryCost=await page.evaluate(()=>{const p=window.__wireTheHouse.pvc;
          const measure=()=>{for(let i=0;i<20;i++)p.floorTarget();const start=performance.now();for(let i=0;i<200;i++)p.floorTarget();return (performance.now()-start)/200;};
          const withTenMs=measure(),saved=p.dropped.splice(0),withoutMs=measure();p.dropped.push(...saved);
          const triangles=saved.reduce((total,item)=>total+(item.mesh.geometry.index?.count??item.mesh.geometry.getAttribute('position').count)/3*2,0);
          return{withTenMs,withoutMs,triangles};});
        let frameRate=null;
        if(process.argv.includes('--benchmark')){
          const measure=async()=>{await page.waitForTimeout(1300);return Number((await page.locator('#fps-counter').textContent()).match(/\d+/)?.[0]??0);};
          await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.pvc;p.dropped.forEach(item=>item.mesh.visible=false);g.step=window.rebendTick;});
          const without=await measure();
          await page.evaluate(()=>window.__wireTheHouse.pvc.dropped.forEach(item=>item.mesh.visible=true));
          const withTen=await measure();
          await page.evaluate(()=>window.__wireTheHouse.step=()=>{});
          frameRate={without,withTen};
        }
        for(const id of floor.uuids){await aimDropped(id,false);await key('KeyE');assert.equal(await page.evaluate(()=>window.__wireTheHouse.pvc.carried?.mesh.uuid),id,`E must take ${id}`);
          await page.locator('#pvc-drop-pipe').click();await tick(4);assert.equal((await state()).dropped,10);}
        assert.equal((await state()).totalAll,100);
        tenFloor={count:floor.uuids.length,individuallyPicked:floor.uuids.length,outlined:floor.highlights.length,insideRoom:true,queryCost,frameRate};
      }
      if(mobile){
        await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.pvc;p.target=g.mission.points[1];p.transition('cut');p.setFocus();});
        await tick(3);assert.equal(await page.locator('#pvc-drop-pipe').isVisible(),true);
        await page.locator('#pvc-drop-pipe').tap();await tick(3);
        assert.equal((await state()).phase,'batch');assert.equal((await state()).dropped,2);
      }
      report.cases.push({name,initial:{phase:initial.phase,totalAll:initial.totalAll},marking:{phase:marking.phase,dropped:marking.dropped},ready:{phase:ready.phase,dropped:ready.dropped,totalAll:ready.totalAll},picked:{phase:picked.phase,dropped:picked.dropped,totalAll:picked.totalAll},tenFloor});
    }finally{await context.close();}
  }
  assert.deepEqual(report.errors,[]);report.passed=true;
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({out,passed:report.passed,cases:report.cases,errors:report.errors}));
