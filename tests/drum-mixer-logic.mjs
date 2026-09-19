import assert from 'node:assert/strict';
import {build} from 'esbuild';
await build({stdin:{contents:"export {MortarBatch} from './src/systems/MortarBatch.ts';export {DrumMixer} from './src/systems/DrumMixer.ts';export {createConcreteMixer} from './src/world/SiteEquipmentModels.ts';",resolveDir:process.cwd()},outfile:'output/drum-mixer-logic.mjs',bundle:true,format:'esm',platform:'node'});
const {MortarBatch,DrumMixer,createConcreteMixer}=await import('../output/drum-mixer-logic.mjs');
const pantry=new MortarBatch(),drum=new DrumMixer(createConcreteMixer());
assert.equal(drum.batch.capacityLitres,60);assert.equal(drum.batch.getState().initialStockKg,0);
drum.toggle();drum.update(10);assert.equal(drum.batch.mixProgress,0,'Empty rotation cannot create mortar');drum.toggle();
for(let i=0;i<4;i++)assert.equal(drum.batch.addWater(5),5);
pantry.openSack(0);for(let i=0;i<18;i++){assert(pantry.scoopCement(0));assert(pantry.pour('trowel',drum.batch));}
for(let i=0;i<36;i++){assert(pantry.scoopSand());assert(pantry.pour('shovel',drum.batch));}
assert.equal(pantry.massKg,0);assert.equal(drum.batch.quality,'unmixed');
const stocks=pantry.getState(),contents=drum.batch.getState();
assert(Math.abs(stocks.transferredKg-contents.receivedKg)<1e-8);
assert(Math.abs(stocks.sacks.reduce((n,s)=>n+s.remainingKg,0)+stocks.sandRemainingKg+contents.massKg-contents.addedWaterLitres-stocks.initialStockKg)<1e-8,'Shared stock is conserved across both vessels');
drum.toggle();drum.update(8);assert.equal(drum.batch.ready,true);assert.equal(drum.ready,false,'Do not take mortar from a running drum');drum.toggle();assert(drum.ready);assert.equal(drum.batch.quality,'balanced');
const snapshots=[];for(const kg of [0,1,20,50]){if(kg)drum.batch.consumeKg(kg);const t=performance.now();drum.present();const m=drum.model.getObjectByName('drum-contained-ingredients'),p=m.geometry.getAttribute('position');assert(Array.from(p.array).every(Number.isFinite));assert(p.count>0);snapshots.push({litres:drum.batch.volumeLitres,vertices:p.count,ms:performance.now()-t});}
drum.batch.consumeKg(1e6);drum.present();assert.equal(drum.model.getObjectByName('drum-contained-ingredients').visible,false);
const full=new MortarBatch({capacityLitres:1,sandKg:0,sackKg:0});full.addWater(1);pantry.scoopSand();const load=pantry.getState().heldShovel;assert.equal(pantry.pour('shovel',full),false);assert.deepEqual(pantry.getState().heldShovel,load,'Rejected transfer retains the source load');
console.log(JSON.stringify({passed:true,snapshots}));
