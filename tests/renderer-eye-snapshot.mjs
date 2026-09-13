import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';

const url=process.argv[2]??'http://127.0.0.1:5362/Electrical-Game/';
const out=process.argv[3]??'output/renderer-eye-snapshot';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={url,fixture:'Render isolation diagnostic: the real game settles its tool stance, then gameplay stepping pauses. Gaze, logical camera changes and a 1 L puddle are supplied directly. Actual WebGPU/WebGL Water Pro rendering, asynchronous frame guard and viewport resizing remain active. Native gaze controls are tested separately.',scenarios:[]};
try{
  for(const backend of ['webgpu','webgl']){
    const page=await browser.newPage({viewport:{width:1366,height:768}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const target=new URL(url);if(backend==='webgl')target.searchParams.set('renderer','webgl');
    await page.goto(target.href);await page.waitForFunction(()=>window.__wireTheHouse?.roomWater.waterProActive);
    await page.locator('#start-button').click();await page.waitForTimeout(600);
    await page.evaluate(async()=>{
      const g=window.__wireTheHouse,c=g.renderer.camera;
      g.selectTool('hammer');c.position.set(0,1.65,-1.4);c.lookAt(0,1.3,g.room.brickWall.volume.frontZ);
      g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;
      for(let i=0;i<150;i++)g.step(1/60);
      g.step=()=>{};g.roomWater.addFloorWater(0,1,1);g.roomWater.update(.05);
      await g.renderer.waitForFrame();g.renderer.eyeYaw=0;g.renderer.eyePitch=0;
      g.renderer.render();await g.renderer.waitForFrame();
    });
    await page.screenshot({path:`${out}/${backend}-straight.png`});
    const state=await page.evaluate(async()=>{
      const g=window.__wireTheHouse,r=g.renderer,c=r.camera,tool=g.fpsRig.tools.get('hammer');
      tool.updateWorldMatrix(true,true);
      const matrix=tool.matrixWorld.clone(),headPosition=c.position.clone(),headRotation=c.quaternion.clone();
      const tip=g.fpsRig.chiselTipWorld.clone(),screen=tip.clone().project(r.renderCamera);
      r.eyeYaw=.14;r.eyePitch=.06;const accepted=r.render();await r.waitForFrame();
      tool.updateWorldMatrix(true,true);
      const gaze={accepted,worldMatrixError:Math.max(...tool.matrixWorld.elements.map((n,i)=>Math.abs(n-matrix.elements[i]))),headPositionError:c.position.distanceTo(headPosition),headAngleError:c.quaternion.angleTo(headRotation),viewAngle:r.renderCamera.quaternion.angleTo(c.quaternion),screenShift:tip.clone().project(r.renderCamera).distanceTo(screen),rigVisible:g.fpsRig.visible,rigParentStillHead:g.fpsRig.parent===c,renderDetached:r.renderCamera.parent===null};
      r.eyeYaw=.12;const started=r.render();
      const savedRotation=r.renderCamera.quaternion.clone(),savedPosition=r.renderCamera.position.clone(),savedProjection=r.renderCamera.projectionMatrix.clone();
      // These can happen while an async water pass is pending. None may alter
      // the accepted view, even Water Pro.resize which normally edits its camera.
      c.rotation.y+=.31;c.position.x+=.05;r.eyeYaw=-.22;r.resize();
      const rejected=r.render();
      const pending={started,rejected,resizeQueued:!!r.pendingSize,angleError:r.renderCamera.quaternion.angleTo(savedRotation),positionError:r.renderCamera.position.distanceTo(savedPosition),projectionError:Math.max(...r.renderCamera.projectionMatrix.elements.map((n,i)=>Math.abs(n-savedProjection.elements[i])))};
      await r.waitForFrame();c.position.copy(headPosition);c.quaternion.copy(headRotation);
      // Same lens fields exposed by Studio must survive the queued vendor
      // resize and be copied into the next accepted independent-eye camera.
      c.fov=83;c.zoom=1.15;c.near=.04;c.far=48;c.updateProjectionMatrix();
      r.eyeYaw=.14;r.eyePitch=.06;r.render();await r.waitForFrame();
      const lens={fov:r.renderCamera.fov,zoom:r.renderCamera.zoom,near:r.renderCamera.near,far:r.renderCamera.far,projectionXError:r.renderCamera.projectionMatrix.elements[0]-c.projectionMatrix.elements[0],projectionYError:r.renderCamera.projectionMatrix.elements[5]-c.projectionMatrix.elements[5]};
      return{gaze,pending,lens,backend:g.roomWater.waterProBackend,error:r.renderError};
    });
    assert(state.gaze.accepted);assert(state.gaze.worldMatrixError<1e-8);assert(state.gaze.headPositionError<1e-8);assert(state.gaze.headAngleError<1e-7);
    assert(state.gaze.viewAngle>.1);assert(state.gaze.screenShift>.05);
    assert(state.gaze.rigVisible&&state.gaze.rigParentStillHead&&state.gaze.renderDetached);
    assert(state.pending.started&&state.pending.resizeQueued);assert.equal(state.pending.rejected,false);
    assert(state.pending.angleError<1e-7);assert.equal(state.pending.positionError,0);assert.equal(state.pending.projectionError,0);
    assert.equal(state.lens.fov,83);assert.equal(state.lens.zoom,1.15);assert.equal(state.lens.near,.04);assert.equal(state.lens.far,48);
    assert(Math.abs(state.lens.projectionXError)<1e-10&&Math.abs(state.lens.projectionYError)<1e-10);
    await page.screenshot({path:`${out}/${backend}-gaze.png`});
    const oldAspect=await page.evaluate(()=>window.__wireTheHouse.renderer.renderCamera.aspect);
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(()=>window.__wireTheHouse.renderer.camera.aspect<.5);
    const portrait=await page.evaluate(async()=>{
      const r=window.__wireTheHouse.renderer,before=r.renderCamera.aspect;
      const accepted=r.render();await r.waitForFrame();
      const canvas=r.webgl.domElement,rect=canvas.getBoundingClientRect();
      return{before,accepted,aspect:r.renderCamera.aspect,logicalAspect:r.camera.aspect,projectionXError:r.renderCamera.projectionMatrix.elements[0]-r.camera.projectionMatrix.elements[0],projectionYError:r.renderCamera.projectionMatrix.elements[5]-r.camera.projectionMatrix.elements[5],canvas:{width:canvas.width,height:canvas.height,cssWidth:rect.width,cssHeight:rect.height,pixelRatio:r.webgl.getPixelRatio()},error:r.renderError};
    });
    assert.equal(portrait.before,oldAspect,'Resize must await an accepted frame before changing the view camera');
    assert(portrait.accepted);assert.equal(portrait.aspect,390/844);assert.equal(portrait.aspect,portrait.logicalAspect);
    assert.equal(portrait.canvas.width,Math.floor(390*portrait.canvas.pixelRatio));assert.equal(portrait.canvas.height,Math.floor(844*portrait.canvas.pixelRatio));
    assert.equal(portrait.canvas.cssWidth,390);assert.equal(portrait.canvas.cssHeight,844);
    assert(Math.abs(portrait.projectionXError)<1e-10&&Math.abs(portrait.projectionYError)<1e-10);
    assert.equal(state.error,'');assert.equal(portrait.error,'');assert.deepEqual(errors,[]);
    await page.screenshot({path:`${out}/${backend}-portrait.png`});
    await page.setViewportSize({width:844,height:390});
    await page.waitForFunction(()=>window.__wireTheHouse.renderer.camera.aspect>2);
    const landscape=await page.evaluate(async()=>{
      const r=window.__wireTheHouse.renderer;r.render();await r.waitForFrame();
      const canvas=r.webgl.domElement,rect=canvas.getBoundingClientRect();
      return{aspect:r.renderCamera.aspect,width:canvas.width,height:canvas.height,cssWidth:rect.width,cssHeight:rect.height,pixelRatio:r.webgl.getPixelRatio(),error:r.renderError};
    });
    assert.equal(landscape.aspect,844/390);assert.equal(landscape.width,Math.floor(844*landscape.pixelRatio));assert.equal(landscape.height,Math.floor(390*landscape.pixelRatio));
    assert.equal(landscape.cssWidth,844);assert.equal(landscape.cssHeight,390);assert.equal(landscape.error,'');assert.deepEqual(errors,[]);
    await page.screenshot({path:`${out}/${backend}-landscape.png`});
    report.scenarios.push({backend,...state,portrait,landscape,errors});await page.close();
  }
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:true,backends:report.scenarios.map(s=>s.backend),checks:['stationary body and tool','independent eye projection','pending frame isolation','deferred Water Pro resize','Studio lens fields','portrait/landscape projection and canvas size']}));
