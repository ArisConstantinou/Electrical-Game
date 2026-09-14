import assert from 'node:assert/strict';
import { skipUnusedOceanBuoyancy } from '../src/systems/roomBuoyancyPolicy.js';

let count=0,calls=0,complete;
const water={underwater:{enabled:false},buoyancy:{getObjectCount:()=>count,async update(dt){assert.equal(this,water.buoyancy);assert.equal(dt,.02);calls++;await new Promise(resolve=>complete=resolve);}}};
skipUnusedOceanBuoyancy(water);
await water.buoyancy.update(.02);assert.equal(calls,0);
for(const [objects,underwater] of [[1,false],[0,true],[1,true]]){
 count=objects;water.underwater.enabled=underwater;
 let settled=false;const task=water.buoyancy.update(.02).then(()=>settled=true);
 await Promise.resolve();assert.equal(settled,false,'Active consumers must await the original readback');
 complete();await task;assert.equal(settled,true);
}
assert.equal(calls,3);count=0;water.underwater.enabled=false;await water.buoyancy.update(.02);assert.equal(calls,3);
console.log(JSON.stringify({passed:true,checks:['no consumers skips','floating object delegates','underwater delegates','delegated update remains awaited','returns to skipped mode']}));
