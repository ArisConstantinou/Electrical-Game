import * as THREE from 'three';

/** Conserved bulk sand volume with a local scoop and surface-only avalanches.
 * One height per grid cell replaces per-grain collision for the buried mass;
 * a small set of ballistic surface grains shows the short-lived disturbance.
 */
export class SandPileSimulation extends THREE.Mesh {
  readonly initialMassKg: number;
  readonly bulkDensityKgM3 = 1600;
  readonly maxSlope = Math.tan(35 * Math.PI / 180);
  readonly columns = 49;
  readonly rows = 43;
  readonly width = 2.24;
  readonly depth = 1.88;
  readonly dx = this.width / (this.columns - 1);
  readonly dz = this.depth / (this.rows - 1);
  private readonly heights = new Float32Array(this.columns * this.rows);
  private readonly disturbance = new Float32Array(this.columns * this.rows);
  private readonly positions: THREE.BufferAttribute;
  private readonly colors: THREE.BufferAttribute;
  private readonly grainPositions = new Float32Array(36 * 3);
  private readonly grainVelocity = new Float32Array(36 * 3);
  private readonly grainLife = new Float32Array(36);
  private readonly grains: THREE.Points;
  private footprint: THREE.Box3 | null = null;
  private pendingSettle = 0;
  private scoopNumber = 0;
  private remainingMassKg: number;
  lastScoop: { x: number; z: number; kg: number; beforeKg: number; afterKg: number } | null = null;

