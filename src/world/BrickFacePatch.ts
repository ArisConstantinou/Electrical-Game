/** Eight orthographic clay faces in a 2×4 atlas, cropped inside the tile
 * borders. Mortar remains geometric rather than baked into the unit face. */
export function brickFacePatch(row: number, column: number, seed = 0): [number, number, number, number] {
  let hash = Math.imul(row + seed * 17 + 41, 73856093) ^ Math.imul(column + seed * 29 + 73, 19349663);
  hash = Math.imul(hash ^ (hash >>> 16), 2246822519) >>> 0;
  const tile = hash % 8;
  const atlasColumn = tile % 2, atlasRow = Math.floor(tile / 2);
  // Keep the full clay face inside its tile, but shift the crop so repeated
  // units do not reuse the same stain, chip and rib pattern at every course.
  const cropX = .003 + ((hash >>> 3) % 11) * .0013;
  const cropY = .003 + ((hash >>> 9) % 4) * .003;
  return [atlasColumn * .5 + cropX, (3 - atlasRow) * .25 + cropY, .48, .235];
}

/** Fired-clay units from adjacent batches and differently heated kiln spots.
 * The low-frequency term keeps neighboring bricks related without repeating
 * an every-Nth-course stripe. This is visual only; the masonry volume stays exact. */
export function brickFaceTone(row: number, column: number, seed = 0): [number, number, number] {
  let hash = Math.imul(row + seed * 23 + 137, 73856093) ^ Math.imul(column + seed * 13 + 71, 19349663);
  hash = Math.imul(hash ^ (hash >>> 15), 2246822519) >>> 0;
  const fired = (hash % 997) / 996;
  const zone = Math.sin((column + seed * 7) * .43 + row * .19) * .055;
  const value = .68 + fired * .46 + zone;
  return [value * (1.025 - fired * .035), value, value * (.96 + fired * .04)];
}
