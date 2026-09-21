/** Material-space centreline. Each cell is a short circular arc, not a hinge.
 * Arc length is invariant; the spring protects a 40 cm region around the mark.
 * Limits are gameplay parameters, not structural/regulatory certification. */
export const PVC = { count:20, length:3, diameter:.02, springLength:.4, cableLength:2, cell:.025, cells:16, maxCellDegrees:12, tolerance:2 } as const;
export interface PipeRecipe { mark:number; angles:number[] }
export class PvcBend {
  readonly angles = Array<number>(PVC.cells).fill(0);
  grip=0;
  revision=0;
  constructor(public mark=.5){}
  get angle():number{return this.angles.reduce((a,b)=>a+b,0);}
  get radius():number|null{const max=Math.max(...this.angles);return max>0?PVC.cell/(max*Math.PI/180):null;}
  get ready():boolean{return Math.abs(this.angle-90)<=PVC.tolerance&&this.angles.filter(a=>a>1).length>=8;}
  get gripS():number{return this.mark-PVC.springLength/2+(this.grip+.5)*PVC.cell;}
  move(direction:number):void{this.grip=Math.max(0,Math.min(PVC.cells-1,this.grip+Math.sign(direction)));}
  press(seconds:number):boolean{
    if(!Number.isFinite(seconds)||seconds<=0)return false;
    const old=this.angles[this.grip];
    this.angles[this.grip]=Math.min(PVC.maxCellDegrees,old+Math.min(seconds,.05)*24,old+Math.max(0,90-this.angle));
    if(this.angles[this.grip]===old)return false;
    this.revision++;return true;
  }
  undo():void{this.angles[this.grip]=Math.max(0,this.angles[this.grip]-1);this.revision++;}
  recipe():PipeRecipe{return{mark:this.mark,angles:[...this.angles]};}
  static from(recipe:PipeRecipe):PvcBend{const bend=new PvcBend(recipe.mark);bend.angles.splice(0,PVC.cells,...recipe.angles);return bend;}
  /** Exact arc integration at material distance s. X starts along the pipe. */
  at(s:number):{x:number;y:number;angle:number}{
    s=Math.max(0,Math.min(PVC.length,s));
    const start=this.mark-PVC.springLength/2;
    let x=Math.min(s,start),y=0,angle=0,remaining=Math.max(0,s-start);
    for(let i=0;i<PVC.cells&&remaining>0;i++){
      const length=Math.min(PVC.cell,remaining),k=this.angles[i]*Math.PI/180/PVC.cell;
      if(k>1e-9){x+=(Math.sin(angle+k*length)-Math.sin(angle))/k;y+=(Math.cos(angle)-Math.cos(angle+k*length))/k;}
      else{x+=Math.cos(angle)*length;y+=Math.sin(angle)*length;}
      angle+=k*length;remaining-=length;
    }
    if(remaining>0){x+=Math.cos(angle)*remaining;y+=Math.sin(angle)*remaining;}
    return{x,y,angle};
  }
  get topHeight():number{
    // Height is set by the end of the protected bend. A near-90 tail can be
    // inspected but only a floor-compatible tail may finally be installed.
    return this.at(this.mark+PVC.springLength/2).x+.026;
  }
}
