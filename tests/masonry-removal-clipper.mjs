import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'error'});
try {
 const {createRemovalClipper,clippedTetra,CORNERS,TETRA}=await server.ssrLoadModule('/src/world/masonryMesher.ts');
 let count=0,maxVolumeError=0,triangleChecks=0;
 const faceKeys=faces=>faces.map(face=>[...new Set(face.map(p=>[p.x,p.y,p.z].map(v=>v.toFixed(11)).join(',')))].sort().join(';')).sort();
 for(const scale of [[.008,.008,.18/23],[.005,.007,.012],[.015,.01,.01]]) {
  const clip=createRemovalClipper();
  for(let position=0;position<40;position++)for(let orientation=0;orientation<6;orientation++)for(let mask=0;mask<81;mask++) {
   let bits=mask;const before=[],after=[];for(let i=0;i<4;i++){const state=bits%3;bits=Math.floor(bits/3);before.push(Number(state>0));after.push(Number(state===2));}
   const origin=[-.75+position*.007,1.25+position*.011,-2.4-position*.003];
   const points=TETRA[orientation].map(i=>({x:origin[0]+CORNERS[i][0]*scale[0],y:origin[1]+CORNERS[i][1]*scale[1],z:origin[2]-CORNERS[i][2]*scale[2]}));
   const a=clippedTetra(points,before,after),b=clip(points,before,after,orientation);
   assert.deepEqual(faceKeys(b.faces),faceKeys(a.faces),`faces differ at ${scale}/${position}/${orientation}/${mask}`);
   const error=Math.abs(a.volume-b.volume);maxVolumeError=Math.max(maxVolumeError,error);assert(error<1e-18,`mass differs ${error}`);count++;
   if(b.volume>1e-15){
    const all=b.faces.flat(),center={x:0,y:0,z:0};for(const p of all){center.x+=p.x/all.length;center.y+=p.y/all.length;center.z+=p.z/all.length;}
    const edges=new Map();let area=0;
    const key=p=>[p.x,p.y,p.z].map(v=>v.toFixed(11)).join(',');
    const normal=(a,b,c)=>({x:(b.y-a.y)*(c.z-a.z)-(b.z-a.z)*(c.y-a.y),y:(b.z-a.z)*(c.x-a.x)-(b.x-a.x)*(c.z-a.z),z:(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)});
    for(let i=0;i<b.triangles.length;i+=3){
     const p=b.triangles.slice(i,i+3),n=normal(...p);area+=Math.hypot(n.x,n.y,n.z)*.5;
     assert(n.x*(p[0].x-center.x)+n.y*(p[0].y-center.y)+n.z*(p[0].z-center.z)>-1e-16,'fragment face winding turned inward');
     for(let edge=0;edge<3;edge++){const a=key(p[edge]),b=key(p[(edge+1)%3]),id=a<b?`${a};${b}`:`${b};${a}`;edges.set(id,(edges.get(id)??0)+(a<b?1:-1));}
     triangleChecks++;
    }
    assert([...edges.values()].every(n=>n===0),'fragment boundary has a crack or inconsistent winding');
    let expectedArea=0;for(const face of a.faces)for(let i=1;i<face.length-1;i++){const n=normal(face[0],face[i],face[i+1]);expectedArea+=Math.hypot(n.x,n.y,n.z)*.5;}
    assert(Math.abs(expectedArea-area)<1e-13,'cached triangles do not cover the original facets');
   }
  }
 }
 const report={passed:true,comparisons:count,triangleChecks,maxVolumeError};
 await mkdir('output/masonry-removal-clipper',{recursive:true});await writeFile('output/masonry-removal-clipper/report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
} finally{await server.close();}
