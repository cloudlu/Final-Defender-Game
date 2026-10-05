import { GAME_WIDTH, GAME_HEIGHT } from '../engine/GridConstants.js';

const QUALITY_COLORS = {
  '精良': { border: 0x66cc66, color: '#66cc66' },
  '卓越': { border: 0x4488ff, color: '#4488ff' },
  '完美': { border: 0xaa44ff, color: '#aa44ff' },
  '传说': { border: 0xff8800, color: '#ff8800' },
  '绝世': { border: 0xff4444, color: '#ff4444' },
  '绝世+3': { border: 0xff44dd, color: '#ff44dd' },
};

/**
 * TavernPanel: 酒馆/佣兵面板（替代宠物面板）。
 * 招募（钻石）→ 拥有列表 → 升级/升品/上阵 2 位。
 * 核心提示：拥有即永久加攻，无需上阵（原版核心机制）。
 */
export class TavernPanel {
  constructor(scene, mercSystem, globalSave, { onClose, onPersist, forgeRef = null }) {
    this.scene = scene;
    this.mercs = mercSystem;
    this.save = globalSave;
    this.forgeRef = forgeRef;
    this.onClose = onClose;
    this.onPersist = onPersist;
    this.selectedId = null;
    this.deployMode = null; // 0 | 1（选择上阵位）
    this.build();
  }

