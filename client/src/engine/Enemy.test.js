import { describe, it, expect } from 'vitest';
import { Enemy } from './Enemy.js';

const basicConfig = {
  id: 'enemy_basic',
  name: '基础僵尸',
  hp: 30,
  speed: 1.5,
  bounty: 5,
  armor: 0,
  behavior: null,
};

const tankConfig = {
  id: 'enemy_tank',
  name: '重装僵尸',
  hp: 200,
  speed: 0.8,
  bounty: 25,
  armor: 3,
  behavior: null,
};

describe('Enemy', () => {
  it('creates with correct stats', () => {
    const e = new Enemy(basicConfig, 5, 0, 1.0);
    expect(e.hp).toBe(30);
    expect(e.maxHp).toBe(30);
    expect(e.speed).toBe(1.5);
    expect(e.alive).toBe(true);
    expect(e.col).toBe(5);
    expect(e.row).toBe(0);
  });

  it('scales with difficulty', () => {
    const e = new Enemy(basicConfig, 5, 0, 2.0);
    expect(e.hp).toBe(60);
    expect(e.maxHp).toBe(60);
  });

  it('moves toward wall (row increases)', () => {
    const e = new Enemy(basicConfig, 5, 0, 1.0);
    const startRow = e.row;
    e.update(1.0);
    expect(e.row).toBeGreaterThan(startRow);
  });

  it('takes damage and dies', () => {
    const e = new Enemy(basicConfig, 5, 0, 1.0);
    const killed = e.takeDamage(50);
    expect(killed).toBe(true);
    expect(e.alive).toBe(false);
  });

  it('armor reduces damage', () => {
    const e = new Enemy(tankConfig, 5, 0, 1.0);
    e.takeDamage(10);
    expect(e.hp).toBe(200 - 7); // 10 - 3 = 7
  });

  it('reaches end at row 12', () => {
    const e = new Enemy(basicConfig, 5, 0, 1.0);
    e.row = 12;
    e.update(0.1);
    expect(e.reachedEnd).toBe(true);
    expect(e.alive).toBe(false);
  });

  it('slows with slow effect', () => {
    const e = new Enemy(basicConfig, 5, 0, 1.0);
    e.slowFactor = 0.5;
    e.slowTimer = 2;
    e.update(1.0);
    expect(e.slowTimer).toBe(1);
  });

  it('stun prevents movement', () => {
    const e = new Enemy(basicConfig, 5, 0, 1.0);
    e.stunTimer = 1;
    const startRow = e.row;
    e.update(0.5);
    expect(e.row).toBe(startRow);
  });

  it('takes DOT damage', () => {
    const e = new Enemy(basicConfig, 5, 0, 1.0);
    e.dotEffects.push({ damage: 10, duration: 2 });
    e.update(1.0);
    expect(e.hp).toBe(20); // 30 - 10
  });

  it('returns null for no split config', () => {
    const e = new Enemy(basicConfig, 5, 0, 1.0);
    expect(e.getSplitConfig()).toBeNull();
  });

  it('returns split config when set', () => {
    const splitEnemy = {
      ...basicConfig,
      behavior: { type: 'split', count: 2, enemyId: 'enemy_basic' },
    };
    const e = new Enemy(splitEnemy, 5, 0, 1.0);
    expect(e.getSplitConfig()).not.toBeNull();
    expect(e.getSplitConfig().count).toBe(2);
  });
});
