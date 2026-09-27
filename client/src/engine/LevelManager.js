import levelsData from '../data/levels.json';

/**
 * LevelManager: 关卡表驱动。职责：
 * 1. 关卡解锁判定（unlockAfter 链 + 精英难度）
 * 2. 关卡波次组成（enemyWaves 表 → 出怪队列）
 * 3. 星级评定（按通关时墙血百分比）
 * 纯逻辑无 Phaser 依赖。
 */
export class LevelManager {
  constructor(levelsConfig = levelsData, playerSave = null) {
    this.levels = levelsConfig.levels;
    this.elite = levelsConfig.elite || null;
    this.save = playerSave || { cleared: {}, stars: {}, eliteUnlocked: false };
  }

  /** @returns 关卡列表（含解锁状态与星级） */
  getLevelList() {
    return this.levels.map(lv => ({
      id: lv.id,
      name: lv.name,
      brief: lv.brief,
      waves: lv.enemyWaves.length,
      unlocked: this.isUnlocked(lv.id),
      stars: this.save.stars[lv.id] || 0,
      difficulty: lv.difficulty,
    }));
  }

  getLevel(levelId) {
    return this.levels.find(lv => lv.id === levelId) || null;
  }

  isUnlocked(levelId) {
    const lv = this.getLevel(levelId);
    if (!lv) return false;
    if (!lv.unlockAfter) return true;
    return !!this.save.cleared[lv.unlockAfter];
  }

  isEliteUnlocked() {
    return this.elite ? !!this.save.cleared[this.elite.unlockAfter] : false;
  }

  /** 开始关卡：返回运行时关卡状态（WaveManager 消费） */
  startLevel(levelId, { elite = false } = {}) {
    const lv = this.getLevel(levelId);
    if (!lv) throw new Error(`Unknown level: ${levelId}`);
    if (!this.isUnlocked(levelId)) throw new Error(`Level locked: ${levelId}`);
    return {
      levelId: lv.id,
      name: lv.name,
      brief: lv.brief,
      enemyWaves: lv.enemyWaves,
      difficulty: lv.difficulty * (elite ? this.elite.difficultyMultiplier : 1),
      elite,
      wallHp: lv.wallHp,
      totalWaves: lv.enemyWaves.length,
    };
  }

  /**
   * 关卡通关结算。
   * @returns {{ cleared: boolean, stars: number, newRecord: boolean }}
   */
  completeLevel(levelId, { wallHpLeft = 0, wallHpMax = 1, elite = false } = {}) {
    const pct = wallHpLeft / wallHpMax;
    const stars = pct >= 0.8 ? 3 : pct >= 0.5 ? 2 : 1;
    const key = elite ? `${levelId}:elite` : levelId;
    const prev = this.save.stars[key] || 0;
    const newRecord = stars > prev;
    if (newRecord) this.save.stars[key] = stars;
    this.save.cleared[levelId] = true;
    if (elite) this.save.cleared[`${levelId}:elite`] = true;
    return { cleared: true, stars, newRecord };
  }

  /** 星级阈值（balance.json starThresholds 的消费方） */
  static starThresholds = { three: 0.8, two: 0.5, one: 0.01 };
}
