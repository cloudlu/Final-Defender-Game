import { describe, it, expect } from 'vitest';
import { ReviveSystem } from './ReviveSystem.js';
import { GameState } from './GameState.js';
import { WaveManager } from './WaveManager.js';
import { SeededRNG } from './SeededRNG.js';
import { Enemy } from './Enemy.js';
import enemiesData from '../data/enemies.json';
import balanceData from '../data/balance.json';

describe('ReviveSystem', () => {
  it('cannot revive without diamonds', () => {
    const r = new ReviveSystem({ diamond: 50 });
    expect(r.canRevive()).toBe(false);
    expect(r.performRevive()).toBeNull();
  });

  it('revives by consuming diamonds, once per run', () => {
    const save = { diamond: 250 };
    const r = new ReviveSystem(save);
    expect(r.canRevive()).toBe(true);
    const params = r.performRevive();
    expect(params.wallHpRestorePct).toBe(0.5);
    expect(save.diamond).toBe(150); // 250 - 100
    expect(r.performRevive()).toBeNull(); // 每局限 1 次
  });
});

describe('GameState.applyRevive', () => {
  function createGame() {
    return new GameState(enemiesData, balanceData, []);
  }

  it('restores wall to 50%, clears enemies, grants invulnerability', () => {
    const state = createGame();
    state.lives = 1;
    state.gameOver = true;
    const cfg = enemiesData.find(c => c.id === 'enemy_basic');
    state.enemies.push(new Enemy(cfg, 4, 5, 1.0));
    const ok = state.applyRevive({ wallHpRestorePct: 0.5, clearEnemies: true, invulnSeconds: 1.5 });
    expect(ok).toBe(true);
    expect(state.gameOver).toBe(false);
    expect(state.lives).toBe(Math.round(state.wallHpMax * 0.5));
    expect(state.enemies.length).toBe(0);
    expect(state.invulnTimer).toBeGreaterThan(0);
  });

  it('invulnerability blocks wall damage', () => {
    const state = createGame();
    state.gameOver = true; // applyRevive 前置条件
    state.applyRevive({ invulnSeconds: 999 });
    const hpBefore = state.lives;
    const cfg = enemiesData.find(c => c.id === 'enemy_basic');
    const e = new Enemy(cfg, 4, state.wallRow - 0.01, 1.0);
    state.enemies.push(e);
    e.update(1); // 到墙
    state.update(1 / 30);
    expect(state.lives).toBe(hpBefore); // 无敌免伤
  });

  it('applyRevive fails when not game over', () => {
    const state = createGame();
    expect(state.applyRevive()).toBe(false);
  });
});

describe('WaveManager density', () => {
  const balanceConfig = { difficultyScalePerWave: 0.1, bossInterval: 10, earlySummonBonusGold: 5 };
  const enemyConfigs = [
    { id: 'enemy_basic', name: '基础僵尸', hp: 30, speed: 1.5, bounty: 5, armor: 0 },
  ];

  it('density multiplies per-kind count', () => {
    const base = { levelId: 'T', name: 'T', brief: '', enemyWaves: [['enemy_basic']], difficulty: 1, elite: false, wallHp: 20, totalWaves: 1 };
    const rng = new SeededRNG(7);
    const sparse = new WaveManager(balanceConfig, enemyConfigs, { ...base, density: 1.0 });
    const dense = new WaveManager(balanceConfig, enemyConfigs, { ...base, density: 2.0 });
    expect(dense.startWave(rng).count).toBe(sparse.startWave(rng).count * 2);
  });

  it('spawn interval shrinks with density (floor 0.25)', () => {
    const base = { levelId: 'T', name: 'T', brief: '', enemyWaves: [['enemy_basic']], difficulty: 1, elite: false, wallHp: 20, totalWaves: 1 };
    const rng = new SeededRNG(7);
    const dense = new WaveManager(balanceConfig, enemyConfigs, { ...base, density: 99 });
    dense.startWave(rng);
    expect(dense.spawnInterval).toBe(0.25);
  });
});
