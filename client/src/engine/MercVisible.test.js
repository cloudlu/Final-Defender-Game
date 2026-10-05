import { describe, it, expect } from 'vitest';
import { GameState } from './src/engine/GameState.js';
import { Enemy } from './src/engine/Enemy.js';
import { MercenarySystem } from './src/engine/MercenarySystem.js';
import enemiesData from './src/data/enemies.json';
import balance from './src/data/balance.json';
import mercData from './src/data/mercenaries.json';

/** v8.11 回归：出战两佣兵都有可见攻击（aoe 型也生成弹道，旧实现直落点结算无弹道被玩家误读为"没攻击"） */
describe('双佣兵攻击可见性', () => {
  it('aoe 型+非 aoe 型佣兵都会产生弹道（玩家存档 deployed=[chrono, arrow]）', () => {
    const mercs = new MercenarySystem(mercData.mercenaries, {
      owned: {
        merc_chrono: { quality: '完美', level: 10, shards: 4 },
        merc_arrow: { quality: '完美', level: 1, shards: 12 },
      },
      deployed: ['merc_chrono', 'merc_arrow'],
    });
    const state = new GameState(enemiesData, balance, [], null, { rngSeed: 7, mercenarySystem: mercs });
    state.startWave();
    state.waveManager.spawnQueue.length = 0;
    const e = new Enemy(enemiesData.find(c => c.id === 'enemy_basic'), 4, 5, 1);
    e.hp = 999999;
    state.enemies.push(e);

    const mercProjByColor = [];
    const orig = state._createProjectile.bind(state);
    state._createProjectile = (skillId, fromCol, fromRow, toCol, toRow, opts) => {
      if (skillId === 'merc') mercProjByColor.push(opts?.color);
      return orig(skillId, fromCol, fromRow, toCol, toRow, opts);
    };

    // 15 秒模拟：chrono(5s)+arrow(2s) 至少各打 2 次
    for (let i = 0; i < 900; i++) {
      state.update(1 / 60);
      e.row = 5; e.col = 4; e.hp = 999999;
    }
    console.log('merc 弹道总数 =', mercProjByColor.length, '颜色分布 =', JSON.stringify(mercProjByColor));
    expect(mercProjByColor.length).toBeGreaterThanOrEqual(4); // chrono≥2 + arrow≥2
    // 两佣兵颜色不同（紫 0xcc66ff vs 草绿 0x88ff44）
    expect(new Set(mercProjByColor).size).toBe(2);
  });
});
