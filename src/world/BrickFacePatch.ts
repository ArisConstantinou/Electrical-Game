/** Eight orthographic clay faces in a 2×4 atlas, cropped inside the tile
 * borders. Worn variants are rarer and individual units can mirror their
 * face, so a conspicuous chip does not repeat at every few bricks. */
export function brickFacePatch(row: number, column: number, seed = 0): [number, number, number, number] {
  let hash = Math.imul(row + seed * 17 + 41, 73856093) ^ Math.imul(column + seed * 29 + 73, 19349663);
  hash = Math.imul(hash ^ (hash >>> 16), 2246822519) >>> 0;
  const tiles = [0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 2, 3, 4, 4, 4, 4, 5, 5, 6, 7];
  const tile = tiles[hash % tiles.length];
  const atlasColumn = tile % 2, atlasRow = Math.floor(tile / 2);
  const cropX = .006 + ((hash >>> 3) % 5) * .01;
  const cropY = .004 + ((hash >>> 9) % 3) * .007;
  const width = .448, height = .228;
  const mirrorU = Boolean((hash >>> 16) & 1), mirrorV = Boolean((hash >>> 17) & 1);
  return [atlasColumn * .5 + cropX + (mirrorU ? width : 0),
    (3 - atlasRow) * .25 + cropY + (mirrorV ? height : 0),
    mirrorU ? -width : width, mirrorV ? -height : height];
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
