export const GAME_CONFIG = {
  title: 'WIRE THE HOUSE',
  room: { width: 7.6, depth: 7.2, height: 3, wallFrontZ: -2.41 },
  player: { eyeHeight: 1.65, speed: 2.2, sprintMultiplier: 1.55, radius: 0.28 },
  renderer: { maxPixelRatio: 1.75, shadowMapSize: 1024 },
  interaction: { maxDistance: 2.35, minAimDot: 0.7 },
} as const;
