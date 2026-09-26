export interface JumpPose {
  phase:'grounded'|'takeoff'|'rising'|'falling'|'landing';
  balance:number;
  tuck:number;
  compression:number;
}
const smooth=(v:number)=>{v=Math.max(0,Math.min(1,v));return v*v*(3-2*v);};

/** A short construction-worker jump, driven by the physical flight/landing.
 * The same envelope moves the pelvis, knees, free arms and carried objects. */
export class JumpMotion {
  readonly pose:JumpPose={phase:'grounded',balance:0,tuck:0,compression:0};
  private flightTime=0;
  private landingTime=1;
  private wasAirborne=false;
  update(dt:number,airborne:boolean,velocity:number,preparation:number):void {
    if(airborne){
      this.flightTime=this.wasAirborne?this.flightTime+dt:dt;
      this.landingTime=0;
      this.pose.phase=velocity>0?'rising':'falling';
      this.pose.balance=smooth(this.flightTime/.13)*(velocity<0?.78+.22*smooth((velocity+3.8)/3.8):1);
      this.pose.tuck=smooth(this.flightTime/.12)*(1-smooth((-velocity-.4)/3.2));
      this.pose.compression=0;
    }else if(preparation>0){
      this.pose.phase='takeoff';this.pose.balance=-.16*Math.sin(preparation*Math.PI);
      this.pose.tuck=0;this.pose.compression=Math.sin(preparation*Math.PI)*.085;
    }else{
      this.landingTime=this.wasAirborne?0:this.landingTime+dt;
      const t=Math.min(1,this.landingTime/.28);
      this.pose.phase=t<1?'landing':'grounded';
      this.pose.balance=.78*(1-smooth(t));this.pose.tuck=0;
      this.pose.compression=t<1?.13*Math.sin(Math.PI*t)*(1-t*.35):0;
    }
    this.wasAirborne=airborne;
  }
}
