import type { Scene,PerspectiveCamera,Vector3 } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { RoomWaterSystem } from '../systems/RoomWaterSystem';
export interface RoomWaterRuntime {update(dt:number):Promise<void>;resize(width:number,height:number):void;dispose():void;backend:string;sampleWaves(positions:Vector3[]):Promise<Array<{height:number;normal:number[]}>>}
export function createRoomWater(renderer:WebGPURenderer,scene:Scene,camera:PerspectiveCamera,room:RoomWaterSystem):Promise<RoomWaterRuntime>;
