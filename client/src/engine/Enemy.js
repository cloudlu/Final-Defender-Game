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

    // BOSS 原版机制字段
    this.elementImmune = !!config.elementImmune;   // 元素破解者：免疫所有元素伤害
    this.freezeHeal = !!config.freezeHeal;         // 深海巨兽：冻结时回血
    this.healOnHurt = !!config.healOnHurt;         // 巨魔首领：受伤后持续回血
    this._healOnHurtTimer = 0;
    // 新机制字段（v5.9 小怪表对齐）
    this.revivesLeft = config.revives || 0;              // 木乃伊：复活次数
    this.deathHealAura = config.deathHealAura || 0;      // 护士/咸鱼：死亡时治疗周围 pct
    this.negativeTimeResist = config.negativeTimeResist || 0; // 胆小：负面时间 -100%
    this.blocksProjectiles = !!config.blocksProjectiles; // 墓碑/寒霜兽：阻挡弹道
    this.stunImmune = !!config.stunImmune;               // 傀儡：免疫眩晕
    this.burnImmune = !!config.burnImmune;               // 火焰僵尸/巨齿鲨：免疫燃烧
    this.negativeResist = !!config.negativeResist;       // 咸鱼/木乃伊：免疫负面状态
    this._bandageState = this.behavior?.type === 'bandage_heal' ? 'normal' : null;
    this._bandageTimer = 0;
    this._vampireHeal = this.behavior?.type === 'vampire';
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

    // 巨魔首领：受伤后 5 秒内持续回血（原版机制）
    if (this.healOnHurt) {
      if (this._healOnHurtTimer > 0) {
        this._healOnHurtTimer -= dt;
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.02 * dt); // 2%/s
      }
    }

    // 绷带僵尸精英：血 <30% 停走 5 秒回 50% 血（原版机制，一次性）
    if (this._bandageState === 'normal' && this.behavior?.type === 'bandage_heal'
      && this.hp / this.maxHp <= (this.behavior.threshold ?? 0.3)) {
      this._bandageState = 'healing';
      this._bandageTimer = 5;
    }
    if (this._bandageState === 'healing') {
      this._bandageTimer -= dt;
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.1 * dt); // 50% / 5s = 10%/s
      if (this._bandageTimer <= 0) {
        this._bandageState = 'done';
      }
      return; // 恢复期间停止移动
    }

    // 嗜血僵尸精英：吸血（接近敌人时持续回血由 GameState 判定，这里实现为每秒自回 1%）
    if (this._vampireHeal && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.01 * dt);
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

// v9.9 狂暴：独立速度乘区（BossManager 设置 _rageSpeedMult=4）
if (this._rage && this._rageSpeedMult) speedMul *= this._rageSpeedMult;

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
    // v9.9 狂暴无敌（原版：狂暴期间无敌 15 秒）
    if (this._rage && this.invulnerable) {
      this.hitFlash = 0.3;
      return false;
    }
    // 弹道闪避（天线僵尸 50%）
    if (this.dodge > 0 && rngLike && rngLike.next() < this.dodge) {
      this.hitFlash = 0.5;
      return false; // miss
    }
    let mult = 1;
    if (this.elementImmune && element) return false; // 元素破解者：免疫所有元素伤害
    if (element) {
      if (this.resist[element]) mult -= this.resist[element];      // 抗性减免
      if (this.weak?.[element]) mult += this.weak[element];        // 弱点增伤
    }
    const actual = Math.max(1, damage * mult - this.armor);
    this.hp -= actual;
    this.hitFlash = 1;
    // 深海巨兽：被冻结会回血；巨魔首领：受伤后回血
    if (this.freezeHeal && this.frozen) this.hp = Math.min(this.maxHp, this.hp + actual * 0.5);
    if (this.healOnHurt) this._healOnHurtTimer = 5; // 5 秒内持续回血标记
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
    // 木乃伊：死亡复活（血量递减 33%，最多 N 次）
    if (this.hp <= 0 && this.revivesLeft > 0) {
      this.revivesLeft--;
      this.maxHp = Math.round(this.maxHp * 0.67);
      this.hp = this.maxHp;
      this.alive = true;
      this.stunTimer = 0;
      this.frozen = false;
      return false; // 复活不算死亡
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
    if (this.negativeTimeResist >= 1) return; // 负面时间-100%：完全免疫
    this.stunTimer = Math.max(this.stunTimer, duration * (1 - this.negativeTimeResist));
    this.frozen = true;
  }

  getSplitConfig() { return this.behavior?.type === 'split' ? this.behavior : null; }
  getExplodeConfig() { return this.behavior?.type === 'explode' ? this.behavior : null; }
}
