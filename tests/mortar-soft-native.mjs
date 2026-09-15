import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {prepareFinishedMortar} from './prepared-mortar-fixture.mjs';
const url=process.argv[2]??'http://127.0.0.1:5362/Electrical-Game/',out=process.argv[3]??'output/mortar-soft-native';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),report={url,mobileIsEmulation:true,fixture:'120 × 100 mm real hollow-clay opening, impacts limited to 40 mm requested depth. Actual exposed internal chambers are measured, never replaced by an analytical wall. Native hold/release uses the production hand release point and projectile solver.',cases:[]};
try{for(const mobile of [false,true]){
 const platform=mobile?'mobile':'desktop';if(process.env.QA_PLATFORM&&process.env.QA_PLATFORM!==platform)continue;
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1366,height:768},isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);
 await context.addInitScript(()=>{const original=crypto.getRandomValues.bind(crypto);crypto.getRandomValues=a=>a instanceof Uint32Array&&a.length===1?(a[0]=260913,a):original(a);});
 const page=await context.newPage(),errors=[];await page.routeWebSocket('**',()=>{});page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.roomWater.waterProActive,null,{timeout:120000});await page.locator('#start-button')[mobile?'tap':'click']();
 const fixture=await page.evaluate(async()=>{
  const g=window.__wireTheHouse,v=g.room.brickWall.volume,f=v.frontZ;window.__softStep=g.step.bind(g);g.step=()=>{};
  let strikes=0;for(let pass=0;pass<3;pass++)for(let x=-.048;x<=.04801;x+=.024)for(let y=1.364;y<=1.43601;y+=.024){const h=v.raycast({x,y,z:f+.05},{x:0,y:0,z:-1},.24);if(h&&f-h.point.z<.04){v.impact({point:h.point,direction:{x:0,y:0,z:-1},chisel:'flat',widthM:.025,energyJ:5});strikes++;}}
  g.room.brickWall.flushGeometry();await g.room.brickWall.waitForGeometry();window.__softColumns=[];
  for(let x=-.048;x<=.04801;x+=.016)for(let y=1.364;y<=1.43601;y+=.016){const h=v.raycast({x,y,z:f+.02},{x:0,y:0,z:-1},.24);if(h&&f-h.point.z>.012)window.__softColumns.push({x,y,back:h.point.z});}
  const m=g.mortar,deposit=m.deposit.bind(m);window.__softContacts=[];window.__softInitial=null;
  m.deposit=(p,mass,n,...rest)=>{const held=deposit(p,mass,n,...rest);if(held>0){window.__softContacts.push({point:p.toArray(),held,requested:mass});if(!window.__softInitial)window.__softInitial=Object.fromEntries([...m.field.nodes].map(([key,node])=>[key,node.value]));}return held;};
  return{strikes,columns:window.__softColumns.length,depthRangeMm:[Math.min(...window.__softColumns.map(c=>f-c.back))*1000,Math.max(...window.__softColumns.map(c=>f-c.back))*1000],save:v.serialize()};
 });
 await writeFile(`${out}/${platform}-masonry-save.json`,JSON.stringify(fixture.save));delete fixture.save;
 await prepareFinishedMortar(page);
 if(mobile)await page.locator('[data-tool="trowel"]').tap();else await page.keyboard.press('Digit7');
 await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera;g.hammerWorkStance.restore(c);c.position.set(0,g.player.eyeHeight,g.room.brickWall.volume.frontZ+.46);c.lookAt(0,1.4,g.room.brickWall.volume.frontZ-.04);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});
 const steps=count=>page.evaluate(n=>{for(let i=0;i<n;i++)window.__softStep(1/120);},count);
 const capture=async(name,drain=true)=>{await page.evaluate(async drain=>{const g=window.__wireTheHouse;if(drain)await g.mortar.waitForGeometry();await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();},drain);await page.screenshot({path:`${out}/${platform}-${name}.png`});};
 const boundaries=()=>page.evaluate(()=>{
  const m=window.__wireTheHouse.mortar,map=new Map(m.deposits.map(d=>[d.fieldKey,d.mesh.geometry]));let mismatches=0,maxNormalDelta=0;const mismatchDetails=[];
  window.__softContactFrames??={};let maxResidueRotation=0;
  for(const clod of m.projectiles){if(!clod.contacts)continue;const previous=window.__softContactFrames[clod.variation],q=clod.mesh.quaternion;if(previous)maxResidueRotation=Math.max(maxResidueRotation,2*Math.acos(Math.min(1,Math.abs(q.x*previous[0]+q.y*previous[1]+q.z*previous[2]+q.w*previous[3]))));window.__softContactFrames[clod.variation]=q.toArray();}
  if(maxResidueRotation>1e-7)throw new Error('Contacted paste rotates with rebound velocity');
  if(m.deposits.some(d=>d.mesh.position.lengthSq()>1e-12||Math.abs(d.mesh.quaternion.w)<1-1e-9))throw new Error('Adhered mortar left its fixed world frame');
  for(const[key,geometry]of map){const cell=key.split(',').map(Number);for(let axis=0;axis<3;axis++){const neighbor=cell.slice();neighbor[axis]++;const other=map.get(neighbor.join(','));if(!other)continue;const plane=neighbor[axis]*m.field.spacing*16;
   const collect=g=>{const values=new Map(),segments=[],p=g.getAttribute('position'),n=g.getAttribute('normal');for(let i=0;i<p.count;i+=3){const triangle=[];for(let j=0;j<3;j++){const v=[p.getX(i+j),p.getY(i+j),p.getZ(i+j)];if(Math.abs(v[axis]-plane)<3e-7){values.set(v.join(','),{p:v,n:[n.getX(i+j),n.getY(i+j),n.getZ(i+j)]});triangle.push(v);}}for(let a=0;a<triangle.length;a++)for(let b=a+1;b<triangle.length;b++)segments.push([triangle[a],triangle[b]]);}return{values:[...values.values()],segments};};
   const a=collect(geometry),b=collect(other);
   const distanceToSegment=(p,[a,b])=>{const d=b.map((v,i)=>v-a[i]),length=d.reduce((s,v)=>s+v*v,0),t=length?Math.max(0,Math.min(1,d.reduce((s,v,i)=>s+v*(p[i]-a[i]),0)/length)):0;return Math.hypot(...p.map((v,i)=>v-a[i]-t*d[i]));};
   // Compare the shared boundary curve, not triangulation vertex identity:
   // one side can legitimately contain another vertex on the same edge.
   for(const[left,right]of [[a,b],[b,a]])for(const v of left.values){const match=right.values.find(w=>v.p.every((p,i)=>Math.abs(p-w.p[i])<1e-6));if(match)maxNormalDelta=Math.max(maxNormalDelta,...v.n.map((n,i)=>Math.abs(n-match.n[i])));else{const distance=Math.min(...right.segments.map(segment=>distanceToSegment(v.p,segment)));if(distance>=1e-6){mismatches++;if(mismatchDetails.length<12)mismatchDetails.push({key,axis,point:v.p,segmentDistance:distance});}}}
  }}return{mismatches,mismatchDetails,maxNormalDelta,meshes:map.size,revision:m.field.revision,pending:m.pendingGeometryChunks,signature:[...map].map(([k,g])=>k+':'+g.uuid).join('|')};
 });
 const read=()=>page.evaluate(()=>{const g=window.__wireTheHouse,m=g.mortar,f=g.room.brickWall.volume.frontZ,V=g.renderer.camera.position.constructor;let count=0,filled=0,flush=0;for(const c of window.__softColumns){const hit=m.field.raycast(new V(c.x,c.y,f+.02),new V(0,0,-1),.24);if(hit&&f-hit.point.z<.012)flush++;for(let z=c.back+.004;z<f;z+=.008){count++;if(m.field.sample(new V(c.x,c.y,z))>=.35)filled++;}}const t=m.telemetry;return{...t,fillFraction:filled/count,flushFraction:flush/window.__softColumns.length,distributionChangeKg:window.__softInitial?[...new Set([...Object.keys(window.__softInitial),...m.field.nodes.keys()])].reduce((sum,key)=>sum+Math.abs((window.__softInitial[key]??0)-(m.field.nodes.get(key)?.value??0))*m.field.nodeMass,0):0,contacts:window.__softContacts.slice(),pendingSettling:m.field.settling.length,renderError:g.renderer.renderError};});
 await steps(80);await capture('before');const cdp=mobile?await context.newCDPSession(page):null;
 const held=async down=>{if(cdp){const b=await page.locator('#look-joystick').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:down?'touchStart':'touchEnd',touchPoints:down?[{x:b.x+b.width/2,y:b.y+b.height/2,id:17}]:[]});}else await page.keyboard[down?'down':'up']('KeyE');};
 const loads=[],settling=[],animation=[];
 for(let load=0;load<4;load++){
  await page.evaluate(x=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.lookAt(x,1.4,g.room.brickWall.volume.frontZ-.04);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;},load%2?-.025:.025);await steps(24);
  await held(true);await steps(56);await held(false);
  if(load===0){for(let i=0;i<100;i++){await steps(1);if((await read()).stuckKg>.01)break;}settling.push(await read());await capture('first-impact',false);animation.push({frame:0,...await boundaries()});for(let frame=1;frame<=24;frame++){await page.evaluate(()=>window.__softStep(1/60));const boundary=await boundaries();animation.push({frame,...boundary});if(boundary.mismatches)console.log(JSON.stringify({frame,boundary}));assert.equal(boundary.mismatches,0,'Visible mortar chunks disagree during settling');assert(boundary.maxNormalDelta<1e-4,'Shared mortar lighting normals disagree during settling');if(frame%4===0)settling.push(await read());if([1,3,5,7,11,15,19,24].includes(frame))await capture('impact-frame-'+String(frame).padStart(2,'0'),false);}await capture('first-settled');}
  await steps(180);const s=await read();loads.push(s);assert(Math.abs(s.launchedKg-(load+1)*.65)<1e-7);assert(Math.abs(s.launchedKg-s.stuckKg-s.restingKg-s.floorKg-s.movingKg)<1e-7);if(s.flushFraction>=.95)break;
 }
 await capture('filled');const last=loads.at(-1);report.cases.push({platform,fixture,loads,settling,animation,errors});
 assert(last.fillFraction>.95&&last.flushFraction>=.95,'Native aimed scoops failed to fill the actual small masonry opening');assert(settling[0].stuckKg>.01,'Native cast missed the cavity');
 const changedExistingKg=settling.at(-1).distributionChangeKg-(settling.at(-1).stuckKg-settling[0].stuckKg);
 assert(changedExistingKg>.01,'Fresh impact stayed rigid; only extra projectile contacts changed its quantity');
 assert.equal(last.pendingSettling,0);assert.equal(last.renderError,'');assert.deepEqual(errors,[]);console.log(JSON.stringify({platform,fixture,loads:loads.map(s=>({launchedKg:s.launchedKg,stuckKg:s.stuckKg,fill:s.fillFraction,flush:s.flushFraction})),settling:settling.map(s=>({stuckKg:s.stuckKg,changedKg:s.distributionChangeKg}))}));await context.close();
}}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
