/** Conservative shallow floor flow. Volumes are cubic metres internally. */
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
  constructor(){
    for(let y=0;y<this.rows;y++)for(let x=0;x<this.columns;x++){
      // Millimetre-scale unfinished floor roughness creates connected puddles.
      this.bed[y*this.columns+x]=.00045*(1+Math.sin(x*.37)*Math.cos(y*.31))+.0002*(1+Math.sin(x*.81+y*.59));
    }
  }
  indexAt(x:number,z:number):number{return Math.max(0,Math.min(this.rows-1,Math.floor((z-this.minZ)/this.dz)))*this.columns+Math.max(0,Math.min(this.columns-1,Math.floor((x-this.minX)/this.dx)));}
  add(x:number,z:number,litres:number):void{
    if(!Number.isFinite(litres)||litres<=0)return;
    this.depths[this.indexAt(x,z)]+=litres/1000/this.area;this.receivedLitres+=litres;
  }
  update(dt:number):void{
    this.accumulator+=Math.max(0,Math.min(dt,.5));
    while(this.accumulator>=1/30){this.accumulator-=1/30;this.flow(1/30);}
  }
  private flow(dt:number):void{
    // Pair transfers share an equal opposite volume. Donor limiting prevents
    // negative depth; closed perimeter preserves water during room flooding.
    const pair=(a:number,b:number)=>{
      const difference=this.bed[a]+this.depths[a]-this.bed[b]-this.depths[b];
      if(Math.abs(difference)<1e-9)return;
      const donor=difference>0?a:b,receiver=difference>0?b:a;
      const speed=Math.min(.24,dt*(3+20*Math.sqrt(Math.max(this.depths[a],this.depths[b]))));
      const transfer=Math.min(this.depths[donor]*.24,Math.abs(difference)*speed);
      this.depths[donor]-=transfer;this.depths[receiver]+=transfer;
    };
    for(let z=0;z<this.rows;z++)for(let x=0;x<this.columns;x++){
      const a=z*this.columns+x;if(x+1<this.columns)pair(a,a+1);if(z+1<this.rows)pair(a,a+this.columns);
    }
  }
  surfaceAt(x:number,z:number):number{const i=this.indexAt(x,z);return this.bed[i]+this.depths[i];}
  get volumeLitres():number{let sum=0;for(const h of this.depths)sum+=h;return sum*this.area*1000;}
  get wetArea():number{let cells=0;for(const h of this.depths)if(h>.000015)cells++;return cells*this.area;}
  get maxDepth():number{return this.depths.reduce((a,b)=>Math.max(a,b),0);}
}
