import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const url=process.argv[2]??'http://127.0.0.1:5362/Electrical-Game/';
const out='output/low-work-arms';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={url,fixture:'Native tool selection; diagnostic camera heights and frozen game clock isolate low-work limb geometry. Mobile is Chromium emulation.',scenarios:[],errors:[]};
try{
  for(const spec of [{name:'desktop',width:1366,height:768},{name:'mobile',width:390,height:844,mobile:true}]){
    const page=await browser.newPage({viewport:{width:spec.width,height:spec.height},isMobile:!!spec.mobile,hasTouch:!!spec.mobile});
    page.on('pageerror',error=>report.errors.push(error.message));
    await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse,undefined,{timeout:120000});await page.locator('#start-button')[spec.mobile?'tap':'click']();
    await page.waitForTimeout(650);await page.evaluate(()=>{document.exitPointerLock();const g=window.__wireTheHouse;window.__armStep=g.step.bind(g);g.step=()=>{};});await page.waitForTimeout(80);
    for(const[tool,key]of [['fitting','Digit5'],['spring','Digit1'],['cutter','Digit2'],['trowel','Digit7'],['hose','Digit8']]){
      if(spec.mobile)await page.locator(`[data-tool="${tool}"]`).tap();else await page.keyboard.press(key);
      for(const height of [1.65,.68]){
        const result=await page.evaluate(async({height})=>{
          const g=window.__wireTheHouse,c=g.renderer.camera;window.__armStep(0);
          c.position.set(0,height,-1.95);c.lookAt(0,height===.68?.08:1.25,g.room.brickWall.volume.frontZ);c.updateMatrixWorld(true);
          g.fpsRig.show(g.selectedTool);g.fpsRig.poseArms(c);g.renderer.render();await g.renderer.waitForFrame();
          const arms=g.fpsRig.armSets.get(g.selectedTool),left=arms.find(a=>a.side<0);let minY=Infinity;
          left.group.updateWorldMatrix(true,true);
          left.group.traverse(object=>{if(!object.isMesh)return;const p=object.geometry.getAttribute('position');if(!p)return;const v=c.position.clone();for(let i=0;i<p.count;i++)minY=Math.min(minY,v.fromBufferAttribute(p,i).applyMatrix4(object.matrixWorld).y);});
          return{height,tool:g.selectedTool,minY,arms:g.fpsRig.debugPose().arms,upperActual:left.shoulder.distanceTo(left.elbow),forearmActual:left.elbow.distanceTo(left.wrist)};
        },{height});
        const left=result.arms.find(a=>a.side<0);
        assert.equal(result.arms.filter(a=>a.gripping).length,1);
        assert.equal(left.gripRole,'resting');
        assert(Math.abs(result.upperActual-.31)<1e-8,'upper arm does not stretch');
        assert(Math.abs(result.forearmActual-.27)<1e-8,'forearm does not stretch');
        if(height===.68){assert(result.minY>.025,`${spec.name}/${tool}: free arm and all fingers must remain above floor`);assert(left.wrist[1]>=.2299);}
        else assert(Math.abs(left.shoulder[1]-left.wrist[1]-.55)<1e-8,'standing hang stays unchanged');
        report.scenarios.push({viewport:spec.name,...result});
        if(tool==='fitting'&&height===.68)await page.screenshot({path:`${out}/${spec.name}-low-box-free-hand.png`});
      }
    }
    await page.close();
  }
  assert.deepEqual(report.errors,[]);console.log(JSON.stringify({scenarios:report.scenarios.length,minFloorClearanceM:Math.min(...report.scenarios.map(s=>s.minY)),errors:report.errors}));
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
