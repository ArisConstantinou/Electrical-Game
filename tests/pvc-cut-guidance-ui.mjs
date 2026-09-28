import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {serveTaskBuild} from './serve-task-build.mjs';

const baseline=process.argv.includes('--baseline');
const live=process.argv.includes('--live');
const out=process.env.PVC_GUIDANCE_OUT??`output/pvc-cut-guidance/${baseline?'before':'after'}`;
const url='http://127.0.0.1:5365/Electrical-Game/';
await mkdir(out,{recursive:true});
const report={baseline,live,url,cases:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  for(const viewport of [{width:390,height:844},{width:1095,height:1139},{width:844,height:390}]){
    const mobile=viewport.width!==1095,name=mobile?viewport.width===390?'portrait':'landscape':'desktop';
    if(process.env.PVC_GUIDANCE_ONLY&&name!==process.env.PVC_GUIDANCE_ONLY)continue;
    const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile});
    await blockPointerLock(context);
    if(!live)await serveTaskBuild(context,url);
    const page=await context.newPage();
    page.on('pageerror',error=>report.errors.push(error.message));
    await page.goto(url);
    await page.locator('#apprentice-count').selectOption('0');
    await page.locator('#start-button').click({timeout:120000});
    await page.evaluate(async()=>{
      const g=window.__wireTheHouse;
      await g.workerBody.ready;
      window.guidanceTick=g.step.bind(g);g.step=()=>{};g.player.update=()=>{};
      g.mixing.finished=true;g.mixing.setActive(false);
      const p=g.pvc,c=g.renderer.camera,box=g.mission.points[1].boxGroup.getWorldPosition(c.position.clone());
      p.bend=new p.bend.constructor(.9);p.bend.angles.fill(90/16);
      p.quantity=1;p.phase='extracting';p.elapsed=1.5;p.animate(.01);
      c.position.set(box.x,.95,box.z+.95);c.lookAt(box);
      g.player.crouched=true;g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;c.updateMatrixWorld(true);
    });
    const tick=n=>page.evaluate(n=>{for(let i=0;i<n;i++)window.guidanceTick(1/60,0,true);},n);
    await page.keyboard.press('KeyE');await tick(74);
    assert.equal(await page.evaluate(()=>window.__wireTheHouse.pvc.phase),'fitting');
    const sample=()=>page.evaluate(()=>{
      const g=window.__wireTheHouse,p=g.pvc,guide=document.querySelector('#pvc-cut-guide');
      const canvas=g.renderer.webgl.domElement,rect=canvas.getBoundingClientRect();
      const projected=p.cutRing.position.clone().project(g.renderer.camera);
      const line=guide?.getBoundingClientRect();
      const expected={x:rect.left+(projected.x+1)*rect.width/2,y:rect.top+(1-projected.y)*rect.height/2};
      return{phase:p.phase,error:p.telemetry.fitErrorMm,cutCm:p.telemetry.cutHeightCm,
        status:document.querySelector('#pvc-cut-height-status')?.textContent??'',
        guideVisible:!!guide&&!guide.hidden,guideCenter:line?{x:line.left+line.width/2,y:line.top+line.height/2}:null,expected,
        width:line?.width??0,height:line?.height??0,guideRect:line?{left:line.left,top:line.top,right:line.right,bottom:line.bottom}:null,
        guideStyleLeft:guide?.style.left,guideTransform:guide?.style.transform,canvas:{left:rect.left,top:rect.top,width:rect.width,height:rect.height},
        shell:(()=>{const r=g.hud.shell.getBoundingClientRect();return{left:r.left,top:r.top,width:r.width,height:r.height,scrollTop:g.hud.shell.scrollTop,scrollLeft:g.hud.shell.scrollLeft};})(),
        guideStyleTop:guide?.style.top,guideOffsetTop:guide?.offsetTop,computed:(()=>{if(!guide)return null;const c=getComputedStyle(guide);return{marginTop:c.marginTop,top:c.top,transform:c.transform,translate:c.translate,alignSelf:c.alignSelf};})(),
        offsetParent:(()=>{const r=guide?.offsetParent?.getBoundingClientRect();return r?{left:r.left,top:r.top,width:r.width,height:r.height}:null;})()};
    });
    const snap=async label=>{await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${name}-${label}.png`});};
    await tick(5);const start=await sample();await snap('flush');
    if(!baseline){
      assert(start.guideVisible,`${name}: cut guide missing`);
      assert(Math.hypot(start.guideCenter.x-start.expected.x,start.guideCenter.y-start.expected.y)<3,`${name}: line is not on physical cutting point: ${JSON.stringify(start)}`);
      assert.match(start.status,/ΣΤΟ ΥΨΟΣ/);
    }
    await page.evaluate(()=>{const p=window.__wireTheHouse.pvc;p.supportS=.2;p.setCut(.55);p.setFitCamera();});
    await tick(5);const moved=await sample();await snap('far');
    if(!baseline){
      assert(moved.guideVisible,`${name}: cut guide disappeared after moving`);
      assert(Math.hypot(moved.guideCenter.x-moved.expected.x,moved.guideCenter.y-moved.expected.y)<3,`${name}: line does not follow new physical cut`);
      assert(Math.abs(moved.guideCenter.y-start.guideCenter.y)>5,`${name}: line did not move on screen`);
      assert.match(moved.status,/ΜΑΚΡΙΑ/);
      assert.match(moved.status,/↓/);
    }
    const proximity=[];
    if(name==='portrait'&&!baseline){
      const setError=async (millimetres,reset=false)=>{
        await page.evaluate(({millimetres,reset})=>{
          const p=window.__wireTheHouse.pvc,low=p.cutFrom,high=p.cutLimit();
          let best=low,difference=Infinity;
          for(let i=0;i<=2000;i++){
            const candidate=low+(high-low)*i/2000,gap=Math.abs(p.fitErrorAt(candidate)-millimetres);
            if(gap<difference){difference=gap;best=candidate;}
          }
          if(difference>1)throw new Error(`Cannot stage ${millimetres} mm error: best ${difference} mm away`);
          p.cutS=best;p.cutHeightBlocked=false;p.cutSnapped=false;
          if(reset)p.lastCutCue=null;
          p.setFitCamera();
        },{millimetres,reset});
        await tick(6);
        const result=await sample();proximity.push({requestedMm:millimetres,status:result.status,errorMm:result.error});
        return result;
      };
      assert.match((await setError(30)).status,/ΠΙΟ ΚΟΝΤΑ/);
      const almost=await setError(5);assert.match(almost.status,/ΣΧΕΔΟΝ/);await snap('almost');
      assert.match((await setError(20)).status,/ΠΙΟ ΜΑΚΡΙΑ/);
      assert.match((await setError(20,true)).status,/ΚΟΝΤΑ/);
      assert.match((await setError(70,true)).status,/ΜΑΚΡΙΑ/);
      assert.match((await setError(-20,true)).status,/↑/);
      await page.evaluate(()=>window.__wireTheHouse.pvc.snapCutFlush());await tick(6);
      assert.match((await sample()).status,/ΣΤΟ ΥΨΟΣ/);
      await page.locator('#pvc-entry-next').tap();await tick(18);
      const nextEntry=await sample();
      assert(nextEntry.guideVisible&&Math.hypot(nextEntry.guideCenter.x-nextEntry.expected.x,nextEntry.guideCenter.y-nextEntry.expected.y)<3,'guide misses the selected second entry');
      await page.evaluate(()=>{const p=window.__wireTheHouse.pvc;p.supportS=.2;p.cutS=p.cutLimit()-.025;p.setFitCamera();});
      await tick(24);const curved=await sample();await snap('curved');
      assert(curved.guideVisible&&Math.hypot(curved.guideCenter.x-curved.expected.x,curved.guideCenter.y-curved.expected.y)<3,'guide misses a cut near the bend');
      const measureOverlapsZoom=await page.evaluate(()=>{
        const a=document.querySelector('#pvc-live-measure').getBoundingClientRect(),b=document.querySelector('#pvc-fit-zoom').getBoundingClientRect();
        return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
      });
      assert(!measureOverlapsZoom,'low cut measurement is hidden under the zoom button');
    }
    await page.evaluate(()=>window.__wireTheHouse.pvc.snapCutFlush());await tick(20);
    const performanceProfile=await page.evaluate(()=>{
      const g=window.__wireTheHouse,samples=[];
      for(let i=0;i<120;i++){
        const start=performance.now();window.guidanceTick(1/60,0,true);samples.push(performance.now()-start);
      }
      samples.sort((a,b)=>a-b);
      return{simulationP95Ms:samples[113],simulationMaxMs:samples[119],calls:g.renderer.webgl.info.render.calls,
        triangles:g.renderer.webgl.info.render.triangles,geometries:g.renderer.webgl.info.memory.geometries,
        textures:g.renderer.webgl.info.memory.textures,jsHeap:performance.memory?.usedJSHeapSize??null};
    });
    report.cases.push({name,viewport,start,moved,proximity,performanceProfile});
    await context.close();
  }
  assert.deepEqual(report.errors,[]);
  report.passed=!baseline;
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({out,passed:report.passed,cases:report.cases.map(c=>({name:c.name,start:c.start.status,moved:c.moved.status,guideVisible:c.moved.guideVisible})),errors:report.errors}));
