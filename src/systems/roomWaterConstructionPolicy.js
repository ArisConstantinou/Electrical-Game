// These scopes belong to our compiled room component, not the vendor source.
// Factory initialization is fenced by Game.activateWaterPro/Renderer recovery.
const sprayScopes=new WeakMap(),renderScopes=new WeakMap();

export async function createFiniteRoomWater(WaterSystem,SpraySystem,renderer,scene,camera){
  let spray=sprayScopes.get(SpraySystem);
  if(!spray){
    spray={original:SpraySystem.tryCreate,owners:new WeakMap(),count:0};
    spray.wrapper=function(owner,...args){
      return spray.owners.has(owner)?null:spray.original.call(this,owner,...args);
    };
    sprayScopes.set(SpraySystem,spray);SpraySystem.tryCreate=spray.wrapper;
  }
  spray.count++;spray.owners.set(renderer,(spray.owners.get(renderer)??0)+1);
  let render=renderScopes.get(renderer);
  if(!render){
    render={original:renderer.render,targets:[]};
    render.wrapper=function(world,view,...args){
      if(render.targets.some(t=>t.scene===world&&t.camera===view))return;
      return render.original.call(this,world,view,...args);
    };
    renderScopes.set(renderer,render);renderer.render=render.wrapper;
  }
  const target={scene,camera};render.targets.push(target);
  try{
    // The room never registers ocean SpraySystem emitters: its real nozzle
    // droplets and iWave impact generator are separate. Even maxParticles=0
    // constructs the vendor's eight 2048px sprite layers, including synchronous
    // Canvas2D readbacks, so return its supported null capability instead.
    // Its factory's final capture uses temporary sunset/ocean settings. Skip
    // that unpublished capture; the first normal water.update captures the
    // fully configured finite room before drawing any optical colour frame.
    // FFT/compute and offscreen simulation scenes still execute normally.
    return await WaterSystem.create(renderer,scene,camera,'low',{deterministic:false});
  }finally{
    const owners=spray.owners.get(renderer)-1;
    if(owners)spray.owners.set(renderer,owners);else spray.owners.delete(renderer);
    if(--spray.count===0){
      if(SpraySystem.tryCreate===spray.wrapper)SpraySystem.tryCreate=spray.original;
      sprayScopes.delete(SpraySystem);
    }
    render.targets.splice(render.targets.indexOf(target),1);
    if(!render.targets.length){
      if(renderer.render===render.wrapper)renderer.render=render.original;
      renderScopes.delete(renderer);
    }
  }
}
