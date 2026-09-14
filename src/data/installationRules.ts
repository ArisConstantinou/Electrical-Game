export const INSTALLATION_RULES = {
  box: {
    oneGang: { width: 0.074, height: 0.074, depth: 0.037 },
    twoGang: { width: 0.134, height: 0.074, depth: 0.037 },
    groupGap: 0.008,
  },
  height: {
    socketBottom: 0.3,
    switchBottom: 1.2,
  },
  conduit: {
    firstMissionDiameter: 0.02,
    preferredType: 'rigid-pvc' as const,
  },
  leveling: {
    tiltToleranceDegrees: 1.2,
    depthToleranceMetres: 0.003,
    tiltStepDegrees: 0.75,
    depthStepMetres: 0.002,
  },
} as const;

export type BoxKind = '1G' | '2G';
export type InstallationStage = 'inspect' | 'marked' | 'chasing' | 'chased' | 'fitted' | 'mortared' | 'leveling' | 'leveled' | 'conduit' | 'complete';
export type PipeStep = 'measure' | 'cut' | 'bend' | 'install' | 'done';

export interface InstallationDefinition {
  id: string;
  label: string;
  kind: 'socket' | 'switch';
  boxes: BoxKind[];
  x: number;
  bottom: number;
}

export const INSTALLATION_POINTS: InstallationDefinition[] = [
  { id: 'A', label: 'Point A · Socket group', kind: 'socket', boxes: ['2G', '1G'], x: -1.72, bottom: INSTALLATION_RULES.height.socketBottom },
  { id: 'B', label: 'Point B · Double socket', kind: 'socket', boxes: ['2G'], x: 0, bottom: INSTALLATION_RULES.height.socketBottom },
  { id: 'C', label: 'Point C · Light switch', kind: 'switch', boxes: ['1G'], x: 1.65, bottom: INSTALLATION_RULES.height.switchBottom },
];
