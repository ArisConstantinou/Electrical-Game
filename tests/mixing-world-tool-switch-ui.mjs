import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';

const url=process.argv.find(a=>/^https?:/.test(a))??'http://127.0.0.1:5365/Electrical-Game/';
const repro=process.argv.includes('--repro');
// Reproduction serves the committed pre-fix module without changing the shared checkout.
const baselineRef=process.argv.find(a=>a.startsWith('--baseline-ref='))?.split('=')[1]??'HEAD';
const baselineCommit=repro?execFileSync('git',['rev-parse',baselineRef],{encoding:'utf8'}).trim():null;
const baselineSource=repro?execFileSync('git',['show',`${baselineCommit}:src/systems/MixingStation.ts`],{encoding:'utf8'}):null;
const out='output/mixing-world-tool-switch';await mkdir(out,{recursive:true});
const report={url,mobileIsEmulation:true,repro,baselineCommit,cases:[],errors:[],passed:false};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  for(const layout of [{name:'desktop',width:1366,height:768,mobile:false},{name:'portrait',width:390,height:844,mobile:true},{name:'landscape',width:844,height:390,mobile:true}]){
    const context=await browser.newContext({viewport:{width:layout.width,height:layout.height},isMobile:layout.mobile,hasTouch:layout.mobile});await blockPointerLock(context);
    const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
    if(repro)await page.route('**/src/systems/MixingStation.ts*',async route=>{
      const live=await route.fetch(),liveSource=await live.text();
      const three=liveSource.match(/import \* as THREE from ["']([^"']+)["']/)?.[1];assert(three,'Vite-resolved Three import');
      const compiled=ts.transpileModule(baselineSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/(from\s+|import\s+)(["'])([^"']+)\2/g,(all,prefix,quote,specifier)=>{
        const resolved=specifier==='three'?three:specifier.startsWith('.')?new URL(specifier+(/\.css$/.test(specifier)?'':'.ts'),route.request().url()).pathname:specifier;return `${prefix}${quote}${resolved}${quote}`;
      });await route.fulfill({response:live,body:compiled,contentType:'application/javascript'});
    });
    await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.mixing,undefined,{timeout:120000});await page.locator('#start-button')[layout.mobile?'tap':'click']();await page.waitForTimeout(350);
    await page.evaluate(()=>{const g=window.__wireTheHouse;window.__switchStep=g.step.bind(g);g.step=()=>{};window.__wallCalls=0;const perform=g.performAction.bind(g);g.performAction=(...args)=>{window.__wallCalls++;return perform(...args);};});
    // The production horseshoe deliberately separates the sacks and shovel.
    // Retain the original competing-target regression with an explicit nearby
    // sack fixture; normal-layout access is covered by immersive/drum UI tests.
    await page.evaluate(()=>{const m=window.__wireTheHouse.mixing.models;m.sacks[0].position.copy(m.shovel.position).add({x:.35,y:-.13,z:.28});m.group.updateMatrixWorld(true);});
    const step=(n=1)=>page.evaluate(count=>{for(let i=0;i<count;i++)window.__switchStep(1/60);},n);
    const state=()=>page.evaluate(()=>{const g=window.__wireTheHouse,m=g.mixing;return{mixing:m.telemetry,pendingTool:m.pendingTool,prompt:document.querySelector('#mixing-world-prompt').textContent,interactLabel:document.querySelector('#mobile-interact small')?.textContent,wallCalls:window.__wallCalls,waterVisible:m.models.water.visible,shovelVisible:m.models.shovel.visible,launched:g.mortar.telemetry.launchedKg,overflow:document.documentElement.scrollWidth>innerWidth,renderError:g.renderer.renderError};});
    const aim=async(kind,cone=false)=>{
      const evidence=await page.evaluate(({kind,cone})=>{
        const g=window.__wireTheHouse,m=g.mixing,c=g.renderer.camera,models=m.models;
        const root={water:models.water,trowel:m.stationTrowel,shovel:models.shovel,mixer:models.mixer,bucket:models.bucket,sand:models.sand,sack:models.sacks[0]}[kind];
        models.group.updateMatrixWorld(true);
        const roots=[models.bucket,models.sand,...models.sacks,models.rinse,models.water,models.mixer,models.shovel,m.stationTrowel].filter(o=>o.visible);
        const points=[];root.traverse(o=>{if(o.isMesh){o.geometry.computeBoundingBox();points.push(o.localToWorld(o.geometry.boundingBox.getCenter(c.position.clone())));}});
        const origin=models.group.getWorldPosition(c.position.clone());
        const belongs=o=>{while(o){if(o===root)return true;o=o.parent;}return false;};
        for(const dz of [-.92,-1.4,-1.8,-2.1,-.55])for(const dx of [0,-.4,.4,-.8,.8,-1.2,1.2])for(const height of [1.65,.95])for(const p of points){
          if(Math.hypot(dx,dz)>=2.3)continue;
          c.position.set(origin.x+dx,height,origin.z+dz);c.lookAt(p);c.updateMatrixWorld(true);m.ray.setFromCamera({x:0,y:0},c);
          const hit=m.ray.intersectObjects(roots,true)[0],preferred={kind:'sack'},sackPoint=models.sacks[0].getWorldPosition(c.position.clone()).add({x:0,y:.32,z:0}).sub(c.position),inCone=sackPoint.length()<=3.35&&c.getWorldDirection(c.position.clone()).dot(sackPoint.normalize())>.91;
          if(hit&&hit.distance<=3.2&&belongs(hit.object)&&(!cone||inCone)){
            g.player.crouched=height===.95;g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;
            return{kind,directHit:hit.object.name||hit.object.type,distance:hit.distance,preferred:preferred?.kind,inCone,camera:c.position.toArray(),point:p.toArray()};
          }
        }
        throw new Error(`No reachable direct ray hit for ${kind}, cone=${cone}`);
      },{kind,cone});await step(2);return evidence;
    };
    const button=async selector=>{await page.locator(selector)[layout.mobile?'tap':'click']();await step(2);};
    const equip=tool=>button(`[data-mix-equip="${tool}"]`);
    const cdp=layout.mobile?await context.newCDPSession(page):null;
    const press=async(kind='interact',frames=1)=>{
      if(layout.mobile){const box=await page.locator(kind==='use'?'#look-joystick':'#mobile-interact').boundingBox();assert(box);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2,id:91}]});}
      else if(kind==='use'){await page.mouse.move(layout.width*.5,layout.height*.42);await page.mouse.down();}else await page.keyboard.down('KeyE');
      await step(frames);
      if(layout.mobile)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else if(kind==='use')await page.mouse.up();else await page.keyboard.up('KeyE');await step(2);
    };
    const shot=async name=>{await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${layout.name}-${name}.png`});};
    await aim('sack');await equip('trowel');await page.evaluate(()=>window.__wireTheHouse.mixing.batch.openSack(0));await aim('sack');await press('use');await step(100);
    const cement=await state();assert.equal(cement.mixing.batch.cementScoops,1,'An actual cement stroke establishes the reported starting state');
    const overlap=await aim('shovel',true),beforePickup=await state();await press();await step(100);const picked=await state();await shot(repro?'baseline-world-shovel':'world-shovel');
    if(repro){report.cases.push({layout:layout.name,cement,overlap,beforePickup,picked});await context.close();continue;}
    assert.equal(beforePickup.mixing.aimedTarget,'shovel','Exact visible shovel wins even inside preferred cement sack cone');assert.match(beforePickup.prompt,/ΠΙΑΣΕ ΦΤΥΑΡΙ/);if(layout.mobile)assert.equal(beforePickup.interactLabel,beforePickup.prompt.replace(/^.*? · /,''),'Mobile action agrees with visible world prompt');
    assert.equal(picked.mixing.tool,'shovel','INTERACT picks up the physical shovel after toolbar trowel selection');assert.equal(picked.mixing.batch.cementScoops,cement.mixing.batch.cementScoops,'Selecting shovel cannot add another cement scoop');
    await aim('sand');await press('use');await step(100);const sand=await state();assert.equal(sand.mixing.batch.sandScoops,1,'Selected world shovel performs an actual sand stroke');
    // A fresh world pickup during a finite cement stroke must be remembered once.
    await equip('trowel');await aim('sack');await press('use');const duringCement=await state();assert.equal(duringCement.mixing.activity,'cement');await aim('shovel',true);await press('interact',12);const queuedCement=await state();assert.equal(queuedCement.pendingTool,'shovel','World shovel request is queued while cement is moving');assert.equal(queuedCement.mixing.tool,'trowel');await step(120);const switchedCement=await state();assert.equal(switchedCement.mixing.tool,'shovel');assert.equal(switchedCement.mixing.batch.cementScoops,2,'Queued pickup completes precisely the in-flight cement scoop');await step(120);assert.equal((await state()).mixing.batch.cementScoops,2,'Held pickup cannot repeat cement after switch');
    // A direct world pickup during pouring also waits for the jug to finish.
    await equip('water');await aim('bucket');await press('use');await aim('shovel');await press();const queuedWater=await state();assert.equal(queuedWater.mixing.activity,'water');assert.equal(queuedWater.pendingTool,'shovel');await step(100);const switchedWater=await state();assert.equal(switchedWater.mixing.tool,'shovel');assert(Math.abs(switchedWater.mixing.batch.waterLitres-20/3)<1e-8);
    // The dedicated visible put-down button works both during and after pouring.
    await page.evaluate(()=>window.__wireTheHouse.mixing.batch.discard());await equip('water');await aim('bucket');await press('use');await button('#mixing-put-down');const queuedPutDown=await state();assert.equal(queuedPutDown.pendingTool,'hands');assert.equal(queuedPutDown.mixing.activity,'water');assert.equal(queuedPutDown.mixing.tool,'water');await step(100);const putDown=await state();assert.equal(putDown.mixing.tool,'hands');assert.equal(putDown.waterVisible,true);assert(Math.abs(putDown.mixing.batch.waterLitres-20/3)<1e-8);await shot('water-put-down');
    await aim('water');const waterPrompt=await state();assert.match(waterPrompt.prompt,/ΠΙΑΣΕ.*(?:ΝΕΡ|ΚΑΝΑΤ)/);await press();assert.equal((await state()).mixing.tool,'water','World jug pickup matches its prompt');await button('#mixing-put-down');const immediatePutDown=await state();assert.equal(immediatePutDown.mixing.tool,'hands');assert.equal(immediatePutDown.mixing.batch.massKg,putDown.mixing.batch.massKg,'Putting down the jug preserves the actual water');
    const controls=await page.locator('#mixing-toolbelt').evaluate(el=>Array.from(el.querySelectorAll('button')).map(button=>({id:button.id||button.dataset.mixEquip,text:button.textContent,bounds:button.getBoundingClientRect().toJSON(),textBounds:Array.from(button.querySelectorAll('span,small')).map(label=>{const range=document.createRange();range.selectNodeContents(label);return range.getBoundingClientRect().toJSON();}),fontSize:Math.min(...Array.from(button.querySelectorAll('span,small')).map(label=>parseFloat(getComputedStyle(label).fontSize)))})));
    for(const control of controls){assert(control.bounds.x>=0&&control.bounds.right<=layout.width&&control.bounds.y>=0&&control.bounds.bottom<=layout.height,`${control.id} fits ${layout.name}`);assert(control.fontSize>=12,`${control.id} label is readable`);for(const bounds of control.textBounds)assert(bounds.x>=control.bounds.x-1&&bounds.right<=control.bounds.right+1&&bounds.y>=control.bounds.y&&bounds.bottom<=control.bounds.bottom,`${control.id} text fits its button in ${layout.name}`);}
    assert.equal(immediatePutDown.wallCalls,0);assert.equal(immediatePutDown.launched,0);assert.equal(immediatePutDown.overflow,false);assert.equal(immediatePutDown.renderError,'');report.cases.push({layout:layout.name,overlap,beforePickup,picked,sand,queuedCement,switchedCement,queuedWater,switchedWater,queuedPutDown,putDown,immediatePutDown,controls});await context.close();
  }
  assert.deepEqual(report.errors,[]);report.passed=!repro;
}finally{await writeFile(`${out}/${repro?'repro':'report'}.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({passed:report.passed,repro,layouts:report.cases.map(c=>c.layout),report:`${out}/${repro?'repro':'report'}.json`}));
