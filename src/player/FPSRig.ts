import * as THREE from 'three';

export type RigTool = 'spray' | 'hammer' | 'fitting' | 'level' | 'spring' | 'cutter';
export const RIG_TOOLS: RigTool[] = ['spray', 'hammer', 'fitting', 'level', 'spring', 'cutter'];

const material = (color: number, roughness = 0.7, metalness = 0.05): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness, metalness, depthTest: false });
const place = (object: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D => { object.position.set(x, y, z); object.renderOrder = 20; return object; };

export class FPSRig extends THREE.Group {
  private readonly tools = new Map<RigTool, THREE.Group>();
  private readonly restingY = -0.24;
  private sprayCanMaterial: THREE.MeshStandardMaterial | null = null;
  private sprayMist: THREE.Points | null = null;
  private strikeAmount = 0;

  constructor() {
    super();
    this.name = 'Modular FPS hands and tools';
    this.userData.studioEntityId = 'fps-rig';
    this.position.set(0.08, this.restingY, -0.88);
    this.scale.setScalar(0.74);
    this.addTool('spray', this.createSpray());
    this.addTool('hammer', this.createHammer());
    this.addTool('fitting', this.createFittingTool());
    this.addTool('level', this.createLevel());
    this.addTool('spring', this.createPvcTool('spring'));
    this.addTool('cutter', this.createPvcTool('cutter'));
    this.show('spray');
  }

  show(tool: RigTool): void { this.tools.forEach((group, key) => { group.visible = key === tool; }); }
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
  private hand(x: number, y: number, z: number, rotation = 0): THREE.Group {
    const hand = new THREE.Group();
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.18, 5, 10), material(0x263e35, 0.95));
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
    group.add(this.hand(-0.2, -0.3, 0.08, -0.58), this.hand(0.25, -0.29, 0.1, 0.62));
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.14, 0.28), material(0xa42d23, 0.48, 0.25));
    body.rotation.x = -0.25; place(body, 0.02, -0.06, -0.1);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.036, 0.36, 10), material(0x282b29, 0.84));
    grip.rotation.z = -0.3; grip.rotation.x = -0.2; place(grip, 0.08, -0.23, 0.02);
    const chuck = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.037, 0.12, 12), material(0x555b5a, 0.35, 0.65));
    chuck.rotation.x = Math.PI / 2; place(chuck, 0.02, 0.005, -0.29);
    const chisel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.35, 8), material(0x6d7370, 0.3, 0.75));
    chisel.rotation.x = Math.PI / 2; place(chisel, 0.02, 0.005, -0.51);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.04, 0.2), material(0x252827, 0.82));
    top.rotation.x = -0.25; place(top, 0.02, 0.025, -0.1);
    const chiselTip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.012, 0.07), material(0x7b807c, 0.28, 0.8));
    place(chiselTip, 0.02, 0.005, -0.705);
    group.add(body, top, grip, chuck, chisel, chiselTip);
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
