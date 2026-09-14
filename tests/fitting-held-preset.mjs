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
  const tool=rig.getObjectByName('FPS fitting tool'),geometryIds=[];rig.traverse(object=>{if(object.isMesh)geometryIds.push(object.geometry.uuid);});
  const primary=rig.armSets.get('fitting').find(arm=>arm.side===1).hand,originalHand=primary.uuid;
  const storedGripPosition=[...primary.userData.fittingGripPosition],storedGripQuaternion=[...primary.userData.fittingGripQuaternion];
  for(const [width,height,coarse] of [[1366,768,false],[390,844,true],[844,390,true]]){
    globalThis.innerWidth=width;globalThis.innerHeight=height;media.matches=coarse;
    let firstWrist;
    for(const kinds of [...presets,...presets].reverse()){
      rig.setFittingBoxKinds(kinds);
      for(let frame=0;frame<30;frame++){rig.update(1/60,false);rig.poseArms(camera);}
      const visible=[];tool.traverseVisible(object=>{if(object instanceof ElectricalBox)visible.push(object.kind);});
      assert.deepEqual(visible,kinds,'Exactly the selected supply group is rendered');
      assert.equal(primary.uuid,originalHand,'Preset changes reuse the existing hand');
      assert.deepEqual(primary.userData.fittingGripPosition,storedGripPosition);assert.deepEqual(primary.userData.fittingGripQuaternion,storedGripQuaternion);
      const pose=rig.debugPose(),right=pose.arms.find(arm=>arm.side===1);
      for(const arm of pose.arms){
        near(Math.hypot(...arm.shoulder.map((value,index)=>value-arm.elbow[index])),.31,'Upper arm length');
        near(Math.hypot(...arm.elbow.map((value,index)=>value-arm.wrist[index])),.27,'Forearm length');
        assert.equal(arm.fingers,5);assert.equal(arm.gripping,arm.side===1);
      }
      if(firstWrist)right.wrist.forEach((value,index)=>near(value,firstWrist[index],'Wrist remains fixed across presets'));else firstWrist=right.wrist;
    }
  }
  rig.fittingBoxAvailable=false;rig.poseArms(camera);assert(rig.fittingBoxParts.every(part=>!part.visible),'Unavailable supply hides every cached variant');
  rig.setFittingBoxKinds(['2G']);assert(rig.fittingBoxParts.every(part=>!part.visible));
  rig.fittingBoxAvailable=true;rig.poseArms(camera);
  const final=[];tool.traverseVisible(object=>{if(object instanceof ElectricalBox)final.push(object.kind);});assert.deepEqual(final,['2G']);
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
  const after=[];rig.traverse(object=>{if(object.isMesh)after.push(object.geometry.uuid);});assert.deepEqual(after,geometryIds,'Repeated preset changes and frames must not rebuild or leak geometry');
  console.log(JSON.stringify({passed:true,presets:report,nearWall:clearances,checks:['actual placed casing geometry and gaps','one cached visible variant','fixed grip/wrist and five fingers','desktop/portrait/landscape pose checks','availability restoration','near-wall whole casing clearance','no geometry rebuilds']},null,2));
}finally{globalThis.window=prior.window;globalThis.innerWidth=prior.width;globalThis.innerHeight=prior.height;await server.close();}
