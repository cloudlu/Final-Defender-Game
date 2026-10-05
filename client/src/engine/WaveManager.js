/**
 * WaveManager: 出怪调度。
 * 两种模式：
 *  - level: 关卡表驱动（enemyWaves 数组指定每波敌人种类，波内数量=表长×3 只）
 *  - endless: 旧随机公式（fallback，无尽模式）
 */
import { GRID } from './GridConstants.js';

export class WaveManager {
  constructor(balanceConfig, enemyConfigs, levelRuntime = null) {
    this.balance = balanceConfig;
    this.enemyConfigs = enemyConfigs;
    this.level = levelRuntime; // null = endless 模式
    this.currentWave = 0;
    this.waveActive = false;
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.spawnInterval = 0.8;
    this.levelComplete = false;
  }

  startWave(rng) {
    this.currentWave++;
    this.waveActive = true;

    const diffMult = (this.level ? this.level.difficulty : 1)
      * (1 + (this.currentWave - 1) * this.balance.difficultyScalePerWave);

    this.spawnQueue = [];
    // 原版尸潮规模：出怪高频持续（间隔下限 0.15s），波次前 70% 时间刷完
    this.spawnInterval = Math.max(0.15, (0.5 - this.currentWave * 0.015) / (this.level?.density || 1));

    let composition;
    const isFinalWave = this.level && this.currentWave >= this.level.totalWaves;
    if (this.level) {
      const kinds = this.level.enemyWaves[this.currentWave - 1]
        || this.level.enemyWaves[this.level.enemyWaves.length - 1];
      // 终波含 "BOSS" 标记 → 该波由 GameState 附加生成 BOSS
      this.bossWave = isFinalWave && kinds.includes('BOSS');
      const normalKinds = kinds.filter(k => k !== 'BOSS');
      // 波内数量：每种敌人基数 8 只（终波 10）× 密度倍数——对齐原版尸潮
      const perKind = Math.round((isFinalWave ? 10 : 8) * (this.level.density || 1));
      composition = [];
      for (const kind of normalKinds) {
        for (let i = 0; i < perKind; i++) composition.push(kind);
      }
    } else {
      const enemyCount = 5 + Math.floor(this.currentWave * 1.5);
      composition = Array.from({ length: enemyCount }, () => this._pickRandomId(rng));
    }

    for (let i = 0; i < composition.length; i++) {
      const spawnCol = rng.nextInt(1, GRID.COLS - 2);
      const configId = composition[i];
      const cfg = this.enemyConfigs.find(e => e.id === configId) || this.enemyConfigs[0];
      this.spawnQueue.push({
        configId: cfg.id, config: cfg, difficultyMultiplier: diffMult,
        spawnCol, spawnRow: 0,
      });
    }

    this.spawnTimer = 0;
    return {
      wave: this.currentWave, count: this.spawnQueue.length,
      isFinalWave, difficultyMultiplier: diffMult,
    };
  }

  update(dt) {
    if (!this.waveActive || this.spawnQueue.length === 0) return null;
    this.spawnTimer += dt;
    if (this.spawnTimer >= this.spawnInterval) {
      this.spawnTimer -= this.spawnInterval;
      return this.spawnQueue.shift();
    }
    return null;
  }

  isWaveComplete(aliveCount) {
    return this.waveActive && this.spawnQueue.length === 0 && aliveCount === 0;
  }

  endWave() { this.waveActive = false; }

  /** 关卡通关：打完最后一波 */
  isLevelComplete() {
    return !!this.level && this.levelComplete;
  }

  /** 在 waveComplete 回调后由 GameState 通知：若已是最后一波则标记通关 */
  notifyWaveEnded() {
    if (this.level && !this.waveActive && this.currentWave >= this.level.totalWaves) {
      this.levelComplete = true;
    }
  }

  getWaveGoldBonus() {
    return this.balance.earlySummonBonusGold + this.currentWave * (this.level ? 8 : 5);
  }

  _pickRandomId(rng) {
    return rng.pick(this.enemyConfigs).id;
  }
}
