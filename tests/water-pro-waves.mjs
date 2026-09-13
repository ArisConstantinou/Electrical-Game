import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';

const url=process.argv[2]??'http://127.0.0.1:5362/Electrical-Game/';
const out=process.argv[3]??'output/water-pro-waves';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={fixture:'Diagnostic uniform volumes at 0.2, 0.6 and 1.8 m. Gameplay step is paused, while real Water Pro renderer frames and vendor GPU wave samples run. Native nozzle filling is tested separately by default-flood-ui.mjs.',scenarios:[]};
const frames=page=>page.evaluate(async()=>{const g=window.__wireTheHouse;for(let i=0;i<60;i++){await new Promise(resolve=>setTimeout(resolve,17));g.renderer.render();await g.renderer.waitForFrame();}});
try{
  for(const backend of ['webgpu','webgl']){
    const page=await browser.newPage({viewport:{width:1366,height:768}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const target=new URL(url);if(backend==='webgl')target.searchParams.set('renderer','webgl');
    await page.goto(target.href);await page.waitForFunction(()=>window.__wireTheHouse?.roomWater.waterProActive);
    await page.locator('#start-button').click();await page.waitForTimeout(600);
    await page.evaluate(()=>{const g=window.__wireTheHouse;g.step=()=>{};g.fpsRig.visible=false;});
    let previous=0;
    for(const depth of [.2,.6,1.8]){
      await page.evaluate(({depth,previous})=>{
        const g=window.__wireTheHouse,r=g.roomWater,f=r.field,c=g.renderer.camera;
        for(let z=0;z<f.rows;z++)for(let x=0;x<f.columns;x++)r.addFloorWater(f.minX+(x+.5)*f.dx,f.minZ+(z+.5)*f.dz,(depth-previous)*f.area*1000);
        r.update(.1);c.position.set(0,2.65,1.8);c.lookAt(0,.6,-2.41);c.updateMatrixWorld(true);
      },{depth,previous});previous=depth;
      await frames(page);
      const a=await page.evaluate(async()=>{
        const g=window.__wireTheHouse,positions=Array.from({length:64},(_,i)=>g.renderer.camera.position.clone().set((i%8-4)*.3,0,(Math.floor(i/8)-4)*.3));
        return await g.renderer.water.sampleWaves(positions);
      });
      await page.screenshot({path:`${out}/${backend}-${depth}m-a.png`});await frames(page);
      const state=await page.evaluate(async()=>{
        const g=window.__wireTheHouse,r=g.roomWater,p=r.surfaceGeometry.getAttribute('position');
        const positions=Array.from({length:64},(_,i)=>g.renderer.camera.position.clone().set((i%8-4)*.3,0,(Math.floor(i/8)-4)*.3));
        const ys=Array.from({length:p.count},(_,i)=>p.getY(i));
        return {samples:await g.renderer.water.sampleWaves(positions),water:r.telemetry,minY:Math.min(...ys),maxY:Math.max(...ys),optics:g.renderer.scene.getObjectByName('Water Pro finite room flooding surface').userData.waterPro,error:g.renderer.renderError};
      });
      await page.screenshot({path:`${out}/${backend}-${depth}m-b.png`});
      const heights=state.samples.map(sample=>sample.height),motionRms=Math.sqrt(state.samples.reduce((sum,sample,i)=>sum+(sample.height-a[i].height)**2,0)/a.length);
      const maxNormalSlope=Math.max(...state.samples.map(sample=>Math.hypot(sample.normal[0],sample.normal[2])));
      assert(Math.abs(state.water.meanDepthMm-depth*1000)<.01,'Real field depth must match injected volume');
      assert(state.minY>depth-.004&&state.maxY<depth+.004,'Base geometry must rise with actual volume');
      assert(Math.abs(state.water.conservationErrorLitres)<1e-5,'Optics must not change water mass');
      assert(motionRms>.002,'Actual vendor FFT waves must move between rendered frames');
      assert(Math.max(...heights)-Math.min(...heights)>.015,'Visible water body requires centimetre scale waves');
      assert(maxNormalSlope>.07,'Actual optical normals must ripple');assert.equal(state.error,'');
      report.scenarios.push({backend,depth,minY:state.minY,maxY:state.maxY,minimumWave:Math.min(...heights),maximumWave:Math.max(...heights),motionRms,maxNormalSlope,optics:state.optics});
    }
    await page.evaluate(()=>{const c=window.__wireTheHouse.renderer.camera;c.position.set(0,1.65,1.8);c.lookAt(0,2.2,-2.41);c.updateMatrixWorld(true);});await frames(page);
    const immersed=await page.evaluate(()=>{const g=window.__wireTheHouse;return {optics:g.renderer.scene.getObjectByName('Water Pro finite room flooding surface').userData.waterPro,fog:!!g.renderer.scene.fogNode,error:g.renderer.renderError};});
    assert.equal(immersed.optics.cameraSubmerged,true);assert(immersed.fog);assert.equal(immersed.error,'');assert.deepEqual(errors,[]);
    await page.screenshot({path:`${out}/${backend}-submerged.png`});await page.close();
  }
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:true,scenarios:report.scenarios}));
