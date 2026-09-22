import * as THREE from 'three';
import { Renderer } from './Renderer';
import { Input } from './Input';
import { AssetManager } from './AssetManager';
import { HammerWorkStance } from '../player/HammerWorkStance';
import { PlayerController } from '../player/PlayerController';
import { WorkerBody } from '../player/WorkerBody';
import { HoseSupplyLine } from '../player/HoseSupplyLine';
import type { MobileAimProfile } from '../player/PlayerController';
import { DesktopControls } from '../player/DesktopControls';
import { MobileControls, type AimControlMode, type AimInputMode } from '../player/MobileControls';
import { FPSRig, RIG_TOOLS, type RigTool } from '../player/FPSRig';
import { Room } from '../world/Room';
import { MissionSystem } from '../systems/MissionSystem';
import { MarkingSystem } from '../systems/MarkingSystem';
import { HeightMeasureSystem } from '../systems/HeightMeasureSystem';
import { LaserLevelSystem } from '../systems/LaserLevelSystem';
import { setLaserProjection } from '../systems/LaserProjection';
import { ChasingSystem } from '../systems/ChasingSystem';
import { MortarSystem } from '../systems/MortarSystem';
import { MixingStation } from '../systems/MixingStation';
import { PvcWorkshop } from '../systems/PvcWorkshop';
import { ApprenticeSystem } from '../systems/ApprenticeSystem';
import { RoomWaterSystem } from '../systems/RoomWaterSystem';
import { BoxPlacementSystem } from '../systems/BoxPlacementSystem';
import { BoxFitPreview } from '../systems/BoxFitPreview';
import { WorkSurfaceClearance } from '../systems/WorkSurfaceClearance';
import { GAME_CONFIG } from '../data/gameConfig';
import { WATER_GUN_MODES } from '../systems/WaterGun';
import { LevelingSystem, type LevelDirection } from '../systems/LevelingSystem';
import { ConduitSystem, type PvcTool } from '../systems/ConduitSystem';
import { InteractionSystem } from '../systems/InteractionSystem';
import type { HammerMode } from '../systems/InteractionSystem';
import { HUD } from '../ui/HUD';
import { MobileHUD } from '../ui/MobileHUD';
import { ModelInspector } from '../ui/ModelInspector';
import { ConstructionAudio, type ConstructionSound } from '../audio/ConstructionAudio';
import { BoxAssemblyBuilder, horizontalBoxLayout, type BoxAttachmentZone } from '../electrical/BoxAssembly';

