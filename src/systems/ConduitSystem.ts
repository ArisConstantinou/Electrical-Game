import * as THREE from 'three';
import { Conduit } from '../electrical/Conduit';
import type { InstallationPoint } from '../electrical/InstallationPoint';

export type PvcTool = 'spring' | 'cutter';

export interface ConduitActionResult { changed: boolean; message: string }

export class ConduitSystem {
  selectedTool: PvcTool = 'spring';
  constructor(private readonly scene: THREE.Scene) {}

  selectTool(tool: PvcTool): void { this.selectedTool = tool; }
  cycle(): void { this.selectedTool = this.selectedTool === 'spring' ? 'cutter' : 'spring'; }

  action(point: InstallationPoint): ConduitActionResult {
    point.setStage('conduit');
    if (point.pipeStep === 'measure') {
      point.pipeStep = 'cut';
      return { changed: true, message: 'Route measured. Select CUTTER.' };
    }
    if (point.pipeStep === 'cut') {
      if (this.selectedTool !== 'cutter') return { changed: false, message: 'Select CUTTER (2) before cutting.' };
      point.pipeStep = 'bend';
      return { changed: true, message: 'Pipe cut. Select SPRING for the floor bend.' };
    }
    if (point.pipeStep === 'bend') {
      if (this.selectedTool !== 'spring') return { changed: false, message: 'Select SPRING (1) to form the bend.' };
      point.pipeStep = 'install';
      return { changed: true, message: 'Bend formed. ACTION to install into the box.' };
    }
    if (point.pipeStep === 'install') {
      const conduit = new Conduit(point);
      this.scene.add(conduit);
      point.conduit = conduit;
      point.pipeStep = 'done';
      point.setStage('complete');
      return { changed: true, message: `Point ${point.definition.id} first fix complete.` };
    }
    return { changed: false, message: 'Conduit already installed.' };
  }
}
