import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { blockPointerLock } from './browser-safety.mjs';

const url=process.argv[2]??'http://127.0.0.1:5362/Electrical-Game/';
const out=process.argv[3]??'output/mobile-hammer-contact';
const diagnostic=process.env.QA_DIAGNOSTIC==='1';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={url,mobileIsEmulation:true,diagnostic,fixture:'Only starting camera and deterministic clock are controlled. Native CDP touch drives explicit hold, free look, backward recovery and lateral cutting. No authored damage or contact override. Pointer Lock blocked before navigation.',cases:[],errors:[]};
const step=(page,frames)=>page.evaluate(async frames=>{
  for(let i=0;i<frames;i++){
    window.__contactStep(1/60);
    const g=window.__wireTheHouse,f=window.__feedingFrames;
    f.current=g.input.actionHeld&&g.fpsRig.contactStatus==='feeding'?f.current+1:0;
    f.longest=Math.max(f.longest,f.current);
    if((i+1)%12===0)await window.__wireTheHouse.chasing.waitForDebrisSplits();
  }
},frames);
const state=page=>page.evaluate(()=>{
  const g=window.__wireTheHouse,r=g.fpsRig,w=g.room.brickWall;
  return {position:g.renderer.camera.position.toArray(),yaw:g.player.yaw,pitch:g.player.pitch,
    impacts:w.impactCount,debrisStrikes:g.chasing.debrisStrikeCount,removedCm3:w.volume.removedVolume*1e6,
    held:g.input.actionHeld,reachable:r.reachable,inAir:r.chiselInAir,status:r.contactStatus,reason:r.reachReason,pose:r.debugPose(),
    tip:r.chiselTipWorld.toArray(),frontZ:w.volume.frontZ,
    useStatus:document.querySelector('#mobile-use-status')?.textContent,
    contacts:window.__contacts,attempts:window.__attempts,pointerLock:document.pointerLockElement?.id??null,
    longestFeedingSeconds:window.__feedingFrames.longest/60,
    overflow:document.documentElement.scrollWidth>innerWidth,renderError:g.renderer.renderError};
});
try{
  for(const distance of [.46,.72,.95])for(const yaw of [-.4,0,.4]){
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await blockPointerLock(context);
    const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
    try{
      await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.renderer.renderCamera,{timeout:120000});
      await page.locator('#start-button').tap();await page.locator('[data-tool="hammer"]').tap();
      await page.evaluate(({distance,yaw})=>{
        const g=window.__wireTheHouse,c=g.renderer.camera;
        window.__contactStep=g.step.bind(g);g.step=()=>{};
        c.position.set(0,g.player.eyeHeight,g.room.brickWall.volume.frontZ+distance);
        c.rotation.set(-.35,yaw,0,'YXZ');g.player.pitch=-.35;g.player.yaw=yaw;
        g.player.workPosition.locked=false;g.player.workPosition.released=false;
        window.__contacts={};window.__attempts=[];window.__feedingFrames={current:0,longest:0};
        const originalContact=g.fpsRig.contact.bind(g.fpsRig);
        g.fpsRig.contact=(...args)=>{
          const result=originalContact(...args),r=g.fpsRig;
          const key=r.contactStatus;
          window.__contacts[key]=(window.__contacts[key]??0)+1;
          return result;
        };
        const originalAction=g.performAction.bind(g);
        g.performAction=(...args)=>{
          const before=g.room.brickWall.impactCount+g.chasing.debrisStrikeCount;
          originalAction(...args);
          window.__attempts.push({hit:g.room.brickWall.impactCount+g.chasing.debrisStrikeCount>before,
            reachable:g.fpsRig.reachable,air:g.fpsRig.chiselInAir,blend:g.fpsRig.hammerGripBlend,
            tip:g.fpsRig.chiselTipWorld.toArray(),fit:{...g.fpsRig.hammerFit},contacts:{...window.__contacts}});
        };
      },{distance,yaw});
      await step(page,120);
      const cdp=await context.newCDPSession(page);
      const touch=(type,touchPoints)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints});
      // Exercise both action-pad styles without changing the production input.
      if(yaw<0)await page.locator('#quick-aim-input').tap();
      if(!diagnostic){
        const beforeSwipe=await state(page);
        await touch('touchStart',[{x:265,y:330,id:3}]);
        await touch('touchMove',[{x:275,y:330,id:3}]);await step(page,24);
        await touch('touchEnd',[]);await step(page,1);
        const afterSwipe=await state(page);
        assert.equal(afterSwipe.held,false,'General screen swipe must never start the hammer');
        assert.equal(afterSwipe.impacts,beforeSwipe.impacts,'General swipe unexpectedly damaged the wall');
        assert.notEqual(afterSwipe.yaw,beforeSwipe.yaw,'General swipe must still aim');
        // Restore only the stated fixture view after independently checking swipe.
        await page.evaluate(yaw=>{const g=window.__wireTheHouse;g.player.yaw=yaw;g.renderer.camera.rotation.y=yaw;},yaw);
        await step(page,30);
      }
      const initial=await state(page);
      const b=await page.locator('#look-joystick').boundingBox(),action={x:b.x+b.width/2,y:b.y+b.height/2,id:2};
      if(diagnostic)await page.evaluate(()=>{window.__wireTheHouse.input.actionHeld=true;});
      else await touch('touchStart',[action]);
      await step(page,240);
      const afterHold=await state(page),entry={distance,yaw,aimStyle:yaw<0?'drag':'stick',initial,afterHold};report.cases.push(entry);
      if(!diagnostic){
        assert.equal(afterHold.held,true,'Stationary explicit hold must keep the hammer active');
        assert(afterHold.impacts>initial.impacts&&afterHold.removedCm3>initial.removedCm3,'Native stationary hold must make real masonry contact and remove material');
        if(distance===.46&&yaw!==0){
          assert.equal(afterHold.status,'too-close','Head collision must explain why the tool cannot strike');
          assert.match(afterHold.reason,/step back/i);
          assert.match(afterHold.useStatus,/step back/i,'The actual mobile action pad must explain the failed contact');
          assert(afterHold.tip[2]-afterHold.frontZ>.035,'Rejected close contact must visibly withdraw the bit from masonry');
          for(const arm of afterHold.pose.arms){
            const length=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
            assert(Math.abs(length(arm.shoulder,arm.elbow)-.31)<.002&&Math.abs(length(arm.elbow,arm.wrist)-.27)<.002,'Withdrawing a blocked hammer must preserve physical arm lengths');
          }
          await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.room.brickWall.waitForGeometry();await g.renderer.waitForFrame();window.__contactStep(0);await g.renderer.waitForFrame();});
          await page.screenshot({path:`${out}/too-close-${yaw}.png`});
          const move={x:75,y:540,id:1};await touch('touchStart',[action,move]);
          await touch('touchMove',[action,{...move,y:560}]);
          const recovery=[];
          for(let i=0;i<70;i++){
            await step(page,1);const s=await state(page);recovery.push({z:s.position[2],yaw:s.yaw,pitch:s.pitch,held:s.held});
            if(s.position[2]-s.frontZ>=.72)break;
          }
          // CDP touchEnd names the ending contact when another finger remains.
          await touch('touchEnd',[{...move,y:560}]);
          const backed=await state(page);entry.backwardSamples=recovery;entry.backed=backed;
          assert(backed.position[2]-backed.frontZ>=.72,'Native backward input must release the close stance');
          assert(recovery.every((s,i)=>s.held&&Math.abs(s.yaw-afterHold.yaw)<1e-8&&Math.abs(s.pitch-afterHold.pitch)<1e-8&&(!i||Math.abs(s.z-recovery[i-1].z)<.08)),'Backward recovery must preserve held use/aim without a camera jump');
          await step(page,240);const resumed=await state(page);entry.resumed=resumed;
          assert(resumed.impacts+resumed.debrisStrikes>backed.impacts+backed.debrisStrikes+5,'Stepping back must resume hammering without repressing USE');
          assert(resumed.removedCm3>afterHold.removedCm3,'Recovered contact must continue removing real material');
        }else{
          const move={x:75,y:540,id:1},sign=yaw<0?-1:1;
          await touch('touchStart',[action,move]);await touch('touchMove',[action,{...move,x:move.x+sign*28}]);
          await step(page,180);await touch('touchEnd',[{...move,x:move.x+sign*28}]);
          const moved=await state(page);entry.moving=moved;
          assert((moved.position[0]-afterHold.position[0])*sign>.03,'Held use plus native movement must cut laterally');
          assert(moved.impacts+moved.debrisStrikes>=afterHold.impacts+afterHold.debrisStrikes+3,'Lateral movement must retain repeated physical contacts');
          assert(moved.removedCm3>afterHold.removedCm3,'Moving contact must excavate the next material');
          assert(Math.abs(moved.yaw-afterHold.yaw)<1e-8&&Math.abs(moved.pitch-afterHold.pitch)<1e-8,'Lateral cuts must not recenter camera aim');
          // A blade can spend time feeding from a shallow shell into a deep
          // cavity while moving. It must settle and keep striking when only
          // the movement finger lifts, without restarting the action finger.
          await step(page,90);const settled=await state(page);entry.settled=settled;
          assert.equal(settled.held,true);
          assert(settled.impacts+settled.debrisStrikes>moved.impacts+moved.debrisStrikes,'Holding after lateral movement must settle into real contact');
        }
        await touch('touchEnd',[]);const released=await state(page);await step(page,30);
        const stopped=await state(page);
        assert.equal(stopped.held,false);assert.equal(stopped.impacts,released.impacts);assert.equal(stopped.debrisStrikes,released.debrisStrikes);
      }
      const final=await state(page);entry.final=final;
      await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.room.brickWall.waitForGeometry();await g.renderer.waitForFrame();window.__contactStep(0);await g.renderer.waitForFrame();});
      await page.screenshot({path:`${out}/contact-${distance}-${yaw}.png`});
      await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
      console.log(JSON.stringify({distance,yaw,impacts:final.impacts,removed:final.removedCm3,contacts:final.contacts,attempts:final.attempts.length,failures:final.attempts.filter(a=>!a.hit).length,reachable:final.reachable,reason:final.reason}));
      assert.equal(final.pointerLock,null);assert.equal(final.renderError,'');assert.equal(final.overflow,false);
    }catch(error){
      await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
      await page.screenshot({path:`${out}/failure-${distance}-${yaw}.png`});throw error;
    }finally{await context.close();}
  }
  assert.deepEqual(report.errors,[]);
  report.passed=true;
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:true,cases:report.cases.length,longestFeedingSeconds:Math.max(...report.cases.map(c=>c.final.longestFeedingSeconds))}));
}finally{await browser.close();}
