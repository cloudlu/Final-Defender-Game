import { GAME_WIDTH, GAME_HEIGHT } from '../engine/GridConstants.js';
import { affixCn } from './statNames.js';
import { QUALITY_ORDER, QUALITY_NAMES, QUALITY_SKILL_BONUS } from '../engine/EquipmentForgeSystem.js';

const RARITY_COLORS = {
  white: { border: 0xaaaaaa, color: '#aaaaaa', label: '白' },
  green: { border: 0x66cc66, color: '#66cc66', label: '绿' },
  blue: { border: 0x4488ff, color: '#4488ff', label: '蓝' },
  purple: { border: 0xaa44ff, color: '#aa44ff', label: '紫' },
  orange: { border: 0xff8800, color: '#ff8800', label: '橙' },
  red: { border: 0xff4444, color: '#ff4444', label: '红' },
  rainbow: { border: 0xff44dd, color: '#ff44dd', label: '彩' },
};

const SLOT_NAMES = { weapon: '武器', helmet: '头盔', coat: '衣服', bracers: '护臂', pants: '腰饰', shoes: '鞋子' };
const SLOT_ICONS = { weapon: '⚔️', helmet: '🪖', coat: '🛡️', bracers: '🧤', pants: '👖', shoes: '👟' };

const GEM_Q = ['白', '绿', '蓝', '紫', '黄', '红', '至尊'];
const GEM_QC = ['#aaaaaa', '#66cc66', '#4488ff', '#aa44ff', '#ffdd44', '#ff4444', '#ff44dd'];

/** 词条值显示格式化：浮点尾数兜底（0.144*100=14.399999 类） */
function fmtVal(a) {
  const v = Math.round(a.value * 100) / 100;
  return a.pct ? `${v}%` : `${v}`;
}

/**
 * ForgePanel: 装备·宝石（v8.10 主页+弹窗两级）。
 * - 主页：6 部位大卡（穿戴件预览+2 宝石孔+部位强化等级），一屏放下零重叠
 * - 点部位 → 弹窗：该部位装备列表（单列大卡）+ 选中详情操作 + 该部位宝石孔/背包
 * - 宝石挂孔位（部位）：换装备宝石自动保留，无需拆卸重镶（比原版手动拆卸更友好，词条按部位专属的语义不变）
 */
export class ForgePanel {
  constructor(scene, forgeSystem, globalSave, { onClose, onPersist, gemSystem = null }) {
    this.scene = scene;
    this.forge = forgeSystem;
    this.save = globalSave;
    this.save.equipped = this.save.equipped || {};
    this.gems = gemSystem;
    this.onClose = onClose;
    this.onPersist = onPersist;
    this.activeSlot = null;      // null = 主页；'weapon' 等 = 部位弹窗
    this.selectedUid = null;     // 弹窗内选中的装备
    this._page = 1;
    this.build();
  }

  /** 装备战力评分（与 GemSystem.gemPower 同锚点折算 + 品质/品阶/强化权重） */
  score(entry) {
    let score = 0;
    const PCT = { wallHp: 0.1, critRate: 12, damage: 1, gunDamage: 1, eliteDamage: 0.8, debuffTargetDamage: 0.7, highHpTargetDamage: 0.7, lowHpWallDamage: 0.7, explodeDamage: 0.8 };
    for (const a of entry.affixes || []) {
      if (a.pct) score += a.value * (PCT[a.stat] ?? 1);
      else score += a.stat === 'wallHp' ? a.value * 0.1 : a.value;
    }
    score += QUALITY_ORDER.indexOf(entry.quality) * 12;
    score += (entry.tier || 1) * 3;
    score += this.forge.getSlotLevel(entry.slot) * 4;
    return Math.round(score);
  }

  compareMark(entry) {
    const curUid = this.save.equipped[entry.slot];
    if (curUid == null || curUid === entry.uid) return 0;
    const cur = this.forge.save.inventory.find(i => i.uid === curUid);
    if (!cur) return 0;
    const diff = this.score(entry) - this.score(cur);
    if (diff > 3) return 1;
    if (diff < -3) return -1;
    return 0;
  }

