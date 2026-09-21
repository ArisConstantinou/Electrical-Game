import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';

const url=process.argv[2]??'http://127.0.0.1:5365/Electrical-Game/';
const out='output/mixing-tool-grips';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={url,mobileIsEmulation:true,cases:[],errors:[],passed:false};
try{
  for(const layout of [{name:'desktop',width:1366,height:768,mobile:false},{name:'portrait',width:390,height:844,mobile:true},{name:'landscape',width:844,height:390,mobile:true}]){
    const context=await browser.newContext({viewport:{width:layout.width,height:layout.height},isMobile:layout.mobile,hasTouch:layout.mobile});await blockPointerLock(context);
    const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
    await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.mixing,undefined,{timeout:120000});await page.selectOption('#apprentice-count','0');await page.locator('#start-button').click();await page.waitForFunction(()=>getComputedStyle(document.querySelector('#start-screen')).opacity==='0');
    await page.evaluate(()=>{const g=window.__wireTheHouse,m=g.mixing,c=g.renderer.camera,b=m.models.bucket.getWorldPosition(c.position.clone());g.step=()=>{};c.position.set(b.x-.55,g.player.eyeHeight,b.z-1.12);c.lookAt(b.x,.3,b.z);c.updateMatrixWorld(true);m.setActive(true);m.update(0,false,false);m.present();});
    const sample=()=>page.evaluate(()=>{
      const g=window.__wireTheHouse,m=g.mixing,model=m.heldTools.get(m.tool);
      m.present();
      return {tool:m.tool,activity:m.telemetry.activity,modelPosition:model.position.toArray(),hands:m.arms.filter(a=>a.side>0||model.userData.secondaryGripPoint).map(a=>{
        const grip=a.hand.position.clone().fromArray(a.side===1?model.userData.gripPoint:model.userData.secondaryGripPoint);model.localToWorld(grip);
        const back=a.hand.position.clone().set(0,0,1);if(m.tool==='mixer')back.applyQuaternion(a.hand.children[0].quaternion).applyQuaternion(a.hand.quaternion);
        return{side:a.side,gripError:a.hand.getWorldPosition(grip.clone()).distanceTo(grip),reach:a.shoulder.distanceTo(a.wrist),forearmLength:a.elbow.distanceTo(a.wrist),rotation:a.hand.quaternion.toArray(),backUp:back.y,gripSection:a.hand.userData.gripSection};
      }),overflow:document.documentElement.scrollWidth>innerWidth};
    });
    const shot=async name=>{await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${layout.name}-${name}.png`});};
    const cases=[];
    for(const tool of ['trowel','shovel','mixer']){
      await page.locator(`[data-mix-equip="${tool}"]`).click({force:true});
      const idle=await sample();
      for(const hand of idle.hands){assert(hand.gripError<1e-6,`${tool} hand must seat on authored grip`);assert(hand.reach<.57,`${tool} idle arm stays in reach`);assert(Math.abs(hand.forearmLength-.27)<.001,`${tool} forearm remains connected without stretching`);}
      if(tool==='mixer')for(const hand of idle.hands){assert(hand.backUp>.98,'Mixer knuckles face upward in a mirrored overhand grasp');assert.equal(hand.gripSection[0],hand.side>0?.033:.028,'Fingers fit the actual mixer handle radius');}
      await shot(`${tool}-held`);cases.push(idle);
      if(tool==='mixer'){
        const inserted=await page.evaluate(()=>{
          const g=window.__wireTheHouse,m=g.mixing,c=g.renderer.camera;
          const acceptedRequest=m.action('insert');const pending=Boolean(m.mixerApproach)&&!m.inserted;m.chooseTool('mixer');
          m.useAimedObject({kind:'bucket',object:m.models.bucket});const aimedPending=Boolean(m.mixerApproach)&&!m.inserted;m.chooseTool('mixer');
          const b=m.models.bucket.getWorldPosition(c.position.clone());g.player.crouched=true;c.position.set(b.x-.18,.95,b.z-.32);c.lookAt(b.x,.3,b.z);c.updateMatrixWorld(true);
          const accepted=m.action('insert');m.present();
          return{acceptedRequest,pending,aimedPending,accepted,hands:m.arms.map(a=>({reach:a.shoulder.distanceTo(a.wrist),forearm:a.elbow.distanceTo(a.wrist),upperVisible:a.upper.visible}))};
        });
        assert(inserted.acceptedRequest&&inserted.pending&&inserted.aimedPending,'Both paths prepare the stance before seating unreachable mixer');
        assert(inserted.accepted,'A crouched worker beside the bucket can insert the mixer');
        assert(inserted.hands.every(hand=>hand.reach<.57&&Math.abs(hand.forearm-.27)<.001),'Inserted mixer keeps both forearms connected');
        assert(inserted.hands.every(hand=>!hand.upperVisible),'Mounted mixer keeps hidden shoulder caps behind the first-person camera');
        await shot('mixer-inserted');
        const left=await page.evaluate(()=>{const g=window.__wireTheHouse,m=g.mixing;g.renderer.camera.position.z-=1;m.update(1/60,false,true);m.present();return{inserted:m.inserted,running:m.mixerRunning,held:m.telemetry.heldToolVisible};});
        assert(!left.inserted&&!left.running&&left.held,'Walking away lifts the mixer into reachable hands and stops motor');
        const edge=await page.evaluate(()=>{const g=window.__wireTheHouse,m=g.mixing,c=g.renderer.camera,b=m.models.bucket.getWorldPosition(c.position.clone());g.player.crouched=true;c.position.set(b.x-.3,.95,b.z-.55);c.lookAt(b.x,.3,b.z);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;c.updateMatrixWorld(true);const initiallyReachable=m.canReachMixer(m.models.bucket),accepted=m.action('insert'),pending=m.telemetry.approaching;for(let i=0;i<50;i++)m.update(1/60,false,false);m.present();return{initiallyReachable,accepted,pending,inserted:m.inserted,hands:m.arms.map(a=>({reach:a.shoulder.distanceTo(a.wrist),forearm:a.elbow.distanceTo(a.wrist)}))};});
        assert(!edge.initiallyReachable&&edge.accepted&&edge.pending&&edge.inserted,'Marginal crouched stance must first move into reach');
        assert(edge.hands.every(hand=>hand.reach<.57&&Math.abs(hand.forearm-.27)<.001),'Automatic mixer stance keeps both forearms connected');await shot('mixer-assisted');cases.push({inserted,left,edge});continue;
      }
      await page.evaluate(tool=>{const m=window.__wireTheHouse.mixing;m.beginActivity(tool==='trowel'?'tear':'sand',tool==='trowel'?m.models.sacks[0]:m.models.sand);},tool);
      const frames=[];
      for(let i=0;i<100;i++){
        await page.evaluate(()=>window.__wireTheHouse.mixing.update(1/60,false,false));const frame=await sample();frames.push(frame);
        for(const hand of frame.hands){assert(hand.reach<.57,`${tool} activity must not detach forearm`);assert(Math.abs(hand.forearmLength-.27)<.001,`${tool} work forearm remains connected`);}
        if(i===25||i===63)await shot(`${tool}-work-${i}`);
      }
      for(let i=1;i<frames.length;i++)assert(Math.hypot(...frames[i].modelPosition.map((v,j)=>v-frames[i-1].modelPosition[j]))<.13,`${tool} cannot jump between source and bucket frame ${i}: ${JSON.stringify([frames[i-1].modelPosition,frames[i].modelPosition])}`);
      cases.push({tool,workFrames:frames.length});
    }
    report.cases.push({layout:layout.name,cases});await context.close();
  }
  assert.deepEqual(report.errors,[]);report.passed=true;
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({passed:report.passed,report:`${out}/report.json`}));
