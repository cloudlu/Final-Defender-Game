/**
 * BossManager: BOSS 技能调度（引擎层）。
 * BOSS 本体是 Enemy（isBoss=true），本类只负责技能计时与触发事件。
 * 技能：
 *  - summon: 召唤小怪（GameState 执行 spawn）
 *  - speedBurst: 预警 warnSeconds 后狂暴冲刺 duration 秒
 *  - roar: 预警后击晕玩家技能 silenceSeconds（GameState 写 playerSilenceTimer）
 * 技能间隔 ≥8s，保证控制覆盖率 ≤25%（反软锁护栏）。
 */
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

  /**
   * @param {number} dt
   * @param {object} handlers { onSummon(enemyId,count), onRoar(seconds), spawnEnemyFn }
   * @returns {Array} 事件列表（供 UI 特效：'warn_roar' / 'roar' / 'warn_speed' 等）
   */
  update(dt, handlers) {
    const boss = this.activeBoss;
    const events = [];
    if (!boss || !boss.alive) {
      if (boss && !boss.alive) this.clear();
      return events;
    }

    for (const skill of boss.bossSkills || []) {
      const timerKey = skill.type;
      boss.bossSkillTimers[timerKey] = (boss.bossSkillTimers[timerKey] ?? skill.interval) - dt;
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
      }

      // roar 的静默在预警后由 GameState 的 roarPending 处理（保持 Enemy 纯粹）
    }
    return events;
  }
}
