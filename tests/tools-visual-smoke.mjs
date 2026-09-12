import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const url=process.argv[2]??'http://127.0.0.1:5362/Electrical-Game/';
const output=resolve(process.argv[3]??'output/tools-visual');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const tools=['spring','cutter','spray','hammer','fitting','level','trowel','hose'];
const report={url,headless:true,browser:browser.version(),mobileIsEmulation:true,tools:[],room:[],errors:[],failures:[]};
const check=(ok,message)=>{if(!ok)report.failures.push(message);};
try{
for(const mobile of [false,true]){
 const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1366,height:768},deviceScaleFactor:1,isMobile:mobile,hasTouch:mobile});
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.goto(url,{waitUntil:'networkidle'});await page.locator('#start-button')[mobile?'tap':'click']();await page.waitForTimeout(180);
 const platform=mobile?'mobile':'desktop';
 for(const [index,tool]of tools.entries()){
  await page.keyboard.press(`Digit${index+1}`);
  if(mobile){await page.locator(`[data-tool="${tool}"]`).tap();}
  await page.evaluate(()=>{
   const g=window.__wireTheHouse,c=g.renderer.camera;
   c.position.set(-.55,1.65,-.88);c.lookAt(-.48,1.50,-2.41);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;g.step(1/60);
  });
  await page.waitForTimeout(90);
  await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.room.brickWall.waitForGeometry();g.renderer.render();});
  const data=await page.evaluate(()=>{
   const g=window.__wireTheHouse,selected=g.selectedTool,group=g.fpsRig.tools.get(selected);
   const visibleTools=[...g.fpsRig.tools].filter(([,value])=>value.visible).map(([key])=>key);
   const models=[];group.traverse(o=>{if(o.isMesh&&o.visible)models.push({name:o.name,type:o.geometry.type,vertices:o.geometry.attributes.position?.count??0});});
   const world=(object,xyz)=>object.localToWorld(g.renderer.camera.position.clone().fromArray(xyz));
   const grips=[];
   if(group.userData.gripPoint){
    const targets=[group.userData.gripPoint,...(group.userData.secondaryGripPoint?[group.userData.secondaryGripPoint]:[])];
    const hands=group.children.filter(child=>child.type==='Group'&&child.children.some(mesh=>mesh.geometry?.type==='SphereGeometry'));
    for(let i=0;i<targets.length;i++){
     const glove=hands[i]?.children.find(mesh=>mesh.geometry?.type==='SphereGeometry');
     if(glove)grips.push(glove.getWorldPosition(g.renderer.camera.position.clone()).distanceTo(world(group,targets[i])));
    }
   }else if(selected==='hammer'){
    for(const arm of g.fpsRig.hammerArmParts){const target=group.localToWorld(arm.grip.clone()),actual=g.fpsRig.localToWorld(arm.glove.position.clone());grips.push(target.distanceTo(actual));}
   }
   const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
   const labels=[...document.querySelectorAll('button,[data-tool] span,#aim-control-label,#mortar-panel strong,#mortar-panel small')].filter(visible);
   const badFonts=labels.filter(e=>parseFloat(getComputedStyle(e).fontSize)<12).map(e=>({text:e.textContent.trim().slice(0,45),font:getComputedStyle(e).fontSize}));
   const replacementText=labels.filter(e=>e.textContent.includes('\uFFFD')).map(e=>e.textContent.trim());
   const look=document.querySelector('#look-joystick'),rect=look.getBoundingClientRect(),hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
   const selectedButton=document.querySelector(`[data-tool="${selected}"]`),selectedRect=selectedButton.getBoundingClientRect();
   const panel=document.querySelector('#mortar-panel'),panelRect=panel.getBoundingClientRect();
   const overlaps=(a,b)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
   const panelOverlaps=visible(panel)?['#interaction-prompt','#joystick','#look-joystick','#mobile-tool-slider'].map(selector=>{const element=document.querySelector(selector);return{selector,area:visible(element)?overlaps(panelRect,element.getBoundingClientRect()):0};}).filter(item=>item.area>1):[];
   const modelNames=models.filter(model=>model.name).map(model=>model.name);
   return{selected,visibleTools,meshCount:models.length,modelNames,handGripErrorMetres:grips,layout:{width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,shellScrollLeft:document.querySelector('#game-shell').scrollLeft,pageScrollX:scrollX,badFonts,replacementText,panelOverlaps,mobileLookCenterUnblocked:Boolean(hit?.closest('#look-joystick')),selectedButton:{x:selectedRect.x,y:selectedRect.y,width:selectedRect.width,height:selectedRect.height}},mortar:JSON.parse(g.renderState()).mortar??null,render:{...g.renderer.webgl.info.render},memory:{...g.renderer.webgl.info.memory}};
  });
  const item={platform,tool,...data};report.tools.push(item);
  check(data.selected===tool,`${platform}: Digit${index+1} did not select ${tool}`);
  check(data.visibleTools.length===1&&data.visibleTools[0]===tool,`${platform}: wrong visible model for ${tool}`);
  check(data.meshCount>=3,`${platform}: ${tool} model missing geometry`);
  check(data.handGripErrorMetres.length>0&&data.handGripErrorMetres.every(distance=>distance<.025),`${platform}: ${tool} hand detached from grip ${JSON.stringify(data.handGripErrorMetres)}`);
  check(data.layout.scrollWidth<=data.layout.width+1&&data.layout.scrollHeight<=data.layout.height+1,`${platform}: viewport overflow on ${tool}`);
  check(data.layout.badFonts.length===0,`${platform}: unreadable text on ${tool} ${JSON.stringify(data.layout.badFonts)}`);
  check(data.layout.replacementText.length===0,`${platform}: corrupted text on ${tool}`);
  check(data.layout.panelOverlaps.length===0,`${platform}: mortar panel overlaps controls or instructions on ${tool}: ${JSON.stringify(data.layout.panelOverlaps)}`);
  if(mobile)check(data.layout.shellScrollLeft===0&&data.layout.pageScrollX===0,`mobile: ${tool} selection scrolled the game viewport`);
  if(mobile)check(data.layout.mobileLookCenterUnblocked,`mobile: ${tool} blocks the look-pad centre`);
  if(mobile)check(data.layout.selectedButton.x>=0&&data.layout.selectedButton.x+data.layout.selectedButton.width<=data.layout.width,`mobile: selected ${tool} button is clipped`);
  await page.screenshot({path:join(output,`${platform}-${index+1}-${tool}.png`)});
 }
 // Architecture diagnostics omit only the viewmodel, keeping the room unchanged.
 for(const [name,target]of [['work-wall',[0,1.2,-2.41]],['supplies-right',[2.72,.35,2.04]],['supplies-left',[-2.85,.12,1.45]]]){
  await page.evaluate(target=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.position.set(0,1.65,0);c.lookAt(...target);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;g.fpsRig.visible=false;g.renderer.render();},target);
  await page.screenshot({path:join(output,`${platform}-room-${name}.png`)});
 }
 const room=await page.evaluate(()=>{
  const g=window.__wireTheHouse,items=[];g.room.traverse(o=>{if(o.userData.studioEntityId?.startsWith('world:'))items.push({id:o.userData.studioEntityId,name:o.name,position:{...o.position}});});return items;
 });report.room.push({platform,items:room});
 await page.close();
}
check(report.errors.length===0,`Browser errors: ${report.errors.join('; ')}`);
console.log(JSON.stringify({tools:report.tools.map(t=>({platform:t.platform,tool:t.tool,meshes:t.meshCount,gripError:t.handGripErrorMetres,lookClear:t.layout.mobileLookCenterUnblocked})),failures:report.failures,errors:report.errors},null,2));
if(report.failures.length)throw Error(report.failures.join('\n'));
}finally{await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));await browser.close();}
