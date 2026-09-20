import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
try {
  const {MissionSystem}=await server.ssrLoadModule('/src/systems/MissionSystem.ts');
  const mission=new MissionSystem(new THREE.Scene()),shared=mission.points;
  mission.boxPreset='2G+1G';
  const first=mission.placementCandidate();assert.equal(first.definition.id,'A');first.boxGroup.visible=true;first.setStage('fitted');mission.select(first);
  const progressBefore=mission.progress;const second=mission.placementCandidate();assert.equal(mission.progress,progressBefore,'An unused extra does not add a mission obligation');assert.notEqual(first,second);assert.equal(mission.placementCandidate(),second,'Failed/unused placement must reuse the same candidate');
  second.boxGroup.visible=true;second.setStage('fitted');mission.select(second);
  mission.boxPreset='1G';const single=mission.placementCandidate();assert.deepEqual(single.definition.boxes,['1G']);single.boxGroup.visible=true;single.setStage('fitted');
  mission.select(first);assert.equal(mission.activePoint,first,'Selecting a previous unfinished box works');
  assert.equal(mission.points,shared,'Physics and mortar retain this array reference');
  assert.equal(mission.complete,false);first.setStage('complete');assert.notEqual(mission.activePoint,first,'Completing a selected box continues the mission');
  second.boxGroup.visible=false;mission.boxPreset='2G+1G';assert.equal(mission.placementCandidate(),second,'Retrieved matching group is reused');second.boxGroup.visible=true;
  while(mission.points.filter(p=>p.boxGroup.visible).length<24){const p=mission.placementCandidate();p.boxGroup.visible=true;p.setStage('fitted');}
  assert.equal(mission.placementCandidate(),null,'Bounded visible supply');
  assert.equal(new Set(mission.points.map(p=>p.definition.id)).size,mission.points.length,'Stable IDs remain unique');
  for(const p of mission.points)p.setStage('complete');assert.equal(mission.complete,true);assert.equal(mission.activePoint,null);assert.equal(mission.progress,100);
  console.log(JSON.stringify({suite:'multiple-box-mission',passed:true,sharedArray:true,uniqueIds:true,independentSelection:true,reusableSupply:true,visibleLimit:24,completion:true}));
} finally {await server.close();}
