import { GAME_WIDTH, GAME_HEIGHT } from '../engine/GridConstants.js';
import { describeEffect } from './statNames.js';

const RARITY_COLORS = {
  white: { border: 0xaaaaaa, color: '#aaaaaa', label: '普通' },
  blue: { border: 0x4488ff, color: '#4488ff', label: '稀有' },
  purple: { border: 0xaa44ff, color: '#aa44ff', label: '史诗' },
  orange: { border: 0xff8800, color: '#ff8800', label: '传说' },
};
const SLOT_NAMES = { weapon: '武器', armor: '护甲', helmet: '头盔', gloves: '手套', boots: '鞋子', accessory: '饰品' };

/**
 * ForgePanel: 装备仓库/强化/分解/穿戴 面板（主菜单入口）。
 * 穿戴状态与仓库同存于全局档（save.equipped: { slot: uid }）。
 */
export class ForgePanel {
  constructor(scene, forgeSystem, globalSave, { onClose, onPersist }) {
    this.scene = scene;
    this.forge = forgeSystem;
    this.save = globalSave;
    this.save.equipped = this.save.equipped || {};
    this.onClose = onClose;
    this.onPersist = onPersist;
    this.selectedUid = null;
    this.build();
  }

  build() {
    const { width, height } = this.scene.cameras.main;
    const cx = width / 2;
    this.container = this.scene.add.container(0, 0).setDepth(700);
    this.container.add(this.scene.add.rectangle(cx, height / 2, width, height, 0x000000, 0.9).setInteractive());

    this.container.add(this.scene.add.text(cx, 40, '🔧 装备锻造', {
      fontSize: '26px', fill: '#66ccff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));

    this.balanceText = this.scene.add.text(cx, 76, '', {
      fontSize: '15px', fill: '#ffd700', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.container.add(this.balanceText);

    // 已穿戴区
    this.equipText = this.scene.add.text(cx, 104, '', {
      fontSize: '12px', fill: '#88ff88', fontFamily: 'Arial',
    }).setOrigin(0.5);
    this.container.add(this.equipText);

    // 仓库列表容器
    this.listContainer = this.scene.add.container(0, 0);
    this.container.add(this.listContainer);
    // 详情容器
    this.detailContainer = this.scene.add.container(0, 0);
    this.container.add(this.detailContainer);

    this.container.add(this.scene.add.text(cx, height - 22, '点击装备查看 · 点击空白处关闭', {
      fontSize: '11px', fill: '#667', fontFamily: 'Arial',
    }).setOrigin(0.5));
    this.container.list[0].on('pointerdown', () => { this.destroy(); this.onClose?.(); });

    this.refresh();
  }

  refresh() {
    this.balanceText.setText(`💰 ${this.save.gold || 0}`);
    // 6 槽位固定顺序展示（空槽灰显）
    const ALL_SLOTS = ['weapon', 'helmet', 'gloves', 'armor', 'boots', 'accessory'];
    const eqParts = ALL_SLOTS.map(slot => {
      const uid = this.save.equipped[slot];
      const entry = uid != null ? this.forge.save.inventory.find(i => i.uid === uid) : null;
      if (!entry) return `${SLOT_NAMES[slot]}:—`;
      const base = this.forge._baseConfig(entry.refId);
      return `${SLOT_NAMES[slot]}:${base?.name || '?'}${entry.forgeLv > 0 ? '+' + entry.forgeLv : ''}`;
    });
    this.equipText.setText(eqParts.join('  '));
    this._buildList();
    this._buildDetail();
  }

  _buildList() {
    this.listContainer.removeAll(true);
    const cx = GAME_WIDTH / 2;
    const items = this.forge.save.inventory.slice(0, 8); // 最多显示 8 件
    const startY = 150;
    const rowH = 44;
    if (items.length === 0) {
      this.listContainer.add(this.scene.add.text(cx, startY + 20, '仓库为空——去 🎰 抽卡或局内掉落获取装备', {
        fontSize: '12px', fill: '#667788', fontFamily: 'Arial',
      }).setOrigin(0.5));
      return;
    }
    items.forEach((entry, i) => {
      const y = startY + i * rowH;
      const base = this.forge._baseConfig(entry.refId);
      const rc = RARITY_COLORS[base?.rarity] || RARITY_COLORS.white;
      const equippedSlot = Object.entries(this.save.equipped).find(([, uid]) => uid === entry.uid)?.[0];
      const selected = this.selectedUid === entry.uid;

      const row = this.scene.add.rectangle(cx, y, 490, 38, selected ? 0x2a4060 : 0x1e2436)
        .setInteractive({ useHandCursor: true });
      row.setStrokeStyle(2, selected ? 0xffffff : rc.border);
      this.listContainer.add(row);

      // 名称 + 强化标记（+0 时显示"未强化"避免误导）
      const forgeTag = entry.forgeLv > 0 ? ` +${entry.forgeLv}` : '';
      this.listContainer.add(this.scene.add.text(cx - 230, y, `${base?.name ?? entry.refId}${forgeTag}`, {
        fontSize: '13px', fill: rc.color, fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0, 0.5));
      // 首条效果中文摘要
      const firstEff = base?.effects?.[0];
      const effSummary = firstEff ? describeEffect(firstEff, { scale: 1 + 0.1 * entry.forgeLv }) : '';
      this.listContainer.add(this.scene.add.text(cx - 60, y, `${SLOT_NAMES[base?.slot] || '?'} · ${effSummary}`, {
        fontSize: '11px', fill: '#ccccdd', fontFamily: 'Arial',
      }).setOrigin(0, 0.5));
      if (equippedSlot) {
        this.listContainer.add(this.scene.add.text(cx + 30, y, '[已穿戴]', {
          fontSize: '11px', fill: '#88ff88', fontFamily: 'Arial',
        }).setOrigin(0, 0.5));
      }
      row.on('pointerdown', () => { this.selectedUid = entry.uid; this.refresh(); });
    });
  }

  _buildDetail() {
    this.detailContainer.removeAll(true);
    if (this.selectedUid == null) return;
    const entry = this.forge.save.inventory.find(i => i.uid === this.selectedUid);
    if (!entry) { this.selectedUid = null; return; }
    const base = this.forge._baseConfig(entry.refId);
    const cx = GAME_WIDTH / 2;
    const y = GAME_HEIGHT - 150;

    const cost = this.forge.getForgeCost(entry.uid);
    const panel = this.scene.add.rectangle(cx, y + 22, 510, 158, 0x18202f);
    panel.setStrokeStyle(2, 0x335577);
    this.detailContainer.add(panel);

    // 效果（中文）+ 强化后的数值对比
    const effDesc = (base?.effects || []).map(e => {
      const now = describeEffect(e, { scale: 1 + 0.1 * entry.forgeLv });
      if (entry.forgeLv > 0 && !cost?.maxed) {
        const next = describeEffect(e, { scale: 1 + 0.1 * (entry.forgeLv + 1) });
        return `${now}（强化后 ${next}）`;
      }
      return now;
    }).join('  ');
    this.detailContainer.add(this.scene.add.text(cx, y - 42, `效果：${effDesc}`, {
      fontSize: '12px', fill: '#88ff88', fontFamily: 'Arial',
      wordWrap: { width: 470 }, align: 'center',
    }).setOrigin(0.5));

    // 强化等级语义说明（+0 不再误导）
    const lvLabel = entry.forgeLv > 0 ? `强化等级 +${entry.forgeLv}（每级效果 +10%）` : '未强化（基础效果已生效）';
    this.detailContainer.add(this.scene.add.text(cx, y - 16, lvLabel, {
      fontSize: '11px', fill: '#8899bb', fontFamily: 'Arial',
    }).setOrigin(0.5));

    if (cost?.maxed) {
      this.detailContainer.add(this.scene.add.text(cx, y, '已满级 +10', {
        fontSize: '14px', fill: '#ffcc44', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0.5));
    } else {
      const feedAvail = this.forge.countFeedCopies(entry.refId, entry.uid);
      this.detailContainer.add(this.scene.add.text(cx, y - 8,
        `强化：💰${cost.gold} + 同名×${cost.feedCount}（持有 ${feedAvail}）`, {
        fontSize: '12px', fill: '#ccccdd', fontFamily: 'Arial',
      }).setOrigin(0.5));
      const canForge = this.save.gold >= cost.gold && feedAvail >= cost.feedCount;
      const forgeBtn = this.scene.add.rectangle(cx - 110, y + 28, 150, 36, canForge ? 0x00aa44 : 0x555566)
        .setInteractive({ useHandCursor: canForge });
      this.detailContainer.add(forgeBtn);
      this.detailContainer.add(this.scene.add.text(cx - 110, y + 28, '⚡ 强化', {
        fontSize: '14px', fill: '#fff', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0.5));
      forgeBtn.on('pointerdown', () => {
        if (!canForge) { this.scene.cameras.main.flash(150, 255, 60, 60); return; }
        const r = this.forge.forge(entry.uid, this.save.gold || 0);
        if (r.success) {
          this.save.gold -= r.cost.gold;
          this.onPersist?.();
          this.refresh();
        }
      });
    }

    // 穿戴/卸下（带当前穿戴对比）
    const equippedSlot = Object.entries(this.save.equipped).find(([, uid]) => uid === entry.uid)?.[0];
    // 对比：同槽位当前穿戴的装备效果
    const curUid = this.save.equipped[base?.slot];
    const curEntry = curUid != null && curUid !== entry.uid
      ? this.forge.save.inventory.find(i => i.uid === curUid) : null;
    const curBase = curEntry ? this.forge._baseConfig(curEntry.refId) : null;
    const fmtEff = (b, e2) => (b?.effects || []).map(ef => describeEffect(ef, { scale: 1 + 0.1 * (e2?.forgeLv || 0) })).join(' ') || '无';
    const effNow = fmtEff(base, entry);
    // 常驻对比行（同槽位已有穿戴时）
    if (!equippedSlot && curEntry && curBase) {
      this.detailContainer.add(this.scene.add.text(cx, y + 52,
        `[对比] 新【${base.name}】：${effNow}  vs  当前【${curBase.name}】：${fmtEff(curBase, curEntry)}`, {
        fontSize: '10.5px', fill: '#ffdd88', fontFamily: 'Arial',
        wordWrap: { width: 490 }, align: 'center',
      }).setOrigin(0.5));
    }
    const wearBtn = this.scene.add.rectangle(cx + 110, y + 28, 150, 36, equippedSlot ? 0x775522 : 0x336699)
      .setInteractive({ useHandCursor: true });
    this.detailContainer.add(wearBtn);
    this.detailContainer.add(this.scene.add.text(cx + 110, y + 28, equippedSlot ? '卸下' : `穿戴(${SLOT_NAMES[base?.slot] || '?'})`, {
      fontSize: '13px', fill: '#fff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));
    wearBtn.on('pointerdown', () => {
      if (equippedSlot) {
        delete this.save.equipped[equippedSlot];
      } else if (base?.slot) {
        this.save.equipped[base.slot] = entry.uid; // 同槽替换
      }
      this.onPersist?.();
      this.refresh();
    });

    // 合成（原版：3 件同槽同稀有度 → 1 件高一级稀有度）
    const samePool = this.forge.save.inventory.filter(i => {
      if (i.uid === entry.uid) return false;
      const b = this.forge._baseConfig(i.refId);
      return b?.slot === base?.slot && b?.rarity === base?.rarity;
    });
    const canCombine = samePool.length >= 2 && !equippedSlot;
    const combineBtn = this.scene.add.rectangle(cx + 150, y + 88, 150, 30, canCombine ? 0x7755aa : 0x444466)
      .setInteractive({ useHandCursor: canCombine });
    this.detailContainer.add(combineBtn);
    this.detailContainer.add(this.scene.add.text(cx + 150, y + 88,
      `合成 (${samePool.length}/2 同类)${equippedSlot ? ' 先卸下' : ''}`, {
      fontSize: '12px', fill: '#fff', fontFamily: 'Arial',
    }).setOrigin(0.5));
    combineBtn.on('pointerdown', () => {
      if (!canCombine) { this.scene.cameras.main.flash(150, 255, 60, 60); return; }
      this.forge.setEquippedMap(this.save.equipped);
      const r = this.forge.combine([entry.uid, samePool[0].uid, samePool[1].uid]);
      if (r.success) {
        this.selectedUid = r.item.uid; // 选中新装备
        this.onPersist?.();
        this.refresh();
        this.scene.cameras.main.flash(250, 170, 120, 255);
      }
    });

    // 分解
    const scrapVal = this.forge.getScrapValue(entry.uid);
    const isEquipped = !!equippedSlot;
    const scrapBtn = this.scene.add.rectangle(cx, y + 88, 150, 30, isEquipped ? 0x444466 : 0x884444)
      .setInteractive({ useHandCursor: !isEquipped });
    this.detailContainer.add(scrapBtn);
    this.detailContainer.add(this.scene.add.text(cx, y + 88, `分解 +${scrapVal}G${isEquipped ? '（先卸下）' : ''}`, {
      fontSize: '12px', fill: '#fff', fontFamily: 'Arial',
    }).setOrigin(0.5));
    scrapBtn.on('pointerdown', () => {
      if (isEquipped) return;
      const gold = this.forge.scrap(entry.uid);
      this.save.gold = (this.save.gold || 0) + gold;
      this.selectedUid = null;
      this.onPersist?.();
      this.refresh();
    });
  }

  destroy() {
    if (this.container) { this.container.destroy(); this.container = null; }
  }
}
