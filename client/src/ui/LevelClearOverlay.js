/**
 * LevelClearOverlay: 关卡通关结算（星级 + 重玩/下一关/选关）。
 * 星级：墙血 ≥80% 三星 / ≥50% 二星 / 通关一星。
 */
export class LevelClearOverlay {
  constructor(scene, result, actions) {
    this.scene = scene;
    this.build(result, actions);
  }

  build(result, actions) {
    const { width, height } = this.scene.cameras.main;
    this.container = this.scene.add.container(0, 0).setDepth(650);

    const bg = this.scene.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.85);
    bg.setInteractive();
    this.container.add(bg);

    const cx = width / 2, cy = height / 2;

    const title = this.scene.add.text(cx, cy - 200, '🏆 关卡通关!', {
      fontSize: '30px', fill: '#ffdd44', fontFamily: 'Arial', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5);
    this.container.add(title);

    this.container.add(this.scene.add.text(cx, cy - 158, `${result.levelName}${result.elite ? ' · 精英' : ''}`, {
      fontSize: '16px', fill: '#66ccff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));

    // 星级逐颗弹出
    const starY = cy - 105;
    const starGap = 70;
    for (let i = 0; i < 3; i++) {
      const earned = i < result.stars;
      const star = this.scene.add.text(cx + (i - 1) * starGap, starY, earned ? '⭐' : '☆', {
        fontSize: '44px',
      }).setOrigin(0.5).setAlpha(earned ? 0 : 1).setScale(earned ? 2.2 : 1);
      this.container.add(star);
      if (earned) {
        this.scene.tweens.add({
          targets: star, alpha: 1, scale: 1,
          delay: 350 + i * 300, duration: 260, ease: 'Back.easeOut',
        });
      }
    }

    if (result.newRecord) {
      this.container.add(this.scene.add.text(cx, starY + 44, '✨ 新纪录!', {
        fontSize: '13px', fill: '#ff88ff', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0.5));
    }

    this.container.add(this.scene.add.text(cx, cy - 25, `分数 ${result.score}  ·  金币 +${result.goldEarned ?? 0}  ·  钻石 +${result.diamondEarned ?? 0}`, {
      fontSize: '13px', fill: '#88ff88', fontFamily: 'Arial',
    }).setOrigin(0.5));

    // 剧情解锁文本（对齐原版：通关解锁剧情）
    if (result.storyUnlock) {
      const storyBg = this.scene.add.graphics();
      storyBg.fillStyle(0x101826, 0.95);
      storyBg.fillRoundedRect(cx - 240, cy + 5, 480, 74, 8);
      storyBg.lineStyle(1, 0x4466aa, 1);
      storyBg.strokeRoundedRect(cx - 240, cy + 5, 480, 74, 8);
      this.container.add(storyBg);
      this.container.add(this.scene.add.text(cx - 225, cy + 13, '📖 剧情解锁', {
        fontSize: '11px', fill: '#66aaff', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0, 0));
      this.container.add(this.scene.add.text(cx, cy + 42, result.storyUnlock, {
        fontSize: '11px', fill: '#ccddee', fontFamily: 'Arial',
        wordWrap: { width: 460 }, align: 'center', lineSpacing: 3,
      }).setOrigin(0.5));
    }

    // 本局装备处理（原版式：结算时统一穿/分解）
    const loot = result.loot || [];
    if (loot.length > 0 && actions.onLootResolve) {
      const lootY = cy + 100;
      this.container.add(this.scene.add.text(cx, lootY - 14, `📦 本局获得装备（${loot.length} 件）— 逐件处理：`, {
        fontSize: '11px', fill: '#88ddff', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0.5));
      loot.slice(0, 3).forEach((item, i) => {
        const rowY = lootY + 14 + i * 34;
        const RARITY_COLOR = { white: 0xaaaaaa, blue: 0x4488ff, purple: 0xaa44ff, orange: 0xff8800 };
        const rc = RARITY_COLOR[item.rarity] || 0xaaaaaa;
        const g = this.scene.add.graphics();
        g.fillStyle(0x18202f, 0.95);
        g.fillRoundedRect(cx - 235, rowY - 14, 470, 30, 6);
        g.lineStyle(1, rc, 1);
        g.strokeRoundedRect(cx - 235, rowY - 14, 470, 30, 6);
        this.container.add(g);
        this.container.add(this.scene.add.text(cx - 220, rowY, item.name, {
          fontSize: '12px', fill: `#${rc.toString(16).padStart(6, '0')}`, fontFamily: 'Arial', fontStyle: 'bold',
        }).setOrigin(0, 0.5));
        this.container.add(this.scene.add.text(cx - 60, rowY, `[${item.slot}] ${item.description}`, {
          fontSize: '10px', fill: '#ccccdd', fontFamily: 'Arial',
        }).setOrigin(0, 0.5));
        const wearBtn = this.scene.add.rectangle(cx + 150, rowY, 70, 24, 0x00aa44).setInteractive({ useHandCursor: true }).setDepth(651);
        this.container.add(wearBtn);
        this.container.add(this.scene.add.text(cx + 150, rowY, '穿戴', { fontSize: '11px', fill: '#fff', fontFamily: 'Arial' }).setOrigin(0.5).setDepth(652));
        const scrapBtn = this.scene.add.rectangle(cx + 225, rowY, 70, 24, 0x884444).setInteractive({ useHandCursor: true }).setDepth(651);
        this.container.add(scrapBtn);
        this.container.add(this.scene.add.text(cx + 225, rowY, '分解', { fontSize: '11px', fill: '#fff', fontFamily: 'Arial' }).setOrigin(0.5).setDepth(652));
        const handle = (wear) => {
          actions.onLootResolve(item, wear);
          g.setAlpha(0.3);
          wearBtn.disableInteractive().setFillStyle(0x333333);
          scrapBtn.disableInteractive().setFillStyle(0x333333);
        };
        wearBtn.on('pointerdown', () => handle(true));
        scrapBtn.on('pointerdown', () => handle(false));
      });
    }

    // 按钮
    const btnY = cy + 215;
    this._button(cx - 130, btnY, 140, 44, '🔁 再来一次', 0x555577, actions.onRetry);
    if (result.hasNext) {
      this._button(cx + 10, btnY, 160, 44, '▶ 下一关', 0x00aa44, actions.onNext);
    }
    this._button(cx - 60, btnY + 58, 140, 40, '📋 选关', 0x336699, actions.onMenu);
  }

  _button(x, y, w, h, label, color, onClick) {
    const btn = this.scene.add.rectangle(x, y, w, h, color)
      .setInteractive({ useHandCursor: true }).setDepth(651);
    this.container.add(btn);
    this.container.add(this.scene.add.text(x, y, label, {
      fontSize: '15px', fill: '#ffffff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(652));
    btn.on('pointerover', () => btn.setFillStyle(color + 0x111111));
    btn.on('pointerout', () => btn.setFillStyle(color));
    btn.on('pointerdown', onClick);
  }
}
