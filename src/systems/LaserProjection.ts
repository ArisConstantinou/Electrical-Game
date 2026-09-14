import { uniform, positionWorld, smoothstep, vec3 } from 'three/tsl';

// One horizontal reference plane shared by the real surface materials. Empty
// holes have no fragments to shade, so there is no floating line across a chase.
export const laserHeight = uniform(1.2);
export const laserEnabled = uniform(0);
const distance=positionWorld.y.sub(laserHeight).abs();
export const laserBand=smoothstep(.0008,.0035,distance).oneMinus().mul(laserEnabled);
const halo=smoothstep(.001,.009,distance).oneMinus().mul(laserEnabled);
export const laserTint=vec3(.06,.95,.12);
export const laserEmission=vec3(.04,1,.10).mul(laserBand.mul(1.8).add(halo.mul(.18)));

export function setLaserProjection(height: number | null): void {
  laserEnabled.value=height===null?0:1;
  if(height!==null)laserHeight.value=height;
}
