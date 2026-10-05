import { GAME_WIDTH, GAME_HEIGHT } from '../engine/GridConstants.js';

/**
 * VanguardPanel: 先锋官面板（主菜单 📊 入口）——玩家语言的属性总览。
 * 顶部：战力大数字卡；中部：核心属性网格（伤害/攻速/暴击/收益，图标+中文+直观换算）；
 * 下部：加成来源中文摘要（"装备 伤害+25% 攻速-15%"式）；底部：穿戴一览。
 * 数据源 GameState.getBonusBreakdown()（结构化对象）。
 */
export class VanguardPanel {
  constructor(scene, breakdown, equippedList, { onClose }) {
    this.scene = scene;
    this.data = breakdown; // { power, stats: {...}, sources: [{source, text}] }
    this.equippedList = equippedList; // [{slot, empty, quality, qColor, tier, affixes[]}]
    this.onClose = onClose;
    this.build();
  }

  build() {
    const { width, height } = this.scene.cameras.main;
    const cx = width / 2;
    this.container = this.scene.add.container(0, 0).setDepth(700);
    this.container.add(this.scene.add.rectangle(cx, height / 2, width, height, 0x000000, 0.94).setInteractive());

    this.container.add(this.scene.add.text(cx, 40, '📊 先锋官属性', {
      fontSize: '22px', fill: '#ffdd44', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));

    // ===== 战力大数字卡 =====
    const pY = 96;
    const pg = this.scene.add.graphics();
    pg.fillStyle(0x1a2436, 0.95);
    pg.fillRoundedRect(cx - 240, pY - 32, 480, 64, 12);
    pg.lineStyle(2, 0xffcc44, 0.7);
    pg.strokeRoundedRect(cx - 240, pY - 32, 480, 64, 12);
    this.container.add(pg);
    this.container.add(this.scene.add.text(cx - 210, pY, '⚡ 战力', {
      fontSize: '16px', fill: '#8899bb', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0, 0.5));
    this.container.add(this.scene.add.text(cx + 210, pY, `${this.data.power}`, {
      fontSize: '34px', fill: '#ffdd44', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(1, 0.5));
    this.container.add(this.scene.add.text(cx, pY + 22, '装备 · 宝石 · 佣兵 · 强化的全部折算', {
      fontSize: '9.5px', fill: '#667788', fontFamily: 'Arial',
    }).setOrigin(0.5));

    // ===== 核心属性 2×3 网格（图标+中文名+直观值）=====
    const s = this.data.stats;
    const cells = [
      { icon: '⚔️', name: '伤害', value: `×${s.damageMult.toFixed(2)}`, sub: '基础 1.00' },
      { icon: '🌀', name: '攻速', value: `${s.msPerShot}ms/发`, sub: `×${s.attackSpeed.toFixed(2)}` },
      { icon: '🎯', name: '暴击', value: `${Math.round(s.critRate * 100)}%`, sub: `暴伤 ×${s.critDamage.toFixed(2)}` },
      { icon: '🔫', name: '枪械', value: s.gunMult > 1.01 ? `×${s.gunMult.toFixed(2)}` : '—', sub: '研发+宝石' },
      { icon: '💰', name: '金币', value: `×${s.goldBonus.toFixed(2)}`, sub: '关卡收益' },
      { icon: '⭐', name: '经验', value: `×${s.xpBonus.toFixed(2)}`, sub: '升级速度' },
    ];
    const gridY = 190;
    const cellW = 150, cellH = 74;
    cells.forEach((c, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      const x = cx - cellW * 1.5 - 12 + col * (cellW + 12) + cellW / 2;
      const y = gridY + row * (cellH + 10) + cellH / 2;
      const g = this.scene.add.graphics();
      g.fillStyle(0x161d2b, 0.95);
      g.fillRoundedRect(x - cellW / 2, y - cellH / 2, cellW, cellH, 10);
      g.lineStyle(1, 0x2a3a52, 1);
      g.strokeRoundedRect(x - cellW / 2, y - cellH / 2, cellW, cellH, 10);
      this.container.add(g);
      this.container.add(this.scene.add.text(x - cellW / 2 + 12, y - cellH / 2 + 16, `${c.icon} ${c.name}`, {
        fontSize: '12px', fill: '#8899bb', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0, 0.5));
      this.container.add(this.scene.add.text(x - cellW / 2 + 12, y + 2, c.value, {
        fontSize: '19px', fill: '#ffffff', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0, 0.5));
      this.container.add(this.scene.add.text(x - cellW / 2 + 12, y + cellH / 2 - 13, c.sub, {
        fontSize: '9px', fill: '#667788', fontFamily: 'Arial',
      }).setOrigin(0, 0.5));
    });

    // ===== 加成来源摘要（中文一句话/来源）=====
    const srcY = gridY + 2 * (cellH + 10) + 24;
    this.container.add(this.scene.add.text(cx - 240, srcY, '加成来源', {
      fontSize: '13px', fill: '#ffdd66', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0, 0.5));
    if (this.data.sources.length === 0) {
      this.container.add(this.scene.add.text(cx, srcY + 24, '暂无加成——穿戴装备/镶嵌宝石后这里会显示各来源贡献', {
        fontSize: '11px', fill: '#667788', fontFamily: 'Arial',
      }).setOrigin(0.5));
    } else {
      // 每来源一行（合并同源多条 text），最多 6 行
      const bySrc = {};
      for (const e of this.data.sources) (bySrc[e.source] = bySrc[e.source] || []).push(e.text);
      const rows = Object.entries(bySrc).slice(0, 6);
      rows.forEach(([src, texts], i) => {
        const ry = srcY + 26 + i * 22;
        const g = this.scene.add.graphics();
        g.fillStyle(0x131a28, 0.9);
        g.fillRoundedRect(cx - 240, ry - 11, 480, 22, 5);
        this.container.add(g);
        this.container.add(this.scene.add.text(cx - 228, ry, src, {
          fontSize: '11px', fill: '#88ddff', fontFamily: 'Arial', fontStyle: 'bold',
        }).setOrigin(0, 0.5));
        this.container.add(this.scene.add.text(cx + 228, ry, texts.join('  '), {
          fontSize: '11px', fill: '#88ff88', fontFamily: 'Arial',
        }).setOrigin(1, 0.5));
      });
      if (Object.keys(bySrc).length > 6) {
        this.container.add(this.scene.add.text(cx, srcY + 26 + 6 * 22, '…', {
          fontSize: '11px', fill: '#667788', fontFamily: 'Arial',
        }).setOrigin(0.5));
      }
      // 穿戴一览（两列网格：每格部位/品质阶 + 词条 2 行，不再一行挤 6 件）
      const eqY = srcY + 26 + Math.min(6, Object.keys(bySrc).length) * 22 + 14;
      this.container.add(this.scene.add.text(cx - 240, eqY, '穿戴一览', {
        fontSize: '13px', fill: '#ffdd66', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0, 0.5));
      const list = Array.isArray(this.equippedList) ? this.equippedList : [];
      const ecW = 232, ecH = 52;
      list.forEach((eq, i) => {
        const col = i % 2, row = Math.floor(i / 2);
        const x = cx - ecW - 6 + col * (ecW + 12);
        const y = eqY + 22 + row * (ecH + 8);
        const g = this.scene.add.graphics();
        g.fillStyle(0x131a28, 0.9);
        g.fillRoundedRect(x - ecW / 2, y - ecH / 2, ecW, ecH, 8);
        g.lineStyle(1, eq.empty ? 0x2a3444 : 0x3a5a7a, 1);
        g.strokeRoundedRect(x - ecW / 2, y - ecH / 2, ecW, ecH, 8);
        this.container.add(g);
        if (eq.empty) {
          this.container.add(this.scene.add.text(x, y, `${eq.slot}：（空）`, {
            fontSize: '11px', fill: '#556677', fontFamily: 'Arial',
          }).setOrigin(0.5));
        } else {
          this.container.add(this.scene.add.text(x - ecW / 2 + 12, y - 14, `${eq.slot}  ${eq.quality}${eq.tier}阶`, {
            fontSize: '11.5px', fill: eq.qColor, fontFamily: 'Arial', fontStyle: 'bold',
          }).setOrigin(0, 0.5));
          (eq.affixes || []).forEach((t, ai) => {
            this.container.add(this.scene.add.text(x - ecW / 2 + 12, y + 2 + ai * 14, t, {
              fontSize: '9.5px', fill: '#88ff88', fontFamily: 'Arial',
            }).setOrigin(0, 0.5));
          });
        }
      });
    }

    this.container.add(this.scene.add.text(cx, height - 18, '点击空白处关闭', {
      fontSize: '11px', fill: '#667', fontFamily: 'Arial',
    }).setOrigin(0.5));
    this.container.list[0].on('pointerdown', () => { this.destroy(); this.onClose?.(); });
  }

  destroy() {
    if (this.container) { this.container.destroy(); this.container = null; }
  }
}
