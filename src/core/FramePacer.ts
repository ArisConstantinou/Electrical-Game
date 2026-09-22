export type FrameRateLimit = 0 | 30 | 60 | 120;

export const FRAME_RATE_STORAGE_KEY = 'wirehouse.frame-rate-limit';

export function readFrameRateLimit(): FrameRateLimit {
  try {
    const saved = localStorage.getItem(FRAME_RATE_STORAGE_KEY);
    if (saved === '0' || saved === '30' || saved === '60' || saved === '120') return Number(saved) as FrameRateLimit;
  } catch { /* Storage may be unavailable in private or embedded sessions. */ }
  return 60;
}

/** Pace expensive updates without replacing RAF or changing simulation time. */
export class FramePacer {
  private nextFrame: number | null = null;

  reset(): void { this.nextFrame = null; }

  accept(time: number, framesPerSecond: number): boolean {
    if (framesPerSecond === 0) { this.reset(); return true; }
    const interval = 1000 / framesPerSecond;
    if (this.nextFrame === null) { this.nextFrame = time + interval; return true; }
    // RAF timestamps can straddle a refresh boundary by a fraction of a ms.
    if (time + .5 < this.nextFrame) return false;
    // Skip missed deadlines after a slow frame; never run a catch-up burst.
    this.nextFrame += (Math.floor(Math.max(0, time + .5 - this.nextFrame) / interval) + 1) * interval;
    return true;
  }
}
