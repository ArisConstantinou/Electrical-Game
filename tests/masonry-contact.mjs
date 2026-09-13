import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const url=process.argv[2]??'http://127.0.0.1:5362/Electrical-Game/';
const out=resolve(process.argv[3]??'output/masonry-contact');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1366,height:768},deviceScaleFactor:1});
const report={url,browser:browser.version(),viewport:{width:1366,height:768},headless:true,errors:[],steps:[],limitations:['The side-oblique diagnostic uses an inspection camera and temporarily hides only the camera-relative arms. Actual hammer, chisel and wall geometry stay unchanged. Normal screenshots retain the arms.','Input is ordinary keyboard events through the existing gameplay Input, with camera positioning as a QA fixture.']};
page.on('pageerror',e=>report.errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
const state=()=>page.evaluate(()=>JSON.parse(window.render_game_to_text()));
const shot=async()=>{
  await page.evaluate(()=>{
    const entry=window.__contactQA.entry;
    window.__contactQA.aimEntry(entry.x,entry.y);
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'e',code:'KeyE',bubbles:true}));
    window.advanceTime(17);
    window.dispatchEvent(new KeyboardEvent('keyup',{key:'e',code:'KeyE',bubbles:true}));
  });
};
const capture=async(name,oblique=false)=>{
  const canvas=await page.evaluate(async oblique=>{
    const g=window.__wireTheHouse;
    await g.room.brickWall.waitForGeometry();
    await g.renderer.waitForFrame();
    if(oblique){
      const entry=window.__contactQA.entry,view=g.renderer.camera.clone(false);
      view.fov=54;view.near=.008;view.position.set(entry.x+.34,entry.y+.11,-1.98);
      view.lookAt(entry.x,entry.y,-2.45);view.updateProjectionMatrix();view.updateMatrixWorld(true);
      const arms=g.fpsRig.hammerArms,wasVisible=arms.visible;
      try{
        arms.visible=false;
        g.renderer.webgl.render(g.renderer.scene,view);
        // Capture synchronously before the gameplay RAF renders its main camera.
        return g.renderer.webgl.domElement.toDataURL('image/png');
      }finally{arms.visible=wasVisible;}
    }else {g.renderer.render();await g.renderer.waitForFrame();}
  },oblique);
  if(canvas)await writeFile(join(out,`${name}.png`),Buffer.from(canvas.split(',')[1],'base64'));
  else await page.screenshot({path:join(out,`${name}.png`)});
};
const aimEntry=(x,y)=>page.evaluate(({x,y})=>window.__contactQA.aimEntry(x,y),{x,y});
try{
  await page.goto(url,{waitUntil:'networkidle'});await page.click('#start-button');await page.keyboard.press('Digit4');
  await page.evaluate(()=>document.exitPointerLock());await page.waitForTimeout(40);
  await page.evaluate(()=>{
    const g=window.__wireTheHouse,wall=g.room.brickWall,original=wall.contactProvider;
    window.__contactQA={entry:{x:.8,y:1.55},view:{offsetX:.16,z:-1.45},last:null,contacts:[],
      aimEntry(x,y){
        this.entry={x,y};
        g.renderer.camera.position.set(x+this.view.offsetX,1.65,this.view.z);
        g.renderer.camera.lookAt(x,y,wall.volume.frontZ);
        g.player.yaw=g.renderer.camera.rotation.y;g.player.pitch=g.renderer.camera.rotation.x;
        g.renderer.camera.updateMatrixWorld(true);
      },
      observe(){
        const c=this.last,particles=g.chasing.particles;
        return{contact:c,state:JSON.parse(g.renderState()),removedBounds:wall.lastResult?.bounds??null,negativeVelocity:particles.filter(p=>p.velocity.z<-.001).length,insideEmptyCell:particles.filter(p=>p.mesh.position.z<wall.volume.frontZ-.015&&!wall.isSolidAt(p.mesh.position.x,p.mesh.position.y,p.mesh.position.z)).length,unsupported:g.chasing.unsupportedSettledFragmentCount,overlap:g.chasing.settledOverlapCount};
      }
    };
    wall.contactProvider=camera=>{
      const contact=original(camera);
      if(!contact){window.__contactQA.last=null;return null;}
      const rig=g.fpsRig,tip=rig.flatTip.localToWorld(rig.chiselTipWorld.clone().set(0,0,-.035));
      const left=rig.flatTip.localToWorld(tip.clone().set(-.0225,0,-.035));
      const right=rig.flatTip.localToWorld(tip.clone().set(.0225,0,-.035));
      const actualEdge=right.sub(left).normalize();
      const hammer=rig.tools.get('hammer');
      const shaftBack=hammer.localToWorld(rig.tipAnchor.clone().add(tip.clone().set(0,0,.35)));
      const actualAxis=tip.clone().sub(shaftBack).normalize();
      const item={point:{...contact.point},direction:{...contact.direction},edge:{...contact.edge},actualEdge:{...actualEdge},actualAxis:{...actualAxis},edgeError:actualEdge.distanceTo(contact.edge),axisError:actualAxis.distanceTo(contact.direction),tipError:tip.clone().addScaledVector(actualEdge,contact.bladeOffsetM??0).distanceTo(contact.point),depthMm:(wall.volume.frontZ-contact.point.z)*1000,camera:{yaw:g.player.yaw,pitch:g.player.pitch}};
      window.__contactQA.last=item;window.__contactQA.contacts.push(item);
      return contact;
    };
  });
  assert.equal((await state()).workSurface.chiselTiltDegrees,25,'Default attack must be downward25 degrees');
  assert.equal((await state()).workSurface.chiselEdgeDegrees,0,'Default flat blade must be horizontal');
  // Find a pristine clay face whose real tool axis crosses an existing chamber.
  const candidate=await page.evaluate(()=>{
    const g=window.__wireTheHouse,w=g.room.brickWall,v=w.volume;
    for(let y=1.43;y<1.9;y+=.019)for(let x=.55;x<1.15;x+=.019){
      window.__contactQA.aimEntry(x,y);
      const c=w.contactProvider(g.renderer.camera);if(!c)continue;
      const clayFace=[[-.015,0],[.015,0],[0,-.015],[0,.015]].every(([dx,dy])=>v.sampleMaterial(c.point.x+dx,c.point.y+dy,v.frontZ-.008)===1);
      if(!clayFace)continue;
      const samples=[];let airRun=0,maxAir=0;
      for(let t=.005;t<=.155;t+=.002){
        const p={x:c.point.x+c.direction.x*t,y:c.point.y+c.direction.y*t,z:c.point.z+c.direction.z*t};
        const material=v.sampleMaterial(p.x,p.y,p.z);samples.push({t,point:p,material});
        airRun=material===0?airRun+.002:0;maxAir=Math.max(maxAir,airRun);
      }
      if(v.sampleMaterial(c.point.x-c.direction.x*.002,c.point.y-c.direction.y*.002,c.point.z-c.direction.z*.002)===0&&maxAir>.022){
        return{x,y,initial:{point:{...c.point},direction:{...c.direction}},samples,maxAir};
      }
    }
    return null;
  });
  assert.ok(candidate,'No actual pre-existing hollow chamber found along chisel axis');report.candidate=candidate;
  await aimEntry(candidate.x,candidate.y);await capture('01-intact-contact');
  let shellOpened=false,passedThrough=false,peakInward=0,peakInside=0,maximumTipError=0;
  for(let index=0;index<100;index++){
    await aimEntry(candidate.x,candidate.y);await shot();
    const observed=await page.evaluate(()=>window.__contactQA.observe());
    report.steps.push({index,...observed});
    peakInward=Math.max(peakInward,observed.negativeVelocity);peakInside=Math.max(peakInside,observed.insideEmptyCell);
    maximumTipError=Math.max(maximumTipError,observed.contact?.tipError??0);
    if(!shellOpened&&observed.contact?.depthMm>25){shellOpened=true;await capture('02-chisel-inside-cell');await capture('03-side-oblique-inside-cell',true);}
    if(!observed.contact&&shellOpened){passedThrough=true;break;}
    await page.evaluate(()=>window.advanceTime(80));
  }
  assert.ok(shellOpened,'Tip did not enter a pre-existing chamber after shell perforation');
  assert.ok(maximumTipError<.0001,`Actual visible cutting tip differs from impact by ${maximumTipError}m`);
  assert.ok(peakInward>0,'No fragment ever moved inward');
  assert.ok(peakInside>0,'No debris entered an empty chamber');
  report.cavity={shellOpened,passedThrough,peakInward,peakInside,maximumTipError};
  // Once this local axis is through, held tool input in air must not manufacture
  // extra damage, material, or an impact count. No direct carve/restore is used.
  assert.ok(passedThrough,'Repeated real impacts did not clear the tool axis within100 strikes');
  const beforeAir=await state();
  for(let index=0;index<2;index++){await aimEntry(candidate.x,candidate.y);await shot();}
  const afterAir=await state();
  assert.equal(afterAir.workSurface.impactCount,beforeAir.workSurface.impactCount,'Air consumed an impact');
  assert.equal(afterAir.workSurface.removedVolumeCm3,beforeAir.workSurface.removedVolumeCm3,'Air produced removed material');
  report.air={before:beforeAir.workSurface,after:afterAir.workSurface};
  await page.evaluate(()=>window.advanceTime(2200));
  const support=await page.evaluate(()=>window.__contactQA.observe());report.support=support;
  await page.locator('#settings-toggle').click();
  while((await state()).workSurface.chiselTiltDegrees!==70)await page.locator('#chisel-tilt').click();
  await page.locator('#chisel-angle').click();await page.locator('#chisel-angle').click();
  assert.equal((await state()).workSurface.chiselEdgeDegrees,90,'Blade could not rotate independently to90');
  assert.equal((await state()).workSurface.chiselTiltDegrees,70,'Blade rotation changed downward hammer pitch');
  await page.locator('#chisel-angle').click();await page.locator('#chisel-angle').click();await page.locator('#settings-close').click();
  const peel=[];
  for(let step=0;step<10;step++){
    await aimEntry(-.65,1.86-step*.015);await shot();
    const observation=await page.evaluate(()=>window.__contactQA.observe());
    peel.push({step,contact:observation.contact,removed:observation.state.workSurface.removedVolumeCm3});
    if(step===0||step===4||step===9)await capture(`04-downward-peel-${step+1}`);
    await page.evaluate(()=>window.advanceTime(80));
  }
  assert.ok(peel.every(p=>p.contact&&p.contact.direction.y<-.75&&p.contact.direction.z<0),'70-degree attack is not predominantly downward');
  assert.ok(peel.at(-1).removed>peel[0].removed,'Downward peel did not progressively detach material');
  report.peel=peel;
  await capture('05-side-oblique-downward-peel',true);
  // Sideways chasing must move the WHOLE hammer axis while keeping the physical
  // blade horizontal. Exercise actual settings/keys and damage, not just values.
  await page.locator('#settings-toggle').click();
  for(let i=0;i<10&&(await state()).workSurface.chiselTiltDegrees!==0;i++)await page.locator('#chisel-tilt').click();
  assert.equal((await state()).workSurface.chiselTiltDegrees,0,'Could not set horizontal hammer pitch');
  await page.locator('#settings-close').click();
  report.sideways=[];
  const vectorDifference=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
  for(const side of [70,-70]){
    for(let i=0;i<32&&(await state()).workSurface.chiselSideDegrees!==side;i++){
      await page.keyboard.press((await state()).workSurface.chiselSideDegrees<side?'KeyK':'KeyJ');
    }
    assert.equal((await state()).workSurface.chiselSideDegrees,side,'J/K did not set the real lateral hammer angle');
    assert.equal((await state()).workSurface.chiselEdgeDegrees,0,'Lateral lean silently rotated the blade');
    const entry={x:side>0?-1.25:1.4,y:side>0?1.18:1.84};
    const probes=[];
    for(const view of [{offsetX:.38,z:-1.55},{offsetX:-.38,z:-.90}]){
      await page.evaluate(view=>{window.__contactQA.view=view;},view);
      await aimEntry(entry.x,entry.y);await shot();
      probes.push((await page.evaluate(()=>window.__contactQA.observe())).contact);
    }
    assert.ok(probes.every(Boolean),'No solid contact in lateral camera-independence probes');
    for(const probe of probes){
      assert.ok(Math.abs(probe.actualEdge.y)<.001,'Visible zero-roll blade is not world-horizontal');
      assert.ok(Math.abs(probe.direction.x)>.9&&Math.sign(probe.direction.x)===Math.sign(side)&&Math.abs(probe.direction.y)<.001&&probe.direction.z<0,'Whole hammer is not attacking horizontally sideways');
      assert.ok(probe.edgeError<.0001&&probe.axisError<.0001&&probe.tipError<.0001,'Visible blade, shaft, or tip differs from physical impact');
    }
    assert.ok(Math.abs(probes[0].camera.yaw-probes[1].camera.yaw)>.2&&Math.abs(probes[0].camera.pitch-probes[1].camera.pitch)>.02,'Inspection probes did not change both camera yaw and pitch');
    assert.ok(vectorDifference(probes[0].actualEdge,probes[1].actualEdge)<.0001&&vectorDifference(probes[0].actualAxis,probes[1].actualAxis)<.0001,'Camera orientation changes independent world blade/hammer angles');
    const before=(await state()).workSurface.removedVolumeCm3,hits=[];
    await page.evaluate(()=>{window.__contactQA.view={offsetX:.16,z:-1.45};});
    for(let i=0;i<16;i++){
      await aimEntry(entry.x+Math.sign(side)*i*.015,entry.y);await shot();
      const observation=await page.evaluate(()=>window.__contactQA.observe());
      hits.push({contact:observation.contact,removed:observation.state.workSurface.removedVolumeCm3,bounds:observation.removedBounds});
      await page.evaluate(()=>window.advanceTime(80));
    }
    const bounds=hits.filter(hit=>hit.bounds).map(hit=>hit.bounds);
    assert.ok(hits.at(-1).removed>before,'Sideways input removed no actual masonry');
    assert.ok(hits.filter((hit,i)=>hit.removed>(i?hits[i-1].removed:before)).length>=4,'Sideways chase did not progressively remove material across multiple inputs');
    assert.ok(bounds.length>=4,'Sideways removal has no recorded spatial extent');
    const removedSpanX=Math.max(...bounds.map(b=>b.max.x))-Math.min(...bounds.map(b=>b.min.x));
    assert.ok(removedSpanX>.12,'Actual removal did not follow the horizontal chase path');
    report.sideways.push({side,probes,hits,removedSpanX,removedVolumeCm3:hits.at(-1).removed-before});
    await capture(`06-sideways-${side>0?'right':'left'}-player`);
    await capture(`07-sideways-${side>0?'right':'left'}-diagnostic`,true);
  }
  assert.equal(support.unsupported,0,'Settled debris has no valid wall/floor support');
  assert.equal(support.overlap,0,'Settled rubble overlaps another solid body');
  assert.equal(report.errors.length,0,report.errors.join('\n'));
  console.log(JSON.stringify({passed:true,cavity:report.cavity,airNoDamage:true,support:{unsupported:support.unsupported,overlap:support.overlap},peelHits:peel.length,sideways:report.sideways.map(item=>({side:item.side,removedSpanX:item.removedSpanX,removedVolumeCm3:item.removedVolumeCm3,cameraIndependent:true,horizontalPhysicalBlade:true}))},null,2));
}catch(error){report.failure=String(error.stack??error);throw error;}
finally{await writeFile(join(out,'contact-report.json'),JSON.stringify(report,null,2));await browser.close();}
