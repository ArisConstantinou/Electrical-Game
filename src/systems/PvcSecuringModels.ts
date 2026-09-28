import * as THREE from 'three';
import {buildM18ToolModel} from '../player/M18ToolModels';

export {buildRebarPliers,buildHeldRebar,buildRebarHug,setRebarPliersClosed,setTieWireProgress,setTieWireTarget} from './RebarTyingModels';

/** Dedicated masonry drill whose visible bit is truly 12 mm diameter. */
export function buildPvcDrill12():THREE.Group{
  const drill=buildM18ToolModel('drill',{bitDiameterMm:12});
  drill.name='Milwaukee M18 FPD3 masonry drill - 12 mm bit';
  return drill;
}
