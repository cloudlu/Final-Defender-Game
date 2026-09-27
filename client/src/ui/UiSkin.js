import { GAME_WIDTH } from '../engine/GridConstants.js';

/**
 * UiSkin: 统一 UI 面板皮肤（圆角深色底 + 亮边 + 顶部高光），替代裸 rectangle。
 * 用 Graphics 画圆角矩形，Phaser rectangle 不支持圆角。
 */
export const UiSkin = {
  /**
   * 画一个皮肤面板
   * @returns {Phaser.GameObjects.Graphics}
   */
  panel(scene, x, y, w, h, { fill = 0x161c2e, border = 0x3d5a8a, alpha = 0.94, radius = 10 } = {}) {
    const g = scene.add.graphics();
    // 阴影
    g.fillStyle(0x000000, 0.35);
    g.fillRoundedRect(x - w / 2 + 3, y - h / 2 + 4, w, h, radius);
    // 主体
    g.fillStyle(fill, alpha);
    g.fillRoundedRect(x - w / 2, y - h / 2, w, h, radius);
    // 边框
    g.lineStyle(2, border, 0.9);
    g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, radius);
    // 顶部高光线
    g.lineStyle(1, 0xffffff, 0.12);
    g.lineBetween(x - w / 2 + radius * 0.5, y - h / 2 + 2, x + w / 2 - radius * 0.5, y - h / 2 + 2);
    return g;
  },

  /** 按钮（带按下反馈） */
  button(scene, x, y, w, h, label, color, onClick, { fontSize = 14 } = {}) {
    const g = scene.add.graphics();
    const draw = (fill, border) => {
      g.clear();
      g.fillStyle(0x000000, 0.3);
      g.fillRoundedRect(x - w / 2 + 2, y - h / 2 + 3, w, h, 8);
      g.fillStyle(fill, 1);
      g.fillRoundedRect(x - w / 2, y - h / 2, w, h, 8);
      g.lineStyle(2, border, 1);
      g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 8);
      // 顶部高光
      g.fillStyle(0xffffff, 0.15);
      g.fillRoundedRect(x - w / 2 + 2, y - h / 2 + 2, w - 4, h * 0.35, { tl: 8, tr: 8, bl: 0, br: 0 });
    };
    draw(color, 0xffffff);
    const zone = scene.add.rectangle(x, y, w, h, 0xffffff, 0).setInteractive({ useHandCursor: true });
    const txt = scene.add.text(x, y, label, {
      fontSize: `${fontSize}px`, fill: '#ffffff', fontFamily: 'Arial', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5);
    zone.on('pointerover', () => draw(color + 0x111111, 0xffffff));
    zone.on('pointerout', () => draw(color, 0xffffff));
    zone.on('pointerdown', (p) => {
      p.event.stopPropagation();
      scene.tweens.add({ targets: zone, scaleX: 0.94, scaleY: 0.94, duration: 60, yoyo: true });
      onClick?.();
    });
    return { zone, txt, g };
  },
};
