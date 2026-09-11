import { Renderer } from './Renderer';
import { Input } from './Input';
import { AssetManager } from './AssetManager';
import { PlayerController } from '../player/PlayerController';
import { DesktopControls } from '../player/DesktopControls';
import { MobileControls } from '../player/MobileControls';
import { FPSRig, RIG_TOOLS, type RigTool } from '../player/FPSRig';
import { Room } from '../world/Room';
import { MissionSystem } from '../systems/MissionSystem';
import { MarkingSystem } from '../systems/MarkingSystem';
import { ChasingSystem } from '../systems/ChasingSystem';
import { MortarSystem } from '../systems/MortarSystem';
import { LevelingSystem, type LevelDirection } from '../systems/LevelingSystem';
import { ConduitSystem, type PvcTool } from '../systems/ConduitSystem';
import { InteractionSystem } from '../systems/InteractionSystem';
import { HUD } from '../ui/HUD';
import { MobileHUD } from '../ui/MobileHUD';

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
  started = false;
  private readonly chasing: ChasingSystem;
  private readonly interaction: InteractionSystem;
  private lastTime = performance.now();
  private shake = 0;
  private resultShown = false;
  private actionCooldown = 0;

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
    new DesktopControls(this.hud.shell, this.player);
    new MobileControls(this.hud.shell, this.input, this.player);
    new MobileHUD();
    this.bindEvents();
    this.hud.onStart(() => {
      this.started = true;
      if (!matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints === 0) void this.hud.shell.requestPointerLock();
    });
    addEventListener('resize', this.renderer.resize);
    this.assets.markLoaded('procedural-core');
    requestAnimationFrame(this.loop);
  }

  step(dt: number): void {
    const active = this.mission.activePoint;
    const leveling = active?.stage === 'leveling';
    if (this.started && !leveling) this.player.update(Math.min(dt, 0.05));
    this.actionCooldown = Math.max(0, this.actionCooldown - dt);
    const requested = this.input.consumeAction();
    const repeatable = (this.selectedTool === 'spray' || this.selectedTool === 'hammer') && this.input.actionHeld && this.actionCooldown <= 0;
    if (this.started && (requested || repeatable)) {
      this.performAction();
      this.actionCooldown = this.selectedTool === 'spray' ? 0.075 : this.selectedTool === 'hammer' ? 0.24 : 0.18;
    }
    this.chasing.update(dt);
    this.fpsRig.update(dt, this.player.velocity.lengthSq() > 0.02);
    this.fpsRig.show(this.selectedTool);
    const wallAim = Boolean(this.room.brickWall.aim(this.renderer.camera));
    const pointAim = Boolean(this.mission.target(this.renderer.camera));
    const aimed = this.selectedTool === 'spray' || this.selectedTool === 'hammer' ? wallAim : pointAim;
    this.hud.update(active, aimed, this.mission.progress, this.selectedTool);
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
      workSurface: { freeSprayMarks: this.room.brickWall.freeMarkCount },
      activePoint: point ? { id: point.definition.id, kind: point.definition.kind, bottomHeightM: point.definition.bottom, boxes: point.definition.boxes, stage: point.stage, chaseHits: point.chaseHits, pipeStep: point.pipeStep, targeted: this.mission.target(this.renderer.camera) === point, tiltDegrees: Number(point.boxGroup.tiltDegrees.toFixed(2)), depthErrorMm: Number((point.boxGroup.depthError * 1000).toFixed(1)), levelPass: point.boxGroup.isLevel, flushPass: point.boxGroup.isFlush } : null,
      points: this.mission.points.map(item => ({ id: item.definition.id, stage: item.stage, conduitVisible: Boolean(item.conduit) })),
    });
  }

  private performAction(): void {
    const active = this.mission.activePoint;
    if (!active) return;
    const spatialTool = this.selectedTool === 'spray' || this.selectedTool === 'hammer';
    const target = active.stage === 'leveling' ? active : spatialTool ? active : this.mission.target(this.renderer.camera);
    if (!target) { this.hud.notify('Aim at the work area you chose.', false); return; }
    const wasChasing = this.selectedTool === 'hammer' && (target.stage === 'marked' || target.stage === 'chasing');
    const result = this.interaction.action(target, this.selectedTool, this.renderer.camera);
    if (wasChasing && result.success) { this.fpsRig.strike(); this.shake = 1; }
    if (result.message) this.hud.notify(result.message, result.success);
  }

  private bindEvents(): void {
    addEventListener('wirehouse:select-tool', event => this.selectTool((event as CustomEvent<RigTool>).detail));
    addEventListener('wirehouse:cycle-tool', event => this.cycleTool((event as CustomEvent<number>).detail || 1));
    addEventListener('wirehouse:level', event => {
      const detail = (event as CustomEvent<LevelDirection | 'confirm'>).detail;
      const point = this.mission.activePoint;
      if (!point || point.stage !== 'leveling') return;
      if (detail === 'confirm') { this.input.actionRequested = true; return; }
      this.leveling.adjust(point, detail);
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
    this.selectedTool = tool;
    if (tool === 'spring' || tool === 'cutter') this.conduit.selectTool(tool as PvcTool);
    this.input.actionHeld = false;
  }

  private cycleTool(direction: number): void {
    const current = RIG_TOOLS.indexOf(this.selectedTool);
    const next = (current + (direction < 0 ? -1 : 1) + RIG_TOOLS.length) % RIG_TOOLS.length;
    this.selectTool(RIG_TOOLS[next]);
  }

  private loop = (time: number): void => {
    const dt = Math.min((time - this.lastTime) / 1000, 0.05);
    this.lastTime = time;
    this.step(dt);
    requestAnimationFrame(this.loop);
  };
}
