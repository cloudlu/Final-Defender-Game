import { describe, it, expect } from 'vitest';
import { SeededRNG } from './SeededRNG.js';

describe('SeededRNG', () => {
  it('produces same sequence for same seed', () => {
    const a = new SeededRNG(42);
    const b = new SeededRNG(42);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = new SeededRNG(1);
    const b = new SeededRNG(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('values are in [0, 1)', () => {
    const rng = new SeededRNG(123);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt produces values in [min, max]', () => {
    const rng = new SeededRNG(456);
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextInt(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
  });

  it('pick returns elements from the array', () => {
    const rng = new SeededRNG(789);
    const arr = ['a', 'b', 'c'];
    for (let i = 0; i < 100; i++) {
      expect(arr).toContain(rng.pick(arr));
    }
  });

  it('shuffle returns all original elements', () => {
    const rng = new SeededRNG(101);
    const arr = [1, 2, 3, 4, 5];
    const shuffled = rng.shuffle([...arr]);
    expect(shuffled.sort()).toEqual(arr.sort());
  });

  it('clone produces independent copy', () => {
    const rng = new SeededRNG(42);
    rng.next();
    const clone = rng.clone();
    const v1 = rng.next();
    const v2 = clone.next();
    expect(v1).toBe(v2);
    // Advance clone independently
    clone.next();
    expect(clone.next()).not.toBe(rng.next());
  });
});
