import { GAME_WIDTH, GAME_HEIGHT } from '../engine/GridConstants.js';

/**
 * DailyPanel: 7 日签到弹层。未领取时自动弹出（主菜单进入时判断）。
 */
export class DailyPanel {
  constructor(scene, dailySystem, globalSave, { onClose, onPersist }) {
    this.scene = scene;
    this.daily = dailySystem;
    this.save = globalSave;
    this.onClose = onClose;
    this.onPersist = onPersist;
    this.build();
  }

  build() {
    const { width, height } = this.scene.cameras.main;
    const cx = width / 2;
    this.container = this.scene.add.container(0, 0).setDepth(700);
    this.container.add(this.scene.add.rectangle(cx, height / 2, width, height, 0x000000, 0.88).setInteractive());
    this.container.add(this.scene.add.text(cx, 70, '📅 每日签到', {
      fontSize: '26px', fill: '#88ffcc', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));

    this.cells = [];
    const startY = 150;
    const colW = 96, rowH = 100;
    this._renderCalendar(startY, colW, rowH);

    // 领取按钮
    const canClaim = this.daily.canClaim();
    const btn = this.scene.add.rectangle(cx, height - 150, 200, 48, canClaim ? 0x00aa66 : 0x555566)
      .setInteractive({ useHandCursor: canClaim });
    this.container.add(btn);
    this.claimText = this.scene.add.text(cx, height - 150, canClaim ? '✅ 领取今日奖励' : '今日已领取', {
      fontSize: '15px', fill: '#ffffff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.container.add(this.claimText);
    btn.on('pointerdown', () => {
      if (!this.daily.canClaim()) return;
      const r = this.daily.claim(this.save);
      if (!r.success) return;
      this.onPersist?.();
      this.scene.cameras.main.flash(300, 150, 255, 200);
      const icon = r.reward.type === 'gold' ? '💰' : '💎';
      const popup = this.scene.add.text(cx, height / 2, `${icon} +${r.reward.amount}`, {
        fontSize: '26px', fill: '#ffdd44', fontFamily: 'Arial', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 3,
      }).setOrigin(0.5).setDepth(750);
      this.scene.tweens.add({ targets: popup, y: height / 2 - 60, alpha: 0, duration: 1200, onComplete: () => popup.destroy() });
      // 重绘
      btn.setFillStyle(0x555566);
      this.claimText.setText('今日已领取');
      btn.disableInteractive();
      this._renderCalendar(startY, colW, rowH);
    });

    this.container.add(this.scene.add.text(cx, height - 90, '断签不罚——超 48 小时重新从第 1 天开始', {
      fontSize: '11px', fill: '#667', fontFamily: 'Arial',
    }).setOrigin(0.5));
    this.container.add(this.scene.add.text(cx, height - 24, '点击空白处关闭', {
      fontSize: '11px', fill: '#667', fontFamily: 'Arial',
    }).setOrigin(0.5));
    this.container.list[0].on('pointerdown', () => { this.destroy(); this.onClose?.(); });
  }

  _renderCalendar(startY, colW, rowH) {
    for (const c of this.cells) c.destroy();
    this.cells = [];
    const cal = this.daily.getCalendar();
    const cx = GAME_WIDTH / 2;
    cal.forEach((entry, i) => {
      const col = i % 4, row = Math.floor(i / 4);
      const x = cx + (col - 1.5) * (colW + 8);
      const y = startY + row * rowH;
      const icon = entry.type === 'gold' ? '💰' : '💎';
      const claimed = entry.claimed;
      const isNext = entry.isNext;
      const cell = this.scene.add.rectangle(x, y, colW, 84, claimed ? 0x1a2430 : isNext ? 0x1e3a2e : 0x22283a);
      cell.setStrokeStyle(2, claimed ? 0x334455 : isNext ? 0x44ff99 : 0x445566);
      this.container.add(cell);
      this.cells.push(cell);
      const dayText = this.scene.add.text(x, y - 26, `Day ${entry.day}`, {
        fontSize: '11px', fill: claimed ? '#556677' : isNext ? '#88ffbb' : '#99aabb',
        fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0.5);
      const rewardText = this.scene.add.text(x, y, `${icon} ${entry.amount}`, {
        fontSize: '14px', fill: claimed ? '#445566' : '#ffffff', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0.5);
      const statusText = this.scene.add.text(x, y + 26, claimed ? '✓' : isNext ? '今日' : '', {
        fontSize: '11px', fill: claimed ? '#556677' : '#88ffbb', fontFamily: 'Arial',
      }).setOrigin(0.5);
      this.container.add([dayText, rewardText, statusText]);
      this.cells.push(dayText, rewardText, statusText);
      if (entry.day === 7 && !claimed) {
        cell.setStrokeStyle(2, 0xffaa00);
      }
    });
  }

  destroy() {
    if (this.container) { this.container.destroy(); this.container = null; }
  }
}
