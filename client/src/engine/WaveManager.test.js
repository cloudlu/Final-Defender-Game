import { describe, it, expect } from 'vitest';
import { WaveManager } from './WaveManager.js';
import { SeededRNG } from './SeededRNG.js';

const balanceConfig = {
  difficultyScalePerWave: 0.1,
  bossInterval: 10,
  earlySummonBonusGold: 5,
};

const enemyConfigs = [
  { id: 'enemy_basic', name: '基础僵尸', hp: 30, speed: 1.5, bounty: 5, armor: 0 },
  { id: 'enemy_runner', name: '迅捷僵尸', hp: 15, speed: 2.5, bounty: 7, armor: 0 },
  { id: 'enemy_tank', name: '重装僵尸', hp: 200, speed: 0.8, bounty: 25, armor: 3 },
];

const levelRuntime = {
  levelId: 'T1',
  name: '测试关',
  brief: '',
  enemyWaves: [
    ['enemy_basic'],
    ['enemy_basic', 'enemy_runner'],
    ['enemy_tank'],
  ],
  difficulty: 1.0,
  elite: false,
  wallHp: 20,
  totalWaves: 3,
};

describe('WaveManager (endless mode)', () => {
  it('starts wave 1 with enemies from full config pool', () => {
    const wm = new WaveManager(balanceConfig, enemyConfigs);
    const rng = new SeededRNG(42);
    const info = wm.startWave(rng);
    expect(info.wave).toBe(1);
    expect(info.count).toBeGreaterThan(0);
  });

  it('increases difficulty each wave', () => {
    const wm = new WaveManager(balanceConfig, enemyConfigs);
    const rng = new SeededRNG(42);
    const info1 = wm.startWave(rng);
    wm.endWave();
    const info2 = wm.startWave(rng);
    expect(info2.difficultyMultiplier).toBeGreaterThan(info1.difficultyMultiplier);
  });

  it('spawns enemies from queue with valid spawn col', () => {
    const wm = new WaveManager(balanceConfig, enemyConfigs);
    const rng = new SeededRNG(42);
    wm.startWave(rng);
    const spawn = wm.update(10);
    expect(spawn).not.toBeNull();
    expect(spawn.config).toBeDefined();
    expect(spawn.spawnCol).toBeGreaterThanOrEqual(1);
    expect(spawn.spawnCol).toBeLessThanOrEqual(6); // GRID.COLS - 2
  });

  it('wave completes when queue empty and no alive enemies', () => {
    const wm = new WaveManager(balanceConfig, enemyConfigs);
    const rng = new SeededRNG(42);
    wm.startWave(rng);
    while (wm.update(1) !== null) {}
    expect(wm.isWaveComplete(0)).toBe(true);
  });
});

describe('WaveManager (level mode)', () => {
  it('wave composition follows enemyWaves table (3 per kind)', () => {
    const wm = new WaveManager(balanceConfig, enemyConfigs, levelRuntime);
    const rng = new SeededRNG(42);
    const info = wm.startWave(rng);
    expect(info.wave).toBe(1);
    expect(info.count).toBe(3); // 1 kind × 3
    // all spawned are basic
    while (wm.update(10) !== null) {} // drain via large step: only 1 spawn fires per call
    expect(info.isFinalWave).toBe(false);
  });

  it('final wave is flagged and level completes after it ends', () => {
    const wm = new WaveManager(balanceConfig, enemyConfigs, levelRuntime);
    const rng = new SeededRNG(42);
    // waves 1-2
    for (let w = 1; w <= 2; w++) {
      wm.startWave(rng);
      wm.endWave();
      wm.notifyWaveEnded();
    }
    const final = wm.startWave(rng);
    expect(final.isFinalWave).toBe(true);
    expect(final.count).toBe(4); // 1 kind × 4 (final wave boost)
    wm.endWave();
    wm.notifyWaveEnded();
    expect(wm.isLevelComplete()).toBe(true);
  });

  it('applies level difficulty multiplier', () => {
    const wm = new WaveManager(balanceConfig, enemyConfigs, { ...levelRuntime, difficulty: 1.6 });
    const rng = new SeededRNG(42);
    const info = wm.startWave(rng);
    expect(info.difficultyMultiplier).toBeCloseTo(1.6, 5);
  });

  it('level mode does not use random composition', () => {
    const wm = new WaveManager(balanceConfig, enemyConfigs, levelRuntime);
    const rng = new SeededRNG(42);
    const info2 = (() => { wm.startWave(rng); wm.endWave(); wm.notifyWaveEnded(); return wm.startWave(rng); })();
    expect(info2.count).toBe(6); // 2 kinds × 3
  });
});
