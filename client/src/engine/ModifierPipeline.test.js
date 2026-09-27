import { describe, it, expect } from 'vitest';
import { ModifierPipeline } from './ModifierPipeline.js';

const CAPS = {
  damage: 3.0, attackSpeed: 2.0, range: 5,
  critRate: 0.75, critDamage: 3.0, slowPct: 0.80, goldBonus: 2.0,
};

const m = (stat, type, value) => ({ stat, type, value });

describe('ModifierPipeline', () => {
  it('returns base with no modifiers', () => {
    const p = new ModifierPipeline(CAPS);
    expect(p.resolve(10, 'damage', [])).toBe(10);
  });

  it('adds stack additively', () => {
    const p = new ModifierPipeline(CAPS);
    expect(p.resolve(10, 'damage', [m('damage', 'add', 5), m('damage', 'add', 3)])).toBe(18);
  });

  it('mul_pct stacks additively then multiplies', () => {
    const p = new ModifierPipeline(CAPS);
    // (10) * (1 + 0.2 + 0.3) = 15
    expect(p.resolve(10, 'damage', [m('damage', 'mul_pct', 0.2), m('damage', 'mul_pct', 0.3)])).toBe(15);
  });

  it('mul stacks multiplicatively', () => {
    const p = new ModifierPipeline(CAPS);
    // (10) * 1.5 * 2.0 = 30
    expect(p.resolve(10, 'damage', [m('damage', 'mul', 1.5), m('damage', 'mul', 2.0)])).toBe(30);
  });

  it('order of operations: add, then mul_pct, then mul, regardless of registration order', () => {
    const p = new ModifierPipeline(CAPS);
    // (10 + 10) * 1.5 * 2 = 60, then capped at 3x base = 30
    const mods = [m('damage', 'mul', 2), m('damage', 'add', 10), m('damage', 'mul_pct', 0.5)];
    expect(p.resolve(10, 'damage', mods)).toBe(30);
    mods.reverse();
    expect(p.resolve(10, 'damage', mods)).toBe(30);
  });

  it('uncapped stat (no cap defined) exceeds any cap value', () => {
    const p = new ModifierPipeline({});
    expect(p.resolve(10, 'damage', [m('damage', 'mul', 2), m('damage', 'add', 10), m('damage', 'mul_pct', 0.5)])).toBe(60);
  });

  it('ignores modifiers of other stats', () => {
    const p = new ModifierPipeline(CAPS);
    expect(p.resolve(10, 'damage', [m('goldBonus', 'add', 100)])).toBe(10);
  });

  it('caps damage at 3x base', () => {
    const p = new ModifierPipeline(CAPS);
    expect(p.resolve(10, 'damage', [m('damage', 'mul_pct', 99)])).toBe(30);
    expect(p.resolve(10, 'damage', [m('damage', 'add', 100)])).toBe(30);
  });

  it('critRate caps at absolute 0.75 regardless of base', () => {
    const p = new ModifierPipeline(CAPS);
    expect(p.resolve(0.05, 'critRate', [m('critRate', 'add', 5)])).toBe(0.75);
  });

  it('caps critRate at absolute cap', () => {
    const p = new ModifierPipeline(CAPS);
    // base 0.05 + 0.1 + 0.2 + 0.3 = 0.65 under cap; then exceed
    expect(p.resolve(0.05, 'critRate', [m('critRate', 'add', 0.1), m('critRate', 'add', 0.2)])).toBeCloseTo(0.35, 5);
    expect(p.resolve(0.05, 'critRate', [m('critRate', 'add', 5)])).toBe(0.75);
  });

  it('attackSpeed cap = 2x base speed, i.e. interval floor at base/2', () => {
    const p = new ModifierPipeline(CAPS);
    // mild speedup: interval 1 - 0.3 = 0.7
    expect(p.resolve(1, 'attackSpeed', [m('attackSpeed', 'mul_pct', -0.3)])).toBe(0.7);
    // extreme speedup beyond cap: interval floored at 0.5
    expect(p.resolve(1, 'attackSpeed', [m('attackSpeed', 'mul_pct', -9)])).toBe(0.5);
  });

  it('negative results are not possible for positive base with positive modifiers', () => {
    const p = new ModifierPipeline(CAPS);
    expect(p.resolve(10, 'damage', [m('damage', 'mul_pct', -0.5)])).toBe(5);
  });
});
