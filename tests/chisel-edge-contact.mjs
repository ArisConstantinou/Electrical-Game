import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const url=process.argv[2]??'http://127.0.0.1:5365/Electrical-Game/';
const out=process.argv[3]??'output/chisel-edge-contact';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse);
  const result=await page.evaluate(()=>{
    const g=window.__wireTheHouse,w=g.room.brickWall,v=w.volume,c=g.renderer.camera;
    const original=v.raycast;w.chiselTiltDegrees=0;w.chiselSideDegrees=0;
    c.position.set(.8,1.65,-1.4);c.lookAt(.8,1.5,v.frontZ);c.updateMatrixWorld(true);
    g.started=true;g.selectTool('hammer');g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;
    for(let i=0;i<150;i++)g.step(1/60);
    // An analytical 16 mm opening with surviving backing 60 mm behind it.
    // Production rig, blade vertices, edge sweep and chosen contacts are untouched.
    v.raycast=(origin,direction,max)=>{
      if(direction.z>=0)return null;
      const frontT=(v.frontZ-origin.z)/direction.z;
      const x=origin.x+direction.x*frontT;
      const z=Math.abs(x-.8)<.008?v.frontZ-.06:v.frontZ;
      const distance=(z-origin.z)/direction.z;
      return distance>=0&&distance<=max?{point:origin.clone().addScaledVector(direction,distance),normal:{x:0,y:0,z:1},distance,material:1}:null;
    };
    const read=(width,roll=0,type='flat')=>{
      w.chiselWidthM=width;w.chiselEdgeAngle=roll;w.chiselType=type;
      let hit;for(let i=0;i<60;i++)hit=g.fpsRig.contact(c,w);const tip=g.fpsRig.chiselTipWorld.clone();
      if(!hit)throw new Error(`Analytical contact ${width}/${roll}: ${JSON.stringify(g.fpsRig.hammerFit)}`);
      const blade=g.fpsRig.flatTip;
      const left=blade.localToWorld(tip.clone().set(-.025,0,-.05));
      const right=blade.localToWorld(tip.clone().set(.025,0,-.05));
      return{width,roll,type,point:hit.point.toArray(),center:tip.toArray(),offset:hit.bladeOffsetM,depth:v.frontZ-hit.point.z,measuredWidth:left.distanceTo(right),contactError:tip.addScaledVector(hit.edge,hit.bladeOffsetM).distanceTo(hit.point)};
    };
    try{return{narrow:read(.01),wide:read(.05),rotated:read(.05,Math.PI/2),pointed:read(.05,0,'pointed')};}
    finally{v.raycast=original;}
  });
  assert(Math.abs(result.narrow.depth-.06)<1e-6,'Narrow blade should enter the opening');
  assert(Math.abs(result.wide.depth)<1e-6,'Wide blade edge must stop on the outer shell');
  assert(Math.abs(result.wide.offset)>.008&&Math.abs(result.wide.offset)<=.025,'Contact must be on the real cutting edge');
  assert(Math.abs(result.wide.measuredWidth-.05)<1e-6,'Actual world blade must be exactly 5cm');
  assert(Math.abs(result.rotated.depth-.06)<1e-6,'Rotating the blade should change whether it fits through the slot');
  assert(Math.abs(result.pointed.depth-.06)<1e-6,'Pointed bit must not inherit flat width');
  for(const hit of Object.values(result))assert(hit.contactError<1e-8);
  assert.deepEqual(errors,[]);await writeFile(out+'/report.json',JSON.stringify({url,result,errors},null,2));
  console.log('PASS: 5cm edge stops at a 16mm opening; narrow, rotated and pointed bits fit.');
}finally{await browser.close();}
