let nextEnemyId = 1;

import { GRID } from './GridConstants.js';

/**
 * Enemy: cartoon style, moves down toward wall.
 * @param {object} config - flat enemy config (hp/speed/armor/bounty/behavior)
 * @param {number} spawnCol
 * @param {number} spawnRow
 * @param {number} difficultyMultiplier
 * @param {import('./SeededRNG.js').SeededRNG} [rng] - seeded RNG for deterministic sim
 */
export class Enemy {
  constructor(config, spawnCol, spawnRow, difficultyMultiplier = 1.0, rng = null) {
    this.id = nextEnemyId++;
    this.configId = config.id;
    this.config = config;
    this.name = config.name;
    this.col = spawnCol;
    this.row = spawnRow;

    this.maxHp = Math.round(config.hp * difficultyMultiplier);
    this.hp = this.maxHp;
    this.speed = config.speed;
    this.baseSpeed = config.speed;
    this.bounty = config.bounty;
    this.armor = config.armor || 0;

    this.slowFactor = 1;
    this.slowTimer = 0;
    this.stunTimer = 0;
    this.dotEffects = [];

    this.behavior = config.behavior || null;
    this.alive = true;
    this.reachedEnd = false;
    this.wallRow = GRID.ROWS; // 越过网格底部即抵达城墙

    // All randomness through injected seeded RNG (falls back to Math.random for tests)
    const rand = () => (rng ? rng.next() : Math.random());
    this._rand = rand;
    this.driftX = (rand() - 0.5) * 0.15;
    this.moveTimer = 0;
    this.driftChangeInterval = 2 + rand() * 3;
    this.bobOffset = rand() * Math.PI * 2;
    this.hitFlash = 0;

    // 行为状态
    this.dashTimer = 3 + rand() * 2;   // dash: 周期倒计时
    this.dashing = 0;                  // dash: 冲刺剩余时间
    this.exploded = false;             // explode: 防重复结算

    // 原版敌人机制字段（enemies.json 配置）
    this.resist = config.resist || {};        // { fire:0.5, ... } 受到该系伤害减免
    this.weak = config.weak || {};            // { wind:0.5, ... } 受到该系伤害增加
    this.dodge = config.dodge || 0;           // 弹道闪避率
    this.resistKnock = config.resistKnock || 0;
    this.immuneKnock = !!config.immuneKnock;
    this.enraged = false;
    this.enrageThreshold = this.behavior?.type === 'enrage' ? (this.behavior.threshold ?? 0.5) : null;
    this.enrageSpeedMul = 1;
    this._healPctPerSec = this.behavior?.type === 'heal_aura' ? (this.behavior.pctPerSec || 0.03) : 0;
    this._healRadius = this.behavior?.type === 'heal_aura' ? (this.behavior.radius || 2.5) : 0;
    this._healTimer = 0;
    this._onHitSpeedBoost = this.behavior?.type === 'burrow' ? (this.behavior.onHitSpeedBoost || 0) : 0;

    // BOSS 字段（isBoss 由 WaveManager 设置）
    this.isBoss = config.isBoss || false;
    this.bossSkills = config.bossSkills || null; // [{type,interval,...}]
    this.bossSkillTimers = {};
    this.speedBurst = { multiplier: 1, timer: 0, warnTimer: 0 };
    if (this.isBoss && this.bossSkills) {
      for (const sk of this.bossSkills) this.bossSkillTimers[sk.type] = sk.interval;
    }
  }

  update(dt) {
    if (!this.alive || this.reachedEnd) return;

    if (this.stunTimer > 0) {
      this.stunTimer -= dt;
      if (this.stunTimer <= 0) this.frozen = false;
      return;
    }
    this.frozen = false;

    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      if (this.slowTimer <= 0) this.slowFactor = 1;
    }

    for (let i = this.dotEffects.length - 1; i >= 0; i--) {
      const dot = this.dotEffects[i];
      this.hp -= dot.damage * dt;
      dot.duration -= dt;
      if (dot.duration <= 0) this.dotEffects.splice(i, 1);
      if (this.hp <= 0) { this.alive = false; return; }
    }

    // dash 行为：周期冲刺（2.5 倍速冲刺 0.6 秒）
    let speedMul = 1;
    if (this.behavior?.type === 'dash') {
      if (this.dashing > 0) {
        this.dashing -= dt;
        speedMul = 2.5;
      } else {
        this.dashTimer -= dt;
        if (this.dashTimer <= 0) {
          this.dashing = 0.6;
          this.dashTimer = 3 + this._rand() * 2;
        }
      }
    }

