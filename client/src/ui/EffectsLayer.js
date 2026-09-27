import { gridToPixel, GRID, GAME_WIDTH, GAME_HEIGHT } from '../engine/GridConstants.js';

export const SKILL_COLORS = {
  attack: 0xffffff, thermobaric: 0xff6600, fuelbomb: 0xff4400, empierce: 0xffff00,
  dryice: 0x66ddff, icestorm: 0x88eeff, cyclone: 0xaaffcc, airblade: 0xccffdd,
  ray: 0xff2266, guidedlaser: 0xff66aa, vehicle: 0xccaa66, airstrike: 0xffcc44,
  drone: 0x88ddff,
};

/**
 * EffectsLayer: 一次性视觉特效（命中/爆炸/闪电/毒雾/墙击碎屑等）+ 飘字。
 * 只管"播特效"，不持有游戏状态。
 */
export class EffectsLayer {
  constructor(scene) {
    this.scene = scene;
    this.floatingTexts = [];
  }

  /** 命中火花 */
  hitSparks(x, y, skillId) {
    const color = SKILL_COLORS[skillId] || 0xffffff;
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2, d = 5 + Math.random() * 7;
      const s = this.scene.add.circle(x, y, 1.5, color).setDepth(150);
      this.scene.tweens.add({ targets: s, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, alpha: 0, duration: 120, onComplete: () => s.destroy() });
    }
  }

  impactRing(x, y, color) {
    const r = this.scene.add.circle(x, y, 3, color, 0).setDepth(150);
    r.setStrokeStyle(2, color, 0.8);
    this.scene.tweens.add({ targets: r, scaleX: 2, scaleY: 2, alpha: 0, duration: 180, onComplete: () => r.destroy() });
    const f = this.scene.add.circle(x, y, 3, color, 0.8).setDepth(151);
    this.scene.tweens.add({ targets: f, scaleX: 0, scaleY: 0, alpha: 0, duration: 100, onComplete: () => f.destroy() });
  }

  aoeBurst(x, y, radius, color) {
    const r = this.scene.add.circle(x, y, 3, color, 0).setDepth(150);
    r.setStrokeStyle(2, color, 0.5);
    this.scene.tweens.add({ targets: r, scaleX: radius / 3, scaleY: radius / 3, alpha: 0, duration: 250, onComplete: () => r.destroy() });
  }

  freezeBurst(playerPos) {
    // 保留通用冰系爆发特效供 iceshard 使用
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const s = this.scene.add.star(playerPos.x, playerPos.y, 4, 2, 4, 0x88ddff).setDepth(150);
      this.scene.tweens.add({ targets: s, x: playerPos.x + Math.cos(a) * 100, y: playerPos.y + Math.sin(a) * 100, alpha: 0, rotation: Math.PI, duration: 300, onComplete: () => s.destroy() });
    }
  }

  lightningBolts(fromCol, fromRow, targets) {
    const from = gridToPixel(fromCol, fromRow);
    let px = from.x, py = from.y;
    for (const t of targets) {
      const to = gridToPixel(t.col, t.row);
      const g = this.scene.add.graphics().setDepth(150);
      g.lineStyle(2, 0xffff00, 0.9);
      g.moveTo(px, py);
      for (let i = 1; i <= 3; i++) {
        g.lineTo(px + (to.x - px) * (i / 3) + (Math.random() - 0.5) * 12, py + (to.y - py) * (i / 3) + (Math.random() - 0.5) * 12);
      }
      g.lineTo(to.x, to.y); g.strokePath();
      this.scene.tweens.add({ targets: g, alpha: 0, duration: 150, onComplete: () => g.destroy() });
      const imp = this.scene.add.circle(to.x, to.y, 4, 0xffff00, 0.6).setDepth(151);
      this.scene.tweens.add({ targets: imp, scaleX: 1.5, scaleY: 1.5, alpha: 0, duration: 120, onComplete: () => imp.destroy() });
      px = to.x; py = to.y;
    }
  }

  poisonCloud(playerPos) {
    for (let i = 0; i < 6; i++) {
      const x = playerPos.x + (Math.random() - 0.5) * 180, y = playerPos.y + (Math.random() - 0.5) * 120 - 60;
      const c = this.scene.add.circle(x, y, 6 + Math.random() * 8, 0x44ff00, 0.2).setDepth(150);
      this.scene.tweens.add({ targets: c, y: y - 25, alpha: 0, scaleX: 1.5, scaleY: 1.5, duration: 500, onComplete: () => c.destroy() });
    }
  }

  deathPoof(x, y) {
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2, d = 6 + Math.random() * 8;
      const p = this.scene.add.circle(x, y, 2.5, 0xcccccc).setDepth(140);
      this.scene.tweens.add({ targets: p, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d - 6, alpha: 0, duration: 200, onComplete: () => p.destroy() });
    }
  }

  /** 城墙受击：碎屑 + 红光 + 震屏 */
  wallHit(x, wallY, damage) {
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const d = 12 + Math.random() * 18;
      const p = this.scene.add.circle(x, wallY, 2 + Math.random() * 2, 0x9a7752).setDepth(150);
      this.scene.tweens.add({
        targets: p, x: x + Math.cos(a) * d, y: wallY + Math.sin(a) * d,
        alpha: 0, duration: 300 + Math.random() * 200, onComplete: () => p.destroy(),
      });
    }
    const flash = this.scene.add.circle(x, wallY, 18, 0xff2222, 0.45).setDepth(149);
    this.scene.tweens.add({ targets: flash, scaleX: 2.2, scaleY: 2.2, alpha: 0, duration: 280, onComplete: () => flash.destroy() });
    this.scene.cameras.main.shake(120, 0.006);
  }

  /** 镭射：从英雄到屏幕顶部的垂直贯穿光束 */
  laserBeam(fromCol, fromRow, toCol) {
    const from = gridToPixel(fromCol, fromRow);
    const to = gridToPixel(toCol, -1);
    const g = this.scene.add.graphics().setDepth(155);
    g.lineStyle(6, 0xff2266, 0.35);
    g.lineBetween(from.x, from.y, to.x, to.y);
    g.lineStyle(2, 0xff88aa, 0.95);
    g.lineBetween(from.x, from.y, to.x, to.y);
    this.scene.tweens.add({ targets: g, alpha: 0, duration: 260, onComplete: () => g.destroy() });
  }

  /** 无人机一次性小爆炸 */
  droneStrike(x, y, radiusPx) {
    const r = this.scene.add.circle(x, y, 4, 0x88ddff, 0.5).setDepth(150);
    this.scene.tweens.add({ targets: r, scaleX: radiusPx / 4, scaleY: radiusPx / 4, alpha: 0, duration: 220, onComplete: () => r.destroy() });
  }

  // ==================== 飘字 ====================

  floatingText(x, y, text, color = '#ffffff', fontSize = 10) {
    const t = this.scene.add.text(x, y, text, {
      fontSize: `${fontSize}px`, fill: color, fontFamily: 'Arial', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(200);
    this.floatingTexts.push({ text: t, timer: 0.6, startY: y });
  }

  update(dt) {
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const f = this.floatingTexts[i];
      f.timer -= dt; f.startY -= 20 * dt;
      f.text.setPosition(f.text.x, f.startY);
      f.text.setAlpha(Math.max(0, f.timer / 0.6));
      if (f.timer <= 0) { f.text.destroy(); this.floatingTexts.splice(i, 1); }
    }
  }
}
