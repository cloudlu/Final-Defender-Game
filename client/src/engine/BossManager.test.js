import { describe, it, expect } from 'vitest';
import { GameState } from './GameState.js';
import { BossManager } from './BossManager.js';
import { Enemy } from './Enemy.js';
import { SeededRNG } from './SeededRNG.js';
import enemiesData from '../data/enemies.json';
import balanceData from '../data/balance.json';

const bossCfg = [{
  id: 'boss_king', name: '胖尸王', hp: 3000, speed: 0.45, armor: 6, bounty: 0,
  wallDamage: 10,
  skills: [
    { type: 'summon', interval: 9, enemyId: 'enemy_basic', count: 2 },
    { type: 'speedBurst', interval: 12, multiplier: 2.0, duration: 3, warnSeconds: 1.0 },
    { type: 'roar', interval: 14, silenceSeconds: 2, warnSeconds: 1.0 },
  ],
  reward: { gold: 500, diamond: 50 },
}];

function createGameWithBoss() {
  const state = new GameState(enemiesData, balanceData, [], null, { bossConfig: bossCfg });
  state._spawnBoss();
  return state;
}

describe('BOSS system', () => {
  it('spawnBoss creates boss enemy with override wall damage and reward', () => {
    const state = createGameWithBoss();
    const boss = state.enemies.find(e => e.isBoss);
    expect(boss).toBeDefined();
    expect(state._getWallDamage(boss)).toBe(10);
    expect(boss.bossReward.gold).toBe(500);
  });

  it('boss kill grants fixed reward (not bounty) and clears boss manager', () => {
    const state = createGameWithBoss();
    const boss = state.enemies.find(e => e.isBoss);
    const goldBefore = state.gold;
    boss.takeDamage(999999);
    state._onKill(boss);
    expect(state.gold).toBe(goldBefore + 500);
    expect(state.bossRewardDiamond).toBe(50);
    expect(state.bossManager.activeBoss).toBeNull();
    expect(state.events.some(e => e.type === 'bossKill')).toBe(true);
  });

  it('summon skill spawns minions over time', () => {
    const state = createGameWithBoss();
    const countBefore = state.enemies.length;
    // 推进 10s（summon interval 9s）
    for (let i = 0; i < 10 * 30; i++) state.update(1 / 30);
    expect(state.enemies.length).toBeGreaterThan(countBefore);
    // 新增的都是非 boss
    expect(state.enemies.filter(e => !e.isBoss).length).toBeGreaterThan(0);
  });

  it('roar silences player skills after warning', () => {
    const state = createGameWithBoss();
    state.player.unlockSkill('fireball');
    // 推进 15s（roar interval 14 + warn 1）
    let sawRoar = false;
    for (let i = 0; i < 16 * 30; i++) {
      state.update(1 / 30);
      if (state.events.some(e => e.type === 'roar')) { sawRoar = true; break; }
    }
    expect(sawRoar).toBe(true);
    expect(state.player.silencedTimer).toBeGreaterThan(0);
    // 沉默中放技能无效
    expect(state.player.useSkill('fireball')).toBeNull();
  });

  it('boss wave flag triggers on marked final wave only', () => {
    const levelRuntime = {
      levelId: 'T', name: 'T', brief: '',
      enemyWaves: [['enemy_basic'], ['BOSS', 'enemy_basic']],
      difficulty: 1, elite: false, wallHp: 20, totalWaves: 2,
      density: 1,
    };
    const state = new GameState(enemiesData, balanceData, [], levelRuntime, { bossConfig: bossCfg });
    state.startWave();
    expect(state.waveManager.bossWave).toBeFalsy();
    state.waveManager.endWave();
    state.waveManager.notifyWaveEnded();
    state.startWave();
    expect(state.waveManager.bossWave).toBe(true);
  });

  it('BossManager clears when boss dies', () => {
    const mgr = new BossManager();
    const rng = new SeededRNG(1);
    const boss = new Enemy({ id: 'b', name: 'B', hp: 10, speed: 1, bounty: 0, isBoss: true, bossSkills: [{ type: 'summon', interval: 5, enemyId: 'enemy_basic', count: 1 }] }, 4, 0, 1, rng);
    mgr.register(boss);
    expect(mgr.activeBoss).toBe(boss);
    boss.takeDamage(999);
    mgr.update(1, {});
    expect(mgr.activeBoss).toBeNull();
  });
});
