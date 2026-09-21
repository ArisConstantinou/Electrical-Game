/** Interior rectangles of individual clay units in the existing 1K CC0 scan.
 * The source photograph's grey joints stay outside these rectangles: game
 * mortar is authored by masonry geometry, never painted a second time. */
export function brickFacePatch(row: number, column: number, seed = 0): [number, number, number, number] {
  let hash = Math.imul(row + seed * 17 + 41, 73856093) ^ Math.imul(column + seed * 29 + 73, 19349663);
  hash = Math.imul(hash ^ (hash >>> 16), 2246822519) >>> 0;
  const photoRow = hash % 20;
  const photoColumn = (hash >>> 9) % 5;
  // The photographed running bond alternates by half a unit every 51 px.
  // A 108 × 28 px interior crop leaves the photographed joint outside even
  // where the old, weathered clay edge is uneven.
  const centreX = (photoRow % 2 ? 205 : 123) + photoColumn * 170;
  const centreY = 27 + photoRow * 51;
  return [(centreX - 54) / 1024, (1024 - centreY - 14) / 1024, 108 / 1024, 28 / 1024];
}
