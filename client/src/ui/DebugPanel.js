import { GAME_WIDTH, GAME_HEIGHT } from '../engine/GridConstants.js';

/**
 * DebugPanel: 战斗内平衡调试（仅 URL 带 ?debug=1 时可用）。
 * 滑杆：全局伤害倍率 / 敌人血量倍率 / 敌人速度倍率 / 弹速倍率
 * 按钮：清屏 / 跳下一波 / +10000 金币 / +1000 钻石 / 满弹药
 * 所有倍率实时写 GameState（不持久化，刷新即重置）。
 */
export class DebugPanel {
  constructor(scene, state) {
    this.scene = scene;
    this.state = state;
    this.container = null;
    this.build();
  }

  static get enabled() {
    try { return new URLSearchParams(location.search).has('debug'); } catch { return false; }
  }

  build() {
    const scene = this.scene;
    this.container = scene.add.container(0, 0).setDepth(850);
    const w = 250, h = 330;
    const x = GAME_WIDTH - w / 2 - 8, y = 200;
    this.container.add(scene.add.rectangle(x, y, w, h, 0x101828, 0.95).setInteractive()); // 挡穿透
    const g = scene.add.graphics();
    g.lineStyle(2, 0x4466aa, 1);
    g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 8);
    this.container.add(g);
    this.container.add(scene.add.text(x, y - h / 2 + 16, '🛠 DEBUG', {
      fontSize: '13px', fill: '#ff8844', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));

    // ===== 滑杆组 =====
    this.sliders = [];
    const mkSlider = (label, get, set, min = 0, max = 5, yy) => {
      this.container.add(scene.add.text(x - w / 2 + 14, yy - 12, `${label}: ${get().toFixed(2)}`, {
        fontSize: '10.5px', fill: '#aabbcc', fontFamily: 'Arial',
      }).setOrigin(0, 0.5));
      // 简易滑杆：矩形轨道 + 可拖动手柄
      const trackW = w - 40;
      const track = scene.add.rectangle(x, yy + 8, trackW, 6, 0x2a3a52).setInteractive();
      const handle = scene.add.circle(x - trackW / 2 + trackW * ((get() - min) / (max - min)), yy + 8, 8, 0x66aaff)
        .setInteractive({ draggable: true });
      this.container.add(track);
      this.container.add(handle);
      const sync = () => {
        handle.x = x - trackW / 2 + trackW * ((get() - min) / (max - min));
        this.container.list.find(o => o.text?.startsWith(label))?.setText(`${label}: ${get().toFixed(2)}`);
      };
      handle.on('drag', (pointer, dragX) => {
        const ratio = Math.max(0, Math.min(1, (dragX - (x - trackW / 2)) / trackW));
        set(min + ratio * (max - min));
        sync();
      });
      track.on('pointerdown', (p) => {
        const ratio = Math.max(0, Math.min(1, (p.x - (x - trackW / 2)) / trackW));
        set(min + ratio * (max - min));
        sync();
      });
      this.sliders.push({ sync });
    };

    const S = this.state;
    mkSlider('伤害倍率', () => S.debugDmgMult ?? 1, v => S.debugDmgMult = v, 0, 10, y - h / 2 + 46);
    mkSlider('敌血倍率', () => S.debugEnemyHpMult ?? 1, v => S.debugEnemyHpMult = v, 0.1, 10, y - h / 2 + 92);
    mkSlider('敌速倍率', () => S.debugEnemySpeedMult ?? 1, v => S.debugEnemySpeedMult = v, 0.1, 5, y - h / 2 + 138);

    // ===== 按钮组 =====
    const mkBtn = (bx, by, bw, label, color, onClick) => {
      const b = scene.add.rectangle(bx, by, bw, 26, color).setInteractive({ useHandCursor: true });
      this.container.add(b);
      this.container.add(scene.add.text(bx, by, label, {
        fontSize: '10.5px', fill: '#fff', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0.5));
      b.on('pointerdown', onClick);
    };
    const byBase = y - h / 2 + 168;
    mkBtn(x - 62, byBase, 116, '💥 清屏', 0x884444, () => {
      for (const e of S.enemies) { e.hp = 0; e.alive = false; }
    });
    mkBtn(x + 62, byBase, 116, '⏭ 跳下一波', 0x446688, () => {
      S.waveManager.spawnQueue.length = 0;
      for (const e of S.enemies) e.alive = false;
      S.waveCountdown = Math.min(S.waveCountdown, 1);
    });
    mkBtn(x - 62, byBase + 34, 116, '💰 +10000', 0x887722, () => { S.gold += 10000; });
    mkBtn(x + 62, byBase + 34, 116, '💎 +1000', 0x446699, () => { S.diamond = (S.diamond || 0) + 1000; });
    mkBtn(x - 62, byBase + 68, 116, '🔫 满弹药', 0x336655, () => { S.ammo = S.magazineSize; S._reloading = false; });
    mkBtn(x + 62, byBase + 68, 116, '⭐ +1 级', 0x664488, () => { S.pendingLevelUp = true; });

    // 关闭按钮
    const closeBtn = scene.add.text(x + w / 2 - 12, y - h / 2 + 14, '✕', {
      fontSize: '12px', fill: '#88aacc', fontFamily: 'Arial',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.container.add(closeBtn);
    closeBtn.on('pointerdown', () => this.destroy());
  }

  destroy() {
    if (this.container) { this.container.destroy(); this.container = null; }
  }
}
