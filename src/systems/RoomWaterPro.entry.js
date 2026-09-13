// Build input for this game's compiled Water Pro component. The licensed
// dependency stays outside the public repository; this file contains only our integration.
import { WaterSystem, WaterSurfaceMaterial, getPresetParams } from 'threejs-water-pro';
import { MeshBasicNodeMaterial, NormalBlending } from 'three/webgpu';
import { attribute, positionLocal, vec3, vec4, clamp, smoothstep } from 'three/tsl';

export async function createRoomWater(renderer,scene,camera,room){
  const previous=new Set(scene.children),environment=scene.environment,background=scene.background,fog=scene.fog;
  const water=await WaterSystem.create(renderer,scene,camera,'low',{deterministic:false});
  const preset=getPresetParams('arctic');
  preset.waves.fft.amplitude=.004;preset.waves.fft.windSpeed=.7;preset.waves.fft.peakWavelength=.22;preset.waves.fft.choppiness=.06;
  preset.waves.fft.cascades.maxScale=8;
  preset.foam.surface.enabled=false;preset.foam.waves.enabled=false;preset.foam.shoreline.enabled=false;
  preset.ssr.enabled=true;preset.spray.enabled=false;preset.fog.enabled=false;
  preset.postProcessing.underwater.enabled=false;preset.postProcessing.underwaterParticles.enabled=false;
  preset.oceanFloor.caustics.enabled=false;preset.oceanFloor.sunShafts.enabled=false;
  preset.color={mode:'custom',waterColor:'#759994',transmissionColor:'#e2f0e9',absorptionColor:'#574934'};
  preset.fresnel.surface.refractionStrength=.035;
  water.loadPreset(preset);water.floor.setVisible(false);water.cameraTracking=false;water.setPosition(0,0);water.wake.enabled=false;
  water.foam.surface.enabled=false;water.foam.waves.enabled=false;water.foam.shoreline.enabled=false;water.ssr.enabled=true;
  water.ssr.maxDistance=8;water.ssr.stepCount=96;water.ssr.strength=.6;water.ssr.thickness=.002;water.sparkle.enabled=false;
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
  const waterMaterial=surface.material;
  const material=new MeshBasicNodeMaterial().copy(waterMaterial);
  material.onBeforeRender=()=>{};
  material.onBeforeCompile=()=>{};
  surface.material=material;
  const ripple=clamp(waterMaterial.waterPositionNode.y,-.001,.001).mul(clamp(attribute('waterDepth').mul(1200),0,1));
  const finitePosition=vec3(positionLocal.x,positionLocal.y.add(ripple),positionLocal.z);
  const edgeAlpha=smoothstep(.000015,.0012,attribute('waterDepth')).mul(.88);
  let lastOptics=null;
  const bindFiniteSurface=()=>{
    if(material.positionNode!==finitePosition||lastOptics!==waterMaterial.colorNode){material.positionNode=finitePosition;lastOptics=waterMaterial.colorNode;material.colorNode=vec4(lastOptics.rgb.mul(vec3(.68,.77,.78)),1);material.opacityNode=edgeAlpha;material.needsUpdate=true;}
    waterMaterial.positionNode=finitePosition;
  };
  bindFiniteSurface();
  material.transparent=true;material.depthWrite=false;material.blending=NormalBlending;material.premultipliedAlpha=false;material.alphaToCoverage=false;material.needsUpdate=true;
  room.group.remove(room.surface);
  scene.environment=environment;scene.background=background;scene.fog=fog;
  room.waterProActive=true;room.waterProBackend=water.backend;
  return{
    async update(dt){surface.visible=room.surface.visible;await water.update(dt);bindFiniteSurface();},
    resize(width,height){water.resize(width,height);},
    dispose(){water.dispose();},
    backend:water.backend,
  };
}
