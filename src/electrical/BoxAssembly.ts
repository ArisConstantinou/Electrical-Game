import { INSTALLATION_RULES, type BoxKind } from '../data/installationRules';

export type BoxQuarterTurn = 0 | 1 | 2 | 3;
export type BoxAttachmentZone = 1 | 2 | 3 | 4;

export interface BoxModuleLayout {
  id: string;
  kind: BoxKind;
  x: number;
  y: number;
  rotation: BoxQuarterTurn;
}

export interface BoxAssemblySnapshot {
  modules: BoxModuleLayout[];
  activeId: string;
  candidateKind: BoxKind;
  candidateRotation: BoxQuarterTurn;
}

export interface BoxAssemblyBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

const dimensions = (kind: BoxKind): { width: number; height: number } => kind === '1G'
  ? INSTALLATION_RULES.box.oneGang
  : INSTALLATION_RULES.box.twoGang;

export function boxModuleSize(module: Pick<BoxModuleLayout, 'kind' | 'rotation'>): { width: number; height: number } {
  const size = dimensions(module.kind);
  return module.rotation % 2 === 0 ? { width: size.width, height: size.height } : { width: size.height, height: size.width };
}

export function boxAssemblyBounds(modules: readonly BoxModuleLayout[]): BoxAssemblyBounds {
  if (!modules.length) return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0, centerX: 0, centerY: 0 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const module of modules) {
    const size = boxModuleSize(module);
    minX = Math.min(minX, module.x - size.width / 2);
    maxX = Math.max(maxX, module.x + size.width / 2);
    minY = Math.min(minY, module.y - size.height / 2);
    maxY = Math.max(maxY, module.y + size.height / 2);
  }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
}

export function boxAssemblyKey(modules: readonly BoxModuleLayout[]): string {
  return modules.map(module => `${module.kind}@${module.rotation}:${module.x.toFixed(4)},${module.y.toFixed(4)}`).join('|');
}

export function horizontalBoxLayout(kinds: readonly BoxKind[]): BoxModuleLayout[] {
  const total = kinds.reduce((sum, kind) => sum + dimensions(kind).width, 0) + Math.max(0, kinds.length - 1) * INSTALLATION_RULES.box.groupGap;
  let cursor = -total / 2;
  return kinds.map((kind, index) => {
    const width = dimensions(kind).width;
    const module = { id: `box-${index + 1}`, kind, x: cursor + width / 2, y: 0, rotation: 0 as const };
    cursor += width + INSTALLATION_RULES.box.groupGap;
    return module;
  });
}

export class BoxAssemblyBuilder {
  private modules: BoxModuleLayout[] = [];
  private sequence = 0;
  activeId = '';
  candidateKind: BoxKind = '1G';
  candidateRotation: BoxQuarterTurn = 0;

  constructor(initialKind: BoxKind = '1G') { this.reset(initialKind); }

  reset(kind: BoxKind): void {
    this.sequence = 1;
    this.modules = [{ id: 'box-1', kind, x: 0, y: 0, rotation: 0 }];
    this.activeId = 'box-1';
    this.candidateKind = kind;
    this.candidateRotation = 0;
  }

  restore(modules: readonly BoxModuleLayout[], activeId = modules.at(-1)?.id): void {
    if (!modules.length) return;
    this.modules = modules.map(module => ({ ...module }));
    this.sequence = Math.max(modules.length, ...modules.map(module => Number(module.id.match(/\d+$/)?.[0] ?? 0)));
    this.activeId = activeId && this.modules.some(module => module.id === activeId) ? activeId : this.modules.at(-1)!.id;
    this.candidateKind = this.modules.at(-1)!.kind;
    this.candidateRotation = this.modules.at(-1)!.rotation;
  }

  cycleCandidate(): void { this.candidateKind = this.candidateKind === '1G' ? '2G' : '1G'; }
  rotateCandidate(): void { this.candidateRotation = ((this.candidateRotation + 1) % 4) as BoxQuarterTurn; }

  candidateFor(zone: BoxAttachmentZone): BoxModuleLayout | null {
    const active = this.modules.find(module => module.id === this.activeId);
    if (!active) return null;
    const activeSize = boxModuleSize(active);
    const candidate: BoxModuleLayout = { id: `box-${this.sequence + 1}`, kind: this.candidateKind, x: active.x, y: active.y, rotation: this.candidateRotation };
    const candidateSize = boxModuleSize(candidate), gap = INSTALLATION_RULES.box.groupGap;
    if (zone === 1) candidate.y += (activeSize.height + candidateSize.height) / 2 + gap;
    if (zone === 2) candidate.x += (activeSize.width + candidateSize.width) / 2 + gap;
    if (zone === 3) candidate.y -= (activeSize.height + candidateSize.height) / 2 + gap;
    if (zone === 4) candidate.x -= (activeSize.width + candidateSize.width) / 2 + gap;
    return candidate;
  }

  zoneAvailable(zone: BoxAttachmentZone): boolean {
    const candidate = this.candidateFor(zone);
    if (!candidate) return false;
    const size = boxModuleSize(candidate);
    return this.modules.every(module => {
      const other = boxModuleSize(module);
      return Math.abs(candidate.x - module.x) >= (size.width + other.width) / 2 - 0.001
        || Math.abs(candidate.y - module.y) >= (size.height + other.height) / 2 - 0.001;
    });
  }

  attach(zone: BoxAttachmentZone): BoxModuleLayout | null {
    if (!this.zoneAvailable(zone)) return null;
    const candidate = this.candidateFor(zone)!;
    this.sequence++;
    this.modules.push(candidate);
    this.activeId = candidate.id;
    return { ...candidate };
  }

  get snapshot(): BoxAssemblySnapshot {
    return { modules: this.modules.map(module => ({ ...module })), activeId: this.activeId, candidateKind: this.candidateKind, candidateRotation: this.candidateRotation };
  }
}
