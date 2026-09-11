import type { InstallationPoint } from '../electrical/InstallationPoint';
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

  action(point: InstallationPoint): InteractionResult {
    if (point.stage === 'inspect') {
      this.marking.mark(point);
      return { success: true, message: `Point ${point.definition.id} inspected and marked on the brick face.` };
    }
    if (point.stage === 'marked' || point.stage === 'chasing') {
      this.chasing.hit(point);
      return { success: true, message: point.chaseHits >= 4 ? 'Real masonry opening complete.' : `Demolition hammer: ${point.chaseHits}/4` };
    }
    if (point.stage === 'chased') {
      point.boxGroup.visible = true;
      const direction = point.definition.id === 'B' ? -1 : 1;
      point.boxGroup.setInitialError(direction * (2.25 + point.definition.id.charCodeAt(0) % 2), direction * 0.006);
      point.setStage('fitted');
      return { success: true, message: 'Box group fitted into the recess with a small alignment error.' };
    }
    if (point.stage === 'fitted') {
      this.mortar.apply(point);
      return { success: true, message: 'Continuous mortar bed applied around the complete group.' };
    }
    if (point.stage === 'mortared') {
      this.leveling.begin(point);
      return { success: true, message: 'Leveling mode: correct tilt and flush depth.' };
    }
    if (point.stage === 'leveling') {
      const passed = this.leveling.confirm(point);
      return { success: passed, message: passed ? 'LEVEL and FLUSH passed.' : 'Not yet: bubble and depth must both be inside tolerance.' };
    }
    if (point.stage === 'leveled' || point.stage === 'conduit') {
      const result = this.conduit.action(point);
      return { success: result.changed, message: result.message };
    }
    return { success: false, message: 'This point is complete.' };
  }
}
