import { distanceCells } from './GridConstants.js';

let nextOrbId = 1;

/**
 * XpOrb: 经验球实体。击杀掉落 → 悬停 spawnHover 秒 → 吸附飞向英雄。
 * 纯逻辑（位置/速度/吸附），渲染在 ui/XpOrbRenderer.js。
 */
export class XpOrbSystem {
  constructor(player, { hoverTime = 0.35, attractSpeed = 9, magnetRadius = 99 } = {}) {
    this.player = player;
    this.orbs = []; // { id, col, row, vx, vy, value, state: 'hover'|'attract', timer }
    this.hoverTime = hoverTime;
    this.attractSpeed = attractSpeed;
    this.magnetRadius = magnetRadius;
  }

  /** 击杀掉球。value = 基础值 × 经验加成 */
  spawn(col, row, value, scatterRng = Math.random) {
    const a = scatterRng() * Math.PI * 2;
    const d = 0.3 + scatterRng() * 0.5;
    this.orbs.push({
      id: nextOrbId++, col: col + Math.cos(a) * d, row: row + Math.sin(a) * d,
      value, state: 'hover', timer: this.hoverTime,
    });
  }

  /**
   * @param {number} dt
   * @param {number} xpMultiplier 经验加成倍率（全局强化）
   * @returns {number} 本帧吸收的经验总量
   */
  update(dt, xpMultiplier = 1) {
    let absorbed = 0;
    const px = this.player.x, py = this.player.y;
    for (const orb of this.orbs) {
      if (orb.state === 'hover') {
        orb.timer -= dt;
        if (orb.timer <= 0) orb.state = 'attract';
        continue;
      }
      // 吸附：向英雄加速移动，靠近即吸收
      const dx = px - orb.col, dy = py - orb.row;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.5) {
        orb.collected = true;
        absorbed += orb.value * xpMultiplier;
        continue;
      }
      const speed = this.attractSpeed * (1 + (2.5 - Math.min(2.5, dist)) * 0.6); // 越近越快
      orb.col += (dx / dist) * speed * dt;
      orb.row += (dy / dist) * speed * dt;
    }
    this.orbs = this.orbs.filter(o => !o.collected);
    return Math.round(absorbed);
  }
}
