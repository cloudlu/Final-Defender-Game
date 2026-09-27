/**
 * Seeded pseudo-random number generator using Mulberry32 algorithm.
 * All random operations in the engine MUST use this instead of Math.random().
 */
export class SeededRNG {
  constructor(seed) {
    this.seed = seed | 0;
    this.state = seed | 0;
  }

  /**
   * Generate next random number in [0, 1).
   * @returns {number}
   */
  next() {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Generate random integer in [min, max] (inclusive).
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  nextInt(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /**
   * Pick a random element from an array.
   * @param {Array} arr
   * @returns {*} random element
   */
  pick(arr) {
    return arr[this.nextInt(0, arr.length - 1)];
  }

  /**
   * Shuffle an array in place using Fisher-Yates.
   * @param {Array} arr
   * @returns {Array} the shuffled array
   */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * Create a clone with the same seed state.
   * @returns {SeededRNG}
   */
  clone() {
    const r = new SeededRNG(this.seed);
    r.state = this.state;
    return r;
  }
}
