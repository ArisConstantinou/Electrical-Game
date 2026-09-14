import * as THREE from 'three';
import type {BrickWall} from '../world/BrickWall';
import {queryWallWorkSurface} from './WallWorkSurface';

const TAPE_WIDTH=.028;
const MAX_MARKS=32;
const FRONT_CLEARANCE=.004;
const UP=new THREE.Vector3(0,1,0);

export interface HeightReferenceMark {id:string;point:THREE.Vector3;normal:THREE.Vector3;stable:boolean;heightM:number}

/** A floor-referenced physical tape and pencil marks attached to their supporting wall. */
export class HeightMeasureSystem {
  readonly root=new THREE.Group();
  readonly marksRoot=new THREE.Group();
  target:THREE.Vector3|null=null;
  readonly targetNormal=new THREE.Vector3(0,0,1);
  targetStable=false;
  heightM:number|null=null;
  private mode:'hidden'|'no-wall'|'out-of-reach'|'ready'='hidden';
  private readonly tape:THREE.Mesh<THREE.PlaneGeometry,THREE.MeshBasicMaterial>;
  private readonly hook:THREE.Group;
  private readonly markRecords:(HeightReferenceMark&{group:THREE.Group;supported:boolean})[]=[];
  private readonly probe=new THREE.Vector3();
  private readonly basis=new THREE.Matrix4();
  private readonly right=new THREE.Vector3();
  private lastHeight=-1;
  private supportRevision=-1;
  private lastSupportCheck=-Infinity;

