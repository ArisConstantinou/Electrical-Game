import * as THREE from 'three';
import { buildToolModel, addHammerDetails } from './ToolModels';
import type { BrickWall, ChiselContact } from '../world/BrickWall';

export type RigTool = 'spray' | 'hammer' | 'fitting' | 'level' | 'spring' | 'cutter' | 'trowel' | 'hose';
export const RIG_TOOLS: RigTool[] = ['spray', 'hammer', 'fitting', 'level', 'spring', 'cutter', 'trowel', 'hose'];

// The viewmodel belongs to the final transparent pass so wall paint can never
// composite over the hands or tool, regardless of camera distance.
const material = (color: number, roughness = 0.7, metalness = 0.05): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({
  color,
  roughness,
  metalness,
  transparent: true,
  depthTest: false,
  depthWrite: false,
});
const place = (object: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D => { object.position.set(x, y, z); object.renderOrder = 20; return object; };

export class FPSRig extends THREE.Group {
  private readonly tools = new Map<RigTool, THREE.Group>();
  private readonly restingY = -0.24;
  private sprayCanMaterial: THREE.MeshStandardMaterial | null = null;
  private sprayMist: THREE.Points | null = null;
  private strikeAmount = 0;
  private flatTip: THREE.Mesh | null = null;
  private pointedTip: THREE.Mesh | null = null;
  private readonly tipAnchor = new THREE.Vector3(.02, .005, -.74);
  private readonly hammerArms = new THREE.Group();
  private readonly hammerArmParts: Array<{ upper: THREE.Mesh; forearm: THREE.Mesh; cuff: THREE.Mesh; glove: THREE.Mesh; grip: THREE.Vector3; side: number }> = [];
  readonly chiselTipWorld = new THREE.Vector3();
  toolAction = 0;
  hoseActive = false;
  levelTiltDegrees = 0;
  mortarCharge = 0;
  mortarRecovery = 0;
  mortarSwingDegrees = 0;
  mortarHolding = false;
  chiselInAir = false;
  workStanceSide = 0;

  /** Seat the real visible tip on the first remaining solid, then read it back. */
  contact(camera: THREE.Camera, wall: BrickWall): ChiselContact | null {
    const hammer = this.tools.get('hammer')!;
    if (this.flatTip) {
      this.flatTip.visible = wall.chiselType === 'flat'; this.flatTip.rotation.z = wall.chiselEdgeAngle;
      // Match metres in the world despite the camera rig's presentation scale.
      const scale=hammer.getWorldScale(new THREE.Vector3()).x;
      this.flatTip.scale.x=wall.chiselWidthM/(.045*scale);
    }
    if (this.pointedTip) this.pointedTip.visible = wall.chiselType === 'pointed';
    camera.updateMatrixWorld(true);
    this.updateWorldMatrix(true, false);
    // Blade roll and hammer pitch are independent. Positive pitch is the
    // electrician's top-to-bottom stroke: handle above the engaged cutting edge.
    const tilt=THREE.MathUtils.degToRad(wall.chiselTiltDegrees);
    // The working wall supplies world up and its normal. Looking around must
    // not silently change the independently chosen vertical/lateral attack.
    const side=THREE.MathUtils.degToRad(wall.chiselSideDegrees);
    const desiredWorld=new THREE.Vector3(Math.sin(side)*Math.cos(tilt),-Math.sin(tilt),-Math.cos(side)*Math.cos(tilt));
    // The zero-roll cutting edge stays horizontal in the wall's frame. A
    // shortest-arc rotation from the camera adds an accidental blade roll when
    // looking sideways or combining vertical and lateral hammer angles.
    const right=desiredWorld.clone().cross(new THREE.Vector3(0,1,0)).normalize();
    const back=desiredWorld.clone().negate();
    const up=back.clone().cross(right).normalize();
    const worldOrientation=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,up,back));
    const parentRotation=this.getWorldQuaternion(new THREE.Quaternion()).invert();
    hammer.quaternion.copy(parentRotation.multiply(worldOrientation));
    hammer.updateWorldMatrix(true, false);
    const orientation = hammer.getWorldQuaternion(new THREE.Quaternion());
    const direction = new THREE.Vector3(0,0,-1).applyQuaternion(orientation);
    const edge = new THREE.Vector3(Math.cos(wall.chiselEdgeAngle), Math.sin(wall.chiselEdgeAngle), 0).applyQuaternion(orientation).normalize();
    const view = camera.getWorldDirection(new THREE.Vector3());
    const eye = camera.getWorldPosition(new THREE.Vector3());
    const distance = (wall.volume.frontZ-eye.z)/view.z;
    if (distance < 0 || distance > 2.35 || direction.z >= -.04) { hammer.position.set(0,0,0); this.hammerArms.visible=false; this.chiselInAir=true; return null; }
    const entry = eye.clone().addScaledVector(view,distance);
    if (Math.abs(entry.x)>2.54 || entry.y<0 || entry.y>3) { hammer.position.set(0,0,0);this.hammerArms.visible=false;this.chiselInAir=true;return null; }
    // Follow the CHISEL axis through the aperture. Empty chambers consume no
    // impact and no energy: the next contact is a surviving rib or rear shell.
    const origin=entry.clone().addScaledVector(direction,-.02);
    // Finishing starts at the rib under the crosshair inside the open chase.
    // Tilting upward changes the blade attack, not the selected depth/target.
    // Ordinary excavation still follows the shaft through the front aperture.
    const upward=wall.chiselTiltDegrees<0;
    const rayOrigin=upward?eye:origin,rayDirection=upward?view:direction;
    const reach=upward?2.35:Math.min(.38,.24/Math.abs(direction.z));
    let hit=wall.volume.raycast(rayOrigin,rayDirection,reach),bladeOffsetM=0;
    if(wall.chiselType==='flat'){
      // A wide edge cannot pass through a hole merely because its centre is air.
      // At most nine rays, spaced no farther apart than the material lattice.
      const half=wall.chiselWidthM/2,steps=Math.ceil(half/.007);
      for(let i=1;i<=steps;i++)for(const sign of [-1,1]){
        const offset=sign*half*i/steps;
        const candidate=wall.volume.raycast(rayOrigin.clone().addScaledVector(edge,offset),rayDirection,reach);
        if(candidate&&(!hit||candidate.distance<hit.distance-1e-6)){hit=candidate;bladeOffsetM=offset;}
      }
    }
    this.chiselInAir=!hit;
    const target=hit?new THREE.Vector3(hit.point.x,hit.point.y,hit.point.z).addScaledVector(edge,-bladeOffsetM):entry.clone().addScaledVector(direction,Math.min(.34,.19/Math.abs(direction.z)));
    const local=this.worldToLocal(target.clone());
    hammer.position.copy(local).sub(this.tipAnchor.clone().applyQuaternion(hammer.quaternion));
    hammer.updateWorldMatrix(true, true);
    const tip = hammer.localToWorld(this.tipAnchor.clone());
    this.chiselTipWorld.copy(tip);
    this.poseHammerArms(camera, hammer);
    if (!hit) return null;
    return {point:tip.clone().addScaledVector(edge,bladeOffsetM), direction, edge, chisel:wall.chiselType, energyJ:wall.chiselEnergyJ, widthM:wall.chiselWidthM, bladeOffsetM};
  }

  constructor() {
    super();
    this.name = 'Modular FPS hands and tools';
    this.userData.studioEntityId = 'fps-rig';
    this.position.set(0.08, this.restingY, -0.88);
    this.scale.setScalar(0.74);
    this.addTool('spray', this.createDetailedTool('spray'));
    const hammer=this.createHammer();addHammerDetails(hammer);this.addTool('hammer', hammer);
    this.add(this.hammerArms);
    for(const tool of ['fitting','level','spring','cutter','trowel','hose'] as const)this.addTool(tool,this.createDetailedTool(tool));
    this.show('spray');
  }

  show(tool: RigTool): void { this.tools.forEach((group, key) => { group.visible = key === tool; }); this.hammerArms.visible=tool==='hammer'; }
  setSprayColor(color: number): void {
    this.sprayCanMaterial?.color.setHex(color);
    this.tools.get('spray')?.traverse(object=>{if(object instanceof THREE.Mesh && object.userData.sprayColor)(object.material as THREE.MeshStandardMaterial).color.setHex(color);});
    (this.sprayMist?.material as THREE.PointsMaterial | undefined)?.color.setHex(color);
  }
  toolTipWorld(camera: THREE.Camera,tool: RigTool): THREE.Vector3 {
    camera.updateMatrixWorld(true);this.updateWorldMatrix(true,true);
    const group=this.tools.get(tool),tip=group?.userData.tipPoint as number[] | undefined;
    return group ? group.localToWorld(tip ? new THREE.Vector3().fromArray(tip) : new THREE.Vector3(.1,.04,-.14)) : camera.localToWorld(new THREE.Vector3(.15,-.18,-.55));
  }
  strike(): void { this.strikeAmount = 1; }
  update(dt: number, moving: boolean, spraying = false): void {
    const bob = moving ? Math.sin(performance.now() * 0.012) * 0.006 : 0;
    this.position.y = this.restingY + bob;
    this.strikeAmount = Math.max(0, this.strikeAmount - dt * 5.5);
    this.rotation.x = -Math.sin(this.strikeAmount * Math.PI) * 0.16;
    this.toolAction=Math.max(0,this.toolAction-dt*2.5);
    const cutter=this.tools.get('cutter')?.getObjectByName('cutter-moving-handle');
    if(cutter)cutter.rotation.z=Math.sin(this.toolAction*Math.PI)*.28;
    const trigger=this.tools.get('hose')?.getObjectByName('hose-trigger');
    if(trigger)trigger.scale.x=this.hoseActive?.82:1;
    const bubble=this.tools.get('level')?.getObjectByName('level-bubble');
    if(bubble){if(bubble.userData.restX===undefined)bubble.userData.restX=bubble.position.x;bubble.position.x=bubble.userData.restX+THREE.MathUtils.clamp(this.levelTiltDegrees*.003,-.014,.014);}
    const actuator=this.tools.get('spray')?.getObjectByName('spray-actuator');
    if(actuator)actuator.position.y=spraying?.102:.104;
    const trowel=this.tools.get('trowel');
    if(trowel){
      // The degree readout and the visible wrist/tool use the same stroke.
      // Keep the gripping hand parented to the tool throughout the swing.
      const returning = this.mortarRecovery > 0;
      const degrees = this.mortarHolding || returning ? this.mortarSwingDegrees : 0;
      trowel.rotation.x = THREE.MathUtils.degToRad(degrees);
      trowel.position.y = this.mortarHolding ? -.025 * Math.sin(this.mortarCharge * Math.PI) : 0;
      const load=trowel.getObjectByName('trowel-load');if(load)load.visible=this.mortarRecovery<.2;
    }
    if (this.sprayMist) {
      this.sprayMist.visible = spraying;
      if (spraying) {
        const positions = this.sprayMist.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let index = 0; index < positions.count; index += 1) {
          const travel = (performance.now() * 0.0018 + index / positions.count) % 1;
          positions.setXYZ(index, 0.175 + (Math.random() - 0.5) * travel * 0.055, 0.021 + (Math.random() - 0.5) * travel * 0.055, -0.05 - travel * 0.34);
        }
        positions.needsUpdate = true;
      }
    }
  }

  private addTool(key: RigTool, group: THREE.Group): void { group.name = `FPS ${key} tool`; group.userData.studioEntityId = `fps-rig:${key}`; this.tools.set(key, group); this.add(group); }
  private poseHammerArms(camera: THREE.Camera, hammer: THREE.Group): void {
    this.hammerArms.visible=hammer.visible;
    const upright=new THREE.Vector3(0,1,0);
    const segment=(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void=>{
      const delta=b.clone().sub(a);
      mesh.position.copy(a).add(b).multiplyScalar(.5);
      mesh.quaternion.setFromUnitVectors(upright,delta.clone().normalize());
      mesh.scale.y=delta.length();
    };
    for(const arm of this.hammerArmParts){
      const wrist=this.worldToLocal(hammer.localToWorld(arm.grip.clone()));
      const wristCamera=camera.worldToLocal(this.localToWorld(wrist.clone()));
      // Shoulders enter from below the viewport. Elbows stay on their own side
      // of the picture instead of inheriting the motor's pitched orientation.
      const stance=THREE.MathUtils.clamp(this.workStanceSide,-1,1), blend=Math.abs(stance);
      const shoulder=this.worldToLocal(camera.localToWorld(new THREE.Vector3(arm.side*(.38-.07*blend)-stance*.06,-.66, -.36+arm.side*stance*.08)));
      // Route the forearm up underneath its wrist. When the tool leans left,
      // the right upper arm crosses below the work area, never across the tip.
      const elbow=this.worldToLocal(camera.localToWorld(new THREE.Vector3(THREE.MathUtils.lerp(wristCamera.x+arm.side*.10,wristCamera.x+(Math.sign(wristCamera.x)||arm.side)*.25,blend),Math.min(-.34,wristCamera.y-.32+.07*blend),Math.min(-.52+.07*blend,wristCamera.z*(.80-.08*blend)))));
      segment(arm.upper,shoulder,elbow); segment(arm.forearm,elbow,wrist);
      const axis=wrist.clone().sub(elbow).normalize();
      arm.cuff.position.copy(wrist).addScaledVector(axis,-.05);
      arm.cuff.quaternion.setFromUnitVectors(upright,axis);
      arm.glove.position.copy(wrist);
      arm.glove.quaternion.copy(hammer.quaternion);
    }
  }
  private createHammerArms(): void {
    this.hammerArms.name='Hammer arms with independent shoulder and grip anchors';
    for(const side of [-1,1]){
      const sleeveMaterial=material(0x263e35,.95);
      const upper=new THREE.Mesh(new THREE.CylinderGeometry(.062,.072,1,10),sleeveMaterial);
      const forearm=new THREE.Mesh(new THREE.CylinderGeometry(.049,.062,1,10),sleeveMaterial);
      const cuff=new THREE.Mesh(new THREE.CylinderGeometry(.05,.055,.04,10),material(0x1d3129,.94));
      const glove=new THREE.Mesh(new THREE.SphereGeometry(.062,12,9),material(0x494842,.92));
      glove.scale.set(1.08,.72,.92);
      const grip=side<0?new THREE.Vector3(-.13,-.005,-.30):new THREE.Vector3(.19,-.12,.015);
      this.hammerArmParts.push({upper,forearm,cuff,glove,grip,side});
      for(const mesh of [upper,forearm,cuff,glove]){
        const m=mesh.material as THREE.MeshStandardMaterial;m.depthTest=true;m.depthWrite=true;m.transparent=false;
        mesh.renderOrder=20;this.hammerArms.add(mesh);
      }
    }
  }
  private hand(x: number, y: number, z: number, rotation = 0): THREE.Group {
    const hand = new THREE.Group();
    // Keep the authored hand/tool scale, but extend the forearm beyond the
    // lower viewport edge. The body is then implied by an off-screen shoulder
    // instead of a visibly capped, floating arm.
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.5, 6, 12), material(0x263e35, 0.95));
    sleeve.position.y = -0.19;
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.062, 0.04, 12), material(0x1d3129, 0.94));
    cuff.position.y = 0.115;
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.062, 12, 9), material(0x494842, 0.92));
    glove.scale.set(1.08, 0.72, 0.92);
    glove.position.y = 0.155;
    hand.rotation.z = rotation;
    hand.add(sleeve, cuff, glove);
    place(hand, x, y, z);
    return hand;
  }
  private createDetailedTool(kind: Exclude<RigTool,'hammer'>):THREE.Group {
    const group=buildToolModel(kind),grip=new THREE.Vector3().fromArray(group.userData.gripPoint);
    group.add(this.hand(grip.x+.06,grip.y-.14,grip.z+.01,.4));
    const second=group.userData.secondaryGripPoint as number[] | undefined;
    if(second)group.add(this.hand(second[0]-.055,second[1]-.14,second[2]+.01,-.4));
    if(kind==='trowel'){
      const load=new THREE.Mesh(new THREE.IcosahedronGeometry(.044,2),material(0x857a66,.96));load.name='trowel-load';load.position.set(.01,.06,-.077);load.scale.set(.85,1.5,.22);group.add(load);
    }
    if(kind==='spray'){
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(54),3));
      this.sprayMist=new THREE.Points(geometry,new THREE.PointsMaterial({color:0x168cdb,size:.009,transparent:true,opacity:.4,depthTest:false}));this.sprayMist.visible=false;this.sprayMist.renderOrder=21;group.add(this.sprayMist);
    }
    // Shared builders also serve world props; only viewmodels use this overlay pass.
    group.traverse(object=>{if(object instanceof THREE.Mesh){for(const m of Array.isArray(object.material)?object.material:[object.material]){m.transparent=true;m.depthTest=false;m.depthWrite=false;}object.renderOrder=20;object.castShadow=false;}});
    return group;
  }
  private createHammer(): THREE.Group {
    const group = new THREE.Group();
    this.createHammerArms();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.14, 0.28), material(0xa42d23, 0.48, 0.25));
    body.rotation.x = -0.25; place(body, 0.02, -0.06, -0.1);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.036, 0.25, 10), material(0x282b29, 0.84));
    place(grip, 0.19, -0.12, 0.015);
    const gripBridge=new THREE.Mesh(new THREE.BoxGeometry(.13,.035,.045),material(0x282b29,.84));
    place(gripBridge,.135,.005,.015);
    const chuck = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.037, 0.12, 12), material(0x555b5a, 0.35, 0.65));
    chuck.rotation.x = Math.PI / 2; place(chuck, 0.02, 0.005, -0.29);
    const sideGrip=new THREE.Mesh(new THREE.CylinderGeometry(.022,.026,.22,10),material(0x282b29,.84));
    sideGrip.rotation.z=Math.PI/2;place(sideGrip,-.08,-.005,-.30);
    const chisel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.35, 8), material(0x6d7370, 0.3, 0.75));
    chisel.rotation.x = Math.PI / 2; place(chisel, 0.02, 0.005, -0.51);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.04, 0.2), material(0x252827, 0.82));
    top.rotation.x = -0.25; place(top, 0.02, 0.025, -0.1);
    const wedge = new THREE.BufferGeometry();
    wedge.setAttribute('position', new THREE.Float32BufferAttribute([-.0225,-.006,.035, .0225,-.006,.035, .0225,.006,.035, -.0225,.006,.035, -.0225,0,-.035, .0225,0,-.035], 3));
    wedge.setIndex([0,2,1,0,3,2,0,1,5,0,5,4,3,4,5,3,5,2,0,4,3,1,2,5]);
    wedge.computeVertexNormals();
    const chiselTip = new THREE.Mesh(wedge, material(0x7b807c, 0.28, 0.8));
    place(chiselTip, 0.02, 0.005, -0.705);
    this.flatTip = chiselTip;
    this.pointedTip = new THREE.Mesh(new THREE.ConeGeometry(.012,.07,6), material(0x7b807c,.28,.8));
    this.pointedTip.rotation.x = -Math.PI/2;
    place(this.pointedTip,.02,.005,-.705); this.pointedTip.visible=false;
    group.add(body, top, grip, gripBridge, sideGrip, chuck, chisel, chiselTip, this.pointedTip);
    // The wall must occlude parts of the bit inside solid shell/ribs. The other
    // handheld tools retain their established overlay rendering.
    group.traverse(object=>{ if(object instanceof THREE.Mesh) for(const m of Array.isArray(object.material)?object.material:[object.material]) {m.depthTest=true;m.depthWrite=true;m.transparent=false;} });
    return group;
  }
}
