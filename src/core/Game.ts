import * as THREE from 'three';
import { Renderer } from './Renderer';
import { Input } from './Input';
import { AssetManager } from './AssetManager';
import { HammerWorkStance } from '../player/HammerWorkStance';
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
import { RoomWaterSystem } from '../systems/RoomWaterSystem';
import { BoxPlacementSystem } from '../systems/BoxPlacementSystem';
import { GAME_CONFIG } from '../data/gameConfig';
import { WATER_GUN_MODES } from '../systems/WaterGun';
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
  cutter: 'PVC CUTTER · single-action cut to length',
  trowel: 'TROWEL · hold, release in the green center · ↑ / ↓ loft angle',
  hose: 'WATER GUN | hold to spray | SHOWER / JET / FLOOD / MIST',
};

const SPRAY_COLORS = [
  { name: 'BLUE', value: 0x087fce, css: '#087fce' },
  { name: 'RED', value: 0xe53935, css: '#e53935' },
  { name: 'YELLOW', value: 0xffcc19, css: '#ffcc19' },
  { name: 'WHITE', value: 0xf4f1e8, css: '#f4f1e8' },
] as const;

export class Game {
  readonly hammerWorkStance = new HammerWorkStance();
  readonly renderer: Renderer;
  readonly input = new Input();
  readonly assets = new AssetManager();
  readonly player: PlayerController;
  readonly room: Room;
  readonly mission: MissionSystem;
  readonly conduit: ConduitSystem;
  readonly mortar: MortarSystem;
  readonly roomWater: RoomWaterSystem;
  readonly boxPlacement: BoxPlacementSystem;
  readonly ready: Promise<void>;
  readonly leveling = new LevelingSystem();
  readonly hud: HUD;
  readonly fpsRig = new FPSRig();
  selectedTool: RigTool = 'spray';
  sprayMode: 'dots' | 'live' = 'live';
  sprayColorIndex = 0;
  hammerMode: HammerMode = 'chase';
  hammerSpeed = 2.5;
  hammerAutoSide = true;
  waterGunModeIndex = 3;
  aimControlMode: AimControlMode = 'manual';
  aimProfile: MobileAimProfile = 'normal';
  wallAssistEnabled = true;
  aimInputMode: AimInputMode = 'stick';
  started = false;
  private readonly chasing: ChasingSystem;
  private readonly interaction: InteractionSystem;
  private lastTime = performance.now();
  private resultShown = false;
  private actionCooldown = 0;
  private wasSpraying = false;
  private wasLeveling = false;
  private hudSettingsKey = '';
  private readonly pendingSceneActions:Array<()=>void>=[];
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
    this.room.brickWall.registerInstallations(this.mission.points);
    this.room.brickWall.contactProvider = camera => this.fpsRig.contact(camera, this.room.brickWall);
    this.chasing = new ChasingSystem(this.renderer.scene, this.room.brickWall);
    this.conduit = new ConduitSystem(this.renderer.scene, this.room.brickWall);
    this.mortar = new MortarSystem(this.renderer.scene, this.room.brickWall, this.mission.points);
    this.roomWater = new RoomWaterSystem(this.renderer.scene, this.room.brickWall);
    this.boxPlacement = new BoxPlacementSystem(this.room.brickWall,this.mortar,this.mission.points);
    this.mortar.onRunoff = event => this.roomWater.addRunoff(event);
    this.mortar.onWaterEmission = event => this.roomWater.addEmission(event);
    this.interaction = new InteractionSystem(new MarkingSystem(this.room.brickWall), this.chasing, this.leveling, this.mortar, this.conduit);
    this.interaction.placementSystem=this.boxPlacement;
    this.leveling.placementSystem=this.boxPlacement;
    this.applySpraySettings();
    this.desktopControls = new DesktopControls(this.hud.shell, this.renderer.webgl.domElement, this.player, this.input);
    this.mobileControls = new MobileControls(
      this.hud.shell,
      this.input,
      this.player,
      () => this.isContinuousAction(),
    );
    this.mobileControls.setAimControlMode(this.aimControlMode);
    this.mobileControls.setAimInputMode(this.aimInputMode);
    new MobileHUD();
    this.bindEvents();
    this.hud.onStart(() => {
      this.started = true;
      if (matchMedia('(any-pointer: fine)').matches) this.desktopControls.requestLock();
    });
    addEventListener('resize', this.renderer.resize);
    this.assets.markLoaded('procedural-core');
    const startButton = root.querySelector<HTMLButtonElement>('#start-button')!;
    startButton.disabled = true;
    startButton.textContent = 'PREPARING WATER AND SITE…';
    this.ready = this.renderer.ready.then(async () => {
      await this.renderer.attachRoomWater(this.roomWater);
      startButton.disabled = false;
      startButton.textContent = 'ENTER THE SITE';
      this.lastTime = performance.now();
      requestAnimationFrame(this.loop);
    });
  }

  step(dt: number, waterDt = dt, present = true): void {
    this.hammerWorkStance.restore(this.renderer.camera);
    const active = this.mission.activePoint;
    const leveling = active?.stage === 'leveling';
    if (leveling && !this.wasLeveling && document.pointerLockElement) void document.exitPointerLock();
    this.wasLeveling = leveling;
    const handWork=this.selectedTool==='fitting'||this.selectedTool==='level';
    this.player.wallWorkEnabled=(this.selectedTool==='hammer'||handWork)&&!leveling;
    const cuttingStep=(this.room.brickWall.chiselType==='flat'?this.room.brickWall.chiselWidthM:.01)*.36;
    this.player.wallToolTravelSpeedMps=this.selectedTool==='hammer'&&this.input.actionHeld
      ?Math.min(.6,cuttingStep*this.hammerSpeed/.24):null;
    const workTilt=THREE.MathUtils.degToRad(this.hammerWorkStance.actualTiltDegrees);
    const workSide=THREE.MathUtils.degToRad(this.hammerWorkStance.sideDegrees);
    const wallAxisZ=Math.cos(workTilt)*Math.cos(workSide);
    // Use the angle the hands actually hold, including an upward side stroke's
    // shorter reach. Requested tilt can differ substantially near floor/ceiling.
    const upwardSideFeed=.20*Math.max(0,-Math.sin(workTilt))*Math.abs(Math.sin(workSide));
    this.player.wallWorkDistance=handWork?.46:Math.max(.46,(.38+.55*Math.abs(wallAxisZ)-upwardSideFeed)*Math.max(.2,Math.cos(this.player.yaw)));
    this.player.handWorkTargetY=handWork?this.boxWorkAim()?.y??null:null;
    if (this.started && !leveling) this.player.update(Math.min(dt, 0.05));
    this.fpsRig.beginFrame(dt, this.selectedTool==='hammer' && this.input.actionHeld && Math.abs(this.player.velocity.x)>1e-6
      ? this.player.velocity.x*Math.min(dt,.05) : null);
    this.renderer.camera.rotation.set(this.player.pitch, this.player.yaw, 0);
    for(const action of this.pendingSceneActions.splice(0))action();
    if(this.hammerAutoSide&&this.started&&!leveling&&this.selectedTool==='hammer'){
      this.room.brickWall.chiselSideDegrees=this.hammerWorkStance.resolveSide(this.renderer.camera,this.room.brickWall.chiselSideDegrees);
    }
    this.hammerWorkStance.update(this.renderer.camera, dt, this.room.brickWall.chiselSideDegrees, this.started && !leveling,this.room.brickWall.chiselTiltDegrees,this.selectedTool);
    this.fpsRig.workStanceSide = this.hammerWorkStance.sideDegrees / 75;
    this.fpsRig.workHeadLeanM = this.hammerWorkStance.headLeanM;
    const requestedSide=this.room.brickWall.chiselSideDegrees;
    if(requestedSide!==0)this.fpsRig.hammerHandedness=requestedSide>0?'left':'right';
    this.fpsRig.workStanceTiltDegrees = this.hammerWorkStance.actualTiltDegrees;
    this.fpsRig.workPositionLocked=this.player.workPosition.locked;
    this.actionCooldown = this.selectedTool==='hammer'?this.actionCooldown-dt:Math.max(0,this.actionCooldown-dt);
    const requested = this.input.consumeAction();
    // Both hammer modes deliver local repeated percussive strikes while held.
    const continuousTool = this.isContinuousAction();
    const repeatable = continuousTool && this.input.actionHeld && this.actionCooldown <= 0;
    const spraying = this.selectedTool === 'spray' && this.input.actionHeld;
    if (this.wasSpraying && !spraying) this.interaction.endSprayStroke();
    this.wasSpraying = spraying;
    if (this.started && this.selectedTool !== 'trowel' && this.selectedTool !== 'hose' && (this.selectedTool !== 'hammer' || this.hammerSpeed > 0) && (requested || repeatable)) {
      this.performAction(repeatable && !requested);
      const interval=this.selectedTool === 'spray' ? 0.045 : this.selectedTool === 'hammer' ? 0.24 / Math.max(.25, this.hammerSpeed) : 0.18;
      // Carry fractional frame time so 8x is not silently capped to 30 Hz on
      // slower screens. Bound catch-up to prevent a resume/pause burst.
      this.actionCooldown=(this.selectedTool==='hammer'&&repeatable&&!requested?Math.max(-.05,this.actionCooldown):0)+interval;
      if(this.selectedTool==='hammer'&&this.input.actionHeld&&this.actionCooldown<=0){
        this.performAction(true);this.actionCooldown+=interval;
      }
    }
    else if(!this.input.actionHeld)this.actionCooldown=Math.max(0,this.actionCooldown);
    const mortarTool = this.started && !leveling && (this.selectedTool === 'trowel' || this.selectedTool === 'hose');
    // The player's arms hold tools near the body; aiming does not extend them.
    this.fpsRig.position.z=this.selectedTool==='hammer'?-.22:-.42;
    if(this.selectedTool==='hose'){
      this.fpsRig.show('hose');this.fpsRig.hoseActive=this.input.actionHeld;
      this.fpsRig.update(dt,this.player.velocity.lengthSq()>.02,spraying);
      const camera=this.renderer.camera,origin=camera.getWorldPosition(new THREE.Vector3()),direction=camera.getWorldDirection(new THREE.Vector3());
      const wallHit=this.room.brickWall.aim(camera);
      let distance=wallHit?origin.distanceTo(new THREE.Vector3(wallHit.point.x,wallHit.point.y,wallHit.point.z)):8;
      if(direction.y<-.001){const floorDistance=(this.roomWater.field.surfaceAt(origin.x,origin.z)-origin.y)/direction.y;if(floorDistance>0)distance=Math.min(distance,floorDistance);}
      this.fpsRig.aimWaterGun(camera,origin.addScaledVector(direction,distance));
      this.fpsRig.poseArms(camera);
    }
    const releaseOrigin = this.fpsRig.toolTipWorld(this.renderer.camera, this.selectedTool);
    if (mortarTool && this.selectedTool === 'trowel') this.mortar.swing(this.input.actionHeld,dt,this.renderer.camera,()=>this.fpsRig.poseTrowel(this.renderer.camera,this.mortar.throwFeedback.motion,0,this.room.brickWall.volume.frontZ));
    else this.mortar.cancel();
    const waterSetting=WATER_GUN_MODES[this.waterGunModeIndex];
    const waterHeld=mortarTool&&this.selectedTool==='hose'&&this.input.actionHeld;
    const nozzleDirection=this.fpsRig.waterGunDirectionWorld();
    const waterSeconds=THREE.MathUtils.clamp(waterDt,0,.25);
    if(waterHeld)this.mortar.wet(this.renderer.camera,releaseOrigin,waterSeconds,waterSetting,(x,z)=>this.roomWater.field.surfaceAt(x,z),nozzleDirection);
    this.roomWater.setJetState({active:waterHeld,origin:releaseOrigin,direction:nozzleDirection,...waterSetting});
    this.mortar.update(dt);
    this.boxPlacement.update(dt);
    // Keep hose litres tied to elapsed time on slower phones, while advancing
    // fluid collision in small stable steps. Rendering still happens once.
    if(waterSeconds===0)this.roomWater.update(0);
    for(let remaining=waterSeconds;remaining>1e-8;remaining-=.05)this.roomWater.update(Math.min(.05,remaining));
    this.mortar.preview(this.renderer.camera,releaseOrigin,mortarTool && this.selectedTool === 'trowel');
    this.fpsRig.hoseActive=this.selectedTool==='hose'&&this.input.actionHeld;
    this.fpsRig.levelTiltDegrees=active?.boxGroup.tiltDegrees??0;
    this.fpsRig.fittingBoxAvailable=this.mission.points.filter(point=>point.boxGroup.visible).length<24;
    this.fpsRig.mortarCharge=this.mortar.charge;
    this.fpsRig.mortarRecovery=this.mortar.recovery;
    this.fpsRig.mortarHolding=this.mortar.throwFeedback.holding;
    this.fpsRig.mortarSwingDegrees=this.mortar.throwFeedback.swingDegrees;
    this.chasing.update(dt);
    if(this.selectedTool!=='hose')this.fpsRig.update(dt, this.player.velocity.lengthSq() > 0.02, spraying);
    this.fpsRig.show(this.selectedTool);
    this.fpsRig.visible=this.mission.activePoint?.stage!=='leveling';
    if (this.selectedTool === 'hammer') this.fpsRig.contact(this.renderer.camera, this.room.brickWall);
    else if(this.selectedTool==='trowel')this.fpsRig.poseTrowel(this.renderer.camera,this.mortar.throwFeedback.motion,dt,this.room.brickWall.volume.frontZ);
    else this.fpsRig.poseArms(this.renderer.camera);
    const waterHit = this.selectedTool === 'spray' || mortarTool ? this.room.brickWall.aim(this.renderer.camera) : null;
    const wallAim = Boolean(waterHit);
    const aimedBox=['fitting','level','spring','cutter'].includes(this.selectedTool)?this.boxPlacement.target(this.renderer.camera):null;
    const pointAim=this.selectedTool==='fitting'?Boolean(aimedBox||this.boxWorkAim()):Boolean(aimedBox||this.mission.target(this.renderer.camera));
    const aimed = this.selectedTool === 'hammer' ? this.fpsRig.reachable && !this.fpsRig.chiselInAir : this.selectedTool === 'spray' ? wallAim : pointAim;
    this.hud.update(this.mission.activePoint, aimed, this.mission.progress, this.selectedTool);
    this.hud.updateWorkHeight(this.player.crouched||this.input.pressed('ControlLeft')||this.input.pressed('ControlRight'));
    const useHeld=this.started&&this.input.actionHeld;
    const hammerReady=this.fpsRig.contactStatus==='ready'&&this.hammerSpeed>0;
    const hammerStatus:Record<typeof this.fpsRig.contactStatus,string>={
      ready:useHeld?'CHISELLING':'HOLD TO CHISEL',feeding:'ADVANCING BIT',regripping:'CHANGING GRIP',
      'no-solid':'AIM AT BRICK','too-close':'STEP BACK SLIGHTLY','out-of-reach':'MOVE INTO REACH',
    };
    const useStatus=this.selectedTool==='hammer'?(this.hammerSpeed===0?'SPEED 0 · PAUSED':hammerStatus[this.fpsRig.contactStatus])
      :this.selectedTool==='trowel'?(this.mortar.throwFeedback.overheld?'RELEASE TO RESET':this.mortar.recovery>0?'RELOADING':useHeld?'RELEASE TO THROW':'HOLD TO LOAD')
      :this.selectedTool==='fitting'?(aimedBox?'TAP TO PICK UP':'TAP TO PLACE BOX')
      :this.selectedTool==='level'?(this.mission.activePoint?.stage==='leveling'?'ADJUST SELECTED BOX':aimedBox?'TAP TO PLACE LEVEL':'AIM AT A BOX')
      :useHeld?'USING TOOL':'HOLD TO USE';
    this.hud.updateMobileUseStatus(useStatus,this.selectedTool==='hammer'?hammerReady:true,useHeld);
    const sprayColor = SPRAY_COLORS[this.sprayColorIndex];
    const settingsKey=[this.selectedTool,this.sprayMode,this.sprayColorIndex,this.hammerMode,this.room.brickWall.chiselTiltDegrees<0,this.room.brickWall.chiselWidthM,this.room.brickWall.chiselType,this.aimControlMode,this.aimProfile,this.wallAssistEnabled,this.aimInputMode].join(':');
    if(settingsKey!==this.hudSettingsKey){
      this.hudSettingsKey=settingsKey;
      this.hud.updateSprayControls(this.sprayMode, sprayColor.name, sprayColor.css, this.selectedTool === 'spray');
      this.hud.updateHammerControls(this.hammerMode, this.selectedTool === 'hammer', this.room.brickWall.chiselTiltDegrees < 0);
      this.hud.updateChiselWidth(this.room.brickWall.chiselWidthM,this.room.brickWall.chiselType==='flat');
      this.hud.updateAimControl(this.aimControlMode);
      this.hud.updateAimSpeed(this.aimProfile);
      this.hud.updateWallAssist(this.wallAssistEnabled);
      this.hud.updateAimInput(this.aimInputMode);
    }
    this.hud.updateChiselOrientation(this.room.brickWall.chiselEdgeAngle*180/Math.PI,this.fpsRig.actualTiltDegrees,this.room.brickWall.chiselSideDegrees,this.room.brickWall.chiselWidthM,this.room.brickWall.chiselTiltDegrees);
    this.hud.updateHammerSide(this.room.brickWall.chiselSideDegrees,this.hammerAutoSide);
    const wet=mortarTool && waterHit ? this.mortar.moistureAt(waterHit.point) : {pore:0,film:0};
    const waterTelemetry=this.roomWater.telemetry;
    this.hud.updateMortar(this.selectedTool,this.mortar.charge,this.mortar.angleDegrees,wet,mortarTool && active ? this.mortar.coverage(active):0,this.mortar.recovery,this.mortar.lastOutcome,waterTelemetry.floorLitres,this.mortar.throwFeedback);
    this.hud.updateWaterGun(waterSetting,waterTelemetry.floorLitres,waterTelemetry.meanDepthMm);
    if (this.mission.complete && !this.resultShown) { this.resultShown = true; this.hud.showResult(); if (document.pointerLockElement) void document.exitPointerLock(); }
    this.renderer.eyeYaw = 0;
    this.renderer.eyePitch = 0;
    if (present && this.renderer.render()) {
      const workReticle = this.selectedTool === 'hammer' && this.fpsRig.reachable
        ? this.fpsRig.chiselTipWorld.clone().project(this.renderer.renderCamera) : null;
      this.hud.updateWorkReticle(workReticle);
    }
  }

  renderState(): string {
    const point = this.mission.activePoint;
    return JSON.stringify({
      mortar: this.mortar.telemetry,
      boxPlacement:this.boxPlacement.telemetry,
      water: {...this.roomWater.telemetry,gunMode:WATER_GUN_MODES[this.waterGunModeIndex].id,gunLitres:this.mortar.waterGunLitres},
      hammer: { speedMultiplier: this.hammerSpeed, paused: this.hammerSpeed === 0, impactIntervalSeconds: this.hammerSpeed > 0 ? .24 / this.hammerSpeed : null, contactStatus:this.fpsRig.contactStatus, contactReason:this.fpsRig.reachReason },
      controls: { actionHeld:this.input.actionHeld, move:this.input.mobileMove, look:this.input.mobileLook, aimInput:this.aimInputMode, manualUse:true },
      body: this.fpsRig.debugPose(),
      view: { mode: 'continuous-shared', viewQuaternion: this.renderer.renderCamera.quaternion.toArray(), workQuaternion: this.renderer.camera.quaternion.toArray() },
      workPosition: this.player.workPosition,
      coordinateSystem: 'metres; origin at room floor centre; +X right, +Y up, -Z toward installation wall',
      mode: !this.started ? 'start' : this.mission.complete ? 'mission-complete' : point?.stage === 'leveling' ? 'leveling' : 'playing',
      player: { crouched:this.player.eyeHeight<1.1, x: Number(this.renderer.camera.position.x.toFixed(3)), y: Number(this.renderer.camera.position.y.toFixed(3)), z: Number(this.renderer.camera.position.z.toFixed(3)), yaw: Number(this.player.yaw.toFixed(3)), pitch: Number(this.player.pitch.toFixed(3)) },
      mission: { boxPreset:this.mission.boxPreset, name: 'Living Room First Fix', progressPercent: this.mission.progress, selectedTool: this.selectedTool, complete: this.mission.complete },
      workSurface: { ...this.room.brickWall.telemetry, stanceSideDegrees:this.hammerWorkStance.sideDegrees, stanceCameraOffset:this.hammerWorkStance.offset.toArray(), freeSprayMarks: this.room.brickWall.freeMarkCount, activeFragments: this.chasing.activeFragmentCount, debrisStrikes:this.chasing.debrisStrikeCount, debrisSplits:this.chasing.debrisSplitCount, debrisCrushes:this.chasing.debrisCrushCount, insideFragments: this.chasing.insideFragmentCount, inwardFragments: this.chasing.inwardFragmentCount, physicsMs:this.chasing.lastUpdateMs, peakPhysicsMs:this.chasing.maximumUpdateMs, fragmentBudget:this.chasing.fragmentBudget, chiselTip:{x:this.fpsRig.chiselTipWorld.x,y:this.fpsRig.chiselTipWorld.y,z:this.fpsRig.chiselTipWorld.z,inAir:this.fpsRig.chiselInAir}, airborneFragments: this.chasing.airborneFragmentCount, settledFragments: this.chasing.settledFragmentCount, sprayMode: this.sprayMode, sprayColor: SPRAY_COLORS[this.sprayColorIndex].name, hammerMode: this.hammerMode, chisel: this.room.brickWall.chiselType, chiselEnergyJ: this.room.brickWall.chiselEnergyJ, chiselWidthMm: this.room.brickWall.chiselWidthM*1000, chiselTiltDegrees:this.room.brickWall.chiselTiltDegrees, actualTiltDegrees:this.fpsRig.actualTiltDegrees, chiselSideDegrees:this.room.brickWall.chiselSideDegrees, chiselEdgeDegrees: this.room.brickWall.chiselEdgeAngle*180/Math.PI, aimControlMode:this.aimControlMode, aimInputMode:this.aimInputMode, aimProfile:this.aimProfile, wallAssist:this.wallAssistEnabled, proximityPrecision:Number(this.player.wallAssistAmount.toFixed(3)) },
      activePoint: point ? { id: point.definition.id, kind: point.definition.kind, bottomHeightM: point.boxGroup.getWorldPosition(new THREE.Vector3()).y-point.boxGroup.groupHeight/2, boxes: point.definition.boxes, stage: point.stage, chaseHits: point.chaseHits, chaseCoverage: Number(this.room.brickWall.getChaseCoverage(point.definition.id).toFixed(3)), pipeStep: point.pipeStep, targeted: this.mission.target(this.renderer.camera) === point, tiltDegrees: Number(point.boxGroup.tiltDegrees.toFixed(2)), depthErrorMm: Number((point.boxGroup.depthError * 1000).toFixed(1)), levelPass: point.boxGroup.isLevel, flushPass: point.boxGroup.isFlush } : null,
      points: this.mission.points.map(item => ({ id: item.definition.id, stage: item.stage, boxes:item.definition.boxes, visible:item.boxGroup.visible, position:item.boxGroup.getWorldPosition(new THREE.Vector3()).toArray(), tiltDegrees:item.boxGroup.tiltDegrees, levelVisible:item.boxGroup.levelBar.visible, conduitVisible: Boolean(item.conduit) })),
    });
  }

  private performAction(continuing = false): void {
    let active=this.mission.activePoint;
    const placedTarget=['fitting','level','spring','cutter'].includes(this.selectedTool)?this.boxPlacement.target(this.renderer.camera):null;
    if(active?.stage!=='leveling'&&placedTarget)active=placedTarget;
    if(!active&&this.selectedTool!=='fitting')return;
    if(['fitting','level','spring','cutter'].includes(this.selectedTool)){
      const aim=this.selectedTool==='fitting'?this.boxWorkAim():active!.boxGroup.getWorldPosition(new THREE.Vector3());
      if(!aim||!this.fpsRig.canReachPoint(this.renderer.camera,aim)){
        this.hud.notify('Out of reach. Move closer or crouch for low work.',false,3500);return;
      }
    }
    if(this.selectedTool==='fitting'&&!placedTarget){
      active=this.mission.placementCandidate();
      if(!active){this.hud.notify('24 box groups placed. Pick up an existing box to move it.',false);return;}
      this.room.brickWall.registerInstallations(this.mission.points);
    }
    if(!active)return;
    if(this.selectedTool==='hammer'&&!this.fpsRig.contact(this.renderer.camera,this.room.brickWall)){
      if(!continuing)this.hud.notify(this.fpsRig.reachReason,false,1200);
      return;
    }
    const spatialTool=['spray','hammer','fitting'].includes(this.selectedTool);
    const target=active.stage==='leveling'?active:spatialTool?active:placedTarget;
    if(!target){this.hud.notify('Aim at the box you want to work on.',false);return;}
    this.mission.select(target);
    const retrieving=this.selectedTool==='fitting'&&target.boxGroup.visible;
    const result=this.interaction.action(target,this.selectedTool,this.renderer.camera,continuing);
    if(retrieving&&result.success){this.mission.boxPreset=target.definition.boxes.join('+') as '1G'|'2G'|'2G+1G';this.hud.updateBoxPreset(this.mission.boxPreset);}
    if(result.success)this.fpsRig.toolAction=1;
    if(this.selectedTool==='hammer'&&result.success)this.fpsRig.strike();
    if(result.message)this.hud.notify(result.message,result.success,this.selectedTool==='fitting'||this.selectedTool==='level'?4500:700);
  }

  private boxWorkAim():THREE.Vector3|null {
    const camera=this.renderer.camera,origin=camera.getWorldPosition(new THREE.Vector3()),direction=camera.getWorldDirection(new THREE.Vector3());
    const box=this.boxPlacement.target(camera)?.boxGroup;
    if(box?.visible){
      box.updateWorldMatrix(true,true);
      const hit=new THREE.Ray(origin,direction).intersectBox(new THREE.Box3().setFromObject(box),new THREE.Vector3());
      if(hit&&hit.distanceTo(origin)<=GAME_CONFIG.interaction.maxDistance)return hit;
    }
    if(direction.z>=-.01)return null;
    const distance=(this.room.brickWall.volume.frontZ-origin.z)/direction.z;
    if(distance<=0||distance>2.35)return null;
    const point=origin.addScaledVector(direction,distance);
    return Math.abs(point.x)<=3&&point.y>=0&&point.y<=3?point:null;
  }

  private bindEvents(): void {
    addEventListener('wirehouse:box-preset',event=>{
      const preset=(event as CustomEvent<string>).detail;
      if(preset!=='1G'&&preset!=='2G'&&preset!=='2G+1G')return;
      this.pendingSceneActions.push(()=>{this.mission.boxPreset=preset;this.hud.updateBoxPreset(preset);});
    });
    const setChiselWidth=(value:number)=>{
      const wall=this.room.brickWall;
      if(wall.chiselType!=='flat'||!Number.isFinite(value))return;
      wall.chiselWidthM=Math.round(value/.005)*.005;
      this.hud.updateChiselWidth(wall.chiselWidthM,true);
    };
    addEventListener('wirehouse:chisel-width',event=>setChiselWidth((event as CustomEvent<number>).detail));
    addEventListener('keydown',event=>{
      if(this.selectedTool!=='hammer'||event.repeat||(event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"]')))return;
      if(event.code==='Comma'||event.code==='Period'){event.preventDefault();setChiselWidth(this.room.brickWall.chiselWidthM+(event.code==='Period'?.005:-.005));}
    });
    const setHammerSpeed = (value:number) => {
      if(!Number.isFinite(value))return;
      this.hammerSpeed = THREE.MathUtils.clamp(Math.round(value * 4) / 4, 0, 8);
      this.actionCooldown = Math.min(this.actionCooldown, this.hammerSpeed > 0 ? .24 / this.hammerSpeed : 0);
      this.hud.updateHammerSpeed(this.hammerSpeed);
    };
    addEventListener('wirehouse:hammer-speed',event=>setHammerSpeed((event as CustomEvent<number>).detail));
    addEventListener('keydown',event=>{
      if(this.selectedTool !== 'hammer' || event.repeat) return;
      if(event.code === 'Minus' || event.code === 'Equal') {event.preventDefault();setHammerSpeed(this.hammerSpeed + (event.code === 'Equal' ? .25 : -.25));}
    });
    addEventListener('wirehouse:work-height',()=>{this.player.crouched=!this.player.crouched;this.hud.updateWorkHeight(this.player.crouched);});
    const cancelSwing=()=>this.mortar.cancel();
    addEventListener('pointerdown',event=>{if(event.button===2)cancelSwing();});
    addEventListener('blur',cancelSwing);
    addEventListener('pointercancel',event=>{if(!event.pointerType||event.pointerType==='mouse')cancelSwing();});
    addEventListener('wirehouse:cancel-mobile-action',cancelSwing);
    document.addEventListener('pointerlockchange',()=>{if(!document.pointerLockElement)cancelSwing();});
    addEventListener('wirehouse:mortar-angle',event=>{this.mortar.angleDegrees=THREE.MathUtils.clamp(this.mortar.angleDegrees+(event as CustomEvent<number>).detail,-20,50);});
    const swingButton=document.querySelector<HTMLElement>('#mortar-swing')!;
    swingButton.addEventListener('pointerdown',event=>{event.preventDefault();swingButton.setPointerCapture(event.pointerId);this.input.actionHeld=true;});
    swingButton.addEventListener('pointerup',()=>{this.input.actionHeld=false;});
    swingButton.addEventListener('pointercancel',()=>{this.input.actionHeld=false;cancelSwing();});
    addEventListener('keydown',event=>{if(this.selectedTool==='trowel' && (event.code==='ArrowUp'||event.code==='ArrowDown')){event.preventDefault();this.mortar.angleDegrees=THREE.MathUtils.clamp(this.mortar.angleDegrees+(event.code==='ArrowUp'?2:-2),-20,50);}});
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
    addEventListener('wirehouse:cycle-chisel', () => {
      const wall = this.room.brickWall;
      wall.chiselType = wall.chiselType === 'flat' ? 'pointed' : 'flat';
      document.querySelector('#chisel-type b')!.textContent = wall.chiselType.toUpperCase();
      this.hud.notify(`Chisel: ${wall.chiselType.toUpperCase()}`);
    });
    addEventListener('wirehouse:side-chisel', event => {
      this.hammerAutoSide=false;
      const wall=this.room.brickWall, delta=(event as CustomEvent<number>).detail;
      // Requested side is the actual angle relative to the player's aim;
      // zero is a straight stroke and left/right share the same range.
      const angles=[0,15,25,45,55,-15,-25,-45,-55];
      wall.chiselSideDegrees=delta ? Math.max(-55,Math.min(55,wall.chiselSideDegrees+delta)) : angles[(angles.indexOf(wall.chiselSideDegrees)+1)%angles.length];
      document.querySelector('#chisel-side b')!.textContent=`${Math.abs(wall.chiselSideDegrees)} deg ${wall.chiselSideDegrees>0 ? 'LEFT' : wall.chiselSideDegrees<0 ? 'RIGHT' : 'CENTER'}`;
    });
    addEventListener('wirehouse:hammer-view-side',event=>{
      if(this.selectedTool!=='hammer')return;
      this.hammerAutoSide=false;
      const wall=this.room.brickWall,requested=(event as CustomEvent<number>).detail;
      const sign=requested?Math.sign(requested):wall.chiselSideDegrees>0?-1:1;
      wall.chiselSideDegrees=sign*Math.max(15,Math.abs(wall.chiselSideDegrees));
      this.hud.updateHammerSide(wall.chiselSideDegrees);
      document.querySelector('#chisel-side b')!.textContent=`${Math.abs(wall.chiselSideDegrees)} deg ${wall.chiselSideDegrees>0?'LEFT':'RIGHT'}`;
    });
    addEventListener('wirehouse:hammer-auto-side',()=>{
      this.hammerAutoSide=!this.hammerAutoSide;
      this.hud.updateHammerSide(this.room.brickWall.chiselSideDegrees,this.hammerAutoSide);
    });
    addEventListener('wirehouse:tilt-chisel', event => {
      const wall=this.room.brickWall;
      const delta=(event as CustomEvent<number>).detail;
      const angles=[15,30,45,55,0,-15,-30,-45,-55];
      wall.chiselTiltDegrees=delta ? Math.max(-55,Math.min(55,wall.chiselTiltDegrees+delta)) : angles[(angles.indexOf(wall.chiselTiltDegrees)+1)%angles.length];
      document.querySelector('#chisel-tilt b')!.textContent=`${Math.abs(wall.chiselTiltDegrees)} deg ${wall.chiselTiltDegrees<0 ? "UP" : "DOWN"}`;
      this.hud.notify(wall.chiselTiltDegrees<0 ? `Upward ${Math.abs(wall.chiselTiltDegrees)}° · trim exposed ribs at the existing cavity depth` : `Hammer tilt: ${wall.chiselTiltDegrees}° downward`);
    });
    addEventListener('wirehouse:rotate-chisel', () => {
      this.room.brickWall.chiselEdgeAngle = (this.room.brickWall.chiselEdgeAngle + Math.PI/4) % Math.PI;
      document.querySelector('#chisel-angle b')!.textContent = `${Math.round(this.room.brickWall.chiselEdgeAngle*180/Math.PI)}°`;
    });
    addEventListener('wirehouse:cycle-water-mode',()=>{this.waterGunModeIndex=(this.waterGunModeIndex+1)%WATER_GUN_MODES.length;});
    document.querySelector('#water-gun-mode')?.addEventListener('change',event=>{
      const index=WATER_GUN_MODES.findIndex(mode=>mode.id===(event.target as HTMLSelectElement).value);
      if(index>=0)this.waterGunModeIndex=index;
    });
    addEventListener('wirehouse:cycle-hammer-mode', () => {
      this.hammerMode = this.hammerMode === 'chase' ? 'demolish' : 'chase';
      this.interaction.setHammerMode(this.hammerMode);
      this.hud.notify(`Hammer method: ${this.hammerMode.toUpperCase()}`);
    });
    addEventListener('wirehouse:cycle-aim-control', () => {
      // Legacy integrations cannot re-enable automatic work from camera input.
      this.aimControlMode = 'manual';
      this.mobileControls.setAimControlMode(this.aimControlMode);
      this.hud.notify('Hold USE to work. Swipe the view to look without using a tool.');
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
      this.pendingSceneActions.push(()=>{
      const point = this.mission.activePoint;
      if (!point || point.stage !== 'leveling') return;
      if (detail === 'cancel') { this.leveling.cancel(point); this.hud.notify('Leveling exited. Select the spirit level to resume.'); return; }
      if (detail === 'confirm') { this.input.actionRequested = true; return; }
      if(!this.leveling.adjust(point, detail))this.hud.notify('Movement blocked by masonry or another box.',false,1800);
      });
    });
    addEventListener('wirehouse:exit-leveling', () => {
      this.pendingSceneActions.push(()=>{
      const point = this.mission.activePoint;
      if (!point || point.stage !== 'leveling') return;
      this.leveling.cancel(point);
      this.hud.notify('Leveling exited. Select the spirit level to resume.');
      });
    });
    addEventListener('keydown', event => {
      const point = this.mission.activePoint;
      if (!point || point.stage !== 'leveling' || event.repeat) return;
      const mapping: Partial<Record<string, LevelDirection>> = { KeyA: 'left', KeyD: 'right', KeyW: 'in', KeyS: 'out' };
      const direction = mapping[event.code];
      if (direction) { event.preventDefault(); this.pendingSceneActions.push(()=>{if(point.stage==='leveling')this.leveling.adjust(point, direction);}); }
    });
  }

  private selectTool(tool: RigTool): void {
    if (!RIG_TOOLS.includes(tool)) return;
    const changed = this.selectedTool !== tool;
    if(changed){this.mobileControls.cancelActiveGestures();this.mortar.cancel();const point=this.mission.activePoint;if(point?.stage==='leveling')this.pendingSceneActions.push(()=>this.leveling.cancel(point));}
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

  private isContinuousAction(): boolean { return this.selectedTool === 'spray' || this.selectedTool === 'hammer' || this.selectedTool === 'hose'; }

  private loop = (time: number): void => {
    // Water's depth, reflection and final colour passes share the live scene.
    // Moving its camera/arms between those passes caused alternating tool
    // positions and shadows. Keep elapsed time until the next accepted frame;
    // keyboard/touch intent and mouse angles continue to accumulate meanwhile.
    if(this.renderer.framePending){requestAnimationFrame(this.loop);return;}
    const elapsed = Math.max(0,Math.min((time - this.lastTime) / 1000,.25));
    this.lastTime = time;
    // Preserve simulation time on slow GPUs using bounded physics steps, with
    // one image after the last step. Water and movement advance the same time.
    if(elapsed===0)this.step(0);
    for(let remaining=elapsed;remaining>1e-8;){
      const dt=Math.min(remaining,.05);remaining-=dt;
      this.step(dt,dt,remaining<=1e-8);
    }
    requestAnimationFrame(this.loop);
  };
}
