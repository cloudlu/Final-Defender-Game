import { ConfigLoader } from './ConfigLoader.js';
import enemiesData from './enemies.json';
import balanceData from './balance.json';
import equipmentData from './equipment.json';
import levelsData from './levels.json';
import globalUpgradesData from './globalUpgrades.json';
import bossData from './boss.json';

/**
 * 游戏配置的唯一装载入口：启动时校验，出错 fail-fast。
 * 引擎消费什么字段就校验什么字段，防止"数据/引擎脱节"类缺陷再次发生。
 */

/** 引擎已实现、可派发的敌人行为处理器名单（新增行为处理器后在此登记） */
const REGISTERED_ENEMY_BEHAVIORS = ['fly', 'split', 'explode', 'dash', 'heal_aura', 'enrage', 'burrow', 'revive3', 'bandage_heal', 'vampire'];

let cached = null;

/**
 * @returns {{ enemies: object[], balance: object, equipment: object[] }}
 * @throws {Error} 配置校验失败时抛出（fail-fast）
 */
export function loadGameConfigs() {
  if (cached) return cached;

  const loader = new ConfigLoader();
  loader.registerBehaviors(REGISTERED_ENEMY_BEHAVIORS);
  loader.load('enemies', enemiesData);
  loader.load('skills', []); // 技能卡体系已被升级三选一替代，保留 schema 校验入口
  loader.load('equipment', equipmentData);
  // balance 单独校验：关键字段必须是正数
  for (const key of ['startingGold', 'startingLives', 'difficultyScalePerWave', 'bossInterval']) {
    if (typeof balanceData[key] !== 'number' || balanceData[key] <= 0) {
      loader.errors.push(`[balance] ${key} must be a positive number`);
    }
  }

  if (loader.hasErrors()) {
    const msg = ['Game config validation failed:', ...loader.getErrors().map(e => `  - ${e}`)].join('\n');
    throw new Error(msg);
  }

  // levels.json 结构校验：enemyWaves 引用的敌人必须存在（"BOSS" 是关键字标记，非敌人 id）
  for (const lv of levelsData.levels) {
    for (const wave of lv.enemyWaves) {
      for (const enemyId of wave) {
        if (enemyId === 'BOSS') continue;
        if (!enemiesData.find(e => e.id === enemyId)) {
          throw new Error(`[levels] ${lv.id} references unknown enemy "${enemyId}"`);
        }
      }
    }
  }

  // boss.json 校验：reward/skills 必填
  for (const b of bossData.bosses) {
    if (!b.reward || typeof b.reward.gold !== 'number') {
      throw new Error(`[boss] ${b.id} must have numeric reward.gold`);
    }
    if (!Array.isArray(b.skills)) {
      throw new Error(`[boss] ${b.id} must have skills array`);
    }
  }

  // globalUpgrades.json 校验：maxLevel/baseCost 正数、stat 合法
  const GLOBAL_STATS = ['damage', 'attackSpeed', 'wallHp', 'xpBonus', 'goldBonus'];
  for (const up of globalUpgradesData.upgrades) {
    if (!(up.maxLevel > 0) || !(up.baseCost > 0)) {
      throw new Error(`[globalUpgrades] ${up.id} must have positive maxLevel and baseCost`);
    }
    if (!GLOBAL_STATS.includes(up.stat)) {
      throw new Error(`[globalUpgrades] ${up.id} has unknown stat "${up.stat}"`);
    }
  }

  cached = {
    enemies: enemiesData, balance: balanceData, equipment: equipmentData,
    levelsConfig: levelsData, globalUpgrades: globalUpgradesData.upgrades,
    bosses: bossData.bosses,
  };
  return cached;
}
