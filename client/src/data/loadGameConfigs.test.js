import { describe, it, expect } from 'vitest';
import { loadGameConfigs } from './loadGameConfigs.js';

describe('loadGameConfigs (runtime config validation)', () => {
  it('loads and validates real game configs without errors', () => {
    const cfg = loadGameConfigs();
    expect(cfg.enemies.length).toBeGreaterThan(0);
    expect(cfg.equipment.length).toBeGreaterThan(0);
    expect(cfg.balance.startingLives).toBeGreaterThan(0);
  });

  it('returns cached instance (single source of truth)', () => {
    expect(loadGameConfigs()).toBe(loadGameConfigs());
  });

  it('all enemy behaviors are registered with the engine', () => {
    // loadGameConfigs 内部已用 REGISTERED_ENEMY_BEHAVIORS 校验，能走到这里即通过
    const cfg = loadGameConfigs();
    for (const e of cfg.enemies) {
      if (e.behavior) expect(typeof e.behavior.type).toBe('string');
    }
  });
});
