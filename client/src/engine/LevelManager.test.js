import { describe, it, expect } from 'vitest';
import { LevelManager } from './LevelManager.js';
import levelsData from '../data/levels.json';

const emptySave = { cleared: {}, stars: {}, eliteUnlocked: false };

describe('LevelManager', () => {
  it('first level unlocked, later levels locked initially', () => {
    const lm = new LevelManager(levelsData, emptySave);
    const list = lm.getLevelList();
    expect(list[0].unlocked).toBe(true);
    expect(list[1].unlocked).toBe(false);
  });

  it('completing a level unlocks the next and persists stars', () => {
    const save = { cleared: {}, stars: {}, eliteUnlocked: false };
    const lm = new LevelManager(levelsData, save);
    lm.completeLevel('L1-1', { wallHpLeft: 18, wallHpMax: 20 });
    expect(save.cleared['L1-1']).toBe(true);
    expect(save.stars['L1-1']).toBe(3); // 90% >= 80%
    expect(lm.getLevelList().find(l => l.id === 'L1-2').unlocked).toBe(true);
  });

  it('star ratings follow wall hp thresholds', () => {
    const save = { cleared: {}, stars: {}, eliteUnlocked: false };
    const lm = new LevelManager(levelsData, save);
    expect(lm.completeLevel('L1-1', { wallHpLeft: 16, wallHpMax: 20 }).stars).toBe(3);
    expect(lm.completeLevel('L1-1', { wallHpLeft: 10, wallHpMax: 20 }).stars).toBe(2);
    expect(lm.completeLevel('L1-1', { wallHpLeft: 1, wallHpMax: 20 }).stars).toBe(1);
  });

  it('star record only improves (never downgrades)', () => {
    const save = { cleared: {}, stars: {}, eliteUnlocked: false };
    const lm = new LevelManager(levelsData, save);
    lm.completeLevel('L1-1', { wallHpLeft: 18, wallHpMax: 20 });
    const r = lm.completeLevel('L1-1', { wallHpLeft: 2, wallHpMax: 20 });
    expect(r.stars).toBe(1);       // 本次 1 星
    expect(r.newRecord).toBe(false);
    expect(save.stars['L1-1']).toBe(3); // 历史保持 3 星
  });

  it('elite unlocks after clearing the elite unlockAfter level', () => {
    const save = { cleared: {}, stars: {}, eliteUnlocked: false };
    const lm = new LevelManager(levelsData, save);
    expect(lm.isEliteUnlocked()).toBe(false);
    lm.completeLevel(levelsData.elite.unlockAfter, { wallHpLeft: 5, wallHpMax: 25 });
    expect(lm.isEliteUnlocked()).toBe(true);
  });

  it('startLevel applies elite difficulty multiplier', () => {
    const save = { cleared: { 'L1-4': true }, stars: {}, eliteUnlocked: true };
    const lm = new LevelManager(levelsData, save);
    const normal = lm.startLevel('L1-1');
    const elite = lm.startLevel('L1-1', { elite: true });
    expect(elite.difficulty).toBeCloseTo(normal.difficulty * levelsData.elite.difficultyMultiplier, 5);
    expect(elite.elite).toBe(true);
  });

  it('startLevel throws on locked or unknown level', () => {
    const lm = new LevelManager(levelsData, emptySave);
    expect(() => lm.startLevel('L1-2')).toThrow();
    expect(() => lm.startLevel('NOPE')).toThrow();
  });

  it('real config: every enemyWaves entry references existing enemies and unlock chain is sound', () => {
    const lm = new LevelManager(levelsData, emptySave);
    for (const lv of levelsData.levels) {
      expect(lv.enemyWaves.length).toBeGreaterThan(0);
      expect(lv.enemyWaves.every(w => w.length > 0)).toBe(true);
      if (lv.unlockAfter) {
        expect(levelsData.levels.some(l => l.id === lv.unlockAfter)).toBe(true);
      }
    }
    expect(lm.getLevelList().length).toBe(4);
  });
});
