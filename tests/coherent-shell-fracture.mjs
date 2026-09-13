import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'error'});
const report=[];
try {
  const {MasonryVolume}=await server.ssrLoadModule('/src/world/MasonryVolume.ts');
  for(const seed of [1234,193187,8721])for(const angle of [15,35,55]){
    const wall=new MasonryVolume({seed}),a=angle*Math.PI/180,direction={x:0,y:-Math.sin(a),z:-Math.cos(a)},pieces=[];
    for(let blow=0;blow<16;blow++){
      const entry={x:.72+blow*.006,y:1.55,z:wall.frontZ};
      const origin={x:entry.x,y:entry.y-direction.y*.3,z:entry.z-direction.z*.3};
      const hit=wall.raycast(origin,direction,.65);if(!hit)continue;
      const result=wall.impact({point:hit.point,direction,edge:{x:1,y:0,z:0},energyJ:4,widthM:.05,chisel:'flat'});
      if(blow===0&&result.bounds)assert(result.bounds.min.z>wall.frontZ-.09,'A front-shell blow cannot damage the hidden second bay');
      for(const f of result.fragments){
        const dimensions=[f.size.x,f.size.y,f.size.z].sort((a,b)=>b-a);
        // Span alone used to count almost weightless needles as "large" pieces.
        const substantial=dimensions[0]>=.055&&dimensions[1]>=.035&&f.volume>=.000045;
        let meshVolume=0;const p=f.positions;
        for(let i=0;i<p.length;i+=9)meshVolume+=(p[i]*(p[i+4]*p[i+8]-p[i+5]*p[i+7])+p[i+1]*(p[i+5]*p[i+6]-p[i+3]*p[i+8])+p[i+2]*(p[i+3]*p[i+7]-p[i+4]*p[i+6]))/6;
        assert(Math.abs(Math.abs(meshVolume)-f.volume)<Math.max(1e-12,f.volume*.0001),'A large piece must contain exactly its removed material');
        pieces.push({volume:f.volume,dimensions,substantial,detached:f.detached});
      }
    }
    const large=pieces.filter(p=>p.substantial),massFraction=large.reduce((sum,p)=>sum+p.volume,0)/wall.removedVolume;
    assert(large.length>=3,`${seed}/${angle}: need repeated substantial plates, not an occasional long sliver`);
    assert(massFraction>.4,`${seed}/${angle}: substantial pieces must represent a visible share of removed material`);
    assert(pieces.some(p=>p.volume<.000008),'Small chips must remain alongside plates');
    assert(Math.abs(pieces.reduce((s,p)=>s+p.volume,0)-wall.removedVolume)<1e-10);
    report.push({seed,angle,substantialPieces:large.length,massFraction,largestCm3:Math.max(...pieces.map(p=>p.volume))*1e6,dimensionsCm:large.map(p=>p.dimensions.map(d=>d*100))});
  }
  console.log(JSON.stringify(report.map(({seed,angle,substantialPieces,massFraction,largestCm3})=>({seed,angle,substantialPieces,massFraction,largestCm3})),null,2));
} finally {await mkdir('output/coherent-shell',{recursive:true});await writeFile('output/coherent-shell/report.json',JSON.stringify(report,null,2));await server.close();}
