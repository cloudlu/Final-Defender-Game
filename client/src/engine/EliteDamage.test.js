import { describe, it, expect } from 'vitest';
import { GameState } from './src/engine/GameState.js';
import { Enemy } from './src/engine/Enemy.js';
import { GemSystem } from './src/engine/GemSystem.js';
import enemiesData from './src/data/enemies.json';
import balance from './src/data/balance.json';
import gemsData from './src/data/gems.json';

/** v8.12 回归：镶精英增伤宝石后施放技能不得 ReferenceError（enemy is not defined） */
describe('精英增伤宝石 × 技能施放', () => {
  it('eliteDamage 宝石存在时所有技能类型施放不崩且精英受伤加成', () => {
    const gemSave = { collection: { gX1: { affixId: 'elite_dmg', quality: 2 } }, sockets: {}, nextUid: 2 };
    const gems = new GemSystem(gemsData, gemSave);
    gems.equip('weapon', 0, 'gX1');
    const state = new GameState(enemiesData, balance, [], null, { rngSeed: 7, gemSystem: gems });
    state.startWave();
    state.waveManager.spawnQueue.length = 0;
    const boss = new Enemy(enemiesData.find(c => c.id === 'enemy_basic'), 4, 5, 1);
    boss.hp = 999999;
    state.enemies.push(boss);

    // 解锁并施放各类技能（覆盖全部 _rollDamageWithCrit 调用分支）
    for (const id of ['fuelbomb', 'empierce', 'cyclone', 'guidedlaser', 'vehicle', 'airstrike', 'ray', 'drone', 'rift', 'dryice', 'thermobaric', 'airblade', 'leapwave']) {
      const skill = state.player.skills.find(s => s.id === id);
      if (!skill) continue;
      state.player.unlockSkill(id);
      const r = state.useSkill(id, 4, 5);
      if (r) expect(r.damage).not.toBeNaN();
    }
    // 无异常即通过（旧代码在 eliteDamage>0 时直接 ReferenceError）
  });

  it('精英敌人吃 eliteDamage 加成，普通敌不吃', () => {
    const gemSave = { collection: { gX1: { affixId: 'elite_dmg', quality: 6 } }, sockets: {}, nextUid: 2 };
    const gems = new GemSystem(gemsData, gemSave);
    gems.equip('weapon', 0, 'gX1'); // 至尊 = +140%
    const state = new GameState(enemiesData, balance, [], null, { rngSeed: 7, gemSystem: gems });
    const stats = state.getResolvedStats();
    const normal = state._rollDamageWithCrit(stats, 10, null, { enemy: { isBoss: false, elite: false }, skillId: 'ray' });
    const elite = state._rollDamageWithCrit(stats, 10, null, { enemy: { isBoss: true }, skillId: 'ray' });
    // 取期望值不现实（暴击随机），用多次采样比较均值
    let nSum = 0, eSum = 0;
    for (let i = 0; i < 200; i++) {
      nSum += state._rollDamageWithCrit(stats, 10, null, { enemy: { isBoss: false }, skillId: 'ray' }).damage;
      eSum += state._rollDamageWithCrit(stats, 10, null, { enemy: { isBoss: true }, skillId: 'ray' }).damage;
    }
    expect(eSum / nSum).toBeGreaterThan(2.2); // 140% 增伤 → 均值比 > 2.4 理论，取 2.2 容差
  });
});
