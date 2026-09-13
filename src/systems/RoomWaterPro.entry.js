// Build input for this game's compiled Water Pro component. The licensed
// dependency stays outside the public repository; this file contains only our integration.
import { WaterSystem, WaterSurfaceMaterial, getPresetParams } from 'threejs-water-pro';
import { MeshBasicNodeMaterial, NormalBlending, Object3D, CubeCamera, CubeRenderTarget, LinearMipmapLinearFilter } from 'three/webgpu';
import { attribute, positionLocal, positionWorld, cameraPosition, vec3, vec4, clamp, smoothstep, cubeTexture, tanh, uniform, Fn, output, fog as sceneFog, rangeFogFactor } from 'three/tsl';

export async function createRoomWater(renderer,scene,camera,room){
  const previous=new Set(scene.children),environment=scene.environment,background=scene.background,fog=scene.fog;
  const environmentNode=scene.environmentNode,backgroundNode=scene.backgroundNode,fogNode=scene.fogNode;
  // A null SkyProvider makes Water Pro fall back to a bright blue sky even
  // indoors. Supply a real room capture through its documented provider seam.
  const reflectionTarget=new CubeRenderTarget(128,{generateMipmaps:true,minFilter:LinearMipmapLinearFilter});
  const reflectionCamera=new CubeCamera(.04,20,reflectionTarget);reflectionCamera.position.set(0,1.4,0);
  const cameraVisible=camera.visible;camera.visible=false;
  reflectionCamera.update(renderer,scene);camera.visible=cameraVisible;
  const roomReflections={
    createFogSampler:()=>direction=>cubeTexture(reflectionTarget.texture,direction).rgb,
    createReflectionSampler:()=>(direction,roughness)=>cubeTexture(reflectionTarget.texture,direction).level(roughness.mul(4)).rgb,
    getEnvironmentTexture:()=>reflectionTarget.texture,getMeshes:()=>[],followCamera:()=>{},dispose:()=>reflectionTarget.dispose(),
  };
  const water=await WaterSystem.create(renderer,scene,camera,'low',{deterministic:false});
  const preset=getPresetParams('arctic');
  preset.waves.fft.amplitude=.008;preset.waves.fft.windSpeed=2.8;preset.waves.fft.peakWavelength=.85;preset.waves.fft.choppiness=.22;preset.waves.fft.standingWaveRatio=.6;
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
  preset.fresnel.surface.refractionStrength=.045;
  water.loadPreset(preset);water.floor.setVisible(false);water.cameraTracking=false;water.setPosition(0,0);water.wake.enabled=false;
  water.foam.surface.enabled=false;water.foam.waves.enabled=false;water.foam.shoreline.enabled=false;water.ssr.enabled=true;
  water.ssr.maxDistance=8;water.ssr.stepCount=96;water.ssr.strength=.9;water.ssr.thickness=.003;water.sparkle.enabled=false;
  // A room must reflect its own scene, not Water Pro's default ocean sky.
  water.setSky(roomReflections);water.waterline.enabled=false;
  water.color.setJerlovType('Oceanic IB');
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
  surface.userData.waterPro={colorModel:'physical',reflectionSource:'captured-room',impactWaves:false,wakeResolution:128,waveAmplitude:.008,waveCapMetres:.065};
  const waterMaterial=surface.material;
  const material=new MeshBasicNodeMaterial().copy(waterMaterial);
  material.onBeforeRender=()=>{};
  material.onBeforeCompile=()=>{};
  surface.material=material;
  const wetDepth=attribute('waterDepth');
  const rippleLimit=clamp(wetDepth.mul(.18),0,.065);
  // Vendor waterPositionNode already includes positionLocal.y. Subtract that
  // baseline before clamping the displacement, or a raised flood would pin
  // every vertex at the positive limit and silently stop the wave animation.
  const ripple=tanh(waterMaterial.waterPositionNode.y.sub(positionLocal.y).div(clamp(rippleLimit,.00001,1))).mul(rippleLimit);
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
  let elapsed=0,waveBand=-1;
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
  // The vendor underwater postprocess assumes an infinite ocean at y=0.
  // Attenuate only the actual submerged segment of each room sight ray instead.
  // Above the volume this preserves the room's existing atmospheric fog.
  const immersed=uniform(0),surfaceHeight=uniform(0);
  const atmosphericFog=fog?sceneFog(vec3(fog.color.r,fog.color.g,fog.color.b),rangeFogFactor(fog.near,fog.far)):output;
  scene.fogNode=Fn(()=>{
    const delta=positionWorld.sub(cameraPosition);
    const fraction=clamp(surfaceHeight.sub(cameraPosition.y).div(delta.y.max(.00001)),0,1);
    const path=delta.length().mul(fraction);
    const transmission=vec3(.18,.055,.035).mul(path).negate().exp();
    const underwater=output.rgb.mul(transmission).add(vec3(.025,.105,.12).mul(transmission.oneMinus()));
    return vec4(atmosphericFog.rgb.mix(underwater,immersed),output.a);
  })();
  room.waterProActive=true;room.waterProBackend=water.backend;
  return{
    async update(dt){
      surface.visible=room.surface.visible;
      const meanDepth=room.field.volumeLitres/(room.field.width*room.field.depth*1000);
      const band=Math.min(20,Math.floor(meanDepth/.02));
      if(band!==waveBand){
        waveBand=band;
        // The vendor spectrum/normal field grows with the body of water, not
        // just the visual height cap. Small isolated puddles stay nearly calm.
        const amplitude=.008+1.4*Math.pow(Math.min(1,meanDepth/.4),.7);
        water.waves.amplitude.value=amplitude;water.waves.dirty=true;
        surface.userData.waterPro.waveAmplitude=amplitude;
      }
      water.color.waterDepth=Math.max(.001,meanDepth);
      updateImpact(dt);await water.update(dt);
      // Its stock underwater controller samples an ocean centred at y=0.
      // The finite room has an independently rising, volume-derived surface.
      const submerged=camera.position.y<room.field.surfaceAt(camera.position.x,camera.position.z);
      immersed.value=submerged?1:0;surfaceHeight.value=room.field.surfaceAt(camera.position.x,camera.position.z);
      waterMaterial.cameraSubmergedUniform.value=submerged?1:0;
      surface.userData.waterPro.cameraSubmerged=submerged;
      surface.userData.waterPro.meanDepthMetres=meanDepth;
      bindFiniteSurface();
    },
    resize(width,height){water.resize(width,height);},
    async sampleWaves(positions){water.sampler.setPositions(positions.slice(0,128));await water.sampler.update();return water.sampler.getSamples().map(sample=>({height:sample.height,normal:sample.normal.toArray()}));},
    dispose(){water.dispose();scene.fogNode=fogNode;},
    backend:water.backend,
  };
}
