import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
const load=async file=>import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(await readFile(new URL('../src/systems/'+file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
const {springLeadPoint}=await load('PvcLead.ts'),{PvcBend}=await load('PvcBend.ts');
for(const mark of [.5,1.4])for(const angle of [0,45,90])for(const tail of [-.4,0,mark-.2]){
 const bend=new PvcBend(mark);bend.angles.fill(angle/16);const down={x:0,y:-Math.cos(.4),z:Math.sin(.4)},height=1.4;
 const point=d=>springLeadPoint(d,tail,s=>bend.at(s),down,height),inside=Math.max(0,tail);
 const anchor=tail>=0?bend.at(tail):{x:tail,y:0};assert(Math.hypot(point(0)[0]-anchor.x,point(0)[1]+anchor.y,point(0)[2])<1e-9);
 for(let s=0;s<inside;s+=.002){const expected=bend.at(inside-s);assert.deepEqual(point(s),[expected.x,-expected.y,0],'Lead follows internal bore exactly');}
 let length=0,previous=point(0);
 for(let i=1;i<=4000;i++){const p=point(i/2000);length+=Math.hypot(...p.map((x,j)=>x-previous[j]));assert(height+p.reduce((sum,x,j)=>sum+x*[0,Math.cos(.4),-Math.sin(.4)][j],0)>=.011,'Lead stays above floor');previous=p;}
 assert(Math.abs(length-2)<.0001,'Retrieval lead keeps its two metre length');
 assert(point(inside+.001)[0]<Math.min(0,tail),'Free lead exits the open end before dropping');
}console.log('PVC lead: internal route, attachment, mouth exit, floor contact and length passed');