  build() {
    const { width, height } = this.scene.cameras.main;
    const cx = width / 2;
    this.container = this.scene.add.container(0, 0).setDepth(700);
    this.container.add(this.scene.add.rectangle(cx, height / 2, width, height, 0x000000, 0.9).setInteractive());
    this.container.add(this.scene.add.text(cx, 38, '🍺 酒馆 · 佣兵', {
      fontSize: '26px', fill: '#ffcc88', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));

    this.balanceText = this.scene.add.text(cx, 74, '', {
      fontSize: '14px', fill: '#ffd700', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.container.add(this.balanceText);

    // 被动加成提示（原版核心）
    this.passiveText = this.scene.add.text(cx, 100, '', {
      fontSize: '12px', fill: '#88ff88', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.container.add(this.passiveText);

    // 招募按钮
    const cost = this.mercs.config.recruit.costPerPull;
    const cur = this.mercs.config.recruit.currency === 'diamond' ? '💎' : '💰';
    const recruitBtn = this.scene.add.rectangle(cx + 190, 74, 150, 34, 0xaa5588)
      .setInteractive({ useHandCursor: true });
    this.container.add(recruitBtn);
    this.container.add(this.scene.add.text(cx + 190, 74, `🎲 招募 ${cur}${cost}`, {
      fontSize: '13px', fill: '#fff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));
    recruitBtn.on('pointerdown', () => {
      const balance = cur === '💎' ? (this.save.diamond || 0) : (this.save.gold || 0);
      if (balance < cost) { this._toast('⚠ 操作无法完成：条件不足'); return; }
      if (cur === '💎') this.save.diamond -= cost; else this.save.gold -= cost;
      const r = this.mercs.recruit();
      const msg = r.isNew ? `🎉 获得新佣兵：${r.name}！` : `${r.name} 碎片 +${r.shards}`;
      this._toast(msg);
      this.onPersist?.();
      this.refresh();
    });

    this.listContainer = this.scene.add.container(0, 0);
    this.container.add(this.listContainer);
    this.detailContainer = this.scene.add.container(0, 0);
    this.container.add(this.detailContainer);

    this.container.add(this.scene.add.text(cx, height - 20, '拥有即永久加攻（无需上阵）· 上阵 2 位出战 · 点击空白关闭', {
      fontSize: '11px', fill: '#667', fontFamily: 'Arial',
    }).setOrigin(0.5));
    this.container.list[0].on('pointerdown', () => { this.destroy(); this.onClose?.(); });

    this.refresh();
  }

  _toast(msg, color = '#ffdd44') {
    this._toastText?.destroy();
    this._toastText = this.scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, msg, {
      fontSize: '16px', fill: color, fontFamily: 'Arial', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 3,
      backgroundColor: '#000000cc', padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setDepth(750);
    this.scene.tweens.add({ targets: this._toastText, alpha: 0, delay: 1400, duration: 400, onComplete: () => this._toastText?.destroy() });
  }

  refresh() {
    this.balanceText.setText(`💰 ${this.save.gold || 0}   💎 ${this.save.diamond || 0}`);
    const atk = this.mercs.getTotalPassiveAttack();
    this.passiveText.setText(`⚔️ 佣兵被动攻击加成：+${atk}（已拥有即生效）`);
    this._buildList();
    this._buildDetail();
  }

  _buildList() {
    this.listContainer.removeAll(true);
    const cx = GAME_WIDTH / 2;
    const owned = Object.keys(this.mercs.save.owned);
    const startY = 140;
    const rowH = 54;
    if (owned.length === 0) {
      this.listContainer.add(this.scene.add.text(cx, startY + 10, '暂无佣兵——点右上「🎲 招募」开始组建你的战队', {
        fontSize: '12px', fill: '#667788', fontFamily: 'Arial',
      }).setOrigin(0.5));
      return;
    }
    owned.forEach((id, i) => {
      const cfg = this.mercs._cfg(id);
      if (!cfg) return;
      const st = this.mercs.save.owned[id];
      const y = startY + i * rowH;
      const qc = QUALITY_COLORS[st.quality] || QUALITY_COLORS['精良'];
      const deployedSlot = this.mercs.save.deployed.indexOf(id);
      const selected = this.selectedId === id;
      const row = this.scene.add.rectangle(cx, y, 490, 46, selected ? 0x2a4060 : 0x1e2436)
        .setInteractive({ useHandCursor: true });
      row.setStrokeStyle(2, deployedSlot >= 0 ? 0xffcc44 : qc.border);
      this.listContainer.add(row);
      this.listContainer.add(this.scene.add.text(cx - 225, y, cfg.icon, { fontSize: '22px' }).setOrigin(0.5));
      this.listContainer.add(this.scene.add.text(cx - 190, y - 10, cfg.name, {
        fontSize: '14px', fill: qc.color, fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0, 0.5));
      this.listContainer.add(this.scene.add.text(cx - 190, y + 11,
        `${st.quality} Lv.${st.level} · 被动攻击+${(this.mercs.config.atkBonusByQuality[st.quality] || 0) + Math.floor((st.level - 1) * 6.5)}`, {
        fontSize: '10.5px', fill: '#aabbcc', fontFamily: 'Arial',
      }).setOrigin(0, 0.5));
      if (deployedSlot >= 0) {
        this.listContainer.add(this.scene.add.text(cx + 195, y, `[出战${deployedSlot + 1}]`, {
          fontSize: '11px', fill: '#ffcc44', fontFamily: 'Arial', fontStyle: 'bold',
        }).setOrigin(0.5));
      }
      row.on('pointerdown', () => {
        if (this.deployMode !== null) {
          this.mercs.deploy(this.deployMode, id);
          this.deployMode = null;
          this.onPersist?.();
        } else {
          this.selectedId = id;
        }
        this.refresh();
      });
    });
  }

  _buildDetail() {
    this.detailContainer.removeAll(true);
    // 出战位选择行
    const cx = GAME_WIDTH / 2;
    const slotY = GAME_HEIGHT - 210;
    for (const slot of [0, 1]) {
      const id = this.mercs.save.deployed[slot];
      const cfg = id ? this.mercs._cfg(id) : null;
      const isPicking = this.deployMode === slot;
      const btn = this.scene.add.rectangle(cx - 120 + slot * 240, slotY, 220, 40, isPicking ? 0x668844 : (cfg ? 0x2a4a3a : 0x333344))
        .setInteractive({ useHandCursor: true });
      this.detailContainer.add(btn);
      this.detailContainer.add(this.scene.add.text(cx - 120 + slot * 240, slotY,
        `出战${slot + 1}：${cfg ? cfg.icon + cfg.name : '（空）— 点选'}`, {
        fontSize: '13px', fill: '#ffffff', fontFamily: 'Arial',
      }).setOrigin(0.5));
      btn.on('pointerdown', () => {
        this.deployMode = isPicking ? null : slot;
        if (!isPicking && this.deployMode === null) { this.mercs.deploy(slot, null); this.onPersist?.(); }
        this.refresh();
      });
    }

    // ===== 枪械研发（B5：独立乘区，只作用于枪械）=====
    const research = this.forgeRef; // GameScene/Menu 注入 forgeSystem
    if (research) {
      const rY = GAME_HEIGHT - 262;
      const lv = research.save.gunResearch?.level || 0;
      const mult = research.getResearchMultiplier();
      const panel = this.scene.add.rectangle(cx, rY, 490, 40, 0x14202c);
      panel.setStrokeStyle(1, 0x4466aa);
      this.detailContainer.add(panel);
      this.detailContainer.add(this.scene.add.text(cx - 200, rY, `🔬 枪械研发 Lv.${lv}（枪械伤害 ×${mult.toFixed(2)}）`, {
        fontSize: '12px', fill: '#88ccff', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0, 0.5));
      const notesCost = research.getResearchCost();
      const diamondCost = notesCost * 5; // 图纸→钻石简化
      // 图纸优先（原版：枪械研发消耗图纸），无图纸用钻石兜底
      const notes = this.save.gunNotes || 0;
      const useNotes = notes >= notesCost;
      const canUp = useNotes ? true : (this.save.diamond || 0) >= diamondCost;
      const rBtn = this.scene.add.rectangle(cx + 190, rY, 120, 30, canUp ? 0x3366aa : 0x555566)
        .setInteractive({ useHandCursor: canUp });
      this.detailContainer.add(rBtn);
      this.detailContainer.add(this.scene.add.text(cx + 190, rY, useNotes ? `研究 📜${notesCost}` : `研究 💎${diamondCost}`, {
        fontSize: '12px', fill: '#fff', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0.5));
      rBtn.on('pointerdown', () => {
        if (useNotes) {
          const r = research.upgradeResearch(notesCost);
          if (r.success) { this.save.gunNotes -= notesCost; this.onPersist?.(); this.refresh(); this._toast(`🔬 研发成功 Lv.${r.level}`, '#88ccff'); }
        } else if ((this.save.diamond || 0) >= diamondCost) {
          this.save.diamond -= diamondCost; // 钻石兜底（原版图纸通道的简化替代）
          const r = research.upgradeResearch(notesCost);
          if (r.success) { this.onPersist?.(); this.refresh(); this._toast(`🔬 研发成功 Lv.${r.level}`, '#88ccff'); }
        } else {
          this._toast(`⚠ 图纸不足（需 📜${notesCost}，持有 ${notes}）或钻石不足（需 💎${diamondCost}）`, '#ffaa66');
        }
      });
      this.detailContainer.add(this.scene.add.text(cx - 205, rY + 0, `图纸 ${notes}`, {
        fontSize: '10px', fill: '#889', fontFamily: 'Arial',
      }).setOrigin(0, 0.5));
    }

    if (!this.selectedId) return;
    const cfg = this.mercs._cfg(this.selectedId);
    const st = this.mercs.save.owned[this.selectedId];
    if (!cfg || !st) return;
    const y = GAME_HEIGHT - 120;
    const panel = this.scene.add.rectangle(cx, y, 500, 110, 0x18202f);
    panel.setStrokeStyle(2, 0x556677);
    this.detailContainer.add(panel);
    this.detailContainer.add(this.scene.add.text(cx, y - 38, `${cfg.skill.name}：${cfg.desc}`, {
      fontSize: '11.5px', fill: '#88ff88', fontFamily: 'Arial',
      wordWrap: { width: 470 }, align: 'center',
    }).setOrigin(0.5));

    // 升级（金币）
    const lvCost = this.mercs.getLevelUpCost(this.selectedId);
    const canLv = lvCost !== null && (this.save.gold || 0) >= lvCost;
    const lvBtn = this.scene.add.rectangle(cx - 130, y + 8, 150, 34, canLv ? 0x00aa44 : 0x555566)
      .setInteractive({ useHandCursor: canLv });
    this.detailContainer.add(lvBtn);
    this.detailContainer.add(this.scene.add.text(cx - 130, y + 8, lvCost === null ? '满级 100' : `⬆ Lv${st.level + 1} 💰${lvCost}`, {
      fontSize: '12px', fill: '#fff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));
    lvBtn.on('pointerdown', () => {
      const r = this.mercs.levelUp(this.selectedId, this.save.gold || 0);
      if (r.success) { this.save.gold -= r.cost; this.onPersist?.(); this.refresh(); }
      else this._toast('⚠ 操作无法完成：条件不足');
    });

    // 升品（契约碎片简化为钻石消耗）
    const qCost = this.mercs.getUpgradeQualityCost(this.selectedId);
    const qDiamond = qCost !== null ? qCost * 5 : null;
    const canQ = qDiamond !== null && (this.save.diamond || 0) >= qDiamond;
    const qBtn = this.scene.add.rectangle(cx + 30, y + 8, 170, 34, canQ ? 0xaa44bb : 0x555566)
      .setInteractive({ useHandCursor: canQ });
    this.detailContainer.add(qBtn);
    this.detailContainer.add(this.scene.add.text(cx + 30, y + 8, qCost === null ? '品质 MAX' : `⬆ 升品 💎${qDiamond}`, {
      fontSize: '12px', fill: '#fff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));
    qBtn.on('pointerdown', () => {
      if (!canQ) { this._toast('⚠ 操作无法完成：条件不足'); return; }
      this.save.diamond -= qDiamond;
      const r = this.mercs.upgradeQuality(this.selectedId);
      if (r.success) {
        this._toast(`⬆ 品质提升：${r.quality}！继承比例提高`);
        this.onPersist?.();
        this.refresh();
      }
    });

    // 上阵快捷
    const freeSlot = this.mercs.save.deployed[0] === null ? 0 : (this.mercs.save.deployed[1] === null ? 1 : null);
    const isInDeploy = this.mercs.save.deployed.includes(this.selectedId);
    const depBtn = this.scene.add.rectangle(cx + 180, y + 8, 120, 34, isInDeploy || freeSlot === null ? 0x555566 : 0x336699)
      .setInteractive({ useHandCursor: !isInDeploy && freeSlot !== null });
    this.detailContainer.add(depBtn);
    this.detailContainer.add(this.scene.add.text(cx + 180, y + 8, isInDeploy ? '已出战' : freeSlot === null ? '出战位已满' : '上阵', {
      fontSize: '12px', fill: '#fff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));
    depBtn.on('pointerdown', () => {
      if (isInDeploy || freeSlot === null) return;
      this.mercs.deploy(freeSlot, this.selectedId);
      this.onPersist?.();
      this.refresh();
    });
  }

  destroy() {
    if (this.container) { this.container.destroy(); this.container = null; }
  }
}
