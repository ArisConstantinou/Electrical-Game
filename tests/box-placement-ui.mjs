import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';

const url=process.argv[2]??'http://127.0.0.1:5365/Electrical-Game/';
const out=process.argv[3]??'output/box-placement-ui';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={url,mobileIsEmulation:true,fixture:'Camera and deterministic frame clock are diagnostic fixtures. Selection, approach and placement use real keyboard/touch events. Broad/narrow cavities use real MasonryVolume impacts; legal falling placements use saved clear vertical node strips with no support, and the shallow recess restores a saved node layer. Beds use actual MortarField volume, with cured age authored explicitly; acceptance methods are never stubbed.',scenarios:[],errors:[]};
const state=page=>page.evaluate(()=>{const g=window.__wireTheHouse,p=g.mission.points.find(p=>p.definition.id===window.__boxQAOriginalId),m=g.mortar.telemetry,assembly=g.fpsRig.getObjectByName('Left-hand live box assembly'),candidate=g.fpsRig.getObjectByName('Right-hand next box');return{id:p.definition.id,activeId:g.mission.activePoint?.definition.id,camera:g.renderer.camera.position.toArray(),point:p.position.toArray(),visible:p.boxGroup.visible,boxLocal:p.boxGroup.position.toArray(),stage:p.stage,placement:g.boxPlacement.telemetry,pose:g.fpsRig.debugPose(),fittingBoxAvailable:g.fpsRig.fittingBoxAvailable,fittingBoxVisible:!!assembly?.visible&&!!candidate?.visible,levelVisible:p.boxGroup.levelBar.visible,mortarMass:g.mortar.field.mass+m.movingKg+m.restingKg+m.floorKg,renderError:g.renderer.renderError};});
async function steps(page,count=1,dt=1/60){await page.evaluate(({count,dt})=>{for(let i=0;i<count;i++)window.__boxQAStep(dt);},{count,dt});}
async function aim(page,x,y=1.4,distance=.42){await page.evaluate(({x,y,distance})=>{const g=window.__wireTheHouse,c=g.renderer.camera;g.hammerWorkStance.restore(c);c.position.set(x,g.player.eyeHeight,g.room.brickWall.volume.frontZ+distance);c.lookAt(x,y,g.room.brickWall.volume.frontZ);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;window.__boxQAStep(0);},{x,y,distance});await steps(page,60);}
async function shot(page,name){await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();});await page.screenshot({path:`${out}/${name}.png`});}
async function action(page,mobile){
  if(await page.evaluate(()=>window.__wireTheHouse.selectedTool==='fitting')){
    await page.locator('#box-place-assembly').click();
    await steps(page,1,0);
    return;
  }
  if(mobile){const r=await page.locator('#look-joystick').boundingBox();assert(r);const cdp=await page.context().newCDPSession(page);const touch={x:r.x+r.width*.5,y:r.y+r.height*.5,id:18};await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
  else await page.keyboard.press('KeyE');
  await steps(page,1,0);
}
async function select(page,mobile,tool){if(mobile)await page.locator(`[data-tool="${tool}"]`).tap();else await page.keyboard.press(tool==='fitting'?'Digit5':'Digit6');await steps(page,1,0);if(tool==='fitting'&&!await page.evaluate(()=>window.__wireTheHouse.boxAssemblyActive)){await page.locator('#box-assembly-toggle').click();await steps(page,1,0);}}
function blockedPlacement(before,after,label){assert.equal(after.visible,false,`${label}: obstructed recess cannot leave the box proud of the finish`);assert(Math.abs(after.mortarMass-before.mortarMass)<1e-6,`${label}: refused placement conserves mortar`);}
function flushOrBlocked(before,after,label){if(after.visible){const placement=after.placement.find(p=>p.id===after.id);assert(placement.protrusionMm<=1.20001,`${label}: any accepted casing must be flush`);}assert(Math.abs(after.mortarMass-before.mortarMass)<1e-6,`${label}: fit attempt conserves mortar`);}
async function clearVerticalWorkSlots(page){return page.evaluate(async()=>{
 const g=window.__wireTheHouse,v=g.room.brickWall.volume,save=v.serialize(),chunks=new Map(save.chunks.map(c=>[c.key,new Map(c.edits.map(e=>[e[0],e]))]));let removed=0;
 // Real material removal all the way to floor isolates gravity after a legal
 // flush placement. It supplies no ledge, mortar bond or fake placement state.
 for(let x=1;x<=v.nx;x++){const px=v.nodePosition(x,1,1).x;if(![-.8,.7,1.8].some(cx=>Math.abs(px-cx)<.15))continue;
  for(let y=1;y<=v.ny;y++){if(v.nodePosition(x,y,1).y>1.9)continue;for(let z=1;z<=v.nz;z++){if(v.frontZ-v.nodePosition(x,y,z).z>.09)continue;
   const tx=Math.floor(x/v.tileSize),ty=Math.floor(y/v.tileSize),key=`${tx},${ty}`,offset=((y-ty*v.tileSize)*v.tileSize+x-tx*v.tileSize)*(v.nz+2)+z;
   if(!chunks.has(key))chunks.set(key,new Map());chunks.get(key).set(offset,[offset,255,1]);removed++;
  }}
 }
 save.chunks=[...chunks].map(([key,edits])=>({key,edits:[...edits.values()]}));save.removedVolume=(save.removedVolume??0)+removed*v.nodeVolume;v.restore(save);g.room.brickWall.flushGeometry();await g.room.brickWall.waitForGeometry();return{removed};
});}
function oneHand(s,label){const carrying=s.pose.tool!=='fitting'||s.fittingBoxAvailable;assert.equal(s.pose.arms.filter(a=>a.gripping).length,s.pose.tool==='fitting'&&carrying?2:carrying?1:0,`${label}: available tool supply controls the live hands`);if(s.pose.tool==='fitting'){assert.equal(s.fittingBoxAvailable,true,`${label}: more boxes remain available below the 24-group limit`);assert.equal(s.fittingBoxVisible,true,`${label}: assembly and candidate stay visible while previous boxes are placed`);assert.deepEqual(s.pose.arms.map(a=>a.gripRole).sort(),['assembly','candidate'],`${label}: left and right hands keep their assembly roles`);}for(const a of s.pose.arms){const distance=(u,v)=>Math.hypot(...u.map((n,i)=>n-v[i]));assert(Math.abs(distance(a.shoulder,a.elbow)-.31)<1e-5,`${label}: upper arm does not stretch`);assert(Math.abs(distance(a.elbow,a.wrist)-.27)<1e-5,`${label}: forearm does not stretch`);assert.equal(a.fingers,5);}}
try{
  for(const mobile of [false,true]){
    const name=mobile?'mobile':'desktop';
    const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1366,height:768},isMobile:mobile,hasTouch:mobile});
    await blockPointerLock(page.context());
    // Keep each navigation on one coherent source revision while independent
    // implementation work is still running; this does not intercept game code.
    if(process.env.QA_FREEZE_HMR==='1')await page.addInitScript(()=>{const Original=window.WebSocket;window.WebSocket=class extends Original{addEventListener(type,callback,options){if(type!=='message')return super.addEventListener(type,callback,options);return super.addEventListener(type,event=>{try{if(['update','full-reload'].includes(JSON.parse(event.data).type))return;}catch{}if(typeof callback==='function')callback.call(this,event);else callback?.handleEvent(event);},options);}};});
    page.on('pageerror',e=>report.errors.push(`${name}: ${e.message}`));
    page.on('console',m=>{if(m.type()==='error')report.errors.push(`${name}: ${m.text()}`);});
    await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.boxPlacement,{timeout:120000});
    await page.locator('#start-button')[mobile?'tap':'click']();await page.evaluate(()=>document.exitPointerLock());await page.waitForTimeout(300);
    await page.evaluate(()=>{const g=window.__wireTheHouse;window.__boxQAStep=g.step.bind(g);g.step=()=>{};});
    await select(page,mobile,'fitting');await page.evaluate(()=>{const g=window.__wireTheHouse;window.__boxQAOriginalId=g.mission.placementCandidate(g.boxAssembly.snapshot.modules).definition.id;});await aim(page,-.8,1.65,1.3);
    await action(page,mobile);const far=await state(page);assert.equal(far.visible,false,`${name}: distant box placement rejected`);
    // Walk normally into the wall; a fixed collision stop must still allow the
    // hand-held box to reach it, without stretching arms across the room.
    let cdp;
    if(mobile){const r=await page.locator('#joystick').boundingBox();assert(r);cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+r.width*.5,y:r.y+r.height*.5,id:11}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:r.x+r.width*.5,y:r.y+4,id:11}]});}
    else await page.keyboard.down('KeyW');
    await steps(page,150);
    if(mobile){await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}else await page.keyboard.up('KeyW');
    await steps(page,12);const beforeBlocked=await state(page);await action(page,mobile);const blocked=await state(page);
    blockedPlacement(beforeBlocked,blocked,`${name} intact wall`);
    await shot(page,`${name}-intact-wall-blocked`);
    const voidSlots=await clearVerticalWorkSlots(page);assert(voidSlots.removed>0);
    await action(page,mobile);const inserted=await state(page);assert(inserted.visible,`${name}: normal closest approach places box in cleared cavity`);
    const placed=inserted.placement.find(p=>p.id===inserted.id);assert(placed,`${name}: placement state exists`);assert(placed.protrusionMm<=1.20001,`${name}: accepted casing is flush`);assert.equal(placed.secured,false);oneHand(inserted,name);
    await shot(page,`${name}-cleared-wall-flush`);
    await steps(page,180);const fallen=await state(page);const fall=fallen.placement.find(p=>p.id===fallen.id);assert.equal(fall.state,'floor',`${name}: unsupported flush box falls through cleared slot to actual floor`);assert.equal(fall.secured,false);assert(fallen.boxLocal[1]<inserted.boxLocal[1]-.5,`${name}: displayed box moves downward`);oneHand(fallen,`${name} fallen inventory`);
    // The next supplied box can be placed elsewhere while the original stays
    // on the floor. Keep reading the original stable ID after selection changes.
    await aim(page,1.8,1.4,.42);await action(page,mobile);
    const multiple=await state(page),extra=multiple.placement.find(p=>p.visible&&p.id!==fallen.id);
    assert(extra,`${name}: native placement elsewhere creates a second visible box group`);
    assert.notEqual(multiple.activeId,fallen.id,`${name}: newly placed group becomes selected`);
    assert(multiple.visible,`${name}: original fallen box is preserved`);
    assert.deepEqual(multiple.boxLocal,fallen.boxLocal,`${name}: adding a new box cannot teleport the original`);
    oneHand(multiple,`${name} multiple box supply`);
    await aim(page,fallen.point[0],fallen.point[1]+fallen.boxLocal[1],.46);await steps(page,60);
    await shot(page,`${name}-dry-box-fallen`);
    await select(page,mobile,'level');await action(page,mobile);const unsupportedLevel=await state(page);assert.notEqual(unsupportedLevel.stage,'leveled');assert.equal(unsupportedLevel.levelVisible,false);
    // Aim at the actually fallen box, settle into low working height and
    // retrieve with the same native control used to place it.
    await select(page,mobile,'fitting');
    if(mobile)await page.locator('#mobile-crouch').tap();else await page.keyboard.press('KeyH');
    await steps(page,45);await aim(page,fallen.point[0],fallen.point[1]+fallen.boxLocal[1],.46);
    await action(page,mobile);const retrieved=await state(page);assert.equal(retrieved.visible,false,`${name}: native retrieval of fallen box`);oneHand(retrieved,`${name} crouched retrieval`);await shot(page,`${name}-retrieved-in-hand`);
    await aim(page,.7,1.4,.42);await action(page,mobile);const repositioned=await state(page);assert(repositioned.visible);assert(repositioned.point[0]>.5,`${name}: retrieved box moves to new aimed location`);oneHand(repositioned,`${name} repositioned`);
    report.scenarios.push({platform:name,far,blocked,voidSlots,inserted,fallen,multiple,unsupportedLevel,retrieved,repositioned});
    if(!mobile){
      const cavities=await page.evaluate(async()=>{
        const g=window.__wireTheHouse,w=g.room.brickWall,v=w.volume,front=v.frontZ;
        g.boxPlacement.retrieve(g.mission.points.find(p=>p.definition.id===window.__boxQAOriginalId));
        const carve=(cx,cy,width,height)=>{
          const before=v.removedNodeCount;let hits=0;
          for(let pass=0;pass<12;pass++)for(let x=cx-width/2;x<=cx+width/2+.00001;x+=.014)for(let y=cy-height/2;y<=cy+height/2+.00001;y+=.014){
            const hit=v.raycast({x,y,z:front+.08},{x:0,y:0,z:-1},.3);
            if(hit&&front-hit.point.z<.066){v.impact({point:hit.point,direction:{x:0,y:0,z:-1},chisel:'flat',widthM:.025,energyJ:18});hits++;}
          }
          return{hits,removed:v.removedNodeCount-before,centreDepthMm:(front-v.raycast({x:cx,y:cy,z:front+.08},{x:0,y:0,z:-1},.3).point.z)*1000};
        };
        const narrow=carve(-1.25,1.2,.014,.10),full=carve(-.25,1.2,.50,.12);
        w.flushGeometry();await w.waitForGeometry();return{narrow,full};
      });
      assert(cavities.narrow.removed>0&&cavities.full.removed>0,'cavity fixtures remove real material');
      await aim(page,-1.25,1.2,.42);const beforeNarrow=await state(page);await action(page,false);const narrow=await state(page);
      flushOrBlocked(beforeNarrow,narrow,'narrow footprint');
      await shot(page,'desktop-narrow-hole-blocked');
      if(narrow.visible)await page.evaluate(()=>{const g=window.__wireTheHouse;g.boxPlacement.retrieve(g.mission.points.find(p=>p.definition.id===window.__boxQAOriginalId));});
      await aim(page,-.25,1.2,.42);await action(page,false);const full=await state(page);const fullFit=full.placement.find(p=>p.id===full.id);
      assert(full.visible,'actual broad horizontal channel accepts box');assert(Math.abs(full.point[0]+.25)<.02&&Math.abs(full.point[1]-1.2)<.02,'native placement follows arbitrary horizontal channel aim, not original mission coordinates');assert(fullFit.protrusionMm<=1.20001,'full footprint and depth permit flush placement');assert(fullFit.insertionDepthMm>=35.8,'accepted group inserts its entire casing depth');
      await shot(page,'desktop-full-cavity-insertion');
      await steps(page,120);const ledge=await state(page),ledgePlacement=ledge.placement.find(p=>p.id===ledge.id);assert.equal(ledgePlacement.state,'supported','dry inserted box settles onto surviving cavity ledge');assert.equal(ledgePlacement.secured,false,'dry ledge support is not a mortar bond');assert.equal(ledgePlacement.contactMaterial,'brick');assert(ledge.point[1]+ledge.boxLocal[1]>1,'ledge prevents box falling to floor');await shot(page,'desktop-dry-cavity-ledge');
      await select(page,false,'level');await action(page,false);const dryLevel=await state(page);
      assert.equal(dryLevel.stage,'leveling','supported dry box accepts the seated level before mortar');assert.equal(dryLevel.levelVisible,true);
      await action(page,false);const dryConfirm=await state(page);assert.notEqual(dryConfirm.stage,'leveled','dry alignment cannot bypass required mortar support');
      await select(page,false,'fitting');
      await page.evaluate(()=>{const g=window.__wireTheHouse;g.boxPlacement.retrieve(g.mission.points.find(p=>p.definition.id===window.__boxQAOriginalId));});
      const bed=await page.evaluate(()=>{
        const g=window.__wireTheHouse,m=g.mortar,v=g.room.brickWall.volume,V=g.renderer.camera.position.constructor;let mass=0;
        for(const x of [-.34,-.27,-.20,-.13])mass+=m.field.add(new V(x,1.2,v.frontZ-.025),new V(0,0,1),.65,q=>v.isOccupied(q.x,q.y,q.z));
        m.stuckMass+=mass;m.syncFieldGeometry();return{mass,nodes:m.field.statistics};
      });
      assert(bed.mass>.1,'bed fixture contains actual mortar mass');
      await aim(page,-.25,1.2,.42);await action(page,false);const freshBed=await state(page);assert(freshBed.visible,'box placed into existing fresh mortar inside a fully cleared cavity');
      const initialY=freshBed.boxLocal[1];await steps(page,120);const bonded=await state(page),bond=bonded.placement.find(p=>p.id===bonded.id);
      assert.notEqual(bond.state,'floor','real rear mortar contacts prevent unsupported fall');assert(Math.abs(bonded.boxLocal[1]-initialY)<.025,'bed holds box near placed height');
      assert(Math.abs(bond.displacedKg-bond.repackedKg-bond.looseKg)<1e-8,'displaced mortar is repacked or falls, never deleted');assert(Math.abs(bonded.mortarMass-bed.mass)<1e-6,'mortar field and loose batches preserve total bed mass');
      await shot(page,'desktop-existing-mortar-bed');
      // The supported flush box cannot be adjusted past its authoritative
      // insertion limit; refused corrections must leave its rear casing clear.
      const constrained=await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.mission.points.find(p=>p.definition.id===window.__boxQAOriginalId),initial=p.boxGroup.position.z;const begun=g.leveling.begin(p);let rejected=0;for(let i=0;i<80;i++)if(!g.leveling.adjust(p,'in'))rejected++;const result={begun,initial,final:p.boxGroup.position.z,minimum:p.boxGroup.userData.minimumDepth,stage:p.stage,rejected};g.leveling.cancel(p);return result;});
      assert(constrained.begun,'real supported bed permits leveling');assert(constrained.rejected>0,'depth constraint rejects inward corrections past clearance');assert(constrained.final>=constrained.minimum-1e-8,'leveling cannot push the rear casing through its insertion limit');
      // Restore a deterministic saved shallow recess: one actual masonry node
      // layer is absent across the footprint, while all deeper material remains.
      const shallowFixture=await page.evaluate(async()=>{
        const g=window.__wireTheHouse,v=g.room.brickWall.volume;g.boxPlacement.retrieve(g.mission.points.find(p=>p.definition.id===window.__boxQAOriginalId));const save=v.serialize(),chunks=new Map(save.chunks.map(c=>[c.key,new Map(c.edits.map(e=>[e[0],e]))]));let removed=0;
        for(let x=1;x<=v.nx;x++)for(let y=Math.floor(1.13/v.hy);y<=Math.ceil(1.27/v.hy);y++){
          const p=v.nodePosition(x,y,1);if(Math.abs(p.x-2.1)>.15||Math.abs(p.y-1.2)>.065||!v.nodeMaterial(x,y,1))continue;
          const tx=Math.floor(x/v.tileSize),ty=Math.floor(y/v.tileSize),key=`${tx},${ty}`,offset=((y-ty*v.tileSize)*v.tileSize+x-tx*v.tileSize)*(v.nz+2)+1;
          if(!chunks.has(key))chunks.set(key,new Map());chunks.get(key).set(offset,[offset,255,1]);removed++;
        }
        save.chunks=[...chunks].map(([key,edits])=>({key,edits:[...edits.values()]}));save.removedVolume=(save.removedVolume??0)+removed*v.nodeVolume;v.restore(save);g.room.brickWall.flushGeometry();await g.room.brickWall.waitForGeometry();return{removed,layerDepthMm:v.hz*1000};
      });
      assert(shallowFixture.removed>0);await aim(page,2.1,1.2,.42);const beforeShallow=await state(page);await action(page,false);const shallow=await state(page);blockedPlacement(beforeShallow,shallow,'shallow recess');await shot(page,'desktop-shallow-recess-blocked');
      const filledCavity=await page.evaluate(()=>{
        const g=window.__wireTheHouse,m=g.mortar,v=g.room.brickWall.volume,V=g.renderer.camera.position.constructor;let added=0;const before=m.field.mass+m.telemetry.movingKg+m.telemetry.restingKg+m.telemetry.floorKg;
        for(const x of [-.33,-.25,-.17])for(const z of [v.frontZ-.07,v.frontZ-.035])added+=m.field.add(new V(x,1.2,z),new V(0,0,1),.6,q=>v.isOccupied(q.x,q.y,q.z));m.stuckMass+=added;m.syncFieldGeometry();return{before,added};
      });
      assert(filledCavity.added>.2);await aim(page,-.25,1.2,.42);await action(page,false);const pressed=await state(page),press=pressed.placement.find(p=>p.id===pressed.id);assert(pressed.visible);assert(press.insertionDepthMm>15,'fresh cavity mortar yields to the box');assert(press.displacedKg>.01,'pressing displaces actual occupied mortar');assert(Math.abs(press.displacedKg-press.repackedKg-press.looseKg)<1e-8);assert(Math.abs(pressed.mortarMass-filledCavity.before-filledCavity.added)<1e-6,'fresh cavity placement preserves all mortar mass');await shot(page,'desktop-pressed-mortar-cavity');
      const perimeterPacking=await page.evaluate(()=>{const g=window.__wireTheHouse,m=g.mortar,p=g.mission.points.find(p=>p.definition.id===window.__boxQAOriginalId),V=g.renderer.camera.position.constructor,width=p.boxGroup.groupWidth/2+.026,height=p.boxGroup.groupHeight/2+.024;let added=0;for(let side=0;side<4;side++)for(let i=0;i<6;i++){const t=-.9+1.8*i/5,q=new V(side<2?t*width:side===2?-width:width,side<2?side===0?-height:height:t*height,-.025).applyMatrix4(p.boxGroup.matrixWorld);added+=m.deposit(q,.15,new V(0,0,1),false);}m.stuckMass+=added;m.syncFieldGeometry();return{added,coverage:m.coverage(p)};});
      await steps(page,120);const secured=await state(page);assert.equal(secured.placement.find(p=>p.id===secured.id).secured,true,'fresh cavity mortar develops support before leveling');
      await select(page,false,'level');await action(page,false);const levelStarted=await state(page);assert.equal(levelStarted.stage,'leveling','secured flush box enters normal spirit-level workflow');await action(page,false);const confirmed=await state(page);assert.equal(confirmed.stage,'leveled','native confirm advances a secured level and flush box');
      const washed=await page.evaluate(()=>{const g=window.__wireTheHouse,m=g.mortar,V=g.renderer.camera.position.constructor,front=g.room.brickWall.volume.frontZ;let removed=0;for(const x of [-.4,-.34,-.28,-.22,-.16,-.1])for(const y of [1.12,1.18,1.24,1.3])removed+=m.applyWater(new V(x,y,front-.025),new V(0,0,1),5).washedMortarKg;return removed;});
      assert(washed>0,'water removes actual fresh mortar supporting the cavity box');await steps(page,90);const afterWash=await state(page);assert.equal(afterWash.placement.find(p=>p.id===afterWash.id).secured,false,'washing away mortar revokes box bond');assert.notEqual(afterWash.stage,'leveled','lost support revokes leveling progress');assert.equal(afterWash.levelVisible,false);await shot(page,'desktop-washed-support-revoked');
      await page.evaluate(()=>{const g=window.__wireTheHouse;g.boxPlacement.retrieve(g.mission.points.find(p=>p.definition.id===window.__boxQAOriginalId));});
      await select(page,false,'fitting');
      const curedBed=await page.evaluate(()=>{const g=window.__wireTheHouse,m=g.mortar,v=g.room.brickWall.volume,V=g.renderer.camera.position.constructor;let added=0;for(const x of [-.33,-.25,-.17])added+=m.field.add(new V(x,1.2,v.frontZ-.01),new V(0,0,1),.7,q=>v.isOccupied(q.x,q.y,q.z));for(const node of m.field.nodes.values())if(Math.abs(node.x*m.field.spacing+.25)<.3)node.age=4000;m.stuckMass+=added;m.syncFieldGeometry();return{added};});
      await aim(page,-.25,1.2,.42);const beforeCured=await state(page);await action(page,false);const cured=await state(page);blockedPlacement(beforeCured,cured,'cured mortar');await shot(page,'desktop-cured-mortar-blocked');
      report.scenarios.push({platform:name,cavities,narrow,full,ledge,dryLevel,dryConfirm,bed,freshBed,bonded,constrained,shallowFixture,shallow,filledCavity,pressed,perimeterPacking,secured,levelStarted,confirmed,washed,afterWash,curedBed,cured});
    }
    await page.close();
  }
  assert.deepEqual(report.errors,[]);console.log(JSON.stringify({url,platforms:['desktop','mobile'],checks:['far denial','native close approach','intact wall refusal and flush placement in cleared slot','gravity and floor','native fallen retrieval','reposition','multiple supplied boxes preserve original fallen group','stable ID retrieval with continuing supply','fixed arm lengths','whole footprint collision','shallow recess refusal','dry ledge support','fresh mortar displacement and mass','cured mortar blocks placement beyond finish','level depth constraint','secured native level confirmation','wash support revocation'],errors:report.errors,report:`${out}/report.json`}));
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
