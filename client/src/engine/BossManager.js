/**
 * BossManager: BOSS 技能调度（引擎层）。
 * BOSS 本体是 Enemy（isBoss=true），本类只负责技能计时与触发事件。
 * 技能：
 *  - summon: 召唤小怪（GameState 执行 spawn）
 *  - speedBurst: 预警 warnSeconds 后狂暴冲刺 duration 秒
 *  - roar: 预警后击晕玩家技能 silenceSeconds（GameState 写 playerSilenceTimer）
 *  - rangedAttack (v9.11): 远程攻击——BOSS 向城墙发射弹道（GameState 生成敌方弹）
 * 技能间隔 ≥8s，保证控制覆盖率 ≤25%（反软锁护栏）。
 *
 * v9.11 环境效果（Arena Effect，原版 BOSS 战场机制对齐）：
 *  - boss.arena 存活期间持续改变全局规则，死亡即解除：
 *    darkFog    黑暗迷雾：我方弹速 ×0.55（leviathan 试点）
 *    solarFlare 太阳耀斑：城墙每秒灼烧 flareDps（flame_lord 试点）
 *    empField   电磁场：我方技能冷却 ×(1+cdMult)
 */
export const RAGE_CONFIG = {
  timeTriggerSec: 360,   // 6 分钟
  hpTriggerPct: 0.2,     // 血量 20%
  duration: 15,
  speedMult: 4,          // +300%
  invulnerable: true,
};

export class BossManager {
  constructor() {
    this.activeBoss = null; // Enemy 引用
  }

  register(bossEnemy) {
    this.activeBoss = bossEnemy;
  }

  clear() {
    this.activeBoss = null;
  }

  /** 当前生效的环境效果（GameState 每帧查询应用乘区） */
  getArena() {
    const boss = this.activeBoss;
    return boss && boss.alive && !boss._rage ? (boss.arena || null) : null; // 狂暴时环境让位于压境
  }

  /**
   * @param {number} dt
   * @param {object} handlers { onSummon(enemyId,count), onRoar(seconds), spawnEnemyFn, onRangedAttack(col,row,damage,speed) }
   * @returns {Array} 事件列表（供 UI 特效：'warn_roar' / 'roar' / 'warn_speed' / 'rage' / 'arena' / 'bossShoot' 等）
   */
  update(dt, handlers) {
    const boss = this.activeBoss;
    const events = [];
    if (!boss || !boss.alive) {
      if (boss && !boss.alive) {
        if (boss.arena) events.push({ type: 'arenaEnd', bossId: boss.id, arena: boss.arena.type });
        this.clear();
      }
      return events;
    }

    // ===== v9.9 狂暴机制 =====
    boss._aliveSec = (boss._aliveSec ?? 0) + dt;
    if (boss._rage) {
      // 狂暴进行中：倒计时结束解除
      boss._rage.timeLeft -= dt;
      if (boss._rage.timeLeft <= 0) {
        boss._rage = null;
        boss.invulnerable = false;
        events.push({ type: 'rageEnd', bossId: boss.id });
      }
    } else if (!boss._rageUsed) {
      // 触发判定：存活时长 或 血量阈值
      const hpPct = boss.hp / boss.maxHp;
      if (boss._aliveSec >= RAGE_CONFIG.timeTriggerSec || hpPct <= RAGE_CONFIG.hpTriggerPct) {
        boss._rageUsed = true; // 每场一次（原版部分 BOSS 可二次，简化为一次）
        boss._rage = { timeLeft: RAGE_CONFIG.duration };
        if (RAGE_CONFIG.invulnerable) boss.invulnerable = true;
        boss._rageSpeedMult = RAGE_CONFIG.speedMult;
        events.push({ type: 'rage', bossId: boss.id, duration: RAGE_CONFIG.duration, name: boss.name });
      }
    }

    // ===== v9.11 环境效果：BOSS 出生 2 秒后激活（预警后生效），派发一次 arena 事件 =====
    if (boss.arena && !boss._arenaAnnounced) {
      boss._arenaTimer = (boss._arenaTimer ?? 2) - dt;
      if (boss._arenaTimer <= 0) {
        boss._arenaAnnounced = true;
        events.push({ type: 'arena', bossId: boss.id, arena: boss.arena.type, name: boss.name });
      }
    }

    // 狂暴中的移速倍增（与 speedBurst 叠乘由 Enemy.update 消费 speedBurst；rage 独立乘）
    const rageMult = boss._rage ? (boss._rageSpeedMult || 1) : 1;

    for (const skill of boss.bossSkills || []) {
      // 狂暴期间常规技能暂停（原版：全资源压境）
      if (boss._rage) break;
      const timerKey = skill.type;
      boss.bossSkillTimers[timerKey] = (boss.bossSkillTimers[timerKey] ?? skill.interval) - dt * rageMult;
      const t = boss.bossSkillTimers[timerKey];

      if (skill.type === 'summon' && t <= 0) {
        boss.bossSkillTimers[timerKey] = skill.interval;
        for (let i = 0; i < (skill.count || 1); i++) {
          handlers.spawnEnemyFn?.(skill.enemyId);
        }
        events.push({ type: 'bossSummon', bossId: boss.id });
      } else if (skill.type === 'speedBurst' && t <= 0) {
        boss.bossSkillTimers[timerKey] = skill.interval;
        boss.speedBurst.multiplier = skill.multiplier || 2;
        boss.speedBurst.warnTimer = skill.warnSeconds || 1;
        boss._burstDuration = skill.duration || 3;
        events.push({ type: 'warnSpeed', bossId: boss.id, warnSeconds: skill.warnSeconds || 1 });
      } else if (skill.type === 'roar' && t <= 0) {
        boss.bossSkillTimers[timerKey] = skill.interval;
        events.push({ type: 'warnRoar', bossId: boss.id, warnSeconds: skill.warnSeconds || 1, silenceSeconds: skill.silenceSeconds || 2 });
      } else if (skill.type === 'rangedAttack' && t <= 0) {
        // v9.11 远程攻击：向城墙（玩家防线）发射敌方弹道
        boss.bossSkillTimers[timerKey] = skill.interval;
        const col = boss.col ?? 3.5;
        handlers.onRangedAttack?.(col, skill.damage || 6, skill.speed || 5);
        events.push({ type: 'bossShoot', bossId: boss.id, col, damage: skill.damage || 6 });
      }
    }
    return events;
  }
}
