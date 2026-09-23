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
