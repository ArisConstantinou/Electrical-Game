export class AssetManager {
  private readonly loaded = new Set<string>();
  markLoaded(id: string): void { this.loaded.add(id); }
  has(id: string): boolean { return this.loaded.has(id); }
}