  build() {
    const { width, height } = this.scene.cameras.main;
    const cx = width / 2;
    this.container = this.scene.add.container(0, 0).setDepth(700);
    this.bg = this.scene.add.rectangle(cx, height / 2, width, height, 0x000000, 0.92)
      .setInteractive();
    this.container.add(this.bg);
    this.bg.on('pointerdown', () => {
      // 弹窗开→关弹窗；主页→关面板
      if (this.activeSlot) { this.activeSlot = null; this.selectedUid = null; this.refresh(); }
      else { this.destroy(); this.onClose?.(); }
    });

    this.container.add(this.scene.add.text(cx, 32, '🔧 装备 · 宝石', {
      fontSize: '22px', fill: '#66ccff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));

    this.resText = this.scene.add.text(cx, 60, '', {
      fontSize: '13px', fill: '#ffd700', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.container.add(this.resText);

    this.pageContainer = this.scene.add.container(0, 0);
    this.container.add(this.pageContainer);
    this.popupContainer = this.scene.add.container(0, 0).setDepth(720);
    this.container.add(this.popupContainer);

    this.container.add(this.scene.add.text(cx, height - 14, '宝石镶在部位孔位：换装备自动保留 · 部位强化替换自动继承 · 点空白返回/关闭', {
      fontSize: '10px', fill: '#667', fontFamily: 'Arial',
    }).setOrigin(0.5));

    this.refresh();
  }

  refresh() {
    this.resText.setText(`💰 ${this.save.gold || 0}    ⚒️ 锻造石 ${this.forge.save.forgeStones || 0}    图纸 ${this.forge.save.gunResearch?.level || 0} 级`);
    this._buildPage();
    this._buildPopup();
  }

  // ================= 主页：6 部位卡 =================

  _buildPage() {
    this.pageContainer.removeAll(true);
    // 弹窗开时主页淡出（避免透视干扰）
    this.pageContainer.setAlpha(this.activeSlot ? 0 : 1);
    if (this.activeSlot) return;

    const cx = GAME_WIDTH / 2;
    const SLOTS = ['weapon', 'helmet', 'coat', 'bracers', 'pants', 'shoes'];
    // 2 列 × 3 行（2×240+16=496 < 540 画布宽；旧 3 列 760 左右各溢出 110）
    const cardW = 240, cardH = 170;
    const colGap = 16, rowGap = 12;
    const startX = cx - (cardW * 2 + colGap) / 2 + cardW / 2;
    const startY = 108 + cardH / 2;

    SLOTS.forEach((slot, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = startX + col * (cardW + colGap);
      const y = startY + row * (cardH + rowGap);
      const uid = this.save.equipped[slot];
      const entry = uid != null ? this.forge.save.inventory.find(it => it.uid === uid) : null;
      const rc = entry ? (RARITY_COLORS[entry.quality] || RARITY_COLORS.white) : null;

      const g = this.scene.add.graphics();
      g.fillStyle(0x000000, 0.35);
      g.fillRoundedRect(x - cardW / 2 + 2, y - cardH / 2 + 3, cardW, cardH, 12);
      g.fillStyle(entry ? 0x1a2230 : 0x151b26, 0.98);
      g.fillRoundedRect(x - cardW / 2, y - cardH / 2, cardW, cardH, 12);
      g.lineStyle(2, entry ? rc.border : 0x2a3444, 1);
      g.strokeRoundedRect(x - cardW / 2, y - cardH / 2, cardW, cardH, 12);
      this.pageContainer.add(g);

      // 部位名 + 图标
      this.pageContainer.add(this.scene.add.text(x, y - cardH / 2 + 22, `${SLOT_ICONS[slot]} ${SLOT_NAMES[slot]}`, {
        fontSize: '14px', fill: '#8899bb', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0.5));

      if (entry) {
        // 穿戴件预览
        this.pageContainer.add(this.scene.add.text(x, y - 38, `${QUALITY_NAMES[entry.quality]}·${entry.tier}阶  ⚡${this.score(entry)}`, {
          fontSize: '13px', fill: rc.color, fontFamily: 'Arial', fontStyle: 'bold',
        }).setOrigin(0.5));
        // 词条（最多 2 行，超出折叠计数）
        const affixes = (entry.affixes || []).slice(0, 2);
        if (affixes.length === 0) {
          this.pageContainer.add(this.scene.add.text(x, y - 8, '无词条', {
            fontSize: '10px', fill: '#556677', fontFamily: 'Arial',
          }).setOrigin(0.5));
        }
        affixes.forEach((a, ai) => {
          this.pageContainer.add(this.scene.add.text(x - cardW / 2 + 18, y - 16 + ai * 16,
            `${affixCn(a.name)}+${fmtVal(a)}`, {
            fontSize: '10px', fill: '#99aabb', fontFamily: 'Arial',
          }).setOrigin(0, 0.5));
        });
        const extra = (entry.affixes || []).length - affixes.length;
        if (extra > 0) {
          this.pageContainer.add(this.scene.add.text(x - cardW / 2 + 18, y + 16, `…还有${extra}条`, {
            fontSize: '9px', fill: '#667788', fontFamily: 'Arial',
          }).setOrigin(0, 0.5));
        }
        // 宝石孔预览（2 孔）+ 强化等级（同一行，不重叠）
        const arr = this.gems ? (this.gems.save.sockets[slot] || [null, null]) : [null, null];
        const holeY = y + cardH / 2 - 22;
        for (let gi = 0; gi < 2; gi++) {
          const hx = x - 30 + gi * 32;
          const gem = arr[gi] ? this.gems.save.collection[arr[gi]] : null;
          const hole = this.scene.add.circle(hx, holeY, 11, gem ? 0x1e2a40 : 0x14181f)
            .setInteractive({ useHandCursor: true });
          hole.setStrokeStyle(2, gem ? 0x66aaff : 0x334455);
          this.pageContainer.add(hole);
          if (gem) {
            this.pageContainer.add(this.scene.add.text(hx, holeY, '💎', { fontSize: '9px' }).setOrigin(0.5));
          }
          hole.on('pointerdown', (p) => {
            p.event && p.event.stopPropagation && p.event.stopPropagation();
            this.activeSlot = slot;
            this.selectedUid = uid;
            this.refresh();
          });
        }
        // 部位强化等级（右下）
        this.pageContainer.add(this.scene.add.text(x + cardW / 2 - 12, holeY, `强化 Lv.${this.forge.getSlotLevel(slot)}`, {
          fontSize: '10px', fill: '#667788', fontFamily: 'Arial',
        }).setOrigin(1, 0.5));
      } else {
        this.pageContainer.add(this.scene.add.text(x, y - 12, '（空）', {
          fontSize: '12px', fill: '#445566', fontFamily: 'Arial',
        }).setOrigin(0.5));
        this.pageContainer.add(this.scene.add.text(x, y + 8, '点击穿戴装备', {
          fontSize: '10px', fill: '#445566', fontFamily: 'Arial',
        }).setOrigin(0.5));
      }

      // 整卡热区
      const zone = this.scene.add.rectangle(x, y, cardW, cardH, 0xffffff, 0).setInteractive({ useHandCursor: true });
      this.pageContainer.add(zone);
      zone.on('pointerdown', () => { this.activeSlot = slot; this.selectedUid = uid ?? null; this.refresh(); });
    });
  }

  // ================= 部位弹窗 =================

  _buildPopup() {
    this.popupContainer.removeAll(true);
    if (!this.activeSlot) return;
    const slot = this.activeSlot;
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;
    const pw = 500, ph = 760;
    const px = cx, py = cy;

    // 弹窗底
    const bg = this.scene.add.rectangle(px, py, pw, ph, 0x0d1320, 0.98)
      .setInteractive(); // 挡穿透：点弹窗空白不触发主页 bg 的关闭
    this.popupContainer.add(bg);
    const frame = this.scene.add.graphics();
    frame.lineStyle(2, 0x335577, 1);
    frame.strokeRoundedRect(px - pw / 2, py - ph / 2, pw, ph, 12);
    this.popupContainer.add(frame);

    // 标题 + 关闭
    this.popupContainer.add(this.scene.add.text(px, py - ph / 2 + 22, `${SLOT_ICONS[slot]} ${SLOT_NAMES[slot]}`, {
      fontSize: '17px', fill: '#ffcc44', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));
    const closeBtn = this.scene.add.text(px + pw / 2 - 20, py - ph / 2 + 22, '✕', {
      fontSize: '16px', fill: '#88aacc', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerdown', () => { this.activeSlot = null; this.selectedUid = null; this._gemPickerOpen = false; this.refresh(); });
    this.popupContainer.add(closeBtn);

    // ===== 宝石选择器模式：覆盖装备列表区，展示全部背包宝石可翻页选择 =====
    if (this._gemPickerOpen) {
      this._buildGemPicker(px, py, pw, ph, slot);
      return;
    }

    // ===== 宝石孔（弹窗顶部：与部位对齐的视觉）=====
    if (this.gems) {
      this.popupContainer.add(this.scene.add.text(px - pw / 2 + 16, py - ph / 2 + 52, '宝石孔（换装备自动保留）', {
        fontSize: '11px', fill: '#88aacc', fontFamily: 'Arial',
      }).setOrigin(0, 0.5));
      const arr = this.gems.save.sockets[slot] || [null, null];
      for (let i = 0; i < 2; i++) {
        const hx = px - pw / 2 + 46 + i * 66;
        const uid = arr[i];
        const gem = uid ? this.gems.save.collection[uid] : null;
        const hole = this.scene.add.circle(hx, py - ph / 2 + 92, 22, uid ? 0x1e2a40 : 0x14181f)
          .setInteractive({ useHandCursor: true });
        hole.setStrokeStyle(2, uid ? 0x66aaff : 0x334455);
        this.popupContainer.add(hole);
        if (gem) {
          const affix = this.gems.getAffix(gem.affixId);
          const v = this.gems.gemValue(gem);
          const qc = GEM_QC[gem.quality] || '#fff';
          this.popupContainer.add(this.scene.add.text(hx, py - ph / 2 + 86, (affix?.name || '').slice(0, 5), {
            fontSize: '8.5px', fill: qc, fontFamily: 'Arial', align: 'center',
          }).setOrigin(0.5));
          this.popupContainer.add(this.scene.add.text(hx, py - ph / 2 + 102, `+${affix?.pct ? v + '%' : v}`, {
            fontSize: '8.5px', fill: '#aabbcc', fontFamily: 'Arial',
          }).setOrigin(0.5));
        } else {
          this.popupContainer.add(this.scene.add.text(hx, py - ph / 2 + 92, '+', {
            fontSize: '16px', fill: '#445',
          }).setOrigin(0.5));
        }
        hole.on('pointerdown', () => {
          if (uid) {
            const affix = this.gems.getAffix(gem.affixId);
            this.gems.unequip(slot, i);
            this.onPersist?.();
            this._toast(`💎 已拆下${affix?.name || ''}`, '#88ddff');
            this.refresh();
          } else {
            // 空孔 → 打开宝石选择器（v8.15：全背包可翻页选择）
            this._gemPickerOpen = true;
            this._gemPickerSlotIdx = i;
            this.refresh();
          }
        });
      }
      // 更换/镶嵌宝石入口（孔位右侧）
      const pickBtn = this.scene.add.text(px - pw / 2 + 190, py - ph / 2 + 92, '🔍 选择宝石 ▸', {
        fontSize: '12px', fill: '#ffdd66', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
      pickBtn.on('pointerdown', () => {
        this._gemPickerOpen = true;
        const cur = this.gems.save.sockets[slot] || [null, null];
        this._gemPickerSlotIdx = cur.findIndex(u => u == null) >= 0 ? cur.findIndex(u => u == null) : 0;
        this.refresh();
      });
      this.popupContainer.add(pickBtn);
    }

    // ===== 装备列表（单列大卡，可滚动式分页：每页 3 张）=====
    const items = this.forge.save.inventory
      .filter(i => i.slot === slot)
      .sort((a, b) => {
        const qa = QUALITY_ORDER.indexOf(a.quality), qb = QUALITY_ORDER.indexOf(b.quality);
        return (qb - qa) || (this.score(b) - this.score(a));
      });
    const PER = 3;
    const totalPages = Math.max(1, Math.ceil(items.length / PER));
    this._page = Math.max(1, Math.min(this._page, totalPages));
    const pageItems = items.slice((this._page - 1) * PER, this._page * PER);

    const listTop = py - ph / 2 + 128;
    if (pageItems.length === 0) {
      this.popupContainer.add(this.scene.add.text(px, listTop + 60, '该部位暂无装备——战斗掉落/抽卡获取', {
        fontSize: '11.5px', fill: '#667788', fontFamily: 'Arial',
      }).setOrigin(0.5));
    }
    pageItems.forEach((entry, i) => {
      const y = listTop + 44 + i * 96;
      const rc = RARITY_COLORS[entry.quality] || RARITY_COLORS.white;
      const equipped = this.save.equipped[slot] === entry.uid;
      const selected = this.selectedUid === entry.uid;
      const mark = this.compareMark(entry);

      const g = this.scene.add.graphics();
      g.fillStyle(0x000000, 0.3);
      g.fillRoundedRect(px - 226, y - 40 + 2, 452, 82, 8);
      g.fillStyle(0x1a2230, 0.98);
      g.fillRoundedRect(px - 228, y - 40, 452, 82, 8);
      g.lineStyle(2, selected ? 0xffffff : rc.border, 1);
      g.strokeRoundedRect(px - 228, y - 40, 452, 82, 8);
      g.fillStyle(rc.border, 1);
      g.fillRoundedRect(px - 228, y - 40, 6, 82, { tl: 8, bl: 8, tr: 0, br: 0 });
      this.popupContainer.add(g);

      this.popupContainer.add(this.scene.add.text(px - 204, y - 22, `${QUALITY_NAMES[entry.quality]}·${entry.tier}阶`, {
        fontSize: '13px', fill: rc.color, fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0, 0.5));
      this.popupContainer.add(this.scene.add.text(px - 204, y + 2,
        (entry.affixes || []).map(a => `${affixCn(a.name)}+${fmtVal(a)}`).join('  ') || '无词条', {
        fontSize: '10.5px', fill: '#99aabb', fontFamily: 'Arial',
        wordWrap: { width: 300 },
      }).setOrigin(0, 0.5));
      // 右上战力 + 标记
      this.popupContainer.add(this.scene.add.text(px + 214, y - 22, `⚡${this.score(entry)}`, {
        fontSize: '13px', fill: '#ffdd66', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(1, 0.5));
      const marks = [];
      if (equipped) marks.push('✓装备中');
      else if (mark === 1) marks.push('▲更优');
      else if (mark === -1) marks.push('▼较差');
      if ((entry.affixes || []).some(a => a.locked)) marks.push('🔒');
      if (marks.length) {
        this.popupContainer.add(this.scene.add.text(px + 214, y + 2, marks.join(' '), {
          fontSize: '9.5px', fill: equipped ? '#88ff88' : (mark === 1 ? '#66ff66' : '#99aabb'),
          fontFamily: 'Arial',
        }).setOrigin(1, 0.5));
      }

      const zone = this.scene.add.rectangle(px, y, 452, 82, 0xffffff, 0).setInteractive({ useHandCursor: true });
      this.popupContainer.add(zone);
      zone.on('pointerdown', () => { this.selectedUid = entry.uid; this.refresh(); });
    });

    // ===== 详情区锚点（自底向上固定推导，翻页条与详情区共享此坐标基准）=====
    const gBottom = py + ph / 2 - 10;   // 850：chips 底
    const gemTitleY = gBottom - 46;     // 804：宝石标题
    const btnY = gemTitleY - 30;        // 774：操作按钮行
    const dY = btnY - 71;               // 703：词条区顶（词条止于 btnY-23）

    // 列表分页（y 取"本页卡片末尾 + 24"与"详情区标题 - 30"的较上者，保证既贴列表又不压详情）
    if (totalPages > 1) {
      const listEnd = pageItems.length > 0
        ? (listTop + 44 + (pageItems.length - 1) * 96) + 41   // 末卡底缘
        : listTop + 60;
      const pyp = Math.min(listEnd + 24, dY - 14 - 30);       // 上限=详情标题(dY-14)再上 30
      const mkBtn = (x, label, enabled, onClick) => {
        const b = this.scene.add.rectangle(x, pyp, 52, 24, enabled ? 0x334455 : 0x222833)
          .setInteractive({ useHandCursor: enabled });
        this.popupContainer.add(b);
        this.popupContainer.add(this.scene.add.text(x, pyp, label, {
          fontSize: '13px', fill: enabled ? '#ffdd66' : '#445', fontFamily: 'Arial', fontStyle: 'bold',
        }).setOrigin(0.5));
        if (enabled) b.on('pointerdown', onClick);
      };
      mkBtn(px - 70, '◀', this._page > 1, () => { this._page--; this.refresh(); });
      mkBtn(px + 70, '▶', this._page < totalPages, () => { this._page++; this.refresh(); });
      this.popupContainer.add(this.scene.add.text(px, pyp, `${this._page}/${totalPages}`, {
        fontSize: '12px', fill: '#aabbcc', fontFamily: 'Arial',
      }).setOrigin(0.5));
    }

    // ===== 选中装备详情操作条（弹窗底部，固定锚点自底向上排，不随词条数漂移）=====
    const sel = this.selectedUid != null ? this.forge.save.inventory.find(i => i.uid === this.selectedUid) : null;
    if (!sel) {
      this.popupContainer.add(this.scene.add.text(px, btnY - 20, '👆 点装备卡查看操作（穿戴/升品/强化/洗练）', {
        fontSize: '11px', fill: '#6688aa', fontFamily: 'Arial',
      }).setOrigin(0.5));
      return;
    }
    const rc = RARITY_COLORS[sel.quality];
    const equipped = this.save.equipped[slot] === sel.uid;

    this.popupContainer.add(this.scene.add.text(px - 228, dY - 14,
      `${QUALITY_NAMES[sel.quality]}·${sel.tier}阶  ⚡${this.score(sel)}  技能伤害+${Math.round((QUALITY_SKILL_BONUS[sel.quality] || 0) * 100)}%`, {
      fontSize: '11.5px', fill: rc.color, fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0, 0.5));
    // 词条+洗练/锁定（最多显示 3 条，超出折叠——固定区域高度不随词条数漂移）
    const tierMult = 1 + 0.1 * ((sel.tier || 1) - 1);
    const shownAffixes = (sel.affixes || []).slice(0, 3);
    shownAffixes.forEach((a, idx) => {
      const ay = dY + 8 + idx * 20;
      const finalVal = a.pct ? a.value : Math.round(a.value * tierMult * 10) / 10;
      this.popupContainer.add(this.scene.add.text(px - 228, ay, `${affixCn(a.name)} ${a.pct ? `+${fmtVal(a)}` : `+${finalVal}`}${a.locked ? ' 🔒' : ''}`, {
        fontSize: '11px', fill: '#88ff88', fontFamily: 'Arial',
      }).setOrigin(0, 0.5));
      const canReroll = !a.locked && (this.forge.save.forgeStones || 0) >= 20;
      const rr = this.scene.add.rectangle(px + 96, ay, 46, 17, canReroll ? 0x2288aa : 0x2a2f3a)
        .setInteractive({ useHandCursor: canReroll });
      this.popupContainer.add(rr);
      this.popupContainer.add(this.scene.add.text(px + 96, ay, '🎲', { fontSize: '10px' }).setOrigin(0.5));
      rr.on('pointerdown', () => {
        const r = this.forge.rerollSlot(sel.uid, idx, null);
        if (r.success) {
          this.onPersist?.();
          this.refresh();
          this._toast(`🎲 ${affixCn(a.name)} → ${fmtVal(a)}`, '#88ddff');
        } else {
          this._toast(r.reason === 'poor_stones' ? `⚠ 锻造石不足（需20）` : '⚠ 词条已锁定', '#ffaa66');
        }
      });
      const lk = this.scene.add.rectangle(px + 152, ay, 34, 17, a.locked ? 0xcc8833 : 0x2a3444)
        .setInteractive({ useHandCursor: true });
      this.popupContainer.add(lk);
      this.popupContainer.add(this.scene.add.text(px + 152, ay, a.locked ? '🔓' : '🔒', { fontSize: '10px' }).setOrigin(0.5));
      lk.on('pointerdown', () => { this.forge.toggleLock(sel.uid, idx); this.refresh(); });
    });
    const extraAffixes = (sel.affixes || []).length - shownAffixes.length;
    if (extraAffixes > 0) {
      this.popupContainer.add(this.scene.add.text(px - 228, dY + 8 + shownAffixes.length * 20, `…还有${extraAffixes}条`, {
        fontSize: '9.5px', fill: '#667788', fontFamily: 'Arial',
      }).setOrigin(0, 0.5));
    }

    // 操作按钮行（固定锚点）
    const bY1 = btnY;
    const mkOp = (x, w, label, color, onClick, enabled = true, reason = null) => {
      const b = this.scene.add.rectangle(x, bY1, w, 34, enabled ? color : 0x333a44)
        .setInteractive({ useHandCursor: true });
      this.popupContainer.add(b);
      this.popupContainer.add(this.scene.add.text(x, bY1, label, {
        fontSize: '11px', fill: enabled ? '#fff' : '#667', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0.5));
      b.on('pointerdown', () => {
        if (enabled) onClick();
        else this._toast(`⚠ ${reason || '条件不满足'}`, '#ffaa66');
      });
    };
    // 穿戴
    mkOp(px - 180, 100, equipped ? '卸下' : '穿戴', equipped ? 0x775522 : 0x2266aa, () => {
      if (equipped) delete this.save.equipped[slot];
      else this.save.equipped[slot] = sel.uid;
      this.onPersist?.();
      this.refresh();
    }, true);
    // 部位强化
    const cost = this.forge.getForgeCost(slot);
    if (cost?.maxed) {
      mkOp(px - 60, 100, '强化MAX', 0x3a3a4a, () => this._toast('部位强化已满级', '#ffcc44'), false, '已满级');
    } else {
      mkOp(px - 60, 100, `强化 💰${cost.gold}`, this.save.gold >= cost.gold ? 0x009955 : 0x3a3a4a, () => {
        const r = this.forge.forgeSlot(slot, this.save.gold || 0);
        if (r.success) {
          this.save.gold -= r.cost.gold;
          this._toast(`⚡ 强化 → Lv.${r.level}`, '#88ff88');
          this.onPersist?.();
          this.refresh();
        }
      }, this.save.gold >= cost.gold, `金币不足（需${cost.gold}）`);
    }
    // 升品
    const qCost = this.forge.getUpgradeQualityCost(sel.uid);
    mkOp(px + 60, 100, qCost === null ? '品质MAX' : `⬆品 ⚒️${qCost}`,
      qCost === null ? 0x3a3a4a : ((this.forge.save.forgeStones || 0) >= qCost ? 0xaa44bb : 0x3a3a4a),
      () => {
        const r = this.forge.upgradeQuality(sel.uid);
        if (r.success) {
          this._toast(`⬆ 升品成功：${QUALITY_NAMES[r.quality]}！+${r.newRolls || 0} 词条`, '#ff88ff');
          this.onPersist?.();
          this.refresh();
        }
      }, qCost !== null && (this.forge.save.forgeStones || 0) >= qCost,
      qCost === null ? '已最高品质' : `锻造石不足（需${qCost}）`);
    // 分解
    const scrapVal = this.forge.getScrapValue(sel.uid);
    mkOp(px + 180, 100, `分解 +${scrapVal}G`, equipped ? 0x3a3a4a : 0x884444, () => {
      const r = this.forge.scrap(sel.uid);
      this.save.gold = (this.save.gold || 0) + r.gold;
      this.save.forgeStones = (this.save.forgeStones || 0) + r.stones;
      this.selectedUid = null;
      this.onPersist?.();
      this.refresh();
      this._toast(`♻️ +${r.gold}G +⚒️${r.stones}`, '#ffcc88');
    }, !equipped, '穿戴中不能分解');

    // ===== 背包宝石（弹窗底部固定锚点：与按钮行间距 26px，不再重叠）=====
    if (this.gems) {
      const gY = gemTitleY;
      const socketed = new Set(this.gems.getSocketed().map(g => g.uid));
      const bag = Object.keys(this.gems.save.collection).filter(u => !socketed.has(u));
      bag.sort((a, b) => this.gems.gemPower(this.gems.save.collection[b]) - this.gems.gemPower(this.gems.save.collection[a]));
      this.popupContainer.add(this.scene.add.text(px - 228, gY, '💎 背包宝石（点击镶入空孔）', {
        fontSize: '10.5px', fill: '#88aacc', fontFamily: 'Arial',
      }).setOrigin(0, 0.5));
      const top = bag.slice(0, 3);
      top.forEach((uid, i) => {
        const gem = this.gems.save.collection[uid];
        const affix = this.gems.getAffix(gem.affixId);
        const v = this.gems.gemValue(gem);
        const qc = GEM_QC[gem.quality] || '#fff';
        const dead = v <= 0;
        const gx = px - 228 + i * 152;
        const chip = this.scene.add.rectangle(gx + 74, gY + 24, 148, 34, 0x1a2230, 0.95)
          .setInteractive({ useHandCursor: true });
        chip.setStrokeStyle(1, dead ? 0x553333 : 0x334455);
        this.popupContainer.add(chip);
        this.popupContainer.add(this.scene.add.text(gx + 6, gY + 16, `【${GEM_Q[gem.quality]}】${(affix?.name || '').slice(0, 7)}`, {
          fontSize: '9px', fill: dead ? '#775555' : qc, fontFamily: 'Arial',
        }).setOrigin(0, 0.5));
        this.popupContainer.add(this.scene.add.text(gx + 6, gY + 30, `+${affix?.pct ? Math.round(v * 100) / 100 + '%' : v}${dead ? ' 废' : ''} ⚡${this.gems.gemPower(gem)}`, {
          fontSize: '8.5px', fill: dead ? '#664444' : '#99aabb', fontFamily: 'Arial',
        }).setOrigin(0, 0.5));
        chip.on('pointerdown', () => {
          const cur = this.gems.save.sockets[slot] || [null, null];
          const emptyIdx = cur.findIndex(u => u == null);
          const idx = emptyIdx >= 0 ? emptyIdx : 0;
          const replaced = cur[idx];
          this.gems.equip(slot, idx, uid);
          this.onPersist?.();
          const oldName = replaced ? this.gems.getAffix(this.gems.save.collection[replaced]?.affixId)?.name || '' : '';
          this._toast(`💎 镶嵌成功${replaced ? `（替换${oldName}）` : ''}`, '#88ff88');
          this.refresh();
        });
      });
      if (bag.length > 3) {
        this.popupContainer.add(this.scene.add.text(px + 228, gY + 22, `…共${bag.length}`, {
          fontSize: '9px', fill: '#667788', fontFamily: 'Arial',
        }).setOrigin(1, 0.5));
      }
      if (bag.length === 0) {
        this.popupContainer.add(this.scene.add.text(px, gY + 22, '背包无宝石——去 🎰 抽卡', {
          fontSize: '10px', fill: '#667788', fontFamily: 'Arial',
        }).setOrigin(0.5));
      }
    }
  }

  /**
   * 宝石选择器（v8.15）：覆盖装备列表区的全背包浏览列表。
   * 每页 4 颗大 chips（品质色框+词条+数值+战力分），◀▶ 翻页，点选镶入 _gemPickerSlotIdx 孔。
   * 排序：战力降序（废宝石沉底）。
   */
  _buildGemPicker(px, py, pw, ph, slot) {
    const gY = py - ph / 2 + 128; // 顶部起点（与装备列表区同位）

    this.popupContainer.add(this.scene.add.text(px - 228, gY, `💎 选择宝石 → 镶入${SLOT_NAMES[slot]}孔位${(this._gemPickerSlotIdx ?? 0) + 1}`, {
      fontSize: '13px', fill: '#ffdd66', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0, 0.5));
    // 返回
    const back = this.scene.add.text(px + 228, gY, '✕ 返回', {
      fontSize: '12px', fill: '#88aacc', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });
    back.on('pointerdown', () => { this._gemPickerOpen = false; this.refresh(); });
    this.popupContainer.add(back);

    // 背包宝石（未镶嵌），战力降序
    const socketed = new Set(this.gems.getSocketed().map(g => g.uid));
    const bag = Object.keys(this.gems.save.collection).filter(u => !socketed.has(u));
    bag.sort((a, b) => this.gems.gemPower(this.gems.save.collection[b]) - this.gems.gemPower(this.gems.save.collection[a]));

    // 当前孔位已镶宝石（新旧对比基准卡）
    const curArr = this.gems.save.sockets[slot] || [null, null];
    const curUid = curArr[this._gemPickerSlotIdx ?? 0];
    const currentGem = curUid ? this.gems.save.collection[curUid] : null;
    if (currentGem) {
      const cAffix = this.gems.getAffix(currentGem.affixId);
      const cV = this.gems.gemValue(currentGem);
      const cQc = GEM_QC[currentGem.quality] || '#fff';
      const cy0 = gY + 34;
      const cg = this.scene.add.graphics();
      cg.fillStyle(0x14202c, 0.95);
      cg.fillRoundedRect(px - 228, cy0 - 20, 452, 40, 8);
      cg.lineStyle(1, 0x446688, 1);
      cg.strokeRoundedRect(px - 228, cy0 - 20, 452, 40, 8);
      this.popupContainer.add(cg);
      this.popupContainer.add(this.scene.add.text(px - 214, cy0, '当前已镶：', {
        fontSize: '10.5px', fill: '#88aacc', fontFamily: 'Arial',
      }).setOrigin(0, 0.5));
      this.popupContainer.add(this.scene.add.text(px - 130, cy0,
        `【${GEM_Q[currentGem.quality]}】${cAffix?.name || ''} +${cAffix?.pct ? Math.round(cV * 100) / 100 + '%' : cV}  ⚡${this.gems.gemPower(currentGem)}`, {
        fontSize: '11px', fill: cQc, fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0, 0.5));
      this.popupContainer.add(this.scene.add.text(px + 214, cy0, '▼ 下方候选（镶嵌按钮显示战力差）', {
        fontSize: '9.5px', fill: '#667788', fontFamily: 'Arial',
      }).setOrigin(1, 0.5));
    }

    if (bag.length === 0) {
      this.popupContainer.add(this.scene.add.text(px, gY + 120, '背包无宝石——去 🎰 抽卡获取', {
        fontSize: '12px', fill: '#667788', fontFamily: 'Arial',
      }).setOrigin(0.5));
      return;
    }

    const PER = 4;
    const totalPages = Math.max(1, Math.ceil(bag.length / PER));
    this._gemPickerPage = Math.max(1, Math.min(this._gemPickerPage || 1, totalPages));
    const pageGems = bag.slice((this._gemPickerPage - 1) * PER, this._gemPickerPage * PER);

    pageGems.forEach((uid, i) => {
      const gem = this.gems.save.collection[uid];
      const affix = this.gems.getAffix(gem.affixId);
      const v = this.gems.gemValue(gem);
      const qc = GEM_QC[gem.quality] || '#fff';
      const dead = v <= 0;
      const y = gY + 50 + i * 92;
      const power = this.gems.gemPower(gem);

      const g = this.scene.add.graphics();
      g.fillStyle(0x000000, 0.3);
      g.fillRoundedRect(px - 226, y - 36 + 2, 452, 76, 10);
      g.fillStyle(dead ? 0x1a1518 : 0x1a2230, 0.98);
      g.fillRoundedRect(px - 228, y - 36, 452, 76, 10);
      g.lineStyle(2, dead ? 0x553333 : 0x66aaff, dead ? 0.6 : 1);
      g.strokeRoundedRect(px - 228, y - 36, 452, 76, 10);
      g.fillStyle(dead ? 0x553333 : 0x4488ff, 1);
      g.fillRoundedRect(px - 228, y - 36, 6, 76, { tl: 8, bl: 8, tr: 0, br: 0 });
      this.popupContainer.add(g);

      // 左侧品质徽标 + 词条名
      this.popupContainer.add(this.scene.add.text(px - 204, y - 16, `【${GEM_Q[gem.quality]}】`, {
        fontSize: '13px', fill: qc, fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0, 0.5));
      this.popupContainer.add(this.scene.add.text(px - 130, y - 16, affix?.name || gem.affixId, {
        fontSize: '13px', fill: '#ffffff', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0, 0.5));
      // 第二行：数值 + 战力（desc 是 {v} 模板不直接显示；词条语义由名称+数值自明）
      const valStr = `${affix?.pct ? Math.round(v * 100) / 100 + '%' : v}`;
      this.popupContainer.add(this.scene.add.text(px - 204, y + 10,
        `${valStr}${dead ? '（废·品质不足无效果）' : ''}   ⚡${power}   ${dead ? '' : `当前词条：${affix?.name}+${valStr.replace('%', '%')}`}`, {
        fontSize: '10px', fill: dead ? '#664444' : '#99aabb', fontFamily: 'Arial',
        wordWrap: { width: 400 },
      }).setOrigin(0, 0.5));

      // 镶嵌按钮（右侧）——显示与当前孔位宝石的战力差
      if (!dead) {
        const diff = power - (currentGem ? this.gems.gemPower(currentGem) : 0);
        const eb = this.scene.add.rectangle(px + 190, y, 76, 34, diff >= 0 ? 0x2266aa : 0x6a5522)
          .setInteractive({ useHandCursor: true });
        eb.setStrokeStyle(1, 0x66aaff, 0.7);
        this.popupContainer.add(eb);
        this.popupContainer.add(this.scene.add.text(px + 190, y - 8, '💎 镶嵌', {
          fontSize: '12px', fill: '#fff', fontFamily: 'Arial', fontStyle: 'bold',
        }).setOrigin(0.5));
        if (currentGem) {
          this.popupContainer.add(this.scene.add.text(px + 190, y + 9, `${diff >= 0 ? '+' : ''}${diff}⚡`, {
            fontSize: '9.5px', fill: diff >= 0 ? '#88ff88' : '#ffcc66', fontFamily: 'Arial', fontStyle: 'bold',
          }).setOrigin(0.5));
        }
        eb.on('pointerdown', () => {
          const idx = this._gemPickerSlotIdx ?? 0;
          const cur = this.gems.save.sockets[slot] || [null, null];
          const replaced = cur[idx];
          this.gems.equip(slot, idx, uid);
          this._gemPickerOpen = false;
          this.onPersist?.();
          const oldName = replaced ? this.gems.getAffix(this.gems.save.collection[replaced]?.affixId)?.name || '' : '';
          this._toast(`💎 镶嵌成功${replaced ? `（替换${oldName}）` : ''}，战力 +${power}`, '#88ff88');
          this.refresh();
        });
      } else {
        this.popupContainer.add(this.scene.add.text(px + 190, y, '留作合成', {
          fontSize: '10px', fill: '#554448', fontFamily: 'Arial',
        }).setOrigin(0.5));
      }
    });

    // 翻页
    if (totalPages > 1) {
      const pyp = gY + 50 + PER * 92 + 4;
      const mkBtn = (x, label, enabled, onClick) => {
        const b = this.scene.add.rectangle(x, pyp, 52, 24, enabled ? 0x334455 : 0x222833)
          .setInteractive({ useHandCursor: enabled });
        this.popupContainer.add(b);
        this.popupContainer.add(this.scene.add.text(x, pyp, label, {
          fontSize: '13px', fill: enabled ? '#ffdd66' : '#445', fontFamily: 'Arial', fontStyle: 'bold',
        }).setOrigin(0.5));
        if (enabled) b.on('pointerdown', onClick);
      };
      mkBtn(px - 70, '◀', this._gemPickerPage > 1, () => { this._gemPickerPage--; this.refresh(); });
      mkBtn(px + 70, '▶', this._gemPickerPage < totalPages, () => { this._gemPickerPage++; this.refresh(); });
      this.popupContainer.add(this.scene.add.text(px, pyp, `${this._gemPickerPage} / ${totalPages}`, {
        fontSize: '12px', fill: '#aabbcc', fontFamily: 'Arial',
      }).setOrigin(0.5));
    }
  }

  _toast(msg, color = '#88ddff') {
    this._toastText?.destroy();
    this._toastText = this.scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 80, msg, {
      fontSize: '13px', fill: color, fontFamily: 'Arial', fontStyle: 'bold',
      backgroundColor: '#000000dd', padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setDepth(770);
    this.scene.tweens.add({ targets: this._toastText, alpha: 0, delay: 1500, duration: 400, onComplete: () => this._toastText?.destroy() });
  }

  destroy() {
    if (this.container) { this.container.destroy(); this.container = null; }
  }
}
