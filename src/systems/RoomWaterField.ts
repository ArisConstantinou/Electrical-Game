/** Conservative finite-volume shallow water over a closed room floor.
 * Face velocities carry momentum, so water keeps spreading after impact instead
 * of behaving like a slowly diffusing stain. Volumes are cubic metres internally. */
export class RoomWaterField {
  readonly columns=64;
  readonly rows=54;
  readonly depths=new Float64Array(this.columns*this.rows);
  readonly bed=new Float64Array(this.depths.length);
  readonly width=5.96;
  readonly depth=4.88;
  readonly minX=-2.98;
  readonly minZ=-2.39;
  readonly dx=this.width/this.columns;
  readonly dz=this.depth/this.rows;
  readonly area=this.dx*this.dz;
  receivedLitres=0;
  private accumulator=0;
  private readonly velocityX=new Float64Array(this.depths.length);
  private readonly velocityZ=new Float64Array(this.depths.length);
  private readonly fluxX=new Float64Array(this.depths.length);
  private readonly fluxZ=new Float64Array(this.depths.length);
  private readonly outgoing=new Float64Array(this.depths.length);
  private readonly change=new Float64Array(this.depths.length);
  constructor(){
    for(let y=0;y<this.rows;y++)for(let x=0;x<this.columns;x++){
      this.bed[y*this.columns+x]=.00045*(1+Math.sin(x*.37)*Math.cos(y*.31))+.0002*(1+Math.sin(x*.81+y*.59));
    }
  }
  indexAt(x:number,z:number):number{return Math.max(0,Math.min(this.rows-1,Math.floor((z-this.minZ)/this.dz)))*this.columns+Math.max(0,Math.min(this.columns-1,Math.floor((x-this.minX)/this.dx)));}
  add(x:number,z:number,litres:number):void{
    if(!Number.isFinite(litres)||litres<=0||!Number.isFinite(x)||!Number.isFinite(z))return;
    this.depths[this.indexAt(x,z)]+=litres/1000/this.area;this.receivedLitres+=litres;
  }
  update(dt:number):void{
    if(!Number.isFinite(dt)||dt<=0||this.receivedLitres===0)return;
    this.accumulator+=Math.min(dt,.5);
    while(this.accumulator>=1/120){this.accumulator-=1/120;this.flow(1/120);}
  }
  private flow(dt:number):void{
    const h=this.depths,bed=this.bed,out=this.outgoing,change=this.change;
    out.fill(0);change.fill(0);
    const face=(a:number,b:number,distance:number,velocities:Float64Array,flux:Float64Array)=>{
      const surfaceA=bed[a]+h[a],surfaceB=bed[b]+h[b];
      const faceDepth=Math.max(0,Math.max(surfaceA,surfaceB)-Math.max(bed[a],bed[b]));
      // Hydrostatic pressure accelerates existing flow; floor drag dissipates it.
      let velocity=(velocities[a]+9.81*(surfaceA-surfaceB)/distance*dt)*Math.exp(-dt*(.7+(.001/(faceDepth+.0001))));
      const maxVelocity=distance/dt*.4;
      velocity=Math.max(-maxVelocity,Math.min(maxVelocity,velocity));
      if(faceDepth<1e-8)velocity=0;
      velocities[a]=velocity;
      const donor=velocity>=0?a:b;
      const transportedDepth=Math.min(faceDepth,h[donor]);
      const amount=velocity*transportedDepth/distance*dt;
      flux[a]=amount;out[donor]+=Math.abs(amount);
    };
    for(let z=0;z<this.rows;z++)for(let x=0;x<this.columns;x++){
      const a=z*this.columns+x;
      if(x+1<this.columns)face(a,a+1,this.dx,this.velocityX,this.fluxX);
      if(z+1<this.rows)face(a,a+this.columns,this.dz,this.velocityZ,this.fluxZ);
    }
    const transfer=(a:number,b:number,amount:number)=>{
      const donor=amount>=0?a:b;
      // All outgoing faces share the donor's available water. This is positive
      // and conservative even during a high-flow gun pulse or a loaded flood.
      amount*=out[donor]>h[donor]?h[donor]/out[donor]*.999999:1;
      change[a]-=amount;change[b]+=amount;
    };
    for(let z=0;z<this.rows;z++)for(let x=0;x<this.columns;x++){
      const a=z*this.columns+x;
      if(x+1<this.columns)transfer(a,a+1,this.fluxX[a]);
      if(z+1<this.rows)transfer(a,a+this.columns,this.fluxZ[a]);
    }
    for(let a=0;a<h.length;a++)h[a]+=change[a];
  }
  surfaceAt(x:number,z:number):number{const i=this.indexAt(x,z);return this.bed[i]+this.depths[i];}
  get volumeLitres():number{let sum=0;for(const h of this.depths)sum+=h;return sum*this.area*1000;}
  get wetArea():number{let cells=0;for(const h of this.depths)if(h>.000015)cells++;return cells*this.area;}
  get maxDepth():number{return this.depths.reduce((a,b)=>Math.max(a,b),0);}
}