  constructor(scene:THREE.Scene,private readonly wall:BrickWall,private readonly stableWalls:THREE.Object3D[]=[]){
    this.root.name='Floor to hand measuring tape';this.root.visible=false;
    this.marksRoot.name='Pencil height marks';
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=8192;
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Measuring tape canvas unavailable');
    ctx.fillStyle='#f6c83e';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#201b13';ctx.strokeStyle='#201b13';
    const maxMm=Math.ceil(wall.volume.height*1000);
    for(let mm=0;mm<=maxMm;mm++){
      const y=canvas.height-mm/maxMm*canvas.height;
      const cm=mm%10===0,major=mm%50===0;
      ctx.fillRect(0,y-.65,major?44:cm?31:16,cm?2:1.3);
      if(major&&mm>0){
        ctx.save();ctx.translate(91,y);ctx.rotate(-Math.PI/2);
        ctx.font='bold 40px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillStyle=mm%1000===0?'#a32615':'#201b13';ctx.fillText(String(mm/10),0,0);ctx.restore();
        ctx.fillStyle='#201b13';
      }
    }
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
    this.tape=new THREE.Mesh(new THREE.PlaneGeometry(TAPE_WIDTH,1),new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}));
    this.tape.name='Yellow millimetre tape, centimetres from floor';this.tape.raycast=()=>{};
    this.root.add(this.tape);
    this.hook=new THREE.Group();this.hook.name='Steel tape floor hook';
    const metal=new THREE.MeshStandardMaterial({color:0xb4bcc0,metalness:.7,roughness:.35});
    const upright=new THREE.Mesh(new THREE.BoxGeometry(.032,.018,.0015),metal);upright.position.y=.009;
    const foot=new THREE.Mesh(new THREE.BoxGeometry(.032,.0015,.018),metal);foot.position.set(0,.0008,.008);
    this.hook.add(upright,foot);this.hook.traverse(object=>{object.raycast=()=>{};});this.root.add(this.hook);
    scene.add(this.root,this.marksRoot);
  }

  update(camera:THREE.Camera,active:boolean,canReach:(point:THREE.Vector3,normal:THREE.Vector3)=>boolean):void {
    this.refreshMarkSupport();
    this.target=null;this.heightM=null;this.targetStable=false;
    if(!active){this.mode='hidden';this.root.visible=false;return;}
    // Range feedback uses the same real masonry ray, while the arm owns reach.
    const hit=queryWallWorkSurface(camera,this.wall,this.stableWalls);
    const volume=this.wall.volume;
    if(!hit||!Number.isFinite(hit.point.x)||!Number.isFinite(hit.point.y)||hit.point.y<.01||hit.point.y>volume.height||(!hit.stable&&Math.abs(hit.point.x)>volume.width/2)){
      this.mode='no-wall';this.root.visible=false;return;
    }
    const height=Math.round(hit.point.y*100)/100;
    if(height<.01||height>volume.height){this.mode='no-wall';this.root.visible=false;return;}
    this.probe.copy(hit.point);this.probe.y=height;this.probe.addScaledVector(hit.normal,FRONT_CLEARANCE);
    this.targetNormal.copy(hit.normal);this.targetStable=hit.stable;
    this.heightM=height;
    if(!canReach(this.probe,this.targetNormal)){this.mode='out-of-reach';this.root.visible=false;return;}
    this.target=this.probe.clone();this.mode='ready';this.root.visible=true;
    this.root.position.copy(this.probe).addScaledVector(this.targetNormal,.003);this.root.position.y=0;
    this.root.quaternion.setFromRotationMatrix(this.basis.makeBasis(this.right.crossVectors(UP,this.targetNormal).normalize(),UP,this.targetNormal));
    this.tape.position.y=height/2;this.tape.scale.y=height;
    if(height!==this.lastHeight){
      // Crop a full-height ruler from zero; stretching its labels would lie about scale.
      const uv=this.tape.geometry.getAttribute('uv') as THREE.BufferAttribute;
      uv.setY(0,height/volume.height);uv.setY(1,height/volume.height);uv.setY(2,0);uv.setY(3,0);uv.needsUpdate=true;
      this.lastHeight=height;
    }
  }

  mark():boolean {
    const point=this.target;
    if(this.mode!=='ready'||!point||this.heightM===null||this.markRecords.length>=MAX_MARKS)return false;
    if(this.markRecords.some(mark=>mark.supported&&mark.normal.dot(this.targetNormal)>.99&&mark.point.distanceTo(point)<.025&&Math.abs(mark.heightM-this.heightM!)<.005))return false;
    const group=new THREE.Group();group.name=`Pencil height ${this.heightM.toFixed(2)} m`;group.position.copy(point);
    group.quaternion.copy(this.root.quaternion);
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=160;
    const ctx=canvas.getContext('2d');if(!ctx)return false;
    ctx.strokeStyle='#27231e';ctx.lineWidth=5;ctx.lineCap='round';
    // Slightly uneven graphite strokes, not a paint spot or a hole cutter.
    ctx.beginPath();ctx.moveTo(10,113);ctx.lineTo(65,111);ctx.lineTo(128,113);ctx.moveTo(69,85);ctx.lineTo(67,141);ctx.stroke();
    ctx.font='bold 53px Arial';ctx.fillStyle='#27231e';ctx.textBaseline='alphabetic';ctx.fillText(`${this.heightM.toFixed(2)} m`,155,126);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
    const stamp=new THREE.Mesh(new THREE.PlaneGeometry(.18,.05625),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,alphaTest:.03,polygonOffset:true,polygonOffsetFactor:-1}));
    // The graphite cross, rather than the text centre, identifies the measured point.
    stamp.position.set((256-68)/512*.18,(113-80)/160*.05625,.0002);
    stamp.raycast=()=>{};group.add(stamp);this.marksRoot.add(group);
    this.markRecords.push({id:`height-${this.markRecords.length+1}`,point:point.clone(),normal:this.targetNormal.clone(),stable:this.targetStable,heightM:this.heightM,group,supported:true});return true;
  }

  private refreshMarkSupport():void {
    const volume=this.wall.volume,now=performance.now();
    if(this.supportRevision===volume.surfaceRevision||now-this.lastSupportCheck<100)return;
    this.supportRevision=volume.surfaceRevision;this.lastSupportCheck=now;
    for(const mark of this.markRecords){
      if(mark.stable||!mark.supported)continue;
      const support=this.probe.copy(mark.point).addScaledVector(mark.normal,-FRONT_CLEARANCE-.002);
      if(!volume.isOccupied(support.x,support.y,support.z)){mark.supported=false;mark.group.visible=false;}
    }
  }

  get marks():readonly HeightReferenceMark[]{return this.markRecords.filter(mark=>mark.supported).map(({id,point,normal,stable,heightM})=>({id,point:point.clone(),normal:normal.clone(),stable,heightM}));}

  get telemetry(){const marks=this.marks;return{mode:this.mode,heightM:this.heightM,target:this.target?.toArray()??null,targetNormal:this.targetNormal.toArray(),targetStable:this.targetStable,visible:this.root.visible,count:marks.length,marks:marks.map(mark=>({id:mark.id,heightM:mark.heightM,point:mark.point.toArray(),normal:mark.normal.toArray(),stable:mark.stable}))};}
}
