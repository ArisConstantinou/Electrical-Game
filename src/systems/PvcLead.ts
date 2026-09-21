/** Retrieval lead measured from the spring's trailing eye. No smoothing is
 * allowed across the pipe mouth: it would pull the hidden lead through PVC. */
export function springLeadPoint(distance:number,tail:number,pipePoint:(s:number)=>{x:number;y:number},down:{x:number;y:number;z:number},exitHeight:number):[number,number,number]{
  const inside=Math.max(0,tail);
  if(tail>=0&&distance<=inside){const p=pipePoint(inside-distance);return[p.x,-p.y,0];}
  let remaining=distance-inside,out=0,drop=0;
  const straight=.035,r=Math.min(.04,Math.max(.002,exitHeight/4)),arc=Math.PI*r/2;
  const first=Math.min(remaining,straight);out+=first;remaining-=first;
  if(remaining>0){const length=Math.min(remaining,arc),angle=length/r;out+=r*Math.sin(angle);drop+=r*(1-Math.cos(angle));remaining-=length;}
  if(remaining>0){const fall=Math.min(remaining,Math.max(0,exitHeight-.012-2*r));drop+=fall;remaining-=fall;}
  if(remaining>0){const length=Math.min(remaining,arc),angle=length/r;out+=r*(1-Math.cos(angle));drop+=r*Math.sin(angle);remaining-=length;}
  out+=remaining;
  return[Math.min(0,tail)-out+down.x*drop,down.y*drop,down.z*drop];
}