    // 狂暴（巨人/野猪）：血量过阈值 → 加速（巨人狂暴后免疫控制）
    if (this.enrageThreshold !== null && !this.enraged) {
      if (this.hp / this.maxHp <= this.enrageThreshold) {
        this.enraged = true;
        this.enrageSpeedMul = 1.5;
      }
    }
    if (this.enraged) speedMul *= this.enrageSpeedMul;

    // 护士光环回血：每秒治疗半径内友军（含自身）
    if (this._healPctPerSec > 0 && this.hp < this.maxHp) {
      this._healTimer -= dt;
      if (this._healTimer <= 0) {
        this._healTimer = 1;
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * this._healPctPerSec);
      }
    }

    // BOSS speedBurst：预警（warnTimer）后爆发
    if (this.speedBurst.timer > 0) {
      this.speedBurst.timer -= dt;
      speedMul *= this.speedBurst.multiplier;
    } else if (this.speedBurst.warnTimer > 0) {
      this.speedBurst.warnTimer -= dt;
      if (this.speedBurst.warnTimer <= 0) {
        this.speedBurst.timer = this._burstDuration || 3;
      }
    }

    this.row += this.speed * speedMul * this.slowFactor * dt;

    this.moveTimer += dt;
    if (this.moveTimer >= this.driftChangeInterval) {
      this.moveTimer = 0;
      this.driftX = (this._rand() - 0.5) * 0.2;
    }
    this.col += this.driftX * dt;

    if (this.col < 0.3) { this.col = 0.3; this.driftX = Math.abs(this.driftX); }
    if (this.col > GRID.COLS - 1.3) { this.col = GRID.COLS - 1.3; this.driftX = -Math.abs(this.driftX); }

    if (this.row >= this.wallRow) { this.reachedEnd = true; this.alive = false; }

    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt * 5);
  }

  /**
   * 受击（原版机制版）。
   * @param {number} damage 基础伤害
   * @param {string} [element] 伤害元素（fire/ice/electric/wind/energy/physical）——按抗性/弱点修正
   * @param {object} [rngLike] 闪避判定用随机源 { next() }
   * @returns {boolean} 是否死亡
   */
  takeDamage(damage, element = null, rngLike = null) {
    // 弹道闪避（天线僵尸 50%）
    if (this.dodge > 0 && rngLike && rngLike.next() < this.dodge) {
      this.hitFlash = 0.5;
      return false; // miss
    }
    let mult = 1;
    if (element) {
      if (this.resist[element]) mult -= this.resist[element];      // 抗性减免
      if (this.weak?.[element]) mult += this.weak[element];        // 弱点增伤
    }
    const actual = Math.max(1, damage * mult - this.armor);
    this.hp -= actual;
    this.hitFlash = 1;
    // 狂暴免疫控制（巨人狂暴后）：清空控制态
    if (this.enraged) {
      this.stunTimer = 0;
      this.slowTimer = 0;
      this.slowFactor = 1;
    }
    // 铁桶尸：护甲打空掉桶 → 变普通尸（原版细节）
    if (this.configId === 'enemy_bucket' && !this._bucketLost && this.armor > 0) {
      this._armorWear = (this._armorWear || 0) + actual;
      if (this._armorWear >= 60) {
        this._bucketLost = true;
        this.armor = 0;
        this.speed = 1.0;
        this.configId = 'enemy_basic';
        this.name = '普通丧尸';
      }
    }
    // 钻地佬：受击后钻行加速
    if (this._onHitSpeedBoost > 0) {
      this.speed += this._onHitSpeedBoost * 0.1;
    }
    if (this.hp <= 0) { this.alive = false; return true; }
    return false;
  }

  /** 击退（旋风加农等）：power 越大退越远；免疫/抵抗按原版 */
  knockback(power) {
    if (this.immuneKnock) return;
    const resist = this.resistKnock || 0;
    const effective = Math.max(0, power * (1 - resist));
    if (effective <= 0.05) return; // 完全抵抗（巨人 0.9）
    this.row = Math.max(0, this.row - effective);
    this.stunTimer = Math.max(this.stunTimer, 0.2);
  }

  /** 冻结（干冰弹/冰暴）：免疫单位无效（飞行员/钻地佬）；狂暴巨人免疫控制 */
  freeze(duration) {
    if (this.resistFreeze || this.enraged) return;
    this.stunTimer = Math.max(this.stunTimer, duration);
    this.frozen = true;
  }

  getSplitConfig() { return this.behavior?.type === 'split' ? this.behavior : null; }
  getExplodeConfig() { return this.behavior?.type === 'explode' ? this.behavior : null; }
}
