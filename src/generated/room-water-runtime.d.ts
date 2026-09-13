import type { Scene,PerspectiveCamera } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { RoomWaterSystem } from '../systems/RoomWaterSystem';
export interface RoomWaterRuntime {update(dt:number):Promise<void>;resize(width:number,height:number):void;dispose():void;backend:string}
export function createRoomWater(renderer:WebGPURenderer,scene:Scene,camera:PerspectiveCamera,room:RoomWaterSystem):Promise<RoomWaterRuntime>;
