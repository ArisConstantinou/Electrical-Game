import * as THREE from 'three';
import { WebGPURenderer, MeshStandardNodeMaterial } from 'three/webgpu';
import { positionWorld, materialColor, sin, dot, floor, fract, vec2, vec3, smoothstep, mix } from 'three/tsl';
import { GAME_CONFIG } from '../data/gameConfig';
import { laserBand, laserTint, laserEmission } from '../systems/LaserProjection';
import type { RoomWaterSystem } from '../systems/RoomWaterSystem';
import type { RoomWaterRuntime } from '../generated/room-water-runtime';

export class Renderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(72, 1, 0.025, 60);
  /** Logical camera owns the body/rig; this detached camera owns only the image. */
  readonly renderCamera = new THREE.PerspectiveCamera(72, 1, 0.025, 60);
  readonly orthographicRenderCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, .05, 180);
  private activeRenderCamera:THREE.Camera=this.renderCamera;
  viewCamera:THREE.PerspectiveCamera|THREE.OrthographicCamera|null=null;
  modelScene:THREE.Scene|null=null;
  modelViewport:{x:number;y:number;width:number;height:number}|null=null;
  eyeYaw = 0;
  eyePitch = 0;
  readonly webgl: WebGPURenderer;
  readonly ready:Promise<void>;
  private gpu:WebGPURenderer;
  private readonly forceWebGL=new URLSearchParams(location.search).get('renderer')==='webgl';
  private suspended=false;
  private deviceLost=false;
  private contextLost=false;
  private contextRestored:Promise<void>|null=null;
  private resolveContextRestored:(()=>void)|null=null;
  private recoveryTask:Promise<void>|null=null;
  private renderGeneration=0;
  private recoveryCount=0;
  private waterRoots:THREE.Object3D[]=[];
  private warmupFactory:(()=>THREE.Group)|null=null;
  private water:RoomWaterRuntime|null=null;
  private roomWater:RoomWaterSystem|null=null;
  // The first optical update initializes the vendor's surface and underwater
  // state; later dry frames skip its unused passes.
  private waterWasVisible=true;
  private readonly waterFrustum=new THREE.Frustum();
  private readonly waterProjection=new THREE.Matrix4();
  private readonly waterEye=new THREE.Vector3();
  private renderTask:Promise<void>|null=null;
  private pendingSize:{width:number;height:number}|null=null;
  private lastRenderTime=performance.now();
  private readonly materialCache=new WeakMap<THREE.Material,THREE.Material>();
  private readonly gazeEuler=new THREE.Euler(0,0,0,'YXZ');
  private readonly gazeQuaternion=new THREE.Quaternion();
  renderError='';
  /** Gameplay may advance again once all passes using this scene have finished. */
  get framePending():boolean{return this.renderTask!==null||this.recoveryTask!==null||this.deviceLost||this.suspended;}
  get lifecycleTelemetry():object{return{suspended:this.suspended,recovering:this.recoveryTask!==null,deviceLost:this.deviceLost,contextLost:this.contextLost,recoveries:this.recoveryCount,generation:this.renderGeneration};}

  constructor(container: HTMLElement) {
    this.scene.background = new THREE.Color(0xaab9bd);
    this.scene.fog = new THREE.Fog(0xaab9bd, 9, 24);
    this.scene.name = 'WIRE THE HOUSE scene';
    this.scene.userData.studioEntityId = 'scene:root';
    this.camera.name = 'First-person camera';
    this.camera.userData.studioEntityId = 'camera:first-person';
    this.camera.rotation.order = 'YXZ';
    this.gpu = new WebGPURenderer({ antialias: true, powerPreference: 'high-performance', forceWebGL:this.forceWebGL });
    // Preserve the established diagnostics path. WebGPU calls counts render
    // passes cumulatively; old WebGL info.render.calls meant frame draw calls.
    this.webgl=new Proxy(this.gpu,{get:(target,key)=>{
      target=this.gpu;const info=target.info;
      if(key==='info')return{...info,render:{...info.render,calls:info.render.drawCalls},memory:info.memory};
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    },set:(_target,key,value)=>Reflect.set(this.gpu,key,value,this.gpu)});
    this.webgl.setPixelRatio(Math.min(devicePixelRatio, GAME_CONFIG.renderer.maxPixelRatio));
    this.webgl.shadowMap.enabled = true;
    this.webgl.shadowMap.type = THREE.PCFShadowMap;
    this.webgl.outputColorSpace = THREE.SRGBColorSpace;
    this.webgl.toneMapping = THREE.ACESFilmicToneMapping;
    this.webgl.toneMappingExposure = 1.05;
    this.webgl.domElement.id = 'game-canvas';
    this.webgl.domElement.setAttribute('aria-label', 'WIRE THE HOUSE first-person game');
    container.append(this.webgl.domElement);
    this.bindDeviceLoss();
    this.webgl.domElement.addEventListener('webglcontextlost',event=>{
      event.preventDefault();this.contextLost=true;
      this.contextRestored??=new Promise(resolve=>{this.resolveContextRestored=resolve;});
    });
    this.webgl.domElement.addEventListener('webglcontextrestored',()=>{
      this.contextLost=false;this.resolveContextRestored?.();this.resolveContextRestored=null;this.contextRestored=null;
    });
    this.resize();
    this.ready=this.gpu.init().then(()=>undefined);
  }

  private bindDeviceLoss():void{
    this.gpu.onDeviceLost=()=>{
      this.deviceLost=true;
      window.dispatchEvent(new CustomEvent('wirehouse:graphics-lost'));
    };
  }
  setWarmupFactory(factory:()=>THREE.Group):void{this.warmupFactory=factory;}
  suspend():void{this.suspended=true;this.renderGeneration++;}
  async resume():Promise<void>{
    this.suspended=false;
    if(this.recoveryTask)return this.recoveryTask;
    this.lastRenderTime=performance.now();
    // A suspended GPU readback can remain unresolved after the page returns.
    // Retire its entire renderer/runtime instead of racing a second optical
    // update on the same instance if it does not finish within a short grace.
    const pending=this.renderTask;
    const recovery=(async()=>{
      if(this.contextRestored)await this.contextRestored;
      if(pending&&!this.deviceLost){
        let timer:ReturnType<typeof setTimeout>|undefined;
        try{await Promise.race([pending,new Promise<void>(resolve=>{timer=setTimeout(resolve,1200);})]);}
        finally{if(timer!==undefined)clearTimeout(timer);}
      }
      if(this.deviceLost||this.renderTask===pending&&pending!==null)await this.rebuildGraphics();
      this.lastRenderTime=performance.now();this.waterWasVisible=true;this.resize();
    })();
    this.recoveryTask=recovery;
    try{await recovery;}finally{if(this.recoveryTask===recovery)this.recoveryTask=null;}
  }
  private async rebuildGraphics():Promise<void>{
    this.renderGeneration++;this.renderTask=null;
    const previous=this.gpu,canvas=previous.domElement;
    // Graphics resources are disposable; the room, water simulation fields,
    // placements and gameplay camera remain the same live objects.
    this.water?.dispose();this.water=null;
    for(const root of this.waterRoots)root.removeFromParent();this.waterRoots=[];
    previous.onDeviceLost=()=>{};this.disposePreservingCanvas(previous);
    // Retired vendor continuations may wake much later. Fail their next GPU
    // entry immediately; they must never draw into the reused canvas again.
    const retired=()=>{throw new Error('Retired graphics generation');};
    previous.render=retired;previous.renderAsync=retired;
    previous.compute=retired;previous.computeAsync=retired;
    this.gpu=new WebGPURenderer({canvas,antialias:true,powerPreference:'high-performance',forceWebGL:this.forceWebGL});
    this.gpu.setPixelRatio(Math.min(devicePixelRatio,GAME_CONFIG.renderer.maxPixelRatio));
    this.gpu.shadowMap.enabled=true;this.gpu.shadowMap.type=THREE.PCFShadowMap;
    this.gpu.outputColorSpace=THREE.SRGBColorSpace;this.gpu.toneMapping=THREE.ACESFilmicToneMapping;this.gpu.toneMappingExposure=1.05;
    this.bindDeviceLoss();await this.gpu.init();this.deviceLost=false;this.resize();
    if(this.roomWater)await this.attachRoomWater(this.roomWater);
    if(this.warmupFactory)await this.prepareToolResources(this.warmupFactory());
    this.renderError='';this.recoveryCount++;
  }

  private disposePreservingCanvas(renderer:WebGPURenderer):void{
    // Three r185's WebGL fallback dispose deliberately calls loseContext().
    // This canvas is being recovered and reused, so preserve its restored
    // context while still disposing every renderer cache and GPU resource.
    const backend=renderer.backend as unknown as {isWebGLBackend?:boolean;extensions?:{get:(name:string)=>unknown}};
    const extensions=backend.isWebGLBackend?backend.extensions:undefined;
    if(!extensions){renderer.dispose();return;}
    const get=extensions.get;
    extensions.get=function(name:string){return name==='WEBGL_lose_context'?null:get.call(this,name);};
    try{renderer.dispose();}finally{extensions.get=get;}
  }

  resize = (): void => {
    const parent = this.webgl.domElement.parentElement;
    const width = parent?.clientWidth ?? innerWidth;
    const height = parent?.clientHeight ?? innerHeight;
    this.camera.aspect = Math.max(1, width) / Math.max(1, height);
    // Portrait must retain enough horizontal vision for two hands and a tool.
    // This changes the lens, never the physical size or reach of the body.
    this.camera.fov = Math.max(72, THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(60)/2)/this.camera.aspect)));
    this.camera.updateProjectionMatrix();
    // Water Pro.resize mutates its camera projection and depth targets.
    // Defer it with the accepted frame, rather than midway through a GPU pass.
    if(this.water)this.pendingSize={width,height};
    else this.webgl.setSize(width,height,false);
  };

  async attachRoomWater(room:RoomWaterSystem):Promise<void>{
    await this.ready;
    if(new URLSearchParams(location.search).get('waterPro')==='0'){room.waterProBackend='diagnostic-disabled';return;}
    const {createRoomWater}=await import('../generated/room-water-runtime.js');
    this.snapshotRenderCamera();
    const previous=new Set(this.scene.children);
    this.water=await createRoomWater(this.gpu,this.scene,this.renderCamera,room);
    this.waterRoots=this.scene.children.filter(object=>!previous.has(object));
    // Water Pro leaves its new surface visible until the first update. A dry
    // menu must not compile and draw that full optical shader behind the UI.
    const surface=this.scene.getObjectByName('Water Pro finite room flooding surface');
    if(surface)surface.visible=room.surface.visible;
    this.roomWater=room;
    this.waterWasVisible=true;
  }
  /** Compile transient tool samples under the actual scene lights before play.
   * Shared geometry/materials remain owned by the tool; samples never simulate. */
  async prepareToolResources(samples:THREE.Group):Promise<void>{
    await this.ready;
    this.snapshotRenderCamera();
    samples.position.copy(this.camera.position).addScaledVector(this.camera.getWorldDirection(new THREE.Vector3()),.5);
    this.scene.add(samples);
    try{
      this.prepareMaterials();
      await this.gpu.compileAsync(samples,this.renderCamera,this.scene);
      // The colour compiler does not visit every first-use shadow pipeline.
      // Warm those under the same lights without showing sample mortar.
      const previous=this.gpu.getRenderTarget(),target=new THREE.RenderTarget(1,1);
      try{this.gpu.setRenderTarget(target);this.gpu.render(this.scene,this.renderCamera);}
      finally{this.gpu.setRenderTarget(previous);target.dispose();}
    }finally{this.scene.remove(samples);}
  }
  private prepareMaterials():void{
    this.scene.traverse(object=>{
      const mesh=object as THREE.Mesh;if(!mesh.isMesh||Array.isArray(mesh.material))return;
      const old=mesh.material as THREE.MeshStandardMaterial;
      if(!old.isMeshStandardMaterial||(old as unknown as MeshStandardNodeMaterial).isNodeMaterial)return;
      const shader=String(old.onBeforeCompile),masonry=shader.includes('masonryPosition'),mortar=shader.includes('mortarWorld');
      if(!masonry&&!mortar&&!old.userData.referenceLaserReceiver)return;
      let material=this.materialCache.get(old);
      if(!material){
        const node=new MeshStandardNodeMaterial();node.copy(old);
        let surfaceColor=materialColor.rgb;
        if(masonry){
          const grain=fract(sin(dot(floor(positionWorld.xy.mul(1800)),vec2(127.1,311.7))).mul(43758.5453));
          const mottling=sin(positionWorld.x.mul(93).add(sin(positionWorld.y.mul(71)))).mul(sin(positionWorld.y.mul(127)));
          const grooves=smoothstep(.82,.99,sin(positionWorld.y.mul(3200)));
          surfaceColor=materialColor.rgb.mul(grain.mul(.15).add(.90).add(mottling.mul(.045)).sub(grooves.mul(.035)));
        }else if(mortar){
          const grain=fract(sin(dot(floor(positionWorld.mul(1600)),vec3(127.1,311.7,74.7))).mul(43758.5453));
          surfaceColor=materialColor.rgb.mul(grain.mul(.06).add(.96));
        }
        node.colorNode=mix(surfaceColor,laserTint,laserBand);
        node.emissiveNode=laserEmission;
        material=node;this.materialCache.set(old,node);
      }
      mesh.material=material;
    });
  }
  private snapshotRenderCamera():void{
    if(this.viewCamera instanceof THREE.OrthographicCamera){
      this.viewCamera.updateMatrixWorld(true);
      this.orthographicRenderCamera.copy(this.viewCamera,false);
      this.orthographicRenderCamera.updateMatrixWorld(true);
      this.activeRenderCamera=this.orthographicRenderCamera;
      return;
    }
    this.activeRenderCamera=this.renderCamera;
    if(this.viewCamera){this.viewCamera.updateMatrixWorld(true);this.renderCamera.copy(this.viewCamera,false);this.renderCamera.updateMatrixWorld(true);return;}
    this.camera.updateWorldMatrix(true,true);
    // Copy projection too, so resizing and Studio lens changes are reflected
    // at the same accepted-frame boundary as the gaze and world pose.
    this.renderCamera.copy(this.camera,false);
    this.renderCamera.name='Independent eye view camera';
    this.renderCamera.userData={renderOnly:true};
    this.camera.getWorldPosition(this.renderCamera.position);
    this.camera.getWorldQuaternion(this.renderCamera.quaternion);
    this.camera.getWorldScale(this.renderCamera.scale);
    this.gazeEuler.set(Number.isFinite(this.eyePitch)?this.eyePitch:0,Number.isFinite(this.eyeYaw)?this.eyeYaw:0,0,'YXZ');
    this.renderCamera.quaternion.multiply(this.gazeQuaternion.setFromEuler(this.gazeEuler));
    this.renderCamera.updateMatrixWorld(true);
  }
  private waterInView(room:RoomWaterSystem):boolean{
    if(!room.surface.visible||room.wetBounds.isEmpty())return false;
    const eye=this.activeRenderCamera.getWorldPosition(this.waterEye),bounds=room.wetBounds;
    if(eye.x>=bounds.min.x&&eye.x<=bounds.max.x&&eye.z>=bounds.min.z&&eye.z<=bounds.max.z&&
      eye.y<room.field.surfaceAt(eye.x,eye.z)+.02)return true;
    this.waterProjection.multiplyMatrices(this.activeRenderCamera.projectionMatrix,this.activeRenderCamera.matrixWorldInverse);
    this.waterFrustum.setFromProjectionMatrix(this.waterProjection);
    return this.waterFrustum.intersectsBox(bounds);
  }
  /** True means renderCamera now contains the accepted frame's exact view. */
  render():boolean{
    if(this.framePending)return false;
    if(this.pendingSize){
      const {width,height}=this.pendingSize;this.pendingSize=null;
      if(this.water)this.water.resize(width,height);
      else this.webgl.setSize(width,height,false);
    }
    // Never mutate this snapshot while Water Pro's asynchronous depth/optical
    // passes are pending. Gameplay and input may keep using the logical camera.
    this.snapshotRenderCamera();
    if(this.modelScene){this.gpu.info.reset();this.drawScene(this.modelScene);return true;}
    this.prepareMaterials();
    const now=performance.now(),dt=Math.min(.05,(now-this.lastRenderTime)/1000);this.lastRenderTime=now;
    const waterVisible=this.roomWater?this.waterInView(this.roomWater):false;
    const updateWater=this.water&&(waterVisible||this.waterWasVisible);
    this.waterWasVisible=waterVisible;
    if(!this.water||!updateWater){
      // The Water Pro update normally owns this reset; dry frames still need
      // fresh diagnostics rather than accumulating every draw since loading.
      this.gpu.info.reset();
      this.drawScene(this.scene);return true;
    }
    const generation=this.renderGeneration;
    const task=this.water.update(dt).then(()=>{if(generation===this.renderGeneration&&!this.suspended)this.drawScene(this.scene);}).catch(error=>{
      if(generation===this.renderGeneration&&!this.deviceLost){this.renderError=String(error);console.error('Room Water Pro rendering failed',error);}
    }).finally(()=>{if(this.renderTask===task)this.renderTask=null;});
    this.renderTask=task;
    return true;
  }
  async waitForFrame():Promise<void>{await this.ready;await this.renderTask;}
  private drawScene(scene:THREE.Scene):void{
    const rect=this.modelViewport;if(!rect){this.gpu.render(scene,this.activeRenderCamera);return;}
    const viewport=this.gpu.getViewport(new THREE.Vector4()),scissor=this.gpu.getScissor(new THREE.Vector4()),test=this.gpu.getScissorTest();
    try{this.gpu.setViewport(rect.x,rect.y,rect.width,rect.height);this.gpu.setScissor(rect.x,rect.y,rect.width,rect.height);this.gpu.setScissorTest(true);this.gpu.render(scene,this.activeRenderCamera);}
    finally{this.gpu.setViewport(viewport);this.gpu.setScissor(scissor);this.gpu.setScissorTest(test);}
  }
}
