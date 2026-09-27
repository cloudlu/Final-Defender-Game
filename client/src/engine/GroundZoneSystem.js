import { distanceCells } from './GridConstants.js';

/**
 * GroundZoneSystem: 地面区域效果（原版燃油弹火区/重力场/等离子场类机制）。
 * zone: { id, col, row, radius, duration, tickDamage, slowFactor, freezeOnEnter, element, color }
 * 纯逻辑，渲染在 ui/GroundZoneRenderer.js。
 */
export class GroundZoneSystem {
  constructor() {
    this.zones = [];
    this._nextId = 1;
  }

  /** 创建区域。effect 可为 burn（持续伤害）/ slow（减速）/ freeze（进入冻结） */
  spawn({ col, row, radius, duration, tickDamage = 0, slowFactor = null, freezeOnEnter = 0, color = 0xff6600, tickInterval = 0.5 }) {
    const zone = {
      id: this._nextId++, col, row, radius, duration,
      tickDamage, slowFactor, freezeOnEnter, color, tickInterval,
      _tickTimer: 0,
    };
    this.zones.push(zone);
    return zone;
  }

  /**
   * 推进区域：每 tickInterval 对圈内敌人 tick 伤害/效果；持续到 duration 耗尽。
   * @param {number} dt
   * @param {Array} enemies
   * @param {object} handlers { onKill(enemy), onFreeze(enemy,sec) }
   */
  update(dt, enemies, handlers = {}) {
    let tickDamageTotal = 0;
    for (const zone of this.zones) {
      zone.duration -= dt;
      zone._tickTimer -= dt;
      const inRange = enemies.filter(e => e.alive && distanceCells(zone.col, zone.row, e.col, e.row) <= zone.radius);
      // 持续减速（在圈内时刷新）
      if (zone.slowFactor) {
        for (const e of inRange) {
          e.slowFactor = Math.min(e.slowFactor, zone.slowFactor);
          e.slowTimer = Math.max(e.slowTimer, 0.3);
        }
      }
      // tick 伤害/冻结
      if (zone._tickTimer <= 0) {
        zone._tickTimer = zone.tickInterval;
        for (const e of inRange) {
          if (zone.tickDamage > 0) {
            const killed = e.takeDamage(zone.tickDamage);
            tickDamageTotal += zone.tickDamage;
            if (killed) handlers.onKill?.(e);
          }
          if (zone.freezeOnEnter > 0) {
            e.freeze ? e.freeze(zone.freezeOnEnter) : (e.stunTimer = Math.max(e.stunTimer, zone.freezeOnEnter));
          }
        }
      }
    }
    this.zones = this.zones.filter(z => z.duration > 0);
    return tickDamageTotal;
  }
}
