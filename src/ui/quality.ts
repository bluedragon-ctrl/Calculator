// Graphics quality policy (DESIGN.md §6.6). Pure logic: no DOM or three.js,
// so it can be unit-tested. Storage is injected.

export type Quality = 'high' | 'low';
export type QualitySetting = 'auto' | Quality;

/** Frames above this median duration (ms) are too slow for High (~50 fps). */
export const SLOW_FRAME_MS = 20;
/** Number of frames to measure before deciding. */
export const SAMPLE_FRAMES = 90;
/** Frames ignored at start-up (shader compilation, first layout). */
export const WARMUP_FRAMES = 30;

export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Decide quality from measured frame durations (ms). */
export function chooseQuality(frameTimesMs: readonly number[]): Quality {
  if (frameTimesMs.length === 0) return 'high';
  return median(frameTimesMs) > SLOW_FRAME_MS ? 'low' : 'high';
}

/**
 * Collects frame times while running on High and reports a decision once.
 * Call `addFrame(dtMs)` every frame; returns the decision on the frame it is made.
 */
export class QualityProbe {
  private frames = 0;
  private samples: number[] = [];
  private decided = false;

  addFrame(dtMs: number): Quality | null {
    if (this.decided) return null;
    this.frames++;
    if (this.frames <= WARMUP_FRAMES) return null;
    this.samples.push(dtMs);
    if (this.samples.length < SAMPLE_FRAMES) return null;
    this.decided = true;
    return chooseQuality(this.samples);
  }

  get done(): boolean {
    return this.decided;
  }
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = 'itc.quality';

export function loadQualitySetting(store: KeyValueStore | undefined): QualitySetting {
  try {
    const v = store?.getItem(STORAGE_KEY);
    return v === 'high' || v === 'low' || v === 'auto' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveQualitySetting(store: KeyValueStore | undefined, s: QualitySetting): void {
  try {
    store?.setItem(STORAGE_KEY, s);
  } catch {
    // Storage may be blocked (private mode, school policy). Not fatal.
  }
}

export function nextQualitySetting(s: QualitySetting): QualitySetting {
  return s === 'auto' ? 'high' : s === 'high' ? 'low' : 'auto';
}
