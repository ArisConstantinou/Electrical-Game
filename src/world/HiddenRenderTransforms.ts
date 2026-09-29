import * as THREE from 'three';

/** Invisible render subtrees need no per-frame matrices. Explicit world-space
 * queries retain Three's updateWorldMatrix path, including on hidden anchors. */
export class HiddenRenderTransforms {
  private readonly prepared=new WeakSet<THREE.Object3D>();
  prepare(object:THREE.Object3D):void{
    const typed=object as THREE.Object3D&{isCamera?:boolean;isBone?:boolean};
    if(this.prepared.has(object)||typed.isCamera||typed.isBone)return;
    this.prepared.add(object);
    // TransformControls keeps its picking volumes invisible deliberately.
    // Their world matrices must still follow the visible handles for raycasts.
    for(let parent:THREE.Object3D|null=object;parent;parent=parent.parent)
      if((parent as THREE.Object3D&{isTransformControlsRoot?:boolean}).isTransformControlsRoot)return;
    const update=object.updateMatrixWorld;
    object.updateMatrixWorld=function(force?:boolean):void{
      if(this.visible)update.call(this,force);
    };
  }
}
