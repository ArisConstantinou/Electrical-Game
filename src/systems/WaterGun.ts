/** Game flow settings in litres/second. FLOOD deliberately accelerates filling;
 * it is not a claimed garden-hose specification. */
export const WATER_GUN_MODES = [
  { id: 'mist', label: 'MIST', flowLitresPerSecond: .12, speedMps: 5, spreadRadians: .10 },
  { id: 'shower', label: 'SHOWER', flowLitresPerSecond: 1, speedMps: 8, spreadRadians: .13 },
  { id: 'jet', label: 'JET', flowLitresPerSecond: 4, speedMps: 16, spreadRadians: .018 },
  { id: 'flood', label: 'FLOOD', flowLitresPerSecond: 160, speedMps: 12, spreadRadians: .065 },
] as const;
export type WaterGunSetting = typeof WATER_GUN_MODES[number];
