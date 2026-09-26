import * as THREE from 'three';

/** Move the existing sun coverage without changing the shadow texel phase.
 * A small overlap at bay boundaries prevents repeated map jumps while walking
 * back and forth. Animated casters can still invalidate the map independently. */
export class StableSunShadow {
  private readonly anchor = new THREE.Vector3(Infinity, Infinity, Infinity);
  private readonly offset = new THREE.Vector3();
  private readonly previousOffset = new THREE.Vector3(Infinity, Infinity, Infinity);
  private readonly back = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly previousUp = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private texelX = 0;
  private texelY = 0;

  update(light: THREE.DirectionalLight, position: THREE.Vector3): boolean {
    const camera = light.shadow.camera;
    const texelX = (camera.right - camera.left) / light.shadow.mapSize.x;
    const texelY = (camera.top - camera.bottom) / light.shadow.mapSize.y;
    this.offset.copy(light.position).sub(light.target.position);
    const nextX = this.follow(position.x, this.anchor.x, 1);
    const nextY = this.follow(position.y, this.anchor.y + .55, .5) - .55;
    const nextZ = this.follow(position.z, this.anchor.z, 1);
    const changed = nextX !== this.anchor.x || nextY !== this.anchor.y || nextZ !== this.anchor.z ||
      this.previousOffset.distanceToSquared(this.offset) > 1e-18 || !this.previousUp.equals(camera.up) ||
      texelX !== this.texelX || texelY !== this.texelY;
    if (!changed) return false;
    this.anchor.set(nextX, nextY, nextZ);
    this.back.copy(this.offset).normalize();
    if (this.back.lengthSq() === 0) this.back.z = 1;
    this.right.crossVectors(camera.up, this.back);
    // Match Matrix4.lookAt's non-collinear basis for a vertical Studio sun.
    if (this.right.lengthSq() === 0) {
      if (Math.abs(camera.up.z) === 1) this.back.x += .0001;
      else this.back.z += .0001;
      this.back.normalize();
      this.right.crossVectors(camera.up, this.back);
    }
    this.right.normalize();
    this.up.crossVectors(this.back, this.right);
    this.target.copy(this.anchor);
    const x = this.target.dot(this.right), y = this.target.dot(this.up);
    this.target.addScaledVector(this.right, Math.round(x / texelX) * texelX - x);
    this.target.addScaledVector(this.up, Math.round(y / texelY) * texelY - y);
    light.target.position.copy(this.target);
    light.position.copy(this.target).add(this.offset);
    light.target.updateMatrixWorld(true);
    light.updateMatrixWorld(true);
    light.shadow.needsUpdate = true;
    this.previousOffset.copy(this.offset);
    this.previousUp.copy(camera.up);
    this.texelX = texelX; this.texelY = texelY;
    return true;
  }

  private follow(value: number, previous: number, step: number): number {
    return Math.abs(value - previous) <= step * .65 ? previous : Math.round(value / step) * step;
  }
}
