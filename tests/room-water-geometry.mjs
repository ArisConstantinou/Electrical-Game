import {build} from 'esbuild';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const compiled=await build({entryPoints:['src/systems/RoomWaterSystem.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {RoomWaterSystem}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const water=new RoomWaterSystem(new THREE.Scene(),{volume:{raycast:()=>null}});

// Independent original reconstruction, including edge truncation and triangle
// winding. Optimization must retain the actual mesh and Gaussian shore fade.
function reference(f){
 const n=(f.columns+1)*(f.rows+1),positions=new Float32Array(n*3),depths=new Float32Array(n),indices=[];
 let visible=false;
 for(let z=0;z<=f.rows;z++)for(let x=0;x<=f.columns;x++){
  let height=0,depth=0,count=0,optical=0,weight=0;
  for(const dz of [-1,0])for(const dx of [-1,0])if(x+dx>=0&&x+dx<f.columns&&z+dz>=0&&z+dz<f.rows){const i=(z+dz)*f.columns+x+dx;height+=f.bed[i]+f.depths[i];depth+=f.depths[i];count++;}
  for(let dz=-2;dz<=1;dz++)for(let dx=-2;dx<=1;dx++)if(x+dx>=0&&x+dx<f.columns&&z+dz>=0&&z+dz<f.rows){const w=Math.exp(-((dx+.5)**2+(dz+.5)**2)/1.1);optical+=f.depths[(z+dz)*f.columns+x+dx]*w;weight+=w;}
  const v=z*(f.columns+1)+x;positions.set([f.minX+x*f.dx,Math.max(.0002,height/count),f.minZ+z*f.dz],v*3);depths[v]=optical/weight;visible ||= depth>.000003;
 }
 for(let z=0;z<f.rows;z++)for(let x=0;x<f.columns;x++){const a=z*(f.columns+1)+x;indices.push(a,a+f.columns+1,a+1,a+1,a+f.columns+1,a+f.columns+2);}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
 return{positions,depths,indices:Uint32Array.from(indices),normals:geometry.getAttribute('normal').array,visible};
}
const cases=[];
function verify(label){
 const expected=reference(water.field),actual=water.surfaceGeometry;
 assert.deepEqual(actual.getAttribute('position').array,expected.positions,`${label}: physical surface positions`);
 assert.deepEqual(actual.getAttribute('waterDepth').array,expected.depths,`${label}: optical shore depth`);
 assert.deepEqual(actual.index.array,expected.indices,`${label}: fixed topology`);
 assert.deepEqual(actual.getAttribute('normal').array,expected.normals,`${label}: physical normals`);
 assert.equal(water.surface.visible,expected.visible);assert.equal(actual.drawRange.count,expected.visible?expected.indices.length:0);
 cases.push(label);
}
verify('dry construction');
const initialPositionVersion=water.surfaceGeometry.getAttribute('position').version,indexVersion=water.surfaceGeometry.index.version;
for(let i=0;i<180;i++)water.update(1/60);
assert.equal(water.surfaceGeometry.getAttribute('position').version,initialPositionVersion,'pristine dry floor must not rebuild or upload identical geometry');
for(const [label,x,z,litres] of [['corner puddle',-2.979,-2.389,.1],['opposite edge',2.979,2.489,.4],['interior puddle',-.7,.9,3],['flood',0,0,1500]]){
 water.addFloorWater(x,z,litres);water.update(.05);verify(label);
 for(let i=0;i<60;i++)water.update(1/60);water.rebuildGeometry();verify(`${label} spread`);
 assert.ok(Math.abs(water.telemetry.conservationErrorLitres)<1e-8,`${label}: exact volume conserved`);
 assert.equal(water.surfaceGeometry.index.version,indexVersion,'static topology must never be re-uploaded');
}
console.log(JSON.stringify({passed:true,cases,vertices:water.surfaceGeometry.getAttribute('position').count,dryRebuilds:0,conservationErrorLitres:water.telemetry.conservationErrorLitres}));