  constructor(material: THREE.Material, initialMassKg = 600) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(49 * 43 * 3), uvs = new Float32Array(49 * 43 * 2);
    const colors = new Float32Array(49 * 43 * 3), indices: number[] = [];
    const heights = new Float32Array(49 * 43);
    for (let row = 0; row < 43; row++) for (let col = 0; col < 49; col++) {
      const i = row * 49 + col, x = (col / 48 - .5) * 2.24, z = (row / 42 - .5) * 1.88;
      const angle = Math.atan2(z + .07, x - .055);
      const radial = Math.hypot((x - .055) / .92, (z + .07) / .79);
      const edge = 1 + .045 * Math.sin(angle * 3 + .4) + .025 * Math.cos(angle * 7);
      const primary = .53 * Math.max(0, 1 - radial / edge);
      const secondary = .075 * Math.max(0, 1 - Math.hypot((x + .27) / .48, (z - .13) / .38));
      heights[i] = Math.max(0, primary + secondary);
      positions[i * 3] = x; positions[i * 3 + 2] = z;
      uvs[i * 2] = .5 + x / 2.5; uvs[i * 2 + 1] = .5 + z / 2.5;
      const shade = .965 + Math.sin(i * 17.13) * .023;
      colors.set([shade, shade, shade], i * 3);
      if (row < 42 && col < 48) {
        const a = i, b = a + 49;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const cellArea = 2.24 / 48 * 1.88 / 42;
    const volume = heights.reduce((sum, height) => sum + height * cellArea, 0);
    const multiplier = initialMassKg / (1600 * volume);
    for (let i = 0; i < heights.length; i++) positions[i * 3 + 1] = heights[i] * multiplier - .004;
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    super(geometry, material);
    this.positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    this.colors = geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < heights.length; i++) this.heights[i] = heights[i] * multiplier;
    this.initialMassKg = initialMassKg;
    this.remainingMassKg = initialMassKg;
    this.name = 'mixing-large-sand-mound';
    this.userData.studioEntityId = 'mixing:sand';
    this.castShadow = this.receiveShadow = true;
    const grainsGeometry = new THREE.BufferGeometry();
    grainsGeometry.setAttribute('position', new THREE.BufferAttribute(this.grainPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.grains = new THREE.Points(grainsGeometry, new THREE.PointsMaterial({ color: 0xbfa87b, size: .018, sizeAttenuation: true, transparent: true, opacity: .9, depthWrite: false }));
    this.grains.name = 'Loose surface grains from the shovel cut';
    this.grains.visible = false;
    this.grains.frustumCulled = false;
    this.add(this.grains);
    this.rebuildFootprint();
  }

  get collisionFootprint(): THREE.Box3 | null { return this.footprint; }
  get remainingKg(): number { return this.remainingMassKg; }

  override raycast(raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void {
    const hits: THREE.Intersection[] = [];
    super.raycast(raycaster, hits);
    for (const hit of hits) if (this.worldToLocal(hit.point.clone()).y > .015) intersects.push(hit);
  }

  get telemetry() {
    return { remainingKg: this.remainingMassKg, surfaceKg: this.volumeM3 * this.bulkDensityKgM3,
      pendingSettle: this.pendingSettle, activeGrains: this.grainLife.filter(life => life > 0).length,
      lastScoop: this.lastScoop };
  }

  get volumeM3(): number {
    let sum = 0;
    for (const height of this.heights) sum += height;
    return sum * this.dx * this.dz;
  }

  heightAt(x: number, z: number): number {
    const gx = THREE.MathUtils.clamp((x / this.width + .5) * (this.columns - 1), 0, this.columns - 1);
    const gz = THREE.MathUtils.clamp((z / this.depth + .5) * (this.rows - 1), 0, this.rows - 1);
    const col = Math.min(this.columns - 2, Math.floor(gx)), row = Math.min(this.rows - 2, Math.floor(gz));
    const tx = gx - col, tz = gz - row, a = row * this.columns + col;
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(this.heights[a], this.heights[a + 1], tx),
      THREE.MathUtils.lerp(this.heights[a + this.columns], this.heights[a + this.columns + 1], tx), tz);
  }

  scoop(x: number, z: number, kg: number, directionX = 0, directionZ = 1): boolean {
    if (!Number.isFinite(x + z + kg) || kg <= 0 || kg > this.remainingMassKg + 1e-5) return false;
    const beforeKg = this.volumeM3 * this.bulkDensityKgM3;
    if (kg > beforeKg + .02) return false;
    let volume = kg / this.bulkDensityKgM3;
    const length = Math.hypot(directionX, directionZ) || 1, dirX = directionX / length, dirZ = directionZ / length;
    const weights = new Float32Array(this.heights.length), area = this.dx * this.dz;
    // The front lip cuts a narrow track along its stroke. If that patch is
    // exhausted, widen to nearby live sand before touching the inventory.
    for (const spread of [1, 1.6, 2.6, 5, 12]) {
      let available = 0;
      for (let row = 0; row < this.rows; row++) for (let col = 0; col < this.columns; col++) {
        const i = row * this.columns + col, px = (col / (this.columns - 1) - .5) * this.width;
        const pz = (row / (this.rows - 1) - .5) * this.depth;
        const dx = px - x, dz = pz - z;
        const along = (dx * dirX + dz * dirZ) / (.16 * spread);
        const across = (dx * -dirZ + dz * dirX) / (.065 * spread);
        const d2 = along * along + across * across;
        weights[i] = d2 < 4 ? Math.exp(-d2 * .5) : 0;
        if (weights[i] > 0) available += this.heights[i] * area;
      }
      if (available + 1e-7 >= volume) break;
    }
    let available = 0;
    for (let i = 0; i < weights.length; i++) if (weights[i] > 0) available += this.heights[i] * area;
    if (available + 1e-7 < volume) return false;
    const originalHeights = this.heights.slice();
    const originalDisturbance = this.disturbance.slice();
    for (let pass = 0; pass < 20 && volume > 1e-10; pass++) {
      let capacity = 0;
      for (let i = 0; i < weights.length; i++) if (this.heights[i] > 0) capacity += weights[i] * area;
      if (capacity <= 0) break;
      let taken = 0;
      const depth = volume / capacity;
      for (let i = 0; i < weights.length; i++) {
        const reduction = Math.min(this.heights[i], depth * weights[i]);
        this.heights[i] -= reduction; taken += reduction * area;
        if (reduction > 0) this.disturbance[i] = Math.min(1, this.disturbance[i] + reduction / .012);
      }
      volume = Math.max(0, volume - taken);
    }
    if (volume > 1e-7) { this.heights.set(originalHeights); this.disturbance.set(originalDisturbance); return false; }
    this.remainingMassKg -= kg;
    this.pendingSettle = 22;
    this.lastScoop = { x, z, kg, beforeKg, afterKg: this.volumeM3 * this.bulkDensityKgM3 };
    this.spawnGrains(x, z);
    this.refreshGeometry();
    return true;
  }

  update(dt: number): void {
    if (this.pendingSettle > 0) {
      this.relax(2); this.pendingSettle--; this.refreshGeometry();
    }
    let active = false;
    for (let i = 0; i < this.grainLife.length; i++) {
      if (this.grainLife[i] <= 0) continue;
      this.grainLife[i] = Math.max(0, this.grainLife[i] - dt);
      const offset = i * 3;
      this.grainVelocity[offset + 1] -= 4.6 * dt;
      for (let axis = 0; axis < 3; axis++) this.grainPositions[offset + axis] += this.grainVelocity[offset + axis] * dt;
      const ground = this.heightAt(this.grainPositions[offset], this.grainPositions[offset + 2]);
      if (this.grainPositions[offset + 1] <= ground) this.grainLife[i] = 0;
      if (this.grainLife[i] <= 0) this.grainPositions[offset + 1] = -10;
      else active = true;
    }
    if (active) this.grains.geometry.getAttribute('position').needsUpdate = true;
    this.grains.visible = active;
  }

  private relax(passes: number): void {
    const limitX = this.maxSlope * this.dx, limitZ = this.maxSlope * this.dz;
    for (let pass = 0; pass < passes; pass++) {
      for (let row = 0; row < this.rows; row++) for (let col = 0; col < this.columns; col++) {
        const i = row * this.columns + col;
        if (col + 1 < this.columns) this.flow(i, i + 1, limitX);
        if (row + 1 < this.rows) this.flow(i, i + this.columns, limitZ);
      }
    }
  }

  private flow(a: number, b: number, limit: number): void {
    const difference = this.heights[a] - this.heights[b];
    if (Math.abs(difference) <= limit) return;
    const from = difference > 0 ? a : b, to = difference > 0 ? b : a;
    const transfer = Math.min(this.heights[from], (Math.abs(difference) - limit) * .5);
    this.heights[from] -= transfer; this.heights[to] += transfer;
  }

  private refreshGeometry(): void {
    for (let i = 0; i < this.heights.length; i++) {
      this.positions.setY(i, this.heights[i] - .004);
      const shade = (.965 + Math.sin(i * 17.13) * .023) * (1 - .24 * this.disturbance[i]);
      this.colors.setXYZ(i, shade, shade, shade);
    }
    this.positions.needsUpdate = true;
    this.colors.needsUpdate = true;
    this.geometry.computeVertexNormals(); this.geometry.computeBoundingBox(); this.geometry.computeBoundingSphere();
    this.rebuildFootprint();
  }

  private rebuildFootprint(): void {
    const box = new THREE.Box3(), point = new THREE.Vector3();
    for (let row = 0; row < this.rows; row++) for (let col = 0; col < this.columns; col++) {
      const i = row * this.columns + col, height = this.heights[i];
      if (height < .035) continue;
      box.expandByPoint(point.set((col / (this.columns - 1) - .5) * this.width, height, (row / (this.rows - 1) - .5) * this.depth));
    }
    if (box.isEmpty()) { this.footprint = null; return; }
    box.min.x -= .05; box.max.x += .05; box.min.z -= .05; box.max.z += .05;
    box.min.y = 0;
    this.footprint = box;
  }

  private spawnGrains(x: number, z: number): void {
    this.scoopNumber++;
    for (let i = 0; i < this.grainLife.length; i++) {
      const angle = i * 2.399963 + this.scoopNumber * .75;
      const radius = .025 + (i % 6) * .012, at = i * 3;
      this.grainPositions.set([x + Math.cos(angle) * radius, this.heightAt(x, z) + .012 + (i % 5) * .008, z + Math.sin(angle) * radius], at);
      this.grainVelocity.set([Math.cos(angle) * (.08 + i % 4 * .025), .20 + (i % 5) * .055, Math.sin(angle) * (.08 + i % 3 * .03)], at);
      this.grainLife[i] = .3 + (i % 4) * .08;
    }
    this.grains.geometry.getAttribute('position').needsUpdate = true;
    this.grains.visible = true;
  }
}
