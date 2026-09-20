import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const url=process.argv[2]??'http://127.0.0.1:5366/Electrical-Game/';
const out=resolve(process.argv[3]??'output/prepared-multi-pipe-wall');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
try{
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__wireTheHouse&&window.render_game_to_text,{timeout:30000});
  await page.waitForFunction(()=>!document.querySelector('#start-button')?.disabled,{timeout:30000});
  await page.click('#start-button');
  await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.room.brickWall.waitForGeometry();await g.mortar.waitForGeometry();for(let i=0;i<12;i++)g.step(1/60,0,false);g.renderer.render();await g.renderer.waitForFrame();});
  const report=await page.evaluate(()=>{
    const g=window.__wireTheHouse,v=g.room.brickWall.volume,front=v.frontZ;
    const channels=g.mission.points.map(point=>{
      const top=point.position.y-point.boxGroup.groupHeight/2-.024;
      let clear=true,outsideSolid=0,samples=0;
      for(let y=.006;y<=top;y+=.04)for(const offset of [-.094,-.075,0,.075,.094]){
        clear&&=v.cavityBox({x:point.position.x+offset-.003,y:y-.003,z:front-.050},{x:point.position.x+offset+.003,y:y+.003,z:front+.001}).clear;samples++;
      }
      for(let y=.006;y<=top;y+=.08)for(const offset of [-.13,.13])outsideSolid+=Number(!v.cavityBox({x:point.position.x+offset-.003,y:Math.max(.001,y-.003),z:front-.04},{x:point.position.x+offset+.003,y:y+.003,z:front-.005}).clear);
      const floorMouthClear=v.cavityBox({x:point.position.x-.098,y:0,z:front-.05},{x:point.position.x+.098,y:.025,z:front+.001}).clear;
      return{id:point.definition.id,widthM:.20,clear,floorMouthClear,outsideSolid,samples,coverage:g.room.brickWall.getChaseCoverage(point.definition.id)};
    });
    return{
      state:JSON.parse(window.render_game_to_text()),channels,
      mortarReady:g.mission.points.map(point=>({id:point.definition.id,ready:g.mortar.ready(point),coverage:g.mortar.coverage(point)})),
      rightWall:{name:g.room.intactPracticeWall.name,position:g.room.intactPracticeWall.position.toArray(),rotationY:g.room.intactPracticeWall.rotation.y,children:g.room.intactPracticeWall.children.length},
      render:{calls:g.renderer.webgl.info.render.calls,triangles:g.renderer.webgl.info.render.triangles},errors:[],
    };
  });
  assert(report.channels.every(channel=>channel.clear),JSON.stringify(report.channels));
  assert(report.channels.every(channel=>channel.floorMouthClear),'Every chase must be open through its bottom course to floor level.');
  assert(report.channels.every(channel=>channel.outsideSolid>0),'Each wide chase must retain masonry immediately outside its 200 mm lane.');
  assert(report.channels.every(channel=>channel.coverage>=.99),JSON.stringify(report.channels));
  assert(report.state.points.every(point=>point.visible&&point.stage==='leveled'),'Every supplied box starts visible and ready for PVC.');
  assert(report.state.boxPlacement.every(point=>point.secured&&point.state==='bonded'),'Every supplied box starts bonded in actual mortar.');
  assert(report.mortarReady.every(point=>point.ready),JSON.stringify(report.mortarReady));
  assert(report.rightWall.children>1&&Math.abs(report.rightWall.rotationY+Math.PI/2)<1e-6,'Untouched masonry wall must be on the right side.');
  assert.deepEqual(errors,[]);
  const captures=await page.evaluate(async()=>{
    const g=window.__wireTheHouse,camera=g.renderer.camera,rig=g.fpsRig,wasVisible=rig.visible,views=[];
    try{
      rig.visible=false;
      for(const [name,position,target] of [
        ['main-prepared',[0,1.45,.15],[0,.72,g.room.brickWall.volume.frontZ]],
        ['right-untouched',[.1,1.48,.1],[3.79,1.48,.1]],
      ]){
        camera.position.fromArray(position);camera.lookAt(...target);camera.updateMatrixWorld(true);g.renderer.render();await g.renderer.waitForFrame();views.push([name,g.renderer.webgl.domElement.toDataURL('image/png')]);
      }
    }finally{rig.visible=wasVisible;}
    return views;
  });
  for(const [name,data] of captures)await writeFile(join(out,`${name}.png`),Buffer.from(data.split(',')[1],'base64'));
  report.pvcGate=await page.evaluate(()=>{
    const g=window.__wireTheHouse,point=g.mission.points[0],result=g.interaction.action(point,'spring',g.renderer.camera);
    return{result,stage:point.stage,pipeStep:point.pipeStep,stillSecured:point.boxGroup.userData.placement?.secured,mortarReady:g.mortar.ready(point)};
  });
  assert(report.pvcGate.result.success&&report.pvcGate.stage==='conduit'&&report.pvcGate.pipeStep==='cut','Prepared Point A must accept the first PVC route action.');
  assert(report.pvcGate.stillSecured&&report.pvcGate.mortarReady,'PVC route action must preserve the real mortar bond.');
  const mobile=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  await mobile.goto(url,{waitUntil:'domcontentloaded'});
  await mobile.waitForFunction(()=>window.__wireTheHouse&&!document.querySelector('#start-button')?.disabled,{timeout:30000});
  report.mobile=await mobile.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,startCopy:document.querySelector('#start-screen p')?.textContent??'',button:document.querySelector('#start-button')?.getBoundingClientRect().toJSON()}));
  assert(!report.mobile.overflow,'Prepared-wall start screen must not overflow at 390 × 844.');
  assert(report.mobile.startCopy.includes('wide multi-pipe routes'),'Mobile start screen must explain the prepared PVC state.');
  await mobile.screenshot({path:join(out,'mobile-start.png')});
  await mobile.tap('#start-button');
  const mobileState=await mobile.evaluate(()=>JSON.parse(window.render_game_to_text()));
  assert(mobileState.points.every(point=>point.visible&&point.stage==='leveled'),'Mobile runtime must start at the same prepared PVC state.');
  await mobile.close();
  report.errors=errors;
  await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({url,checks:['three real 200 mm multi-pipe chases open to floor','masonry retained outside lanes','three mortar-bonded level boxes','PVC action gate','untouched right wall','390 × 844 layout and prepared state','console clean'],render:report.render,report:join(out,'report.json')}));
}finally{await browser.close();}
