import { Renderer } from './Renderer';
import { Input } from './Input';
import { AssetManager } from './AssetManager';
import { PlayerController } from '../player/PlayerController';
import type { MobileAimProfile } from '../player/PlayerController';
import { DesktopControls } from '../player/DesktopControls';
import { MobileControls, type AimControlMode, type AimInputMode } from '../player/MobileControls';
import { FPSRig, RIG_TOOLS, type RigTool } from '../player/FPSRig';
import { Room } from '../world/Room';
import { MissionSystem } from '../systems/MissionSystem';
import { MarkingSystem } from '../systems/MarkingSystem';
import { ChasingSystem } from '../systems/ChasingSystem';
import { MortarSystem } from '../systems/MortarSystem';
import { LevelingSystem, type LevelDirection } from '../systems/LevelingSystem';
import { ConduitSystem, type PvcTool } from '../systems/ConduitSystem';
import { InteractionSystem } from '../systems/InteractionSystem';
import type { HammerMode } from '../systems/InteractionSystem';
import { HUD } from '../ui/HUD';
import { MobileHUD } from '../ui/MobileHUD';

const TOOL_HINTS: Record<RigTool, string> = {
  spray: 'SPRAY CAN · mark the chase route',
  hammer: 'DEMO HAMMER · chase or remove masonry',
  fitting: 'BACK BOX · fit the recessed socket box',
  level: 'SPIRIT LEVEL · align the box group',
  spring: 'BENDING SPRING · shape the 20 mm PVC',
  cutter: 'PVC CUTTER · trim the conduit to length',
};

const SPRAY_COLORS = [
  { name: 'BLUE', value: 0x087fce, css: '#087fce' },
  { name: 'RED', value: 0xe53935, css: '#e53935' },
  { name: 'YELLOW', value: 0xffcc19, css: '#ffcc19' },
  { name: 'WHITE', value: 0xf4f1e8, css: '#f4f1e8' },
] as const;

export class Game {
  readonly renderer: Renderer;
  readonly input = new Input();
  readonly assets = new AssetManager();
  readonly player: PlayerController;
  readonly room: Room;
  readonly mission: MissionSystem;
  readonly conduit: ConduitSystem;
  readonly leveling = new LevelingSystem();
  readonly hud: HUD;
  readonly fpsRig = new FPSRig();
  selectedTool: RigTool = 'spray';
  sprayMode: 'dots' | 'live' = 'live';
  sprayColorIndex = 0;
  hammerMode: HammerMode = 'chase';
  aimControlMode: AimControlMode = 'auto-use';
  aimProfile: MobileAimProfile = 'normal';
  wallAssistEnabled = true;
  aimInputMode: AimInputMode = 'drag';
  started = false;
  private readonly chasing: ChasingSystem;
  private readonly interaction: InteractionSystem;
  private lastTime = performance.now();
  private shake = 0;
  private resultShown = false;
  private actionCooldown = 0;
  private wasSpraying = false;
  private wasLeveling = false;
  private readonly mobileControls: MobileControls;
  private readonly desktopControls: DesktopControls;

  constructor(root: HTMLElement) {
    this.hud = new HUD(root);
    const stage = root.querySelector<HTMLElement>('#game-stage');
    if (!stage) throw new Error('Game stage was not created');
    this.renderer = new Renderer(stage);
    this.player = new PlayerController(this.renderer.camera, this.input);
    this.renderer.camera.add(this.fpsRig);
    this.renderer.scene.add(this.renderer.camera);
    this.room = new Room(this.renderer.scene);
    this.renderer.scene.add(this.room);
    this.mission = new MissionSystem(this.renderer.scene);
    this.chasing = new ChasingSystem(this.renderer.scene, this.room.brickWall);
    this.conduit = new ConduitSystem(this.renderer.scene);
    this.interaction = new InteractionSystem(new MarkingSystem(this.room.brickWall), this.chasing, new MortarSystem(), this.leveling, this.conduit);
    this.applySpraySettings();
    this.desktopControls = new DesktopControls(this.hud.shell, this.renderer.webgl.domElement, this.player, this.input);
    this.mobileControls = new MobileControls(this.hud.shell, this.input, this.player, () => this.selectedTool);
    new MobileHUD();
    this.bindEvents();
    this.hud.onStart(() => {
      this.started = true;
      if (matchMedia('(any-pointer: fine)').matches) this.desktopControls.requestLock();
    });
    addEventListener('resize', this.renderer.resize);
    this.assets.markLoaded('procedural-core');
    requestAnimationFrame(this.loop);
  }

