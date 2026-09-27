import { gridToPixel } from '../engine/GridConstants.js';

/**
 * XpOrbRenderer: 经验球的渲染（青色菱形，吸附时拉伸拖尾）。
 */
export class XpOrbRenderer {
  constructor(scene) {
    this.scene = scene;
    this.sprites = new Map(); // orbId -> gameObject
  }

  sync(orbs, dt) {
    const alive = new Set(orbs.map(o => o.id));
    // 清理已吸收的
    for (const [id, g] of this.sprites) {
      if (!alive.has(id)) { g.destroy(); this.sprites.delete(id); }
    }
    for (const orb of orbs) {
      const pos = gridToPixel(orb.col, orb.row);
      let g = this.sprites.get(orb.id);
      if (!g) {
        g = this.scene.add.container(pos.x, pos.y).setDepth(90);
        const diamond = this.scene.add.star(0, 0, 4, 3, 5.5, 0x55e6ff);
        diamond.setStrokeStyle(1, 0x2288aa);
        const glow = this.scene.add.circle(0, 0, 8, 0x55e6ff, 0.25);
        g.add(glow);
        g.add(diamond);
        g.orbGlow = glow;
        this.sprites.set(orb.id, g);
      }
      g.setPosition(pos.x, pos.y);
      // 吸附状态：发光增强 + 微缩放脉动
      if (orb.state === 'attract') {
        g.orbGlow.setAlpha(0.45);
        g.setScale(1.15);
      }
    }
  }

  destroyAll() {
    for (const g of this.sprites.values()) g.destroy();
    this.sprites.clear();
  }
}
