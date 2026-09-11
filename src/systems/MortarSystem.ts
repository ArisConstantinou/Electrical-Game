import type { InstallationPoint } from '../electrical/InstallationPoint';

export class MortarSystem {
  apply(point: InstallationPoint): void {
    if (!point.mortar) point.createMortar();
    point.setStage('mortared');
  }
}