  step(dt: number): void {
    const active = this.mission.activePoint;
    const leveling = active?.stage === 'leveling';
    if (leveling && !this.wasLeveling && document.pointerLockElement) void document.exitPointerLock();
    this.wasLeveling = leveling;
    if (this.started && !leveling) this.player.update(Math.min(dt, 0.05));
    this.actionCooldown = Math.max(0, this.actionCooldown - dt);
    const requested = this.input.consumeAction();
    // Spray is a continuous tool. The hammer is intentionally discrete so one
    // press exposes one chase pass instead of consuming the whole route while held.
    const repeatable = this.selectedTool === 'spray' && this.input.actionHeld && this.actionCooldown <= 0;
    const spraying = this.selectedTool === 'spray' && this.input.actionHeld;
    if (this.wasSpraying && !spraying) this.interaction.endSprayStroke();
    this.wasSpraying = spraying;
    if (this.started && (requested || repeatable)) {
      this.performAction();
      this.actionCooldown = this.selectedTool === 'spray' ? 0.045 : this.selectedTool === 'hammer' ? 0.24 : 0.18;
    }
    this.chasing.update(dt);
    this.fpsRig.update(dt, this.player.velocity.lengthSq() > 0.02, spraying);
    this.fpsRig.show(this.selectedTool);
    const wallAim = Boolean(this.room.brickWall.aim(this.renderer.camera));
    const pointAim = Boolean(this.mission.target(this.renderer.camera));
    const aimed = this.selectedTool === 'spray' || this.selectedTool === 'hammer' ? wallAim : pointAim;
    this.hud.update(active, aimed, this.mission.progress, this.selectedTool);
    const sprayColor = SPRAY_COLORS[this.sprayColorIndex];
    this.hud.updateSprayControls(this.sprayMode, sprayColor.name, sprayColor.css, this.selectedTool === 'spray');
    this.hud.updateHammerControls(this.hammerMode, this.selectedTool === 'hammer');
    this.hud.updateAimControl(this.aimControlMode);
    this.hud.updateAimSpeed(this.aimProfile);
    this.hud.updateWallAssist(this.wallAssistEnabled);
    this.hud.updateAimInput(this.aimInputMode);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 3.7);
      this.renderer.camera.rotation.set(this.player.pitch + (Math.random() - 0.5) * this.shake * 0.025, this.player.yaw + (Math.random() - 0.5) * this.shake * 0.02, 0);
    } else {
      this.renderer.camera.rotation.set(this.player.pitch, this.player.yaw, 0);
    }
    if (this.mission.complete && !this.resultShown) { this.resultShown = true; this.hud.showResult(); if (document.pointerLockElement) void document.exitPointerLock(); }
    this.renderer.render();
  }

  renderState(): string {
    const point = this.mission.activePoint;
    return JSON.stringify({
      coordinateSystem: 'metres; origin at room floor centre; +X right, +Y up, -Z toward installation wall',
      mode: !this.started ? 'start' : this.mission.complete ? 'mission-complete' : point?.stage === 'leveling' ? 'leveling' : 'playing',
      player: { x: Number(this.renderer.camera.position.x.toFixed(3)), y: Number(this.renderer.camera.position.y.toFixed(3)), z: Number(this.renderer.camera.position.z.toFixed(3)), yaw: Number(this.player.yaw.toFixed(3)), pitch: Number(this.player.pitch.toFixed(3)) },
      mission: { name: 'Living Room First Fix', progressPercent: this.mission.progress, selectedTool: this.selectedTool, complete: this.mission.complete },
      workSurface: { freeSprayMarks: this.room.brickWall.freeMarkCount, damagedBricks: this.room.brickWall.damagedBrickCount, destroyedBricks: this.room.brickWall.destroyedBrickCount, recessedBricks: this.room.brickWall.recessedBrickCount, carvedCells: this.room.brickWall.carvedCellCount, chaseDepthMm: this.room.brickWall.chaseDepthMm, chaseBackSurfaces: this.room.brickWall.chaseBackSurfaceCount, chaseSideWalls: this.room.brickWall.chaseSideWallCount, activeFragments: this.chasing.activeFragmentCount, airborneFragments: this.chasing.airborneFragmentCount, settledFragments: this.chasing.settledFragmentCount, rubblePileHeight: Number(this.chasing.rubblePileHeight.toFixed(3)), overlappingSettledFragments: this.chasing.settledOverlapCount, anchoredRemnants: this.room.brickWall.anchoredRemnantCount, floatingStaticPieces: this.room.brickWall.floatingStaticPieceCount, unsupportedAnchoredRemnants: this.room.brickWall.unsupportedAnchoredRemnantCount, fracturePatterns: this.room.brickWall.uniqueFracturePatternCount, sprayMode: this.sprayMode, sprayColor: SPRAY_COLORS[this.sprayColorIndex].name, hammerMode: this.hammerMode, aimControlMode: this.aimControlMode, aimInputMode: this.aimInputMode, aimProfile: this.aimProfile, wallAssist: this.wallAssistEnabled, proximityPrecision: Number(this.player.wallAssistAmount.toFixed(3)) },
      activePoint: point ? { id: point.definition.id, kind: point.definition.kind, bottomHeightM: point.definition.bottom, boxes: point.definition.boxes, stage: point.stage, chaseHits: point.chaseHits, chaseCoverage: Number(this.room.brickWall.getChaseCoverage(point.definition.id).toFixed(3)), pipeStep: point.pipeStep, targeted: this.mission.target(this.renderer.camera) === point, tiltDegrees: Number(point.boxGroup.tiltDegrees.toFixed(2)), depthErrorMm: Number((point.boxGroup.depthError * 1000).toFixed(1)), levelPass: point.boxGroup.isLevel, flushPass: point.boxGroup.isFlush } : null,
      points: this.mission.points.map(item => ({ id: item.definition.id, stage: item.stage, conduitVisible: Boolean(item.conduit) })),
    });
  }

  private performAction(): void {
    const active = this.mission.activePoint;
    if (!active) return;
    const spatialTool = this.selectedTool === 'spray' || this.selectedTool === 'hammer';
    const target = active.stage === 'leveling' ? active : spatialTool ? active : this.mission.target(this.renderer.camera);
    if (!target) { this.hud.notify('Aim at the work area you chose.', false); return; }
    const hammering = this.selectedTool === 'hammer';
    const result = this.interaction.action(target, this.selectedTool, this.renderer.camera);
    if (hammering && result.success) { this.fpsRig.strike(); this.shake = 1; }
    if (result.message) this.hud.notify(result.message, result.success);
  }

  private bindEvents(): void {
    addEventListener('wirehouse:select-tool', event => this.selectTool((event as CustomEvent<RigTool>).detail));
    addEventListener('wirehouse:cycle-tool', event => this.cycleTool((event as CustomEvent<number>).detail || 1));
    addEventListener('wirehouse:cycle-spray-mode', () => {
      this.sprayMode = this.sprayMode === 'dots' ? 'live' : 'dots';
      this.applySpraySettings();
      this.hud.notify(`Spray method: ${this.sprayMode.toUpperCase()}`);
    });
    addEventListener('wirehouse:cycle-spray-color', () => {
      this.sprayColorIndex = (this.sprayColorIndex + 1) % SPRAY_COLORS.length;
      this.applySpraySettings();
      this.hud.notify(`Spray color: ${SPRAY_COLORS[this.sprayColorIndex].name}`);
    });
    addEventListener('wirehouse:cycle-hammer-mode', () => {
      this.hammerMode = this.hammerMode === 'chase' ? 'demolish' : 'chase';
      this.interaction.setHammerMode(this.hammerMode);
      this.hud.notify(`Hammer method: ${this.hammerMode.toUpperCase()}`);
    });
    addEventListener('wirehouse:cycle-aim-control', () => {
      this.aimControlMode = this.aimControlMode === 'auto-use' ? 'double-tap' : 'auto-use';
      this.mobileControls.setAimControlMode(this.aimControlMode);
      this.hud.notify(this.aimControlMode === 'auto-use' ? 'Aim stick: move to spray or hammer.' : 'Aim stick: double tap and hold to use tool.');
    });
    addEventListener('wirehouse:cycle-aim-speed', () => {
      const profiles: MobileAimProfile[] = ['precise', 'normal', 'fast'];
      this.aimProfile = profiles[(profiles.indexOf(this.aimProfile) + 1) % profiles.length];
      this.mobileControls.setAimProfile(this.aimProfile);
      this.hud.notify(`Aim speed: ${this.aimProfile.toUpperCase()}`);
    });
    addEventListener('wirehouse:toggle-wall-assist', () => {
      this.wallAssistEnabled = !this.wallAssistEnabled;
      this.player.setWallAssist(this.wallAssistEnabled);
      this.hud.notify(`Wall precision assist: ${this.wallAssistEnabled ? 'AUTO' : 'OFF'}`);
    });
    addEventListener('wirehouse:cycle-aim-input', () => {
      this.aimInputMode = this.aimInputMode === 'drag' ? 'stick' : 'drag';
      this.mobileControls.setAimInputMode(this.aimInputMode);
      this.hud.notify(`Aim input: ${this.aimInputMode.toUpperCase()}`);
    });
    addEventListener('wirehouse:level', event => {
      const detail = (event as CustomEvent<LevelDirection | 'confirm' | 'cancel'>).detail;
      const point = this.mission.activePoint;
      if (!point || point.stage !== 'leveling') return;
      if (detail === 'cancel') { this.leveling.cancel(point); this.hud.notify('Leveling exited. Select the spirit level to resume.'); return; }
      if (detail === 'confirm') { this.input.actionRequested = true; return; }
      this.leveling.adjust(point, detail);
    });
    addEventListener('wirehouse:exit-leveling', () => {
      const point = this.mission.activePoint;
      if (!point || point.stage !== 'leveling') return;
      this.leveling.cancel(point);
      this.hud.notify('Leveling exited. Select the spirit level to resume.');
    });
    addEventListener('keydown', event => {
      const point = this.mission.activePoint;
      if (!point || point.stage !== 'leveling' || event.repeat) return;
      const mapping: Partial<Record<string, LevelDirection>> = { KeyA: 'left', KeyD: 'right', KeyW: 'in', KeyS: 'out' };
      const direction = mapping[event.code];
      if (direction) { event.preventDefault(); this.leveling.adjust(point, direction); }
    });
  }

  private selectTool(tool: RigTool): void {
    if (!RIG_TOOLS.includes(tool)) return;
    const changed = this.selectedTool !== tool;
    this.selectedTool = tool;
    // Keep the established spray -> hammer gesture useful, but queue exactly
    // one hammer strike rather than turning a held pointer into auto-repeat.
    if (changed && tool === 'hammer' && this.input.actionHeld) this.input.actionRequested = true;
    if (tool === 'spring' || tool === 'cutter') this.conduit.selectTool(tool as PvcTool);
    this.hud.notify(TOOL_HINTS[tool], true, 1200);
  }

  private cycleTool(direction: number): void {
    const current = RIG_TOOLS.indexOf(this.selectedTool);
    const next = (current + (direction < 0 ? -1 : 1) + RIG_TOOLS.length) % RIG_TOOLS.length;
    this.selectTool(RIG_TOOLS[next]);
  }

  private applySpraySettings(): void {
    const color = SPRAY_COLORS[this.sprayColorIndex];
    this.interaction.setSpray(this.sprayMode, color.value);
    this.fpsRig.setSprayColor(color.value);
  }

  private loop = (time: number): void => {
    const dt = Math.min((time - this.lastTime) / 1000, 0.05);
    this.lastTime = time;
    this.step(dt);
    requestAnimationFrame(this.loop);
  };
}
