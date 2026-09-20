import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createServer } from 'vite';

const server=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
const prior={window:globalThis.window,width:globalThis.innerWidth,height:globalThis.innerHeight},media={matches:false};
globalThis.window={matchMedia:()=>media};globalThis.innerWidth=1366;globalThis.innerHeight=768;
try{
  const {FPSRig}=await server.ssrLoadModule('/src/player/FPSRig.ts');
  const {buildToolModel}=await server.ssrLoadModule('/src/player/ToolModels.ts');
  const {ElectricalBox}=await server.ssrLoadModule('/src/electrical/Box.ts');
  const {INSTALLATION_RULES}=await server.ssrLoadModule('/src/data/installationRules.ts');
  const presets=[['1G'],['2G'],['2G','1G']],report=[];
  const near=(a,b,label)=>assert(Math.abs(a-b)<1e-8,`${label}: ${a} != ${b}`);
  let grip;
  for(const kinds of presets){
    const model=buildToolModel('fitting',kinds),body=model.children[0],boxes=body.children;
    assert.equal(boxes.length,kinds.length);assert.deepEqual(boxes.map(box=>box.kind),kinds);
    let width=0;
    boxes.forEach((box,index)=>{
      const original=new ElectricalBox(kinds[index],'reference');
      assert.deepEqual([box.width,box.height,box.depth],[original.width,original.height,original.depth]);
      assert.equal(box.children.length,original.children.length,'Held and placed casings contain identical parts');
      for(let part=0;part<box.children.length;part++){
        assert.deepEqual(box.children[part].position.toArray(),original.children[part].position.toArray());
        assert.deepEqual(box.children[part].geometry.getAttribute('position').array,original.children[part].geometry.getAttribute('position').array,'Held casing vertices must be the actual placed casing');
      }
      if(index)near(box.position.x-box.width/2-(boxes[index-1].position.x+boxes[index-1].width/2),INSTALLATION_RULES.box.groupGap,'Actual group gap');
      width+=box.width;
    });
    width+=(boxes.length-1)*INSTALLATION_RULES.box.groupGap;
    near(model.userData.fittingGroupWidth,width,'Group width');
    near(boxes.at(-1).position.x+boxes.at(-1).width/2+.006,.0395,'Fixed right rim at the hand');
    if(grip)assert.deepEqual(model.userData.gripPoint,grip,'Preset change must not move the established grip');else grip=model.userData.gripPoint;
    report.push({preset:kinds.join('+'),boxCount:boxes.length,groupWidthMm:width*1000,depthMm:boxes[0].depth*1000});
  }
  const camera=new THREE.PerspectiveCamera(65,1366/768,.025,60);camera.position.set(0,1.65,-1.9);camera.rotation.order='YXZ';
  const rig=new FPSRig();camera.add(rig);rig.show('fitting');
  const tool=rig.getObjectByName('FPS fitting tool'),assemblyRoot=rig.getObjectByName('Left-hand live box assembly'),candidateRoot=rig.getObjectByName('Right-hand next box');
  assert(assemblyRoot&&candidateRoot,'Live assembly and candidate roots exist');
  for(const [width,height,coarse] of [[1366,768,false],[390,844,true],[844,390,true]]){
    globalThis.innerWidth=width;globalThis.innerHeight=height;media.matches=coarse;
    for(const kinds of [...presets,...presets].reverse()){
      rig.setFittingBoxKinds(kinds);
      for(let frame=0;frame<30;frame++){rig.update(1/60,false);rig.poseArms(camera);}
      const held=[],candidate=[];assemblyRoot.traverseVisible(object=>{if(object instanceof ElectricalBox)held.push(object.kind);});candidateRoot.traverseVisible(object=>{if(object instanceof ElectricalBox)candidate.push(object.kind);});
      assert.deepEqual(held,kinds,'The left hand renders the complete selected assembly');
      assert.deepEqual(candidate,[kinds.at(-1)],'The right hand renders the next box candidate');
      const pose=rig.debugPose();assert.deepEqual(pose.arms.map(arm=>arm.gripRole).sort(),['assembly','candidate']);
      for(const arm of pose.arms){
        near(Math.hypot(...arm.shoulder.map((value,index)=>value-arm.elbow[index])),.31,'Upper arm length');
        near(Math.hypot(...arm.elbow.map((value,index)=>value-arm.wrist[index])),.27,'Forearm length');
        assert.equal(arm.fingers,5);assert.equal(arm.gripping,true);
      }
      assert(assemblyRoot.children.length<=kinds.length+1,'Rebuild removes stale assembly children');
      assert.equal(candidateRoot.children.length,1,'Rebuild keeps one right-hand candidate');
    }
  }
  rig.fittingBoxAvailable=false;rig.poseArms(camera);assert(!assemblyRoot.visible&&!candidateRoot.visible,'Unavailable supply hides both held assemblies');
  assert(rig.debugPose().arms.every(arm=>!arm.gripping&&arm.gripRole==='reaching'),'Both empty hands reach when supply is unavailable');
  rig.setFittingBoxKinds(['2G']);rig.fittingBoxAvailable=true;rig.poseArms(camera);assert(assemblyRoot.visible&&candidateRoot.visible);
  // Match Game's actual fitting standoff at a straight, close wall view. A
  // valid hand pose alone did not prevent the held casings entering the wall.
  globalThis.innerWidth=390;globalThis.innerHeight=844;media.matches=true;
  const front=-2.41,clearances=[];camera.position.set(0,1.65,front+.46);camera.rotation.set(0,0,0);
  for(const kinds of presets){
    rig.setFittingBoxKinds(kinds);
    for(let frame=0;frame<10;frame++){rig.update(1/60,false);rig.position.z=-.32;rig.poseArms(camera);}
    camera.updateMatrixWorld(true);const bounds=new THREE.Box3();
    tool.traverseVisible(object=>{if(object instanceof ElectricalBox)bounds.union(new THREE.Box3().setFromObject(object));});
    assert(!bounds.isEmpty());
    assert(bounds.min.z-front>=.015,'The complete selected casing must remain in front of the near wall');
    const right=rig.debugPose().arms.find(arm=>arm.side===1);
    near(Math.hypot(...right.shoulder.map((value,index)=>value-right.elbow[index])),.31,'Near-wall upper arm length');
    near(Math.hypot(...right.elbow.map((value,index)=>value-right.wrist[index])),.27,'Near-wall forearm length');
    clearances.push({preset:kinds.join('+'),wallClearanceMm:(bounds.min.z-front)*1000});
  }
  console.log(JSON.stringify({passed:true,presets:report,nearWall:clearances,checks:['actual placed casing geometry and gaps','left-hand assembly plus right-hand candidate','two gripping hands and five fingers','desktop/portrait/landscape pose checks','availability restoration','near-wall whole casing clearance','bounded live rebuild children']},null,2));
}finally{globalThis.window=prior.window;globalThis.innerWidth=prior.width;globalThis.innerHeight=prior.height;await server.close();}
