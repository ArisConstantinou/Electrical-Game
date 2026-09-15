import * as THREE from 'three';
import type {MortarImpactFootprint} from './MortarField';

/** Direct hits flatten wider; glancing hits smear along their tangent. A stable
 * per-clod phase gives every impact a different torn, lobed boundary. */
export function mortarImpactFootprint(velocity:THREE.Vector3,normal:THREE.Vector3,variation:number):MortarImpactFootprint{
  const speed=Math.max(.001,velocity.length()),direction=velocity.clone().multiplyScalar(1/speed),incidence=THREE.MathUtils.clamp(Math.abs(direction.dot(normal)),0,1);
  const force=THREE.MathUtils.clamp((speed-1.5)/6.5,0,1),areaScale=.82+.53*force*(.38+.62*incidence);
  const irregular=.92+.16*(.5+.5*Math.sin(variation*2.3999632297+1.1)),elongation=1+(1-incidence)*1.9+(irregular-1)*.55;
  const tangent=direction.addScaledVector(normal,-direction.dot(normal));let rotation=Math.atan2(tangent.y,tangent.x);
  if(tangent.lengthSq()<1e-5)rotation=variation*2.3999632297;
  return{majorScale:areaScale*Math.sqrt(elongation)*irregular,minorScale:areaScale/Math.sqrt(elongation)/Math.sqrt(irregular),rotationRadians:rotation,offsetScale:(1-incidence)*(.10+.22*force),edgePhase:variation*1.6180339887};
}
