/** Player's garden-bucket recipe guide, for gameplay rather than a construction specification. */
export const MORTAR_RECIPE = Object.freeze({
  capacityLitres: 20,
  waterLitres: 20 / 3,
  cementLitresPerScoop: .35,
  cementScoopsMin: 6,
  cementScoopsMax: 7,
  sandLitresPerScoop: 1.4,
  mixingSeconds: 8,
  cementBulkKgPerLitre: 1.44,
  sandBulkKgPerLitre: 1.6,
  sandVoidFraction: .36,
});

export type MortarBatchQuality = 'empty' | 'incomplete' | 'unmixed' | 'balanced' | 'wet' | 'dry' | 'weak';
export type MortarBatchTool = 'trowel' | 'shovel';
export type MortarPayload = { ingredient: 'cement' | 'sand'; kg: number; litres: number };
export type MortarSack = { open: boolean; remainingKg: number };

/** Finite source stocks, retained tool loads, and a mass-conserving bucket.
 * Tool selection and carrying belong to the interaction layer: neither changes this inventory.
 * Sand voids accept water; this approximate packing model avoids counting each loose volume twice.
 */
export class MortarBatch {
  private readonly sacks: MortarSack[];
  private sandStock: number;
  private readonly initialStockKg: number;
  private cementKg = 0;
  private sandKg = 0;
  private waterKg = 0;
  private mixingTime = 0;
  private usedKg = 0;
  private discardedMass = 0;
  private suppliedWater = 0;
  private trowel: MortarPayload | null = null;
  private shovel: MortarPayload | null = null;

  constructor(options: { sackKg?: number; sandKg?: number } = {}) {
    const sackKg = options.sackKg ?? 25, sandKg = options.sandKg ?? 600;
    if (!Number.isFinite(sackKg) || sackKg < 0 || !Number.isFinite(sandKg) || sandKg < 0 || !Number.isFinite(sackKg * 3 + sandKg)) {
      throw new RangeError('Mortar stocks must be finite nonnegative masses.');
    }
    this.sacks = Array.from({ length: 3 }, () => ({ open: false, remainingKg: sackKg }));
    this.sandStock = sandKg;
    this.initialStockKg = sackKg * 3 + sandKg;
  }

  get massKg(): number { return this.waterKg + this.cementKg + this.sandKg; }
  get waterLitres(): number { return this.waterKg; }
  get cementScoops(): number { return this.cementKg / (MORTAR_RECIPE.cementLitresPerScoop * MORTAR_RECIPE.cementBulkKgPerLitre); }
  get sandScoops(): number { return this.sandKg / (MORTAR_RECIPE.sandLitresPerScoop * MORTAR_RECIPE.sandBulkKgPerLitre); }
  get volumeLitres(): number { return this.volume(this.waterKg, this.cementKg, this.sandKg); }
  get mixProgress(): number { return this.mixingTime / MORTAR_RECIPE.mixingSeconds; }
  get ready(): boolean { return this.hasIngredients && this.mixingTime >= MORTAR_RECIPE.mixingSeconds; }
  private get hasIngredients(): boolean { return this.waterKg > 0 && this.cementKg > 0 && this.sandKg > 0; }

  get quality(): MortarBatchQuality {
    if (this.massKg === 0) return 'empty';
    if (!this.hasIngredients) return 'incomplete';
    if (!this.ready) return 'unmixed';
    const cementLitres = this.cementKg / MORTAR_RECIPE.cementBulkKgPerLitre;
    const sandLitres = this.sandKg / MORTAR_RECIPE.sandBulkKgPerLitre;
    // A qualitative guide around the user's 6-trowel / full-bucket recipe.
    const moisture = this.waterKg / (cementLitres + sandLitres * .4);
    if (moisture > .98) return 'wet';
    if (moisture < .53) return 'dry';
    if (cementLitres / sandLitres < .09) return 'weak';
    return 'balanced';
  }

  openSack(index: number): boolean {
    if (!Number.isInteger(index) || !this.sacks[index] || this.sacks[index].open) return false;
    this.sacks[index].open = true;
    return true;
  }

  scoopCement(index: number): boolean {
    const sack = Number.isInteger(index) ? this.sacks[index] : undefined;
    if (!sack?.open || sack.remainingKg <= 0 || this.trowel) return false;
    const kg = Math.min(sack.remainingKg, MORTAR_RECIPE.cementLitresPerScoop * MORTAR_RECIPE.cementBulkKgPerLitre);
    sack.remainingKg -= kg;
    this.trowel = { ingredient: 'cement', kg, litres: kg / MORTAR_RECIPE.cementBulkKgPerLitre };
    return true;
  }

