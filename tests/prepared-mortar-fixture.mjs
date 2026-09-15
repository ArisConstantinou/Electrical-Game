/** Explicit finite batch for legacy wall-trowel regressions only. */
export const prepareFinishedMortar = page => page.evaluate(() => {
  const mixing=window.__wireTheHouse.mixing,batch=mixing.batch;
  batch.addWater(20/3);batch.openSack(0);
  for(let i=0;i<6;i++){batch.scoopCement(0);batch.pour('trowel');}
  for(let i=0;i<12;i++){batch.scoopSand();batch.pour('shovel');}
  batch.mix(8);mixing.finished=true;mixing.customSupply=true;mixing.active=false;
});
