import * as THREE from 'three';
import type { InstallationPoint } from '../electrical/InstallationPoint';
import type { RigTool } from '../player/FPSRig';
import type { ChasingSystem } from './ChasingSystem';
import type { ConduitSystem } from './ConduitSystem';
import type { LevelingSystem } from './LevelingSystem';
import type { MarkingSystem } from './MarkingSystem';
import type { MortarSystem } from './MortarSystem';

export interface InteractionResult { success: boolean; message: string }
export type HammerMode = 'chase' | 'demolish';

export class InteractionSystem {
  hammerMode: HammerMode = 'chase';
  constructor(
    private readonly marking: MarkingSystem,
    private readonly chasing: ChasingSystem,
    private readonly mortar: MortarSystem,
    private readonly leveling: LevelingSystem,
    private readonly conduit: ConduitSystem,
  ) {}

  setSpray(mode: 'dots' | 'live', color: number): void {
    this.marking.mode = mode;
    this.marking.color = color;
  }
  endSprayStroke(): void { this.marking.endStroke(); }
  setHammerMode(mode: HammerMode): void { this.hammerMode = mode; }

  action(point: InstallationPoint, tool: RigTool, camera: THREE.Camera, continuing = false): InteractionResult {
    if (tool === 'spray') {
      const firstMark = point.stage === 'inspect';
      const painted = this.marking.spray(camera, point);
      return { success: painted, message: !painted ? 'Aim the spray at brick.' : firstMark ? `Point ${point.definition.id}: free mark started.` : '' };
    }
    if (tool === 'hammer') {
      const impact = this.chasing.freeHit(camera, continuing);
      if (impact && point.stage !== 'inspect') {
        point.chaseHits++;
        this.chasing.refreshProgress(point);
      }
      return {success:Boolean(impact), message: !impact ? 'Place the chisel against the masonry.' : point.stage === 'chased' ? 'Cavity clear. The back boxes fit.' : ''};
    }
    if (tool === 'fitting' && point.stage === 'chased') {
      if (!this.chasing.canFitBoxes(point)) return {success:false,message:'The box touches remaining masonry. Widen or deepen the cavity.'};
      point.boxGroup.visible = true;
      const direction = point.definition.id === 'B' ? -1 : 1;
      point.boxGroup.setInitialError(direction * (2.25 + point.definition.id.charCodeAt(0) % 2), direction * 0.006);
      point.setStage('fitted');
      return { success: true, message: 'Box group fitted into the recess with a small alignment error.' };
    }
    if (tool === 'fitting' && point.stage === 'fitted') {
      this.mortar.apply(point);
      return { success: true, message: 'Continuous mortar bed applied around the complete group.' };
    }
    if (tool === 'level' && point.stage === 'mortared') {
      this.leveling.begin(point);
      return { success: true, message: 'Leveling mode: correct tilt and flush depth.' };
    }
    if (tool === 'level' && point.stage === 'leveling') {
      const passed = this.leveling.confirm(point);
      return { success: passed, message: passed ? 'LEVEL and FLUSH passed.' : 'Not yet: bubble and depth must both be inside tolerance.' };
    }
    if ((tool === 'spring' || tool === 'cutter') && (point.stage === 'leveled' || point.stage === 'conduit')) {
      this.conduit.selectTool(tool);
      const result = this.conduit.action(point);
      return { success: result.changed, message: result.message };
    }
    const required: Record<string, string> = { inspect: 'SPRAY', marked: 'HAMMER', chasing: 'HAMMER', chased: 'FITTING TOOL', fitted: 'FITTING TOOL', mortared: 'SPIRIT LEVEL', leveling: 'SPIRIT LEVEL', leveled: 'SPRING / CUTTER', conduit: 'SPRING / CUTTER', complete: 'NONE' };
    return { success: false, message: `Select ${required[point.stage]} for this step.` };
  }
}
