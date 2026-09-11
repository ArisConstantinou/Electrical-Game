import * as THREE from 'three';
import type { InstallationPoint } from '../electrical/InstallationPoint';
import type { RigTool } from '../player/FPSRig';
import type { ChasingSystem } from './ChasingSystem';
import type { ConduitSystem } from './ConduitSystem';
import type { LevelingSystem } from './LevelingSystem';
import type { MarkingSystem } from './MarkingSystem';
import type { MortarSystem } from './MortarSystem';

export interface InteractionResult { success: boolean; message: string }

export class InteractionSystem {
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

  action(point: InstallationPoint, tool: RigTool, camera: THREE.Camera): InteractionResult {
    if (tool === 'spray') {
      const firstMark = point.stage === 'inspect';
      const painted = this.marking.spray(camera, point);
      return { success: painted, message: !painted ? 'Aim the spray at brick.' : firstMark ? `Point ${point.definition.id}: free mark started.` : '' };
    }
    if (tool === 'hammer') {
      if (point.stage !== 'marked' && point.stage !== 'chasing') return { success: false, message: point.stage === 'inspect' ? 'Use SPRAY first and draw your chase.' : 'The masonry opening is already complete.' };
      const hit = this.chasing.hit(camera, point);
      return { success: hit, message: !hit ? 'Aim the demolition hammer at intact brick.' : point.chaseHits >= 4 ? 'Real masonry opening complete.' : '' };
    }
    if (tool === 'fitting' && point.stage === 'chased') {
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
