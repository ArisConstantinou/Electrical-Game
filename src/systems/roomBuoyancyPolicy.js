/** The finite room owns submersion; stock ocean buoyancy has no consumer until
 * an object is registered or the stock underwater effect is enabled. Keep
 * its original awaited implementation available for either future use. */
export function skipUnusedOceanBuoyancy(water){
  const update=water.buoyancy.update.bind(water.buoyancy);
  water.buoyancy.update=async(dt)=>{
    if(water.buoyancy.getObjectCount()===0&&!water.underwater.enabled)return;
    await update(dt);
  };
}
