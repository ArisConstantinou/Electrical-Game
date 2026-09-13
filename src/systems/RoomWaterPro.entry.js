// Build input for this game's compiled Water Pro component. The licensed
// dependency stays outside the public repository; this file contains only our integration.
import { WaterSystem, WaterSurfaceMaterial, getPresetParams } from 'threejs-water-pro';
import { MeshBasicNodeMaterial, NormalBlending, Object3D } from 'three/webgpu';
import { attribute, positionLocal, vec3, vec4, clamp, smoothstep } from 'three/tsl';

export async function createRoomWater(renderer,scene,camera,room){
  const previous=new Set(scene.children),environment=scene.environment,background=scene.background,fog=scene.fog;
  const environmentNode=scene.environmentNode,backgroundNode=scene.backgroundNode;
  const water=await WaterSystem.create(renderer,scene,camera,'low',{deterministic:false});
  const preset=getPresetParams('arctic');
  preset.waves.fft.amplitude=.008;preset.waves.fft.windSpeed=.7;preset.waves.fft.peakWavelength=.28;preset.waves.fft.choppiness=.035;
  preset.waves.fft.cascades.maxScale=8;
  preset.foam.surface.enabled=false;preset.foam.waves.enabled=false;preset.foam.shoreline.enabled=false;
  preset.ssr.enabled=true;preset.spray.enabled=false;preset.fog.enabled=false;
  preset.postProcessing.underwater.enabled=false;preset.postProcessing.underwaterParticles.enabled=false;
  preset.oceanFloor.caustics.enabled=false;preset.oceanFloor.sunShafts.enabled=false;
  // Fresh hose water has no painted blue/grey surface. Water Pro's physical
  // model preserves the concrete seen through shallow water and derives the
  // deeper tint from optical path length rather than a constant RGB overlay.
  preset.color={mode:'physical',algae:0,silt:0,stain:0};
  preset.fresnel.surface.iorRatio=1.333;
  preset.fresnel.surface.refractionStrength=.012;
  water.loadPreset(preset);water.floor.setVisible(false);water.cameraTracking=false;water.setPosition(0,0);water.wake.enabled=false;
  water.foam.surface.enabled=false;water.foam.waves.enabled=false;water.foam.shoreline.enabled=false;water.ssr.enabled=true;
  water.ssr.maxDistance=8;water.ssr.stepCount=96;water.ssr.strength=.9;water.ssr.thickness=.003;water.sparkle.enabled=false;
  // A room must reflect its own scene, not Water Pro's default ocean sky.
  water.setSky(null);
  water.wake.resolution=128;water.wake.worldSize=8;water.wake.friction=2.5;
  water.wake.foamStrength=0;
  if(water.spray)water.spray.enabled=false;
  const owned=scene.children.filter(child=>!previous.has(child));
  let surface=null;
  for(const root of owned)root.traverse(object=>{
    if(object.isMesh&&object.material instanceof WaterSurfaceMaterial&&!surface)surface=object;
    else if(object.isMesh||object.isLight)object.visible=false;
  });
  if(!surface)throw new Error('Water Pro did not expose its documented WaterSurfaceMaterial mesh');
  // Keep Water Pro's optical simulation and depth captures, while replacing
  // its infinite ocean geometry by this room's finite conservative water grid.
  surface.geometry=room.surfaceGeometry;surface.frustumCulled=false;surface.name='Water Pro finite room flooding surface';
  surface.userData.waterPro={colorModel:'physical',impactWaves:false,wakeResolution:128};
  const waterMaterial=surface.material;
  const material=new MeshBasicNodeMaterial().copy(waterMaterial);
  material.onBeforeRender=()=>{};
  material.onBeforeCompile=()=>{};
  surface.material=material;
  const wetDepth=attribute('waterDepth');
  const rippleLimit=clamp(wetDepth.mul(.16),0,.006);
  // Vendor waterPositionNode already includes positionLocal.y. Subtract that
  // baseline before clamping the displacement, or a raised flood would pin
  // every vertex at the positive limit and silently stop the wave animation.
  const ripple=clamp(waterMaterial.waterPositionNode.y.sub(positionLocal.y),rippleLimit.negate(),rippleLimit);
  const finitePosition=vec3(positionLocal.x,positionLocal.y.add(ripple),positionLocal.z);
  // The optical shader already composites refracted scene colour. Only the
  // advancing sub-millimetre shoreline needs an alpha fade; double-blending
  // the whole surface would erase reflection and make a flood look like paint.
  const edgeAlpha=smoothstep(.000008,.0006,wetDepth);
  let lastOptics=null;
  const bindFiniteSurface=()=>{
    if(material.positionNode!==finitePosition||lastOptics!==waterMaterial.colorNode){material.positionNode=finitePosition;lastOptics=waterMaterial.colorNode;material.colorNode=vec4(lastOptics.rgb,1);material.opacityNode=edgeAlpha;material.needsUpdate=true;}
    waterMaterial.positionNode=finitePosition;
  };
  bindFiniteSurface();
  // Use the same bounded, depth-aware displacement for refraction's depth
  // capture as the visible mesh, including when the room fills above y=0.
  water.rendering.waterDepth.setPositionNode(finitePosition);
  material.transparent=true;material.depthWrite=false;material.blending=NormalBlending;material.premultipliedAlpha=false;material.alphaToCoverage=false;material.needsUpdate=true;
  room.group.remove(room.surface);
  // Water Pro's SpraySystem is a WebGPU-only waterline crossing billboard
  // effect, not an arbitrary hose emitter. Use its cross-backend iWave wake
  // solver for the gun's surface impact instead; the game's ballistic stream
  // supplies the actual collision point and accounts for every delivered litre.
  const impactSource=new Object3D();
  impactSource.name='Water Pro water-gun impact wave source';
  const impactId=water.wake.addGenerator(impactSource,{active:false,radius:.11,depth:.004,teleportThreshold:.7});
  let elapsed=0;
  const updateImpact=(dt)=>{
    elapsed+=dt;
    const jet=room.jetState,point=jet?.impactPoint;
    const impact=!!(jet?.active&&point&&jet.impactNormal?.y>.5&&room.field.depths[room.field.indexAt(point.x,point.z)]>.0006);
    water.wake.enabled=room.surface.visible;
    if(impact){
      // The impact footprint wanders a few mm as the stream breaks up. This
      // continuing physical agitation also feeds a stationary held nozzle.
      impactSource.position.copy(point);
      impactSource.position.x+=Math.sin(elapsed*31)*.012;
      impactSource.position.z+=Math.cos(elapsed*27)*.012;
      impactSource.updateMatrixWorld(true);
    }
    water.wake.updateGenerator(impactId,{active:impact,depth:Math.min(.012,.002+(jet?.flowLitresPerSecond??0)*.0015)});
    surface.userData.waterPro.impactWaves=impact;
  };
  scene.environment=environment;scene.background=background;scene.fog=fog;
  scene.environmentNode=environmentNode;scene.backgroundNode=backgroundNode;
  room.waterProActive=true;room.waterProBackend=water.backend;
  return{
    async update(dt){surface.visible=room.surface.visible;updateImpact(dt);await water.update(dt);bindFiniteSurface();},
    resize(width,height){water.resize(width,height);},
    dispose(){water.dispose();},
    backend:water.backend,
  };
}