const TOOL_HINTS: Record<RigTool, string> = {
  measure: 'TAPE MEASURE · aim to measure from the floor · M to mark',
  drill: 'DRILL · hold at a pencil mark to prepare the fixing hole',
  driver: 'DRIVER · hold on the laser bracket to fasten it',
  laser: 'LASER · place on a drilled fixing, then secure with the driver',
  spray: 'SPRAY CAN · mark the chase route',
  hammer: 'DEMO HAMMER · chase or remove masonry',
  fitting: 'BACK BOX · Q opens live assembly · wheel continues through tools',
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
  get isReadyForStart():boolean{return this.loopReady;}
  readonly hammerWorkStance = new HammerWorkStance();
  readonly renderer: Renderer;
  readonly input = new Input();
  readonly assets = new AssetManager();
  readonly player: PlayerController;
  readonly workerBody:WorkerBody;
  readonly modelInspector:ModelInspector;
  frontBodyView=false;
  private readonly frontCamera=new THREE.PerspectiveCamera(48,1,.025,60);
  private readonly inspectionHidden:THREE.Object3D[]=[];
  readonly room: Room;
  readonly mission: MissionSystem;
  readonly conduit: ConduitSystem;
  readonly mortar: MortarSystem;
  readonly mixing: MixingStation;
  readonly pvc: PvcWorkshop;
  readonly apprentice: ApprenticeSystem;
  readonly roomWater: RoomWaterSystem;
  readonly boxPlacement: BoxPlacementSystem;
  readonly boxFitPreview: BoxFitPreview;
  readonly heightMeasure: HeightMeasureSystem;
  readonly laserLevel: LaserLevelSystem;
  readonly workSurfaces: WorkSurfaceClearance;
  readonly ready: Promise<void>;
  readonly leveling = new LevelingSystem();
  readonly hud: HUD;
  readonly fpsRig = new FPSRig();
  readonly hoseSupply:HoseSupplyLine;
  readonly boxAssembly = new BoxAssemblyBuilder('1G');
  readonly audio = new ConstructionAudio();
  selectedTool: RigTool = 'spray';
  boxAssemblyActive = false;
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
  movementStickMode: 'floating' | 'fixed' = (() => {
    try { return localStorage.getItem('wirehouse:movement-stick-mode') === 'fixed' ? 'fixed' : 'floating'; }
    catch { return 'floating'; }
  })();
  started = false;
  private readonly chasing: ChasingSystem;
  private readonly interaction: InteractionSystem;
  private lastTime = performance.now();
  private animationFrame:number|null=null;
  private loopReady=false;
  private lifecyclePaused=false;
  private lifecycleGeneration=0;
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
    root.addEventListener('pointerdown',()=>this.audio.unlock(),{capture:true});
    addEventListener('keydown',()=>this.audio.unlock(),{capture:true});
    this.renderer = new Renderer(stage);
    let boxZoneTouch:{id:number;zone:number;x:number;y:number}|null=null;
    let boxZoneClick:{x:number;y:number;until:number}|null=null;
    this.hud.shell.addEventListener('pointerdown',event=>{
      if((event.pointerType!=='touch'&&event.pointerType!=='pen')||!this.started||!this.boxAssemblyActive||this.selectedTool!=='fitting')return;
      if((event.target as Element).closest('#box-supply'))return;
      const zone=this.fpsRig.fittingZoneAtScreen(this.renderer.renderCamera,this.renderer.webgl.domElement.getBoundingClientRect(),event.clientX,event.clientY);
      if(zone===null)return;
      boxZoneTouch={id:event.pointerId,zone,x:event.clientX,y:event.clientY};this.hud.shell.setPointerCapture(event.pointerId);
      event.preventDefault();event.stopImmediatePropagation();
    },true);
    this.hud.shell.addEventListener('pointerup',event=>{
      if(!boxZoneTouch||event.pointerId!==boxZoneTouch.id)return;
      const touch=boxZoneTouch;boxZoneTouch=null;
      event.preventDefault();event.stopImmediatePropagation();
      if(Math.hypot(event.clientX-touch.x,event.clientY-touch.y)<=14){boxZoneClick={x:event.clientX,y:event.clientY,until:performance.now()+500};dispatchEvent(new CustomEvent('wirehouse:box-attach',{detail:touch.zone}));}
    },true);
    this.hud.shell.addEventListener('pointercancel',event=>{if(boxZoneTouch?.id===event.pointerId)boxZoneTouch=null;},true);
    this.hud.shell.addEventListener('click',event=>{
      if(!boxZoneClick||performance.now()>boxZoneClick.until||Math.hypot(event.clientX-boxZoneClick.x,event.clientY-boxZoneClick.y)>30)return;
      boxZoneClick=null;event.preventDefault();event.stopImmediatePropagation();
    },true);
    this.player = new PlayerController(this.renderer.camera, this.input);
    this.renderer.camera.add(this.fpsRig);
    this.renderer.scene.add(this.renderer.camera);
    this.workerBody=new WorkerBody(this.renderer.scene);
    this.room = new Room(this.renderer.scene);
    this.renderer.scene.add(this.room);
    this.hoseSupply=new HoseSupplyLine(this.renderer.scene,this.fpsRig.getObjectByName('FPS hose tool')!);
    this.mission = new MissionSystem(this.renderer.scene);
    this.room.brickWall.registerInstallations(this.mission.points);
    this.room.brickWall.prepareMultiPipeChases(this.mission.points);
    this.room.brickWall.contactProvider = camera => this.fpsRig.contact(camera, this.room.brickWall);
    this.chasing = new ChasingSystem(this.renderer.scene, this.room.brickWall);
    this.conduit = new ConduitSystem(this.renderer.scene, this.room.brickWall);
    this.mortar = new MortarSystem(this.renderer.scene, this.room.brickWall, this.mission.points);
    this.mixing = new MixingStation(this);
    this.player.setObstacleProvider(()=>[...this.mixing.collisionObstacles(),...this.apprentice?.collisionObstacles()??[]]);
    this.mixing.onSound=(kind,intensity)=>this.audio.play(kind,intensity);
    this.mortar.reserveScoop = amount => this.mixing.reserveScoop(amount);
    this.mortar.scoopBond = () => this.mixing.bondFactor;
    this.mortar.hasScoop = () => this.mixing.canSupplyScoop;
    this.mortar.onLaunch=({speed})=>this.audio.play('trowel-whoosh',speed/8);
    this.mortar.onImpact=({speed,retainedKg})=>this.audio.play('mortar-splat',Math.min(1.4,.35+speed/9+retainedKg/.65*.35));
    this.roomWater = new RoomWaterSystem(this.renderer.scene, this.room.brickWall);
    this.boxPlacement = new BoxPlacementSystem(this.room.brickWall,this.mortar,this.mission.points);
    for(const point of this.mission.points){
      this.boxPlacement.prepareInstalled(point);
      this.mortar.prepareInstalledBox(point);
    }
    this.boxFitPreview = new BoxFitPreview(this.renderer.scene,this.boxPlacement);
    this.heightMeasure = new HeightMeasureSystem(this.renderer.scene,this.room.brickWall,this.room.referenceWalls);
    this.laserLevel = new LaserLevelSystem(this.renderer.scene,this.heightMeasure,this.room.brickWall,this.room.referenceWalls);
    this.workSurfaces = new WorkSurfaceClearance(this.mortar,this.mission.points);
    this.syncBoxAssembly();
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
    this.mobileControls.setMovementStickMode(this.movementStickMode);
    this.pvc = new PvcWorkshop(this);
    this.apprentice = new ApprenticeSystem(this, this.chasing);
    new MobileHUD();
    this.bindEvents();
    this.modelInspector=new ModelInspector(this);
    const bodyBanner=document.createElement('button');bodyBanner.id='body-view-banner';bodyBanner.hidden=true;bodyBanner.textContent='Ολόσωμη μπροστινή προβολή · C επιστροφή';bodyBanner.addEventListener('click',()=>window.dispatchEvent(new CustomEvent('wirehouse:front-body-view')));this.hud.shell.append(bodyBanner);
    addEventListener('wirehouse:front-body-view',()=>{if(!this.started)return;if(this.modelInspector.active){this.modelInspector.faceFront();return;}this.frontBodyView=!this.frontBodyView;bodyBanner.hidden=!this.frontBodyView;this.hud.shell.classList.toggle('front-body-view',this.frontBodyView);});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.suspendLifecycle();else void this.resumeLifecycle();});
    document.addEventListener('freeze',this.suspendLifecycle);
    document.addEventListener('resume',()=>void this.resumeLifecycle());
    addEventListener('pagehide',this.suspendLifecycle);
    addEventListener('pageshow',()=>void this.resumeLifecycle());
    addEventListener('focus',()=>{if(this.lifecyclePaused)void this.resumeLifecycle();});
    addEventListener('wirehouse:graphics-lost',()=>{this.suspendLifecycle();if(!document.hidden)queueMicrotask(()=>void this.resumeLifecycle());});
    this.hud.onStart(() => {
      this.started = true;
      if(this.apprentice.count>=1){this.mixing.wheelbarrow.beginEmpty();this.apprentice.command('point');}
      else this.apprentice.command('cancel');
      if (matchMedia('(any-pointer: fine)').matches) this.desktopControls.requestLock(false);
    });
    addEventListener('resize', this.renderer.resize);
    this.assets.markLoaded('procedural-core');
    const startButton = root.querySelector<HTMLButtonElement>('#start-button')!;
    startButton.disabled = true;
    startButton.textContent = 'PREPARING WATER AND SITE…';
    this.ready = this.renderer.ready.then(async () => {
      await this.workerBody.ready;
      await this.apprentice.ready;
      await this.apprentice.crewReady;
      await this.renderer.attachRoomWater(this.roomWater);
      this.renderer.setWarmupFactory(()=>this.mortar.createRenderWarmup());
      await this.renderer.prepareToolResources(this.mortar.createRenderWarmup());
      startButton.disabled = false;
      startButton.textContent = 'START';
      startButton.focus({ preventScroll: true });
      this.loopReady=true;
      if(document.hidden)this.suspendLifecycle();else await this.resumeLifecycle();
    });
  }

  step(dt: number, waterDt = dt, present = true): void {
    this.restoreInspectionVisibility();
    if(this.modelInspector.active&&!this.modelInspector.live){
      for(const sound of ['spray','hose','drill','driver','trowel','mixer'] as const)this.audio.setContinuous(sound,false);
      this.modelInspector.update(dt);if(present)this.renderer.render();return;
    }
    this.modelInspector.beforeWorld(dt);
    this.room.update(dt);
    this.hammerWorkStance.restore(this.renderer.camera);
    const active = this.mission.activePoint;
    const leveling = active?.stage === 'leveling';
    if (leveling && !this.wasLeveling && document.pointerLockElement) void document.exitPointerLock();
    this.wasLeveling = leveling;
    const blockingWork=this.mixing.wheelbarrow.busy||this.pvc.blocksWork||this.mixing.blocksWork&&!['drill','laser','driver'].includes(this.selectedTool);
    const handWork=!blockingWork&&['fitting','level','measure','drill','driver','laser'].includes(this.selectedTool);
    // A crouched player can bend farther to pick up a casing on the floor.
    // Latch the posture while that casing is still present: lowering the eyes
    // changes the ray for a few frames, but must not snap the torso back up.
    const lowPickupEligible=handWork&&this.selectedTool==='fitting'&&this.player.crouched;
    const floorBoxAimed=lowPickupEligible&&this.boxPlacement.target(this.renderer.camera)?.boxGroup.userData.placement?.state==='floor';
    const nearbyFloorBox=lowPickupEligible&&this.mission.points.some(point=>point.boxGroup.visible&&point.boxGroup.userData.placement?.state==='floor'
      &&Math.hypot(point.position.x-this.renderer.camera.position.x,point.position.z-this.renderer.camera.position.z)<1.25);
    this.player.lowPickup=Boolean(nearbyFloorBox&&(this.player.lowPickup||floorBoxAimed));
    this.player.wallWorkEnabled=(this.selectedTool==='hammer'||handWork)&&!leveling&&!blockingWork&&!this.apprentice.ownsInput;
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
    // Looking around while building a gang must rotate only the view. Do not
    // auto-crouch or retarget the camera from the wall point under the cursor.
    this.player.handWorkTargetY=handWork&&this.selectedTool!=='fitting'?this.boxWorkAim()?.y??null:null;
    if (this.started && !leveling && !this.pvc.focused) this.player.update(Math.min(dt, 0.05));
    this.fpsRig.beginFrame(dt, this.selectedTool==='hammer' && this.input.actionHeld && Math.abs(this.player.velocity.x)>1e-6
      ? this.player.velocity.x*Math.min(dt,.05) : null,this.selectedTool==='hammer'&&(this.input.actionHeld||this.input.actionRequested));
    this.renderer.camera.rotation.set(this.player.pitch, this.player.yaw, 0);
    for(const action of this.pendingSceneActions.splice(0))action();
    if(this.hammerAutoSide&&this.started&&!this.apprentice.ownsInput&&!leveling&&this.selectedTool==='hammer'){
      this.room.brickWall.chiselSideDegrees=this.hammerWorkStance.resolveSide(this.renderer.camera,this.room.brickWall.chiselSideDegrees);
    }
    this.hammerWorkStance.update(this.renderer.camera, dt, this.room.brickWall.chiselSideDegrees, this.started && !this.apprentice.ownsInput && !leveling && !blockingWork,this.room.brickWall.chiselTiltDegrees,this.selectedTool);
    this.fpsRig.workStanceSide = this.hammerWorkStance.sideDegrees / 75;
    this.fpsRig.workHeadLeanM = this.hammerWorkStance.headLeanM;
    const requestedSide=this.room.brickWall.chiselSideDegrees;
    if(requestedSide!==0)this.fpsRig.hammerHandedness=requestedSide>0?'left':'right';
    this.fpsRig.workStanceTiltDegrees = this.hammerWorkStance.actualTiltDegrees;
    this.fpsRig.workPositionLocked=this.player.workPosition.locked;
    this.actionCooldown = this.selectedTool==='hammer'?this.actionCooldown-dt:Math.max(0,this.actionCooldown-dt);
    let requested = this.input.consumeAction();
    let interactionRequested = this.input.consumeInteraction();
    if((requested||interactionRequested)&&this.apprentice.tryOpenDrawingsOnAim()){requested=false;interactionRequested=false;}
    const apprenticeOwnedInput=this.apprentice.handleInput(requested);
    if(apprenticeOwnedInput)requested=false;
    const pvcOwnedInput=(!apprenticeOwnedInput&&!this.mixing.wheelbarrow.busy&&this.pvc.handleInput(dt,requested,interactionRequested));
    if(pvcOwnedInput)requested=false;
    // The station exposes both USE (mouse/touch action) and INTERACT. Route
    // both through the same stroke/hold path while it owns the player's tools.
    const stationRequested = !apprenticeOwnedInput && !pvcOwnedInput && (interactionRequested || (this.mixing.blocksWork && requested));
    const handledMixingInteraction = this.started && !pvcOwnedInput && this.mixing.handleInteractionRequest(stationRequested,interactionRequested);
    if(handledMixingInteraction)requested=false;
    this.mixing.update(dt, stationRequested && !handledMixingInteraction, this.input.interactionHeld || this.input.actionHeld);
    const mixingOwnedInput = this.mixing.blocksWork;
    // Both hammer modes deliver local repeated percussive strikes while held.
    const continuousTool = this.isContinuousAction();
    const repeatable = continuousTool && this.input.actionHeld && this.actionCooldown <= 0;
    const spraying = this.selectedTool === 'spray' && this.input.actionHeld;
    if (this.wasSpraying && !spraying) this.interaction.endSprayStroke();
    this.wasSpraying = spraying;
    const permitWallActions = !apprenticeOwnedInput && !pvcOwnedInput && !blockingWork && (!mixingOwnedInput || this.selectedTool === 'laser');
    if (this.started && permitWallActions && !['measure','drill','driver','trowel','hose'].includes(this.selectedTool) && (this.selectedTool !== 'hammer' || this.hammerSpeed > 0) && (requested || repeatable)) {
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
    const mortarTool = this.started && !apprenticeOwnedInput && !pvcOwnedInput && !leveling && !mixingOwnedInput && !blockingWork && (this.selectedTool === 'trowel' || this.selectedTool === 'hose');
    // The player's arms hold tools near the body; aiming does not extend them.
    this.fpsRig.position.z=this.selectedTool==='hammer'?-.22:this.selectedTool==='fitting'?-.32:-.42;
    if(this.selectedTool==='hose'){
      this.fpsRig.show('hose');this.fpsRig.hoseActive=this.input.actionHeld;
      this.fpsRig.update(dt,this.player.velocity.lengthSq()>.02,spraying);
      const camera=this.renderer.camera,origin=camera.getWorldPosition(new THREE.Vector3()),direction=camera.getWorldDirection(new THREE.Vector3());
      const wallHit=this.room.brickWall.aim(camera);
      let distance=wallHit?origin.distanceTo(new THREE.Vector3(wallHit.point.x,wallHit.point.y,wallHit.point.z)):8;
      if(direction.y<-.001){const floorDistance=(this.roomWater.field.surfaceAt(origin.x,origin.z)-origin.y)/direction.y;if(floorDistance>0)distance=Math.min(distance,floorDistance);}
      this.fpsRig.aimWaterGun(camera,origin.addScaledVector(direction,distance));
      this.fpsRig.poseArms(camera);
      if(!mixingOwnedInput&&!pvcOwnedInput)this.workerBody.update(dt,camera,this.player,this.fpsRig,'hose',this.input.actionHeld,false,[],this.workSurfaces.frontForBounds);
    }
    const releaseOrigin = this.fpsRig.toolTipWorld(this.renderer.camera, this.selectedTool);
    if (mortarTool && this.selectedTool === 'trowel') this.mortar.swing(this.input.actionHeld,dt,this.renderer.camera,()=>{
      this.fpsRig.poseTrowel(this.renderer.camera,this.mortar.throwFeedback.motion,0,this.room.brickWall.volume.frontZ);
      this.fpsRig.constrainWorkSurfaces(this.renderer.camera,this.workSurfaces.frontForBounds);
      this.workerBody.update(0,this.renderer.camera,this.player,this.fpsRig,'trowel',this.input.actionHeld,false,[],this.workSurfaces.frontForBounds);
      return this.fpsRig.trowelReleaseWorld(this.renderer.camera);
    });
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
    this.heightMeasure.update(this.renderer.camera,this.started&&!this.apprentice.ownsInput&&this.selectedTool==='measure',(point,normal)=>this.fpsRig.canReachPoint(this.renderer.camera,point,.10,normal));
    this.laserLevel.update(this.renderer.camera,this.selectedTool,this.started&&!apprenticeOwnedInput&&!blockingWork&&this.input.actionHeld,dt,(point,normal)=>this.fpsRig.canReachPoint(this.renderer.camera,point,.10,normal));
    this.audio.setContinuous('spray',this.started&&!apprenticeOwnedInput&&!blockingWork&&this.selectedTool==='spray'&&this.input.actionHeld);
    this.audio.setContinuous('hose',waterHeld);
    this.audio.setContinuous('drill',this.pvc.phase==='fastener-drilling'||this.selectedTool==='drill'&&this.laserLevel.working);
    this.audio.setContinuous('driver',this.selectedTool==='driver'&&this.laserLevel.working);
    this.audio.setContinuous('trowel',mortarTool&&this.selectedTool==='trowel'&&this.input.actionHeld&&!this.mortar.throwFeedback.overheld,.7+this.mortar.charge*.3);
    this.audio.setContinuous('mixer',this.mixing.mixerRunning);
    setLaserProjection(this.laserLevel.activeHeightM);
    if (this.selectedTool === 'hammer') this.fpsRig.contact(this.renderer.camera, this.room.brickWall);
    else if(this.selectedTool==='trowel')this.fpsRig.poseTrowel(this.renderer.camera,this.mortar.throwFeedback.motion,dt,this.room.brickWall.volume.frontZ);
    else if(this.selectedTool==='measure')this.fpsRig.poseMeasure(this.renderer.camera,this.heightMeasure.target,this.heightMeasure.targetNormal);
    else if(this.selectedTool==='drill'||this.selectedTool==='driver')this.fpsRig.poseReferenceTool(this.renderer.camera,this.selectedTool,this.laserLevel.target,this.laserLevel.targetNormal,this.laserLevel.working,dt);
    else if(this.selectedTool==='laser')this.fpsRig.poseLaser(this.renderer.camera);
    else this.fpsRig.poseArms(this.renderer.camera);
    if(!['hammer','hose','measure','drill','driver'].includes(this.selectedTool))this.fpsRig.constrainWorkSurfaces(this.renderer.camera,this.workSurfaces.frontForBounds);
    const waterHit = this.selectedTool === 'spray' || mortarTool ? this.room.brickWall.aim(this.renderer.camera) : null;
    const wallAim = Boolean(waterHit);
    const aimedBox=['fitting','level','spring','cutter'].includes(this.selectedTool)?this.boxPlacement.target(this.renderer.camera):null;
    this.boxFitPreview.update(this.renderer.camera,this.boxAssembly.snapshot.modules,this.started&&!this.apprentice.ownsInput&&!mixingOwnedInput&&!this.mixing.interactionTargeted&&this.selectedTool==='fitting'&&this.boxAssemblyActive&&this.fpsRig.fittingBoxAvailable,Boolean(aimedBox),dt,point=>this.fpsRig.canReachPoint(this.renderer.camera,point),false,aimedBox?.boxGroup.position.z??0);
    this.hud.updateBoxFit(this.boxFitPreview.telemetry);
    const pointAim=this.selectedTool==='fitting'?this.boxAssemblyActive&&Boolean(aimedBox||this.boxWorkAim()):Boolean(aimedBox||this.mission.target(this.renderer.camera));
    const aimed = this.selectedTool==='measure'?Boolean(this.heightMeasure.target):this.selectedTool === 'hammer' ? this.fpsRig.reachable && !this.fpsRig.chiselInAir : this.selectedTool === 'spray' ? wallAim : pointAim;
    this.hud.update(this.mission.activePoint, aimed, this.mission.progress, this.selectedTool);
    this.hud.updateHeightMeasure(this.selectedTool==='measure',this.heightMeasure.heightM,Boolean(this.heightMeasure.target));
    this.hud.updateLaser(this.pvc.blocksWork?'spray':this.selectedTool,this.laserLevel.telemetry);
    this.hud.updateWorkHeight(this.player.crouched||this.input.pressed('ControlLeft')||this.input.pressed('ControlRight'));
    const useHeld=this.started&&this.input.actionHeld;
    const hammerReady=this.fpsRig.contactStatus==='ready'&&this.hammerSpeed>0;
    const hammerStatus:Record<typeof this.fpsRig.contactStatus,string>={
      ready:useHeld?'CHISELLING':'HOLD TO CHISEL',feeding:'ADVANCING BIT',regripping:'CHANGING GRIP',
      'no-solid':'AIM AT BRICK','too-close':'STEP BACK SLIGHTLY','out-of-reach':'MOVE INTO REACH',
    };
    const useStatus=this.selectedTool==='measure'?'AIM TO MEASURE'
      :this.selectedTool==='drill'?(this.pvc.fastenerPrepAvailable?'USE · PVC FIXINGS':this.laserLevel.working?'DRILLING':'HOLD TO DRILL')
      :this.selectedTool==='driver'?(this.laserLevel.working?'FASTENING':'HOLD TO FASTEN')
      :this.selectedTool==='laser'?(this.laserLevel.telemetry.mounted?'TAP TO PICK UP':'TAP TO MOUNT')
      :this.selectedTool==='hammer'?(this.hammerSpeed===0?'SPEED 0 · PAUSED':hammerStatus[this.fpsRig.contactStatus])
      :this.selectedTool==='trowel'?(this.mortar.throwFeedback.overheld?'RELEASE TO RESET':this.mortar.recovery>0?'RELOADING':useHeld?'RELEASE TO THROW':'HOLD TO LOAD')
      :this.selectedTool==='fitting'?(!this.boxAssemblyActive?'ΣΥΝΑΡΜΟΛΟΓΗΣΗ':aimedBox?'TAP TO PICK UP':this.boxFitPreview.mode==='fits'?'TAP TO PLACE BOX':this.boxFitPreview.mode==='proud'?`PLACE · +${this.boxFitPreview.telemetry.proudDepthMm} mm`:this.boxFitPreview.mode==='blocked'?'POSITION BLOCKED':'MOVE INTO REACH')
      :this.selectedTool==='level'?(this.mission.activePoint?.stage==='leveling'?'ADJUST SELECTED BOX':aimedBox?'TAP TO PLACE LEVEL':'AIM AT A BOX')
      :useHeld?'USING TOOL':'HOLD TO USE';
    // While the preparation bay owns input, MixingStation is the sole writer
    // of the mobile USE state. Alternating both writers every frame made the
    // controls visibly flash while INTERACT was held on the mixer.
    if(!mixingOwnedInput)this.hud.updateMobileUseStatus(useStatus,this.selectedTool==='hammer'?hammerReady:true,useHeld&&this.selectedTool!=='measure');
    const sprayColor = SPRAY_COLORS[this.sprayColorIndex];
    const settingsKey=[this.selectedTool,this.sprayMode,this.sprayColorIndex,this.hammerMode,this.room.brickWall.chiselTiltDegrees<0,this.room.brickWall.chiselWidthM,this.room.brickWall.chiselType,this.aimControlMode,this.aimProfile,this.wallAssistEnabled,this.aimInputMode,this.movementStickMode].join(':');
    if(settingsKey!==this.hudSettingsKey){
      this.hudSettingsKey=settingsKey;
      this.hud.updateSprayControls(this.sprayMode, sprayColor.name, sprayColor.css, this.selectedTool === 'spray');
      this.hud.updateHammerControls(this.hammerMode, this.selectedTool === 'hammer', this.room.brickWall.chiselTiltDegrees < 0);
      this.hud.updateChiselWidth(this.room.brickWall.chiselWidthM,this.room.brickWall.chiselType==='flat');
      this.hud.updateAimControl(this.aimControlMode);
      this.hud.updateAimSpeed(this.aimProfile);
      this.hud.updateWallAssist(this.wallAssistEnabled);
      this.hud.updateAimInput(this.aimInputMode);
      this.hud.updateMovementStick(this.movementStickMode);
    }
    this.hud.updateChiselOrientation(this.room.brickWall.chiselEdgeAngle*180/Math.PI,this.fpsRig.actualTiltDegrees,this.room.brickWall.chiselSideDegrees,this.room.brickWall.chiselWidthM,this.room.brickWall.chiselTiltDegrees);
    this.hud.updateHammerSide(this.room.brickWall.chiselSideDegrees,this.hammerAutoSide);
    const wet=mortarTool && waterHit ? this.mortar.moistureAt(waterHit.point) : {pore:0,film:0};
    const waterTelemetry=this.roomWater.telemetry;
    this.hud.updateMortar(mixingOwnedInput?'spray':this.selectedTool,this.mortar.charge,this.mortar.angleDegrees,wet,mortarTool && active ? this.mortar.coverage(active):0,this.mortar.recovery,this.mortar.lastOutcome,waterTelemetry.floorLitres,this.mortar.throwFeedback);
    this.hud.updateWaterGun(waterSetting,waterTelemetry.floorLitres,waterTelemetry.meanDepthMm);
    if (this.mission.complete && !this.resultShown) { this.resultShown = true; this.hud.showResult(); if (document.pointerLockElement) void document.exitPointerLock(); }
    this.renderer.eyeYaw = 0;
    this.renderer.eyePitch = 0;
    this.mixing.present();
    this.pvc.present();
    this.workerBody.overview=this.frontBodyView||this.modelInspector.live;
    const bodyPlayer=this.mixing.wheelbarrow.driving?{eyeHeight:1.65,velocity:this.player.velocity,yaw:this.mixing.wheelbarrow.telemetry.yaw+Math.PI,pitch:-.60}:this.pvc.focused?{eyeHeight:this.renderer.camera.position.y,velocity:this.player.velocity,yaw:this.player.yaw,pitch:this.player.pitch}:this.player;
    const clearPipeLayout=this.pvc.focused&&['spreading','marking','fastener-marking','pipe-install-ready'].includes(this.pvc.phase)&&!this.workerBody.overview;
    if(!clearPipeLayout&&(this.selectedTool!=='hose'||mixingOwnedInput||pvcOwnedInput)){
      const poseBody=()=>this.workerBody.update(dt,this.renderer.camera,bodyPlayer,this.fpsRig,this.selectedTool,this.input.actionHeld,mixingOwnedInput||this.pvc.blocksWork,this.pvc.blocksWork?this.pvc.anatomicalGrips():this.mixing.anatomicalGrips(),this.workSurfaces.frontForBounds);
      // Box and level grips test hundreds of candidate poses. Installed
      // casings and mortar stay fixed for this synchronous solve, so reuse
      // their bounds without changing contact or collision decisions.
      if((this.selectedTool==='fitting'||this.selectedTool==='level')&&!mixingOwnedInput&&!pvcOwnedInput)this.workSurfaces.withSnapshot(poseBody);
      else poseBody();
    }
    this.mixing.useAnatomicalBody(this.workerBody.loaded);
    this.pvc.useAnatomicalBody();
    this.apprentice.update(dt);
    this.apprentice.presentPlayer();
    // The overhead layout view is for reading all twenty pipes and their live
    // marks. The full torso has no useful contact here and otherwise fills the
    // phone viewport; anatomical hands return for spring insertion and bend.
    if(clearPipeLayout)this.workerBody.visible=false;
    this.hoseSupply.update(this.selectedTool==='hose'&&this.fpsRig.visible&&!mixingOwnedInput&&!pvcOwnedInput);
    if(this.modelInspector.active&&this.modelInspector.live)this.modelInspector.afterWorld(dt);
    else if(this.frontBodyView)this.updateFrontBodyCamera();
    else this.renderer.viewCamera=null;
    if(this.renderer.viewCamera&&!this.renderer.modelScene)this.hideInspectionObstructions(this.renderer.viewCamera);
    // Catch-up physics may run several times per image. Build wet surfaces
    // only once at presentation, keeping cheap flat patches within one budget.
    if(present)this.mortar.flushWetGeometry(64,3);
    if(present)this.chasing.flushFragmentRendering(2048,.5);
    if (present && this.renderer.render()) {
      const workReticle = !this.apprentice.ownsInput && this.selectedTool === 'hammer' && this.fpsRig.reachable
        ? this.fpsRig.chiselTipWorld.clone().project(this.renderer.renderCamera) : null;
      this.hud.updateWorkReticle(workReticle);
    }
  }

  renderState(): string {
    const point = this.mission.activePoint;
    return JSON.stringify({
      apprentice:this.apprentice.telemetry,
      mortar: this.mortar.telemetry,
      pvc: this.pvc.telemetry,
      mixing: this.mixing.telemetry,
      boxPlacement:this.boxPlacement.telemetry,
      boxFit:this.boxFitPreview.telemetry,
      measurement:this.heightMeasure.telemetry,
      laser:this.laserLevel.telemetry,
      audio:this.audio.telemetry,
      water: {...this.roomWater.telemetry,gunMode:WATER_GUN_MODES[this.waterGunModeIndex].id,gunLitres:this.mortar.waterGunLitres},
      hammer: { speedMultiplier: this.hammerSpeed, paused: this.hammerSpeed === 0, impactIntervalSeconds: this.hammerSpeed > 0 ? .24 / this.hammerSpeed : null, contactStatus:this.fpsRig.contactStatus, contactReason:this.fpsRig.reachReason },
      controls: { actionHeld:this.input.actionHeld, move:this.input.mobileMove, look:this.input.mobileLook, aimInput:this.aimInputMode, manualUse:true },
      body: this.fpsRig.debugPose(),
      anatomicalWorker:this.workerBody.telemetry,
      modelInspector:this.modelInspector.telemetry,
      frontBodyView:this.frontBodyView,
      view: { mode: this.modelInspector.active?'model-inspector':this.frontBodyView?'front-body':'continuous-shared', viewQuaternion: this.renderer.renderCamera.quaternion.toArray(), workQuaternion: this.renderer.camera.quaternion.toArray() },
      workPosition: this.player.workPosition,
      coordinateSystem: 'metres; origin at room floor centre; +X right, +Y up, -Z toward installation wall',
      mode: !this.started ? 'start' : this.mission.complete ? 'mission-complete' : point?.stage === 'leveling' ? 'leveling' : 'playing',
      player: { crouched:this.player.eyeHeight<1.1, x: Number(this.renderer.camera.position.x.toFixed(3)), y: Number(this.renderer.camera.position.y.toFixed(3)), z: Number(this.renderer.camera.position.z.toFixed(3)), yaw: Number(this.player.yaw.toFixed(3)), pitch: Number(this.player.pitch.toFixed(3)) },
      mission: { boxPreset:this.mission.boxPreset, boxAssembly:this.boxAssembly.snapshot, boxAssemblyActive:this.boxAssemblyActive, name: 'Living Room First Fix', progressPercent: this.mission.progress, selectedTool: this.selectedTool, complete: this.mission.complete },
      workSurface: { ...this.room.brickWall.telemetry, stanceSideDegrees:this.hammerWorkStance.sideDegrees, stanceCameraOffset:this.hammerWorkStance.offset.toArray(), freeSprayMarks: this.room.brickWall.freeMarkCount, activeFragments: this.chasing.activeFragmentCount, debrisStrikes:this.chasing.debrisStrikeCount, debrisSplits:this.chasing.debrisSplitCount, debrisCrushes:this.chasing.debrisCrushCount, insideFragments: this.chasing.insideFragmentCount, inwardFragments: this.chasing.inwardFragmentCount, physicsMs:this.chasing.lastUpdateMs, peakPhysicsMs:this.chasing.maximumUpdateMs, fragmentBudget:this.chasing.fragmentBudget, chiselTip:{x:this.fpsRig.chiselTipWorld.x,y:this.fpsRig.chiselTipWorld.y,z:this.fpsRig.chiselTipWorld.z,inAir:this.fpsRig.chiselInAir}, airborneFragments: this.chasing.airborneFragmentCount, settledFragments: this.chasing.settledFragmentCount, sprayMode: this.sprayMode, sprayColor: SPRAY_COLORS[this.sprayColorIndex].name, hammerMode: this.hammerMode, chisel: this.room.brickWall.chiselType, chiselEnergyJ: this.room.brickWall.chiselEnergyJ, chiselWidthMm: this.room.brickWall.chiselWidthM*1000, chiselTiltDegrees:this.room.brickWall.chiselTiltDegrees, actualTiltDegrees:this.fpsRig.actualTiltDegrees, chiselSideDegrees:this.room.brickWall.chiselSideDegrees, chiselEdgeDegrees: this.room.brickWall.chiselEdgeAngle*180/Math.PI, aimControlMode:this.aimControlMode, aimInputMode:this.aimInputMode, aimProfile:this.aimProfile, wallAssist:this.wallAssistEnabled, proximityPrecision:Number(this.player.wallAssistAmount.toFixed(3)) },
      activePoint: point ? { id: point.definition.id, kind: point.definition.kind, bottomHeightM: point.boxGroup.getWorldPosition(new THREE.Vector3()).y-point.boxGroup.groupHeight/2, boxes: point.definition.boxes, stage: point.stage, chaseHits: point.chaseHits, chaseCoverage: Number(this.room.brickWall.getChaseCoverage(point.definition.id).toFixed(3)), pipeStep: point.pipeStep, targeted: this.mission.target(this.renderer.camera) === point, tiltDegrees: Number(point.boxGroup.tiltDegrees.toFixed(2)), depthErrorMm: Number((point.boxGroup.depthError * 1000).toFixed(1)), levelPass: point.boxGroup.isLevel, flushPass: point.boxGroup.isFlush } : null,
      points: this.mission.points.map(item => ({ id: item.definition.id, stage: item.stage, boxes:item.definition.boxes, visible:item.boxGroup.visible, position:item.boxGroup.getWorldPosition(new THREE.Vector3()).toArray(), tiltDegrees:item.boxGroup.tiltDegrees, levelVisible:item.boxGroup.levelBar.visible, conduitVisible: Boolean(item.conduit) })),
    });
  }

  private performAction(continuing = false): void {
    if(this.apprentice.ownsInput){if(this.apprentice.mode==='layout')this.apprentice.confirm();return;}
    if(['spring','cutter'].includes(this.selectedTool)){this.hud.notify('Πήγαινε στη μάτσα PVC και πάτησε E για χειροκίνητη προετοιμασία.',false,1800);return;}
    if(['measure','drill','driver'].includes(this.selectedTool))return;
    if(this.selectedTool==='fitting'&&!this.boxAssemblyActive)return;
    if(this.selectedTool==='laser'){
      this.fpsRig.show('laser');
      this.laserLevel.update(this.renderer.camera,'laser',false,0,(point,normal)=>this.fpsRig.canReachPoint(this.renderer.camera,point,.10,normal));
      const result=this.laserLevel.action();if(result.success)this.audio.play('laser');this.hud.notify(result.message,result.success,1800);return;
    }
    let active=this.mission.activePoint;
    const placedTarget=['fitting','level','spring','cutter'].includes(this.selectedTool)?this.boxPlacement.target(this.renderer.camera):null;
    if(active?.stage!=='leveling'&&placedTarget)active=placedTarget;
    if(!active&&this.selectedTool!=='fitting')return;
    if(['fitting','level','spring','cutter'].includes(this.selectedTool)){
      const aim=this.selectedTool==='fitting'?this.boxWorkAim():active!.boxGroup.getWorldPosition(new THREE.Vector3());
      if(!aim||!this.fpsRig.canReachPoint(this.renderer.camera,aim)){
        if(this.selectedTool==='fitting'){this.boxFitPreview.invalidate();this.hud.notify('Πλησίασε τον τοίχο για να τοποθετήσεις το κουτί με το χέρι.',false,2500);}
        else this.hud.notify('Out of reach. Move closer or crouch for low work.',false,3500);
        return;
      }
    }
    if(this.selectedTool==='fitting'&&!placedTarget){
      active=this.mission.placementCandidate(this.boxAssembly.snapshot.modules);
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
    if(result.success){
      const sound=({hammer:'hammer',fitting:'box',level:'level',spring:'spring',cutter:'cutter'} as Partial<Record<RigTool,ConstructionSound>>)[this.selectedTool];
      if(sound)this.audio.play(sound,this.selectedTool==='hammer'?Math.min(1.35,.6+this.room.brickWall.chiselEnergyJ/8):1);
    }
    if(this.selectedTool==='fitting'){if(result.success)this.boxFitPreview.clearGuide();else this.boxFitPreview.pin(this.renderer.camera,this.boxAssembly.snapshot.modules);this.boxFitPreview.invalidate();}
    if(retrieving&&result.success){this.boxAssembly.restore(target.definition.boxLayout??target.boxGroup.layout);this.syncBoxAssembly();}
    else if(this.selectedTool==='fitting'&&result.success){this.boxAssembly.reset('1G');this.syncBoxAssembly();}
    if(result.success)this.fpsRig.toolAction=1;
    if(this.selectedTool==='hammer'&&result.success)this.fpsRig.strike();
    // BOX uses the live fit panel; old failure toasts must not follow a new aim.
    if(result.message&&this.selectedTool!=='fitting')this.hud.notify(result.message,result.success,this.selectedTool==='level'?4500:700);
    else if(result.success&&this.selectedTool==='fitting')this.hud.notify(retrieving?'Box picked up.':'Box placed.',true,900);
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
    const fit=this.boxFitPreview.assessment;
    if(fit?.canPlace&&fit.target&&Math.hypot(point.x-fit.target.x,point.y-fit.target.y)<.01)point.z+=fit.seatDepthM;
    return Math.abs(point.x)<=3&&point.y>=0&&point.y<=3?point:null;
  }

  private syncBoxAssembly(addedId?:string):void {
    const snapshot=this.boxAssembly.snapshot;
    const zones=([1,2,3,4] as BoxAttachmentZone[]).map(zone=>({zone,module:this.boxAssembly.candidateFor(zone)!,available:this.boxAssembly.zoneAvailable(zone)}));
    this.mission.boxPreset=snapshot.modules.map(module=>module.kind).join('+');
    this.fpsRig.setFittingAssembly(snapshot,zones,addedId);
    this.hud.updateBoxPreset(snapshot.modules.length===1?snapshot.modules[0].kind:'custom');
    this.hud.updateBoxAssembly(snapshot,zones.map(zone=>({zone:zone.zone,available:zone.available})));
    this.boxFitPreview.clearGuide();this.boxFitPreview.invalidate();
  }

  private updateFrontBodyCamera():void{
    const target=this.workerBody.position.clone();target.y=this.player.eyeHeight<1.1?.64:.9;
    this.frontCamera.aspect=this.renderer.camera.aspect;this.frontCamera.fov=48;
    const vertical=THREE.MathUtils.degToRad(48),horizontal=2*Math.atan(Math.tan(vertical/2)*this.frontCamera.aspect);
    const distance=Math.max(2.25,1.08/Math.tan(Math.min(vertical,horizontal)/2));
    const forward=new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0),this.workerBody.rotation.y);
    this.frontCamera.position.copy(target).addScaledVector(forward,distance);this.frontCamera.position.y+=.12;
    this.frontCamera.lookAt(target);this.frontCamera.updateProjectionMatrix();this.renderer.viewCamera=this.frontCamera;
  }
  private restoreInspectionVisibility():void{for(const object of this.inspectionHidden)object.visible=true;this.inspectionHidden.length=0;}
  private hideInspectionObstructions(camera:THREE.Camera):void{
    // Presentation-only cutaway lets the front camera inspect a worker beside a wall.
    // Restore before every simulation step; no collision or gameplay geometry changes.
    const origin=camera.getWorldPosition(new THREE.Vector3()),hidden=new Set<THREE.Object3D>();
    const rays=[.15,.8,this.player.eyeHeight].map(y=>{const target=this.workerBody.position.clone();target.y=y;const delta=target.sub(origin);return{ray:new THREE.Ray(origin,delta.clone().normalize()),distance:delta.length()-.25};});
    const inverse=new THREE.Matrix4(),localRay=new THREE.Ray(),point=new THREE.Vector3();
    // Room cutaways need bounds, not expensive triangle hits on every brick.
    this.room.traverseVisible(object=>{
      if(!(object instanceof THREE.Mesh))return;
      if(object instanceof THREE.InstancedMesh){if(!object.boundingBox)object.computeBoundingBox();}
      else if(!object.geometry.boundingBox)object.geometry.computeBoundingBox();
      const bounds=object instanceof THREE.InstancedMesh?object.boundingBox:object.geometry.boundingBox;if(!bounds)return;
      inverse.copy(object.matrixWorld).invert();
      for(const {ray,distance} of rays){localRay.copy(ray).applyMatrix4(inverse);if(localRay.intersectBox(bounds,point)&&point.applyMatrix4(object.matrixWorld).distanceTo(origin)<distance){hidden.add(object);break;}}
    });
    for(const object of hidden){this.inspectionHidden.push(object);object.visible=false;}
  }

  private bindEvents(): void {
    addEventListener('wirehouse:box-preset',event=>{
      const preset=(event as CustomEvent<string>).detail;
      if(preset!=='1G'&&preset!=='2G'&&preset!=='2G+1G')return;
      this.pendingSceneActions.push(()=>{const modules=horizontalBoxLayout(preset.split('+') as Array<'1G'|'2G'>);this.boxAssembly.restore(modules);this.boxFitPreview.clearGuide();this.syncBoxAssembly();});
    });
    addEventListener('wirehouse:box-cycle-candidate',()=>this.pendingSceneActions.push(()=>{if(this.selectedTool==='fitting'&&this.boxAssemblyActive){this.boxAssembly.cycleCandidate();this.syncBoxAssembly();}}));
    addEventListener('wirehouse:box-rotate-candidate',()=>this.pendingSceneActions.push(()=>{if(this.selectedTool==='fitting'&&this.boxAssemblyActive){this.boxAssembly.rotateCandidate();this.syncBoxAssembly();}}));
    addEventListener('wirehouse:box-attach',event=>{
      const zone=(event as CustomEvent<number>).detail as BoxAttachmentZone;
      if(![1,2,3,4].includes(zone))return;
      this.pendingSceneActions.push(()=>{if(this.selectedTool!=='fitting'||!this.boxAssemblyActive)return;const added=this.boxAssembly.attach(zone);if(!added){this.hud.notify(`Zone ${zone} is occupied by the held assembly.`,false,1400);return;}this.audio.play('box');this.syncBoxAssembly(added.id);});
    });
    addEventListener('wirehouse:box-undo',()=>this.pendingSceneActions.push(()=>{
      if(this.selectedTool!=='fitting'||!this.boxAssemblyActive)return;
      const removed=this.boxAssembly.undo();
      if(!removed){this.hud.notify('Nothing to undo.',false,900);return;}
      this.syncBoxAssembly();this.audio.play('box');
    }));
    addEventListener('wirehouse:box-reset',()=>this.pendingSceneActions.push(()=>{
      if(this.selectedTool!=='fitting'||!this.boxAssemblyActive)return;
      this.boxAssembly.reset('1G');this.syncBoxAssembly();this.hud.notify('Assembly reset to one 1G box.',true,1000);
    }));
    addEventListener('wirehouse:box-enter-assembly',()=>{
      if(this.started&&this.selectedTool==='fitting')this.setBoxAssemblyActive(true);
    });
    addEventListener('wirehouse:box-exit-assembly',()=>{
      if(this.started&&this.selectedTool==='fitting')this.setBoxAssemblyActive(false);
    });
    addEventListener('wirehouse:box-place-assembly',()=>this.pendingSceneActions.push(()=>{if(this.started&&this.selectedTool==='fitting'&&this.boxAssemblyActive)this.performAction();}));
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
    addEventListener('wirehouse:work-height',()=>{this.mixing.releaseAutomaticStance();this.player.crouched=!this.player.crouched;this.hud.updateWorkHeight(this.player.crouched);});
    addEventListener('wirehouse:work-height-set',event=>{this.mixing.releaseAutomaticStance();this.player.crouched=Boolean((event as CustomEvent<boolean>).detail);this.hud.updateWorkHeight(this.player.crouched);});
    addEventListener('keydown',event=>{
      if(!this.started||event.code!=='KeyH'||event.repeat||(event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable="true"]')))return;
      event.preventDefault();window.dispatchEvent(new CustomEvent('wirehouse:work-height'));
    });
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
    addEventListener('wirehouse:laser-place',()=>{if(this.started&&this.selectedTool==='laser')this.pendingSceneActions.push(()=>{if(this.selectedTool==='laser')this.performAction();});});
    addEventListener('wirehouse:measure-mark',()=>{
      if(!this.started||this.apprentice.ownsInput||this.selectedTool!=='measure'||this.hud.shell.classList.contains('settings-open'))return;
      this.pendingSceneActions.push(()=>{
        if(this.selectedTool!=='measure'||document.hidden)return;
        this.heightMeasure.update(this.renderer.camera,true,(point,normal)=>this.fpsRig.canReachPoint(this.renderer.camera,point,.10,normal));
        if(!this.heightMeasure.mark())return;
        this.audio.play('mark');
        this.fpsRig.poseMeasure(this.renderer.camera,this.heightMeasure.target,this.heightMeasure.targetNormal);
        this.fpsRig.markMeasure();
        const target=this.heightMeasure.target!,point=this.mission.activePoint;
        if(point?.stage==='inspect'&&!this.heightMeasure.targetStable){point.placeAt(target.x,target.y);point.setStage('marked');}
        this.hud.notify(`Pencil mark · ${target.y.toFixed(2)} m from floor`,true,1600);
      });
    });
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
    addEventListener('wirehouse:cycle-movement-stick', () => {
      this.movementStickMode = this.movementStickMode === 'floating' ? 'fixed' : 'floating';
      this.mobileControls.setMovementStickMode(this.movementStickMode);
      try { localStorage.setItem('wirehouse:movement-stick-mode', this.movementStickMode); } catch { /* Private browsing can block storage. */ }
      this.hud.notify(`Move joystick: ${this.movementStickMode.toUpperCase()}`);
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
    if(this.mixing.wheelbarrow.busy){this.hud.notify('Πάτησε E για να αφήσεις πρώτα το καρότσι.',false,1300);return;}
    if(!this.pvc.allowTool(tool))return;
    if(this.mixing.carrying){this.hud.notify('Άφησε πρώτα τη σύκλα.',false,1600);return;}
    if(this.mixing.active)this.mixing.setActive(false);
    const changed = this.selectedTool !== tool;
    if(changed&&this.selectedTool==='fitting'&&tool==='hammer')this.boxFitPreview.pin(this.renderer.camera,this.boxAssembly.snapshot.modules);
    if(changed){this.mobileControls.cancelActiveGestures();this.mortar.cancel();const point=this.mission.activePoint;if(point?.stage==='leveling')this.pendingSceneActions.push(()=>this.leveling.cancel(point));}
    this.selectedTool = tool;
    if(changed||tool!=='fitting')this.setBoxAssemblyActive(false);
    // Keep the established spray -> hammer gesture useful, but queue exactly
    // one hammer strike rather than turning a held pointer into auto-repeat.
    if (changed && tool === 'hammer' && this.input.actionHeld) this.input.actionRequested = true;
    if (tool === 'spring' || tool === 'cutter') this.conduit.selectTool(tool as PvcTool);
    const touchHint=tool==='fitting'?'ΚΟΥΤΙΑ · άγγιξε ΣΥΝΑΡΜΟΛΟΓΗΣΗ':tool==='measure'?'ΜΕΤΡΗΣΗ · στόχευσε τον τοίχο και άγγιξε ΣΗΜΑΔΙ':tool==='trowel'?'ΜΙΣΤΡΙ · κράτα και άφησε στην πράσινη περιοχή':TOOL_HINTS[tool];
    this.hud.notify(matchMedia('(pointer:coarse)').matches?touchHint:TOOL_HINTS[tool], true, 1200);
  }

  private setBoxAssemblyActive(active:boolean):void {
    this.boxAssemblyActive=this.selectedTool==='fitting'&&active;
    this.fpsRig.setFittingAssemblyActive(this.boxAssemblyActive);
    this.hud.updateBoxAssemblyMode(this.boxAssemblyActive);
    this.boxFitPreview.clearGuide();this.boxFitPreview.invalidate();
    if(this.boxAssemblyActive)this.hud.notify(matchMedia('(pointer:coarse)').matches?'Διάλεξε πλευρά για σύνδεση · ΤΟΠΟΘ. στον τοίχο':'LIVE BOX ASSEMBLY · Q or ESC to return to tool switching',true,1500);
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

  private isContinuousAction(): boolean { return ['spray','hammer','hose','drill','driver'].includes(this.selectedTool); }

  private suspendLifecycle=():void=>{
    this.lifecycleGeneration++;this.lifecyclePaused=true;
    if(this.animationFrame!==null)cancelAnimationFrame(this.animationFrame);this.animationFrame=null;
    this.mobileControls.cancelActiveGestures();this.input.resetTransientInput();
    this.mortar.cancel();
    this.renderer.suspend();
  };
  private async resumeLifecycle():Promise<void>{
    if(!this.loopReady||document.hidden)return;
    const generation=++this.lifecycleGeneration;this.lifecyclePaused=true;
    if(this.animationFrame!==null)cancelAnimationFrame(this.animationFrame);this.animationFrame=null;
    this.mobileControls.cancelActiveGestures();this.input.resetTransientInput();
    try{
      await this.renderer.resume();
      if(generation!==this.lifecycleGeneration||document.hidden)return;
      // Phone lock time is not simulation time: no queued strikes, throws or
      // water emission may catch up when the screen wakes.
      this.lastTime=performance.now();this.actionCooldown=0;this.lifecyclePaused=false;
      this.animationFrame=requestAnimationFrame(this.loop);
    }catch(error){
      this.renderer.renderError=String(error);
      this.hud.notify('Graphics could not resume. Return to the game to retry.',false,4500);
    }
  }

  private loop = (time: number): void => {
    this.animationFrame=null;
    if(this.lifecyclePaused||document.hidden)return;
    // Water's depth, reflection and final colour passes share the live scene.
    // Moving its camera/arms between those passes caused alternating tool
    // positions and shadows. Keep elapsed time until the next accepted frame;
    // keyboard/touch intent and mouse angles continue to accumulate meanwhile.
    if(this.renderer.framePending){this.animationFrame=requestAnimationFrame(this.loop);return;}
    const elapsed = Math.max(0,Math.min((time - this.lastTime) / 1000,.25));
    this.lastTime = time;
    // Preserve simulation time on slow GPUs using bounded physics steps, with
    // one image after the last step. Water and movement advance the same time.
    if(elapsed===0)this.step(0);
    for(let remaining=elapsed;remaining>1e-8;){
      const dt=Math.min(remaining,.05);remaining-=dt;
      this.step(dt,dt,remaining<=1e-8);
    }
    this.animationFrame=requestAnimationFrame(this.loop);
  };
}
