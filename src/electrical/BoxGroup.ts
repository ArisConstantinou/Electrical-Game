import * as THREE from 'three';
import { buildToolModel } from '../player/ToolModels';
import { INSTALLATION_RULES, type BoxKind } from '../data/installationRules';
import { ElectricalBox } from './Box';
import { boxAssemblyBounds, horizontalBoxLayout, type BoxModuleLayout } from './BoxAssembly';

export interface BoxConduitEntry {
  boxIndex: number;
  side: 'left' | 'right';
  position: THREE.Vector3;
}

export class BoxGroup extends THREE.Group {
  readonly boxes: ElectricalBox[] = [];
  readonly groupWidth: number;
  readonly groupHeight: number;
  readonly levelBar: THREE.Group;
  readonly layout: BoxModuleLayout[];

  constructor(kinds: BoxKind[], stableId: string, layout?: readonly BoxModuleLayout[]) {
    super();
    this.name = `Recessed box group ${kinds.join(' + ')}`;
    this.userData.studioEntityId = stableId;
    this.layout = (layout?.length ? layout : horizontalBoxLayout(kinds)).map(module => ({ ...module }));
    const bounds = boxAssemblyBounds(this.layout);
    this.groupWidth = bounds.width;
    this.groupHeight = bounds.height;
    this.layout.forEach((module, index) => {
      const kind = module.kind;
      const box = new ElectricalBox(kind, `${stableId}:box-${index}`);
      box.position.set(module.x - bounds.centerX, module.y - bounds.centerY, 0);
      box.rotation.z = module.rotation * Math.PI / 2;
      box.userData.assemblyModuleId = module.id;
      this.boxes.push(box);
      this.add(box);
    });
    this.levelBar = this.buildLevelBar(stableId);
    this.levelBar.visible = false;
    this.add(this.levelBar);
  }

  setInitialError(tiltDegrees: number, depthMetres: number): void {
    this.rotation.z = THREE.MathUtils.degToRad(tiltDegrees);
    this.position.z = depthMetres;
  }

  adjustTilt(direction: -1 | 1): void {
    const next=this.tiltDegrees+INSTALLATION_RULES.leveling.tiltStepDegrees*direction;
    this.rotation.z = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(next,-15,15));
  }

  adjustDepth(direction: -1 | 1): void {
    this.position.z += INSTALLATION_RULES.leveling.depthStepMetres * direction;
  }

  get tiltDegrees(): number { return THREE.MathUtils.radToDeg(this.rotation.z); }
  get depthError(): number { return this.position.z-(Number(this.userData.finishDepth) || 0); }
  get isLevel(): boolean { return Math.abs(this.tiltDegrees) <= INSTALLATION_RULES.leveling.tiltToleranceDegrees; }
  get isFlush(): boolean { return Math.abs(this.depthError) <= INSTALLATION_RULES.leveling.depthToleranceMetres; }

  getBottomConduitEntries(): BoxConduitEntry[] {
    this.updateWorldMatrix(true, true);
    const entries: BoxConduitEntry[] = [];
    this.boxes.forEach((box, boxIndex) => {
      const down = new THREE.Vector3(0, -1, 0).transformDirection(box.matrixWorld);
      if (!box.visible || down.y > -.7) return;
      box.bottomConduitEntries.forEach((point, index) => entries.push({
        boxIndex, side: index === 0 ? 'left' : 'right', position: box.localToWorld(point.clone()),
      }));
    });
    // A stacked assembly is entered through its exposed lowest row.
    const bottom = Math.min(...entries.map(entry => entry.position.y));
    return entries.filter(entry => entry.position.y <= bottom + .005).sort((a, b) => a.position.x - b.position.x);
  }

  private buildLevelBar(stableId: string): THREE.Group {
    const bar = new THREE.Group();
    bar.name = 'Full-group spirit level';
    bar.userData.studioEntityId = `${stableId}:spirit-level`;
    const model=buildToolModel('level');
    model.updateMatrixWorld(true);
    // Seat the real machined measuring edge on the casing's upper front rim.
    // The handheld model has its own grip offset; its origin is not its base.
    const edges:THREE.Object3D[]=[];
    model.traverse(object=>{if(object.name==='Machined aluminium measuring edge')edges.push(object);});
    const edgeBounds=edges.map(edge=>new THREE.Box3().setFromObject(edge)).sort((a,b)=>a.min.y-b.min.y)[0];
    const modelBounds=new THREE.Box3().setFromObject(model);
    const boxBounds=new THREE.Box3();
    for(const box of this.boxes)boxBounds.union(new THREE.Box3().setFromObject(box));
    bar.position.set(0,boxBounds.max.y,.0004);
    model.position.set(-(edgeBounds.min.x+edgeBounds.max.x)/2,-edgeBounds.min.y,-modelBounds.min.z);
    const bubble=model.getObjectByName('level-horizontal-vial')?.getObjectByName('level-bubble');
    bar.userData.bubble=bubble;
    bar.userData.bubbleNeutral=bubble?.position.clone();
    bar.add(model);
    return bar;
  }

  updateBubble(): void {
    const bubble = this.levelBar.userData.bubble as THREE.Mesh | undefined;
    const neutral=this.levelBar.userData.bubbleNeutral as THREE.Vector3 | undefined;
    if (bubble&&neutral) {
      bubble.position.copy(neutral);
      // The horizontal vial is rotated by 90 degrees: its length is local Y.
      // The air bubble rises to the higher end; calibration marks stay fixed.
      bubble.position.y+=THREE.MathUtils.clamp(-this.tiltDegrees*.0014,-.009,.009);
    }
  }
}
