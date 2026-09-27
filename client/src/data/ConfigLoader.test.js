import { describe, it as test, expect } from 'vitest';
import { ConfigLoader } from './ConfigLoader.js';

const validTowers = [
  { id: 'archer', name: 'Archer', behaviors: ['shoot'], stats: { damage: 10, attackSpeed: 1.5 }, price: 100 },
  { id: 'cannon', name: 'Cannon', behaviors: ['shoot'], stats: { damage: 50, attackSpeed: 0.5 }, price: 300 },
];

const validEnemies = [
  { id: 'goblin', name: 'Goblin', hp: 50, speed: 2, bounty: 5, behavior: null },
  { id: 'troll', name: 'Troll', hp: 200, speed: 0.8, bounty: 20, armor: 3, behavior: null },
];

describe('ConfigLoader', () => {
  test('load towers with valid data produces no errors', () => {
    const loader = new ConfigLoader();
    loader.load('towers', validTowers);
    expect(loader.hasErrors()).toBe(false);
  });

  test('load towers missing required field produces error', () => {
    const loader = new ConfigLoader();
    const badTowers = [{ id: 'archer', name: 'Archer', behaviors: ['shoot'] }];
    loader.load('towers', badTowers);
    expect(loader.hasErrors()).toBe(true);
    const errors = loader.getErrors();
    expect(errors.some(e => e.includes('Missing required field'))).toBe(true);
  });

  test('load enemies with valid data produces no errors', () => {
    const loader = new ConfigLoader();
    loader.load('enemies', validEnemies);
    expect(loader.hasErrors()).toBe(false);
  });

  test('invalid id with spaces produces error', () => {
    const loader = new ConfigLoader();
    const badTowers = [{ id: 'bad id', name: 'Bad', behaviors: ['shoot'], stats: { damage: 1 }, price: 50 }];
    loader.load('towers', badTowers);
    expect(loader.hasErrors()).toBe(true);
    const errors = loader.getErrors();
    expect(errors.some(e => e.includes('Invalid id'))).toBe(true);
  });

  test('stats field with non-number value produces error', () => {
    const loader = new ConfigLoader();
    const badTowers = [{ id: 'archer', name: 'Archer', behaviors: ['shoot'], stats: { damage: 'ten' }, price: 100 }];
    loader.load('towers', badTowers);
    expect(loader.hasErrors()).toBe(true);
    const errors = loader.getErrors();
    expect(errors.some(e => e.includes('must be a number'))).toBe(true);
  });

  test('getById returns correct item', () => {
    const loader = new ConfigLoader();
    loader.load('towers', validTowers);
    const tower = loader.getById('towers', 'cannon');
    expect(tower).toBeDefined();
    expect(tower.id).toBe('cannon');
    expect(tower.name).toBe('Cannon');
  });

  test('get returns the full config', () => {
    const loader = new ConfigLoader();
    loader.load('towers', validTowers);
    const all = loader.get('towers');
    expect(all).toBe(validTowers);
    expect(all.length).toBe(2);
  });

  test('unknown config name loads without errors', () => {
    const loader = new ConfigLoader();
    loader.load('customData', { foo: 'bar' });
    expect(loader.hasErrors()).toBe(false);
    expect(loader.get('customData')).toEqual({ foo: 'bar' });
  });
});
