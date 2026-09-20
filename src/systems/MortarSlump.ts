import * as THREE from 'three';

type Patch={x:number;z:number;rx:number;rz:number;height:number;grip:number;rest:number;eroded:number;sliding:boolean;offset:THREE.Vector2;velocity:THREE.Vector2};

/** Cohesive, yield-limited mortar patches. No wave oscillator or level plane. */
export class MortarSlump {
  revision=0;
  readonly patches:Patch[]=[];
  readonly displacement=new THREE.Vector2();
  readonly loadOffset=new THREE.Vector2();
  private readonly restCentre=new THREE.Vector2();
  private patchArea=1;
  private seed=1;
  private nextChunk=.7;
  private charge=0;
  private cooldown=0;
  constructor(seed=Math.random()*0xffffffff){this.reset(seed);}
  private random():number{this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
  reset(seed:number):void{
    this.seed=seed>>>0;this.patches.length=0;this.displacement.set(0,0);this.loadOffset.set(0,0);this.charge=this.cooldown=0;this.revision++;
    for(let z=0;z<4;z++)for(let x=0;x<3;x++)this.patches.push({x:(x-1)*.19+(this.random()-.5)*.05,z:(z-1.5)*.20+(this.random()-.5)*.05,rx:.10+this.random()*.045,rz:.11+this.random()*.07,height:.024+this.random()*.022,grip:.14+this.random()*.08,rest:1,eroded:0,sliding:false,offset:new THREE.Vector2(),velocity:new THREE.Vector2()});
    this.patchArea=this.patches.reduce((sum,p)=>sum+p.rx*p.rz,0);this.restCentre.set(0,0);for(const p of this.patches){this.restCentre.x+=p.x*p.rx*p.rz/this.patchArea;this.restCentre.y+=p.z*p.rx*p.rz/this.patchArea;}
    this.nextChunk=.35+this.random()*1.2;
  }
  update(dt:number,forceX:number,forceZ:number):void{
    this.displacement.set(0,0);this.loadOffset.set(0,0);let retainedWeight=0;
    for(const p of this.patches){
      const previousX=p.offset.x,previousZ=p.offset.y;
      // Local adhesion differs and rebuilds at rest. Plastic displacement stays
      // where it stopped; reversing the cart does not generate returning waves.
      const fx=forceX,fz=forceZ,stress=Math.hypot(fx,fz),threshold=p.grip*(p.sliding?.95:1)+p.rest*.035;
      if(stress>threshold){
        p.sliding=true;p.rest=Math.max(0,p.rest-dt*2.8);const rate=(stress-threshold)*8;
        p.velocity.x+=fx/stress*rate*dt;p.velocity.y+=fz/stress*rate*dt;
      }else{p.sliding=false;p.rest=Math.min(1,p.rest+dt*.22);}
      p.velocity.multiplyScalar(Math.exp(-(p.sliding?7:24)*dt));
      if(!p.sliding&&p.velocity.lengthSq()<1e-7)p.velocity.set(0,0);
      p.offset.addScaledVector(p.velocity,dt);p.offset.x=THREE.MathUtils.clamp(p.offset.x,-.16,.16);p.offset.y=THREE.MathUtils.clamp(p.offset.y,-.21,.21);
      if(p.offset.x!==previousX||p.offset.y!==previousZ)this.revision++;
      this.displacement.add(p.offset);
      const weight=p.rx*p.rz*(1-p.eroded);this.loadOffset.x+=(p.x+p.offset.x)*weight;this.loadOffset.y+=(p.z+p.offset.y)*weight;retainedWeight+=weight;
    }
    this.displacement.multiplyScalar(1/this.patches.length);this.loadOffset.multiplyScalar(1/Math.max(1e-8,retainedWeight)).sub(this.restCentre);this.cooldown=Math.max(0,this.cooldown-dt);
  }
  height(x:number,z:number):number{
    let h=0;
    for(const p of this.patches){
      const dx=(x-p.x-p.offset.x)/p.rx,dz=(z-p.z-p.offset.y)/p.rz,r=dx*dx+dz*dz;
      const sourceX=(x-p.x)/p.rx,sourceZ=(z-p.z)/p.rz;
      // Transport part of the bulk depth, not just the thin surface crests.
      // Equal-width source/destination kernels remove the same volume from the
      // uphill region that is added downhill, before rim shedding.
      const transported=.10*(Math.exp(-r*1.2)-Math.exp(-(sourceX*sourceX+sourceZ*sourceZ)*1.2));
      const shoulder=r*(1+.12*Math.sin(dx*4+dz*3)+.09*Math.sin(dz*6-dx*2));
      h+=(1-p.eroded)*(p.height*Math.exp(-shoulder*shoulder*1.8)+transported);
    }
    // Interrupted shovel furrows, not closed ripple rings. Their broken
    // shoulders retain the shape of deposited paste as the bulk moves.
    const px=x-this.displacement.x,pz=z-this.displacement.y;
    for(const [cx,cz] of [[-.1,-.18],[.11,.08],[-.04,.29]]){
      const along=(px-cx)/.12,across=(pz-cz-.2*(px-cx)-.01*Math.sin(px*34))/.022;
      h-=.012*Math.exp(-along*along*along*along-across*across);
    }
    return h;
  }
  shedAt(x:number,z:number,mass:number):void{
    const contribution=(p:Patch)=>(1-p.eroded)*(p.height+p.offset.length()*.28)*Math.exp(-1.3*(Math.pow((x-p.x-p.offset.x)/p.rx,2)+Math.pow((z-p.z-p.offset.y)/p.rz,2)));
    const p=this.patches.reduce((a,b)=>contribution(a)>contribution(b)?a:b);
    p.eroded=Math.min(.95,p.eroded+mass/(114*p.rx*p.rz/this.patchArea));this.revision++;
  }
  replenish(mass:number):void{for(const p of this.patches)p.eroded=Math.max(0,p.eroded-mass/114);}
  takeChunk(dt:number,overflow:number,inverted:boolean):number{
    // Accumulate stress, then break off an irregular cohesive piece. Calm
    // rims do not continuously leak a chain of tiny liquid droplets.
    if(!inverted&&overflow<=.004){this.charge=Math.max(0,this.charge-dt*4);return 0;}
    this.charge+=dt*(inverted?100:Math.max(0,overflow-.004)*180);
    if(this.cooldown>0||this.charge<this.nextChunk)return 0;
    const mass=inverted?Math.max(this.nextChunk,3+this.random()*3):this.nextChunk;
    this.charge=Math.max(0,this.charge-mass);this.nextChunk=inverted?3+this.random()*3:.35+this.random()*1.4;this.cooldown=inverted?.035+this.random()*.035:.09+this.random()*.19;
    return mass;
  }
  get telemetry(){return{patches:this.patches.map(p=>({offset:p.offset.toArray(),speed:p.velocity.length(),sliding:p.sliding})),displacement:this.displacement.toArray(),loadOffset:this.loadOffset.toArray()};}
}
