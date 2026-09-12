import * as THREE from 'three';
import type { BrickWall, ChiselContact } from '../world/BrickWall';

export type RigTool = 'spray' | 'hammer' | 'fitting' | 'level' | 'spring' | 'cutter';
export const RIG_TOOLS: RigTool[] = ['spray', 'hammer', 'fitting', 'level', 'spring', 'cutter'];

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
  chiselInAir = false;

  /** Seat the real visible tip on the first remaining solid, then read it back. */
  contact(camera: THREE.Camera, wall: BrickWall): ChiselContact | null {
    const hammer = this.tools.get('hammer')!;
    if (this.flatTip) { this.flatTip.visible = wall.chiselType === 'flat'; this.flatTip.rotation.z = wall.chiselEdgeAngle; }
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
    const view = camera.getWorldDirection(new THREE.Vector3());
    const eye = camera.getWorldPosition(new THREE.Vector3());
    const distance = (wall.volume.frontZ-eye.z)/view.z;
    if (distance < 0 || distance > 2.35 || direction.z >= -.04) { hammer.position.set(0,0,0); this.hammerArms.visible=false; this.chiselInAir=true; return null; }
    const entry = eye.clone().addScaledVector(view,distance);
    if (Math.abs(entry.x)>2.54 || entry.y<0 || entry.y>3) { hammer.position.set(0,0,0);this.hammerArms.visible=false;this.chiselInAir=true;return null; }
    // Follow the CHISEL axis through the aperture. Empty chambers consume no
    // impact and no energy: the next contact is a surviving rib or rear shell.
    const origin=entry.clone().addScaledVector(direction,-.02);
    const hit=wall.volume.raycast(origin,direction,Math.min(.38,.24/Math.abs(direction.z)));
    this.chiselInAir=!hit;
    const target=hit?new THREE.Vector3(hit.point.x,hit.point.y,hit.point.z):entry.clone().addScaledVector(direction,Math.min(.34,.19/Math.abs(direction.z)));
    const local=this.worldToLocal(target.clone());
    hammer.position.copy(local).sub(this.tipAnchor.clone().applyQuaternion(hammer.quaternion));
    hammer.updateWorldMatrix(true, true);
    const tip = hammer.localToWorld(this.tipAnchor.clone());
    this.chiselTipWorld.copy(tip);
    this.poseHammerArms(camera, hammer);
    if (!hit) return null;
    const edge = new THREE.Vector3(Math.cos(wall.chiselEdgeAngle), Math.sin(wall.chiselEdgeAngle), 0).applyQuaternion(orientation).normalize();
    return {point:tip, direction, edge, chisel:wall.chiselType, energyJ:wall.chiselEnergyJ};
  }

  constructor() {
    super();
    this.name = 'Modular FPS hands and tools';
    this.userData.studioEntityId = 'fps-rig';
    this.position.set(0.08, this.restingY, -0.88);
    this.scale.setScalar(0.74);
    this.addTool('spray', this.createSpray());
    this.addTool('hammer', this.createHammer());
    this.add(this.hammerArms);
    this.addTool('fitting', this.createFittingTool());
    this.addTool('level', this.createLevel());
    this.addTool('spring', this.createPvcTool('spring'));
    this.addTool('cutter', this.createPvcTool('cutter'));
    this.show('spray');
  }

  show(tool: RigTool): void { this.tools.forEach((group, key) => { group.visible = key === tool; }); this.hammerArms.visible=tool==='hammer'; }
  setSprayColor(color: number): void {
    this.sprayCanMaterial?.color.setHex(color);
    (this.sprayMist?.material as THREE.PointsMaterial | undefined)?.color.setHex(color);
  }
  strike(): void { this.strikeAmount = 1; }
  update(dt: number, moving: boolean, spraying = false): void {
    const bob = moving ? Math.sin(performance.now() * 0.012) * 0.006 : 0;
    this.position.y = this.restingY + bob;
    this.strikeAmount = Math.max(0, this.strikeAmount - dt * 5.5);
    this.rotation.x = -Math.sin(this.strikeAmount * Math.PI) * 0.16;
    if (this.sprayMist) {
      this.sprayMist.visible = spraying;
      if (spraying) {
        const positions = this.sprayMist.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let index = 0; index < positions.count; index += 1) {
          const travel = (performance.now() * 0.0018 + index / positions.count) % 1;
          positions.setXYZ(index, 0.17 + (Math.random() - 0.5) * travel * 0.055, 0.065 + (Math.random() - 0.5) * travel * 0.055, -0.05 - travel * 0.34);
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
      const shoulder=this.worldToLocal(camera.localToWorld(new THREE.Vector3(arm.side*.38,-.66,-.36)));
      // Route the forearm up underneath its wrist. When the tool leans left,
      // the right upper arm crosses below the work area, never across the tip.
      const elbow=this.worldToLocal(camera.localToWorld(new THREE.Vector3(wristCamera.x+arm.side*.10,Math.min(-.34,wristCamera.y-.32),Math.min(-.52,wristCamera.z*.80))));
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
  private createSpray(): THREE.Group {
    const group = new THREE.Group();
    group.add(this.hand(0.27, -0.29, 0.04, 0.62));
    this.sprayCanMaterial = material(0x087fce, 0.45, 0.15);
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.19, 16), this.sprayCanMaterial);
    can.rotation.z = -0.16; place(can, 0.15, -0.08, -0.03);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.029, 0.027, 12), material(0xd8d6cd, 0.45));
    place(cap, 0.165, 0.032, -0.03);
    const nozzle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.018, 0.026), material(0x252826, 0.5));
    place(nozzle, 0.17, 0.052, -0.044);
    const label = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.064, 16), material(0xe9e5da, 0.62));
    label.rotation.z = -0.16; place(label, 0.15, -0.075, -0.03);
    const labelBand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.018, 0.012), material(0x24333a, 0.65));
    labelBand.rotation.z = -0.16; place(labelBand, 0.152, -0.074, -0.074);
    const mistGeometry = new THREE.BufferGeometry();
    mistGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(54), 3));
    this.sprayMist = new THREE.Points(mistGeometry, new THREE.PointsMaterial({ color: 0xffffff, size: 0.012, transparent: true, opacity: 0.42, depthTest: false, sizeAttenuation: true }));
    this.sprayMist.visible = false;
    this.sprayMist.renderOrder = 21;
    group.add(can, label, labelBand, cap, nozzle, this.sprayMist);
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
  private createFittingTool(): THREE.Group {
    const group = new THREE.Group();
    group.add(this.hand(0.25, -0.3, 0.08, 0.62));
    const box = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.052, 24), material(0x3f4748, 0.74, 0.08));
    box.rotation.x = Math.PI / 2; place(box, 0.08, -0.035, -0.17);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.096, 0.009, 8, 28), material(0x747d7c, 0.55, 0.2));
    place(rim, 0.08, -0.035, -0.202);
    const recess = new THREE.Mesh(new THREE.CylinderGeometry(0.057, 0.057, 0.008, 20), material(0x171a1a, 0.95));
    recess.rotation.x = Math.PI / 2; place(recess, 0.08, -0.035, -0.205);
    const lug = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.024, 0.012), material(0xa0a5a1, 0.4, 0.38));
    place(lug, 0.007, -0.035, -0.21);
    const secondLug = lug.clone(); place(secondLug, 0.153, -0.035, -0.21);
    const knockout = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.009, 14), material(0xc84c35, 0.65));
    knockout.rotation.x = Math.PI / 2; place(knockout, 0.08, 0.03, -0.21);
    const secondKnockout = knockout.clone(); place(secondKnockout, 0.08, -0.1, -0.21);
    group.add(box, rim, recess, lug, secondLug, knockout, secondKnockout);
    return group;
  }
  private createLevel(): THREE.Group {
    const group = new THREE.Group();
    group.add(this.hand(-0.3, -0.31, 0.08, -0.48), this.hand(0.3, -0.31, 0.08, 0.48));
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.055, 0.035), material(0xd3a218, 0.5, 0.16));
    place(bar, 0, -0.08, -0.1);
    const vial = new THREE.Mesh(new THREE.CapsuleGeometry(0.013, 0.12, 4, 10), material(0xcadd55, 0.3));
    vial.rotation.z = Math.PI / 2; place(vial, 0, -0.079, -0.122);
    group.add(bar, vial);
    return group;
  }
  private createPvcTool(selected: 'spring' | 'cutter'): THREE.Group {
    const group = new THREE.Group();
    group.add(this.hand(selected === 'spring' ? -0.27 : 0.27, -0.3, 0.08, selected === 'spring' ? -0.58 : 0.6));
    if (selected === 'spring') {
      const points: THREE.Vector3[] = [];
      for (let index = 0; index <= 96; index += 1) {
        const t = index / 96;
        const angle = t * Math.PI * 13;
        points.push(new THREE.Vector3((t - 0.5) * 0.43, Math.sin(angle) * 0.029, Math.cos(angle) * 0.029));
      }
      const spring = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 128, 0.009, 7, false), material(0xb7a06d, 0.32, 0.74));
      spring.rotation.z = -0.08; place(spring, -0.02, -0.04, -0.15);
      group.add(spring);
    } else {
      const red = material(0xb53026, 0.48, 0.3);
      const jaw = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.02, 9, 22, Math.PI * 1.4), red);
      jaw.rotation.z = 0.55; place(jaw, 0.08, 0.015, -0.16);
      const handleA = new THREE.Mesh(new THREE.CapsuleGeometry(0.021, 0.18, 5, 9), red);
      handleA.rotation.z = -0.45; place(handleA, 0.15, -0.15, -0.14);
      const handleB = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.17, 5, 9), material(0x272a29, 0.84));
      handleB.rotation.z = -0.15; place(handleB, 0.21, -0.16, -0.13);
      const bladeShape = new THREE.Shape();
      bladeShape.moveTo(-0.065, 0.012); bladeShape.lineTo(0.067, 0.05); bladeShape.lineTo(0.035, -0.008); bladeShape.closePath();
      const blade = new THREE.Mesh(new THREE.ShapeGeometry(bladeShape), material(0xd0d1cc, 0.24, 0.82));
      place(blade, 0.08, 0.012, -0.185);
      group.add(jaw, handleA, handleB, blade);
    }
    return group;
  }
}
