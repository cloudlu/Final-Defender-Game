import { GAME_WIDTH, GAME_HEIGHT } from '../engine/GridConstants.js';

/**
 * VanguardPanel: 先锋官面板（主菜单 📊 入口）——原版式局外属性明细页。
 * 展示：战力总览 / 各来源加成分解 / 穿戴明细。
 * 数据源 GameState.getBonusBreakdown()（纯文本行）+ 穿戴表。
 */
export class VanguardPanel {
  constructor(scene, breakdownLines, equippedDesc, { onClose }) {
    this.scene = scene;
    this.lines = breakdownLines;
    this.equippedDesc = equippedDesc;
    this.onClose = onClose;
    this.build();
  }
  build() {
    const { width, height } = this.scene.cameras.main;
    const cx = width / 2;
    this.container = this.scene.add.container(0, 0).setDepth(700);
    this.container.add(this.scene.add.rectangle(cx, height / 2, width, height, 0x000000, 0.92).setInteractive());

    this.container.add(this.scene.add.text(cx, 46, '📊 先锋官 · 属性明细', {
      fontSize: '22px', fill: '#ffdd44', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));

    // 明细行（getBonusBreakdown 输出）
    const startY = 96;
    const lineH = 24;
    this.lines.forEach((line, i) => {
      const isHeader = !line.startsWith(' ');
      const color = isHeader ? '#ffdd66' : line.includes('→') ? '#88ddff' : '#ccccee';
      this.container.add(this.scene.add.text(cx - 240, startY + i * lineH, line, {
        fontSize: isHeader ? '13px' : '11.5px',
        fill: color,
        fontFamily: 'Arial',
        fontStyle: isHeader ? 'bold' : 'normal',
      }).setOrigin(0, 0.5));
    });

    // 穿戴摘要
    const eqY = startY + this.lines.length * lineH + 14;
    this.container.add(this.scene.add.text(cx - 240, eqY, '穿戴：', {
      fontSize: '11px', fill: '#8899bb', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0, 0.5));
    this.container.add(this.scene.add.text(cx, eqY + 22, this.equippedDesc, {
      fontSize: '10.5px', fill: '#88ff88', fontFamily: 'Arial',
      wordWrap: { width: 480 }, align: 'center', lineSpacing: 3,
    }).setOrigin(0.5));

    this.container.add(this.scene.add.text(cx, height - 20, '点击空白处关闭', {
      fontSize: '11px', fill: '#667', fontFamily: 'Arial',
    }).setOrigin(0.5));
    this.container.list[0].on('pointerdown', () => { this.destroy(); this.onClose?.(); });
  }

  destroy() {
    if (this.container) { this.container.destroy(); this.container = null; }
  }
}
