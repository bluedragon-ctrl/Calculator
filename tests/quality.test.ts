import { describe, expect, it } from 'vitest';
import {
  QualityProbe, SAMPLE_FRAMES, SLOW_FRAME_MS, WARMUP_FRAMES, chooseQuality, loadQualitySetting,
  median, nextQualitySetting, saveQualitySetting, type KeyValueStore,
} from '../src/ui/quality';

class MemStore implements KeyValueStore {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

const throwingStore: KeyValueStore = {
  getItem() { throw new Error('blocked'); },
  setItem() { throw new Error('blocked'); },
};

describe('median', () => {
  it('handles odd, even and empty inputs', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNaN();
  });
});

describe('chooseQuality', () => {
  it('picks high for fast frames and low for slow ones', () => {
    expect(chooseQuality(Array(60).fill(16.7))).toBe('high');
    expect(chooseQuality(Array(60).fill(SLOW_FRAME_MS + 5))).toBe('low');
    expect(chooseQuality([])).toBe('high');
  });
  it('ignores a few outlier spikes', () => {
    expect(chooseQuality([...Array(50).fill(16), ...Array(10).fill(200)])).toBe('high');
  });
});

describe('QualityProbe', () => {
  it('ignores warm-up frames, then decides exactly once', () => {
    const p = new QualityProbe();
    for (let i = 0; i < WARMUP_FRAMES; i++) expect(p.addFrame(500)).toBeNull();
    let decision = null;
    for (let i = 0; i < SAMPLE_FRAMES; i++) decision = p.addFrame(40);
    expect(decision).toBe('low');
    expect(p.done).toBe(true);
    expect(p.addFrame(40)).toBeNull();
  });
});

describe('quality setting storage', () => {
  it('round-trips and defaults to auto', () => {
    const s = new MemStore();
    expect(loadQualitySetting(s)).toBe('auto');
    saveQualitySetting(s, 'low');
    expect(loadQualitySetting(s)).toBe('low');
    s.setItem('itc.quality', 'garbage');
    expect(loadQualitySetting(s)).toBe('auto');
  });
  it('survives blocked or missing storage', () => {
    expect(loadQualitySetting(throwingStore)).toBe('auto');
    expect(() => saveQualitySetting(throwingStore, 'high')).not.toThrow();
    expect(loadQualitySetting(undefined)).toBe('auto');
  });
  it('cycles auto → high → low → auto', () => {
    expect(nextQualitySetting('auto')).toBe('high');
    expect(nextQualitySetting('high')).toBe('low');
    expect(nextQualitySetting('low')).toBe('auto');
  });
});
