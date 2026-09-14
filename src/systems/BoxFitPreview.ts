import * as THREE from 'three';
import type {BoxKind} from '../data/installationRules';
import {InstallationPoint} from '../electrical/InstallationPoint';
import type {BoxPlacementSystem,BoxFitAssessment} from './BoxPlacementSystem';

/** Transient, budgeted inspection of the box in hand; never part of the mission. */
export class BoxFitPreview {
  readonly root=new THREE.Group();
  readonly blockedMesh:THREE.InstancedMesh;
  assessment:BoxFitAssessment|null=null;
  mode='hidden';
  private pinned:{camera:THREE.Camera;preset:string}|null=null;
  private usingGuide=false;
  checks=0;
  lastCheckMs=0;
  private extraDepthMm=0;
  private readonly outlines:THREE.LineSegments;
  private readonly ghosts=new Map<string,InstallationPoint>();
  private key='';
  private elapsed=1;
  private preset='';
  private readonly matrix=new THREE.Matrix4();
  private readonly color=new THREE.Color();
  constructor(scene:THREE.Scene,private readonly placement:BoxPlacementSystem){
    this.root.name='Box fit inspection';this.root.userData.transient=true;
    this.blockedMesh=new THREE.InstancedMesh(new THREE.PlaneGeometry(.0043,.0043),new THREE.MeshBasicMaterial({transparent:true,opacity:.62,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}),4096);
    this.blockedMesh.name='Material to remove for held box';this.blockedMesh.count=0;this.blockedMesh.frustumCulled=false;this.blockedMesh.raycast=()=>{};
    this.blockedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // WebGPU builds attribute bindings on first use, even for an empty preview.
    // Create the colour attribute before a distant/grey preview can compile.
    this.blockedMesh.setColorAt(0,this.color);this.blockedMesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.outlines=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0xff4938,transparent:true,opacity:.9,depthTest:false,depthWrite:false}));
    this.outlines.geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(3*72),3).setUsage(THREE.DynamicDrawUsage));
    this.outlines.name='Required recess perimeter and depth';this.outlines.frustumCulled=false;this.outlines.raycast=()=>{};
    this.root.add(this.blockedMesh,this.outlines);this.root.visible=false;scene.add(this.root);
  }
  invalidate():void {this.key='';this.elapsed=1;}
  pin(camera:THREE.Camera,preset:string):void {
    if(this.assessment&&!this.assessment.fits&&['masonry','cured-mortar'].includes(this.assessment.reason)){this.pinned={camera:new THREE.Camera().copy(camera,false),preset};this.invalidate();}
  }
  clearGuide():void {this.pinned=null;this.invalidate();}
  get hasGuide():boolean {return this.pinned!==null;}
  update(camera:THREE.Camera,preset:string,enabled:boolean,retrieving:boolean,dt:number,canReach:(point:THREE.Vector3)=>boolean,guide=false):void {
    this.usingGuide=guide&&this.pinned!==null;
    if(this.usingGuide){camera=this.pinned!.camera;preset=this.pinned!.preset;canReach=()=>true;retrieving=false;}
    this.elapsed+=dt;
    if(!enabled||retrieving){this.root.visible=false;this.mode=retrieving?'retrieve':'hidden';this.assessment=null;this.key='';return;}
    const key=[preset,...camera.position.toArray().map(n=>Math.round(n*2000)),...camera.quaternion.toArray().map(n=>Math.round(n*10000)),this.placement.fitRevision].join(':');
    if(key===this.key)return;
    if(this.key&&preset===this.preset&&this.elapsed<.08)return;
    this.key=key;this.preset=preset;this.elapsed=0;
    let ghost=this.ghosts.get(preset);
    if(!ghost){ghost=new InstallationPoint({id:`preview-${preset}`,label:'Held box fit probe',kind:'socket',boxes:preset.split('+') as BoxKind[],x:0,bottom:.3});this.ghosts.set(preset,ghost);}
    const start=performance.now();this.assessment=this.placement.assess(ghost,camera);this.lastCheckMs=performance.now()-start;this.checks++;
    const fit=this.assessment,target=fit.target;
    this.extraDepthMm=Math.ceil(Math.max(0,...fit.blockedCells.map(cell=>cell.extraDepthM))*1000);
    if(!target){this.root.visible=false;this.mode='out-of-reach';return;}
    const reachable=canReach(new THREE.Vector3(target.x,target.y,target.wallFrontZ));
    this.mode=!reachable||fit.reason==='out-of-reach'?'out-of-reach':fit.fits?'fits':'blocked';
    this.root.visible=true;
    const positions:number[]=[];
    const segment=(a:number[],b:number[])=>positions.push(...a,...b);
    for(const box of ghost.boxGroup.boxes){
      const x=target.x+box.position.x,w=box.width/2,h=box.height/2,y=target.y,z=target.wallFrontZ+.007,back=target.wallFrontZ-fit.required.depth;
      const corners=[[x-w,y-h,z],[x+w,y-h,z],[x+w,y+h,z],[x-w,y+h,z]];
      for(let i=0;i<4;i++){segment(corners[i],corners[(i+1)%4]);segment(corners[i],[corners[i][0],corners[i][1],back]);}
      for(let i=0;i<4;i++)segment([corners[i][0],corners[i][1],back],[corners[(i+1)%4][0],corners[(i+1)%4][1],back]);
    }
    const attribute=this.outlines.geometry.getAttribute('position') as THREE.BufferAttribute;
    (attribute.array as Float32Array).set(positions);attribute.needsUpdate=true;this.outlines.geometry.setDrawRange(0,positions.length/3);
    (this.outlines.material as THREE.LineBasicMaterial).color.set(this.mode==='fits'?0x54ec93:this.mode==='out-of-reach'?0xb7c6ce:0xff5948);
    let count=0;
    if(this.mode==='blocked'&&fit.reason!=='other-box')for(const cell of fit.blockedCells){
      if(count>=4096)break;
      this.matrix.makeTranslation(cell.x,cell.y,cell.surfaceZ+.0018);this.blockedMesh.setMatrixAt(count,this.matrix);
      this.color.set(cell.surfaceZ<target.wallFrontZ-.006?0xffae32:0xff3429);this.blockedMesh.setColorAt(count++,this.color);
    }
    this.blockedMesh.count=count;this.blockedMesh.instanceMatrix.needsUpdate=true;
    if(this.blockedMesh.instanceColor)this.blockedMesh.instanceColor.needsUpdate=true;
  }
  get telemetry(){const fit=this.assessment;return{mode:this.mode,guide:this.usingGuide,visible:this.root.visible,checks:this.checks,lastCheckMs:this.lastCheckMs,preset:this.preset,blockedCells:this.blockedMesh.count,fits:fit?.fits??false,reason:fit?.reason??null,target:fit?.target??null,required:fit?.required??null,extraDepthMm:fit?this.extraDepthMm:0};}
}
