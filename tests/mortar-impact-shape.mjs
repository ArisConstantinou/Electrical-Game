import assert from 'node:assert/strict';
import * as THREE from 'three';
import {MortarField} from '../src/systems/MortarField.ts';
import {mortarImpactFootprint} from '../src/systems/MortarImpact.ts';

const normal=new THREE.Vector3(0,0,1);
const slow=mortarImpactFootprint(new THREE.Vector3(0,0,-2),normal,0);
const fast=mortarImpactFootprint(new THREE.Vector3(0,0,-8),normal,0);
const glancing=mortarImpactFootprint(new THREE.Vector3(6,2,-2),normal,2);
assert(fast.majorScale*fast.minorScale>slow.majorScale*slow.minorScale*1.45,'Greater collision speed must flatten a wider footprint');
assert(glancing.majorScale/glancing.minorScale>fast.majorScale/fast.minorScale*1.65,'Glancing impact must smear more strongly than a direct hit');
assert(Math.abs(glancing.rotationRadians-Math.atan2(2,6))<1e-8,'Smear must follow tangential collision travel');
assert.notEqual(glancing.edgePhase,mortarImpactFootprint(new THREE.Vector3(6,2,-2),normal,3).edgePhase,'Successive throws need different torn edges');

function stamp(velocity,variation){
  const field=new MortarField(),impact=mortarImpactFootprint(velocity,normal,variation);
  const retained=field.add(new THREE.Vector3(0,1,0),normal,.65,()=>false,{frontZ:0,supportZ:()=>-.03,impact},.65);
  assert(retained>.5,'Collision footprint must retain the supplied mortar in backed space');
  const points=[...field.nodes.values()].filter(node=>node.value>=.35).map(node=>[node.x*field.spacing,node.y*field.spacing]);
  const mean=points.reduce((sum,p)=>[sum[0]+p[0]/points.length,sum[1]+p[1]/points.length],[0,0]);
  let xx=0,yy=0,xy=0;for(const p of points){const x=p[0]-mean[0],y=p[1]-mean[1];xx+=x*x;yy+=y*y;xy+=x*y;}xx/=points.length;yy/=points.length;xy/=points.length;
  const root=Math.sqrt((xx-yy)**2+4*xy*xy),major=(xx+yy+root)/2,minor=(xx+yy-root)/2;
  return{field,points,ratio:Math.sqrt(major/Math.max(1e-12,minor)),keys:new Set(field.nodes.keys())};
}
const direct=stamp(new THREE.Vector3(0,0,-8),0),oblique=stamp(new THREE.Vector3(6,2,-2),2),variant=stamp(new THREE.Vector3(6,2,-2),3);
assert(oblique.ratio>direct.ratio*1.25,'Authoritative collision field must preserve the oblique smear');
assert([...oblique.keys].some(key=>!variant.keys.has(key))&&[...variant.keys].some(key=>!oblique.keys.has(key)),'Successive impacts must not stamp an identical field outline');

console.log(JSON.stringify({passed:true,slow,fast,glancing,directRatio:direct.ratio,obliqueRatio:oblique.ratio,obliqueNodes:oblique.points.length,variantNodes:variant.points.length}));
