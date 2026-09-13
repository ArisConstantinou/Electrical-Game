export const TROWEL_CHARGE_SECONDS = .95;
export const TROWEL_RELEASE_SECONDS = .16;
export const TROWEL_CAST_SECONDS = .82;

export type TrowelStage = 'ready' | 'prepare' | 'drive' | 'flip' | 'follow-through' | 'reset';
export interface TrowelMotionInput { holding: boolean; charge: number; castElapsed: number | null }
export interface TrowelMotion {
  stage: TrowelStage;
  /** Metres relative to the hand grip, with blade nose toward -Z. */
  offset: { x: number; y: number; z: number };
  pitchDegrees: number; yawDegrees: number; rollDegrees: number;
  loadVisible: boolean;
}
const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const ease = (value: number): number => { const t = clamp(value); return t * t * (3 - 2 * t); };
type Pose = [number, number, number, number, number, number];
const idle: Pose = [0, 0, 0, 0, 0, 0];
const mix = (a: Pose, b: Pose, t: number): Pose => a.map((n, i) => n + (b[i] - n) * ease(t)) as Pose;

/** Shared by the rig and physical release: preparation keeps the loaded face
 * upward, then the wrist closes the face during the forward casting arc. */
export function sampleTrowelMotion(input: TrowelMotionInput): TrowelMotion {
  const charge = clamp(input.charge);
  const prepared: Pose = [0, 0, .015 * charge, 0, 0, 0];
  let pose: Pose = idle, stage: TrowelStage = 'ready';
  const time = input.castElapsed === null ? null : clamp(input.castElapsed, 0, TROWEL_CAST_SECONDS);
  if (time === null) {
    if (input.holding) { pose = prepared; stage = 'prepare'; }
  } else {
    // A short forward flick with a neutral wrist. Turning the forearm about
    // its own axis closes the blade without bending the hand away from it.
    const drive: Pose = [0, 0, -.035, 0, 0, 0];
    const release: Pose = [0, 0, -.060, 0, 0, 150];
    const follow: Pose = [0, 0, -.070, 0, 0, 160];
    if (time < .08) { pose = mix(prepared, drive, time / .08); stage = 'drive'; }
    else if (time < TROWEL_RELEASE_SECONDS) { pose = mix(drive, release, (time - .08) / .08); stage = 'flip'; }
    else if (time < .4) { pose = mix(release, follow, (time - TROWEL_RELEASE_SECONDS) / (.4 - TROWEL_RELEASE_SECONDS)); stage = time < .2 ? 'flip' : 'follow-through'; }
    else { pose = mix(follow, idle, (time - .4) / (TROWEL_CAST_SECONDS - .4)); stage = 'reset'; }
  }
  return { stage, offset: { x: pose[0], y: pose[1], z: pose[2] }, pitchDegrees: pose[3], yawDegrees: pose[4], rollDegrees: pose[5], loadVisible: time === null || time < TROWEL_RELEASE_SECONDS };
}
