import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/systems/PvcBend.ts',import.meta.url),'utf8');
const {PvcBend,PVC}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
for(const mark of [.5,1.4,2.6]){
 const b=new PvcBend(mark);assert(!b.ready);
 for(let i=0;i<60;i++)b.press(1/60);assert.equal(b.angle,9,'One fixed hand position must saturate, never make an automatic full bend');
 for(let cell=1;cell<10;cell++){b.move(1);for(let i=0;i<30;i++)b.press(1/60);}
 assert(Math.abs(b.angle-90)<1e-6);assert(b.ready);assert(b.radius>.15);
 let length=0,previous=b.at(0);for(let i=1;i<=3000;i++){const p=b.at(i*.001);length+=Math.hypot(p.x-previous.x,p.y-previous.y);previous=p;}
 assert(Math.abs(length-PVC.length)<.00001,`Bending changes material length: ${length}`);
 assert(Math.abs(b.at(3).angle-Math.PI/2)<1e-6);assert(Math.abs(b.topHeight-b.at(3).x-.026)<1e-6);
 const copy=PvcBend.from(b.recipe());copy.undo();assert.notEqual(copy.angle,b.angle,'Batch copies may not alias the sample');
 for(let i=0;i<100;i++)b.move(-1);assert.equal(b.grip,0);
 for(let i=0;i<100;i++)b.move(1);assert.equal(b.grip,15);
}
console.log('PASS: progressive local bending, 90 degrees, conserved 3 m length, independent recipes, finite grip range');
