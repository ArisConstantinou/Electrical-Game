import * as THREE from 'three';

export type RigTool = 'spray' | 'hammer' | 'fitting' | 'level' | 'spring' | 'cutter';
export const RIG_TOOLS: RigTool[] = ['spray', 'hammer', 'fitting', 'level', 'spring', 'cutter'];

const material = (color: number, roughness = 0.7, metalness = 0.05): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness, metalness, depthTest: false });
const place = (object: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D => { object.position.set(x, y, z); object.renderOrder = 20; return object; };

export class FPSRig extends THREE.Group {
  private readonly tools = new Map<RigTool, THREE.Group>();
  private sprayCanMaterial: THREE.MeshStandardMaterial | null = null;
  private sprayMist: THREE.Points | null = null;
  private strikeAmount = 0;

  constructor() {
    super();
    this.name = 'Modular FPS hands and tools';
    this.userData.studioEntityId = 'fps-rig';
    this.position.set(0.08, -0.13, -0.52);
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
    this.position.y = -0.1 + bob;
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
    sleeve.rotation.z = Math.PI / 2 + rotation;
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.062, 12, 9), material(0x494842, 0.92));
    glove.scale.set(1.08, 0.72, 0.92);
    glove.position.x = rotation >= 0 ? -0.12 : 0.12;
    hand.add(sleeve, glove);
    place(hand, x, y, z);
    return hand;
  }
  private createSpray(): THREE.Group {
    const group = new THREE.Group();
    group.add(this.hand(0.24, -0.22, 0.02, -0.2));
    this.sprayCanMaterial = material(0x087fce, 0.45, 0.15);
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.19, 16), this.sprayCanMaterial);
    can.rotation.z = -0.16; place(can, 0.15, -0.08, -0.03);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.029, 0.027, 12), material(0xd8d6cd, 0.45));
    place(cap, 0.165, 0.032, -0.03);
    const nozzle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.018, 0.026), material(0x252826, 0.5));
    place(nozzle, 0.17, 0.052, -0.044);
    const mistGeometry = new THREE.BufferGeometry();
    mistGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(54), 3));
    this.sprayMist = new THREE.Points(mistGeometry, new THREE.PointsMaterial({ color: 0xffffff, size: 0.012, transparent: true, opacity: 0.42, depthTest: false, sizeAttenuation: true }));
    this.sprayMist.visible = false;
    this.sprayMist.renderOrder = 21;
    group.add(can, cap, nozzle, this.sprayMist);
    return group;
  }
  private createHammer(): THREE.Group {
    const group = new THREE.Group();
    group.add(this.hand(-0.18, -0.23, 0.05, 0.3), this.hand(0.22, -0.2, 0.08, -0.3));
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.14, 0.28), material(0xa42d23, 0.48, 0.25));
    body.rotation.x = -0.25; place(body, 0.02, -0.06, -0.1);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.036, 0.36, 10), material(0x282b29, 0.84));
    grip.rotation.z = -0.3; grip.rotation.x = -0.2; place(grip, 0.08, -0.23, 0.02);
    const chuck = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.037, 0.12, 12), material(0x555b5a, 0.35, 0.65));
    chuck.rotation.x = Math.PI / 2; place(chuck, 0.02, 0.005, -0.29);
    const chisel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.35, 8), material(0x6d7370, 0.3, 0.75));
    chisel.rotation.x = Math.PI / 2; place(chisel, 0.02, 0.005, -0.51);
    group.add(body, grip, chuck, chisel);
    return group;
  }
  private createFittingTool(): THREE.Group {
    const group = new THREE.Group();
    group.add(this.hand(0.23, -0.22, 0.04, -0.2), this.hand(-0.23, -0.26, 0.08, 0.2));
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.033, 0.23, 10), material(0xb77b30, 0.78));
    handle.rotation.z = -0.35; place(handle, 0.12, -0.1, -0.03);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.018, 0.19), material(0x7d8280, 0.3, 0.72));
    blade.rotation.x = -0.25; place(blade, 0.07, 0.015, -0.14);
    group.add(handle, blade);
    return group;
  }
  private createLevel(): THREE.Group {
    const group = new THREE.Group();
    group.add(this.hand(-0.28, -0.22, 0.05, 0.1), this.hand(0.28, -0.22, 0.05, -0.1));
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.055, 0.035), material(0xd3a218, 0.5, 0.16));
    place(bar, 0, -0.08, -0.1);
    const vial = new THREE.Mesh(new THREE.CapsuleGeometry(0.013, 0.12, 4, 10), material(0xcadd55, 0.3));
    vial.rotation.z = Math.PI / 2; place(vial, 0, -0.079, -0.122);
    group.add(bar, vial);
    return group;
  }
  private createPvcTool(selected: 'spring' | 'cutter'): THREE.Group {
    const group = new THREE.Group();
    group.add(this.hand(selected === 'spring' ? -0.25 : 0.26, -0.21, 0.06, selected === 'spring' ? 0.12 : -0.12));
    const spring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.008, 8, 28, Math.PI * 1.7), material(0x82827c, 0.35, 0.75));
    spring.rotation.x = 0.5; place(spring, -0.18, -0.08, -0.08);
    const cutterBody = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.018, 8, 18, Math.PI * 1.45), material(0xb53026, 0.5, 0.32));
    cutterBody.rotation.z = 1.2; place(cutterBody, 0.18, -0.06, -0.08);
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.009, 16), material(0xc4c5c0, 0.25, 0.82));
    blade.rotation.x = Math.PI / 2; place(blade, 0.205, -0.04, -0.095);
    if (selected === 'spring') group.add(spring);
    else group.add(cutterBody, blade);
    return group;
  }
}