  scoopSand(): boolean {
    if (this.shovel || this.sandStock <= 0) return false;
    const kg = Math.min(this.sandStock, MORTAR_RECIPE.sandLitresPerScoop * MORTAR_RECIPE.sandBulkKgPerLitre);
    this.sandStock -= kg;
    this.shovel = { ingredient: 'sand', kg, litres: kg / MORTAR_RECIPE.sandBulkKgPerLitre };
    return true;
  }

  pour(tool: MortarBatchTool): boolean {
    if (tool !== 'trowel' && tool !== 'shovel') return false;
    const payload = tool === 'trowel' ? this.trowel : this.shovel;
    if (!payload) return false;
    const cement = this.cementKg + (payload.ingredient === 'cement' ? payload.kg : 0);
    const sand = this.sandKg + (payload.ingredient === 'sand' ? payload.kg : 0);
    if (this.volume(this.waterKg, cement, sand) > MORTAR_RECIPE.capacityLitres + 1e-9) return false;
    this.cementKg = cement;
    this.sandKg = sand;
    if (tool === 'trowel') this.trowel = null; else this.shovel = null;
    this.mixingTime = 0;
    return true;
  }

  /** Refuse the entire addition on overflow, so no hidden spill destroys material. */
  addWater(litres: number): number {
    if (!Number.isFinite(litres) || litres <= 0) return 0;
    if (this.volume(this.waterKg + litres, this.cementKg, this.sandKg) > MORTAR_RECIPE.capacityLitres + 1e-9) return 0;
    this.waterKg += litres;
    this.suppliedWater += litres;
    this.mixingTime = 0;
    return litres;
  }

  /** Call only for time actually spent holding a running mixer inside the bucket. */
  mix(seconds: number): number {
    if (Number.isFinite(seconds) && seconds > 0 && this.hasIngredients) {
      this.mixingTime = Math.min(MORTAR_RECIPE.mixingSeconds, this.mixingTime + seconds);
    }
    return this.mixProgress;
  }

  consumeKg(requested: number): number {
    if (!this.ready || !Number.isFinite(requested) || requested <= 0) return 0;
    const mass = this.massKg, taken = Math.min(requested, mass);
    const remainingFraction = Math.max(0, 1 - taken / mass);
    this.cementKg *= remainingFraction;
    this.sandKg *= remainingFraction;
    this.waterKg *= remainingFraction;
    this.usedKg += taken;
    if (remainingFraction === 0) this.mixingTime = 0;
    return taken;
  }

  /** Empty the bucket explicitly, retaining waste in the ledger and both tool loads. */
  discard(): number {
    const discarded = this.massKg;
    this.discardedMass += discarded;
    this.cementKg = 0;
    this.sandKg = 0;
    this.waterKg = 0;
    this.mixingTime = 0;
    return discarded;
  }

  getState() {
    return {
      capacityLitres: MORTAR_RECIPE.capacityLitres,
      waterLitres: this.waterLitres, cementKg: this.cementKg, sandKg: this.sandKg,
      cementScoops: this.cementScoops, sandScoops: this.sandScoops,
      massKg: this.massKg, volumeLitres: this.volumeLitres,
      mixProgress: this.mixProgress, ready: this.ready, quality: this.quality,
      sacks: this.sacks.map(sack => ({ ...sack })), sandRemainingKg: this.sandStock,
      heldTrowel: this.trowel ? { ...this.trowel } : null,
      heldShovel: this.shovel ? { ...this.shovel } : null,
      consumedKg: this.usedKg, discardedKg: this.discardedMass, addedWaterLitres: this.suppliedWater, initialStockKg: this.initialStockKg,
    };
  }

  private volume(waterKg: number, cementKg: number, sandKg: number): number {
    const sandLitres = sandKg / MORTAR_RECIPE.sandBulkKgPerLitre;
    return cementKg / MORTAR_RECIPE.cementBulkKgPerLitre
      + sandLitres * (1 - MORTAR_RECIPE.sandVoidFraction)
      + Math.max(waterKg, sandLitres * MORTAR_RECIPE.sandVoidFraction);
  }
}
