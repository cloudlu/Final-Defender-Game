import { GAME_WIDTH } from '../engine/GridConstants.js';
import { SKILL_COLORS } from './EffectsLayer.js';

/**
 * SkillBar: 右上角竖排技能图标，只显示已解锁技能。
 * 主动技（点击施放）与被动技（常驻生效，灰调+不可点）视觉区分；
 * hover 显示详细 tooltip（名称/类型/等级/效果）。
 */
export class SkillBar {
  constructor(scene, state) {
    this.scene = scene;
    this.state = state;
    this.buttons = [];
    this.rebuild();
  }

  /** 技能 hover 提示文案 */
  _tooltipFor(skill) {
    const typeLabel = skill.type === 'passive' ? '被动 · 常驻生效' : '主动 · 点击图标施放';
    const parts = [`${skill.name}  Lv.${skill.level || 1}`, typeLabel];
    if (skill.type === 'passive') {
      parts.push(skill.desc || '');
    } else {
      if (skill.damage) parts.push(`伤害 ${skill.damage}`);
      if (skill.cooldown) parts.push(`冷却 ${Math.round(skill.cooldown * 100) / 100}s`); // 显示端取整防浮点尾数
      if (skill.aoe && skill.aoe < 90) parts.push(`范围 ${skill.aoe} 格`);
      if (skill.chain) parts.push(`链跳 ${skill.chain} 目标`);
      parts.push(skill.desc || '');
    }
    return parts.filter(Boolean).join('\n');
  }

  _showTooltip(skill, x, y) {
    this._hideTooltip();
    const lines = this._tooltipFor(skill).split('\n');
    const w = 200, lineH = 17;
    const h = lines.length * lineH + 16;
    const ty = Math.min(y + 26, this.scene.cameras.main.height - h - 8);
    const g = this.scene.add.graphics().setDepth(300);
    g.fillStyle(0x000000, 0.92);
    g.fillRoundedRect(x + 20, ty, w, h, 8);
    g.lineStyle(1, 0x5577aa, 1);
    g.strokeRoundedRect(x + 20, ty, w, h, 8);
    const txt = this.scene.add.text(x + 30, ty + 8, this._tooltipFor(skill), {
      fontSize: '12px', fill: '#ddeeff', fontFamily: 'Arial', lineSpacing: 4,
    }).setDepth(301);
    this.tooltip = { g, txt };
  }

  _hideTooltip() {
    if (this.tooltip) { this.tooltip.g.destroy(); this.tooltip.txt.destroy(); this.tooltip = null; }
  }

  rebuild() {
    for (const b of this.buttons) {
      b.bg.destroy(); b.icon.destroy(); b.cdText.destroy(); b.cdWedge.destroy(); b.readyRing.destroy();
      if (b.lvText) b.lvText.destroy();
      b.selectRing.destroy();
    }
    this._hideTooltip();
    this.buttons = [];
    this.selectedId = this.selectedId || 'attack';

    const x = GAME_WIDTH - 30;
    const startY = 170;
    const spacing = 42;
    const skills = this.state.player.skills.filter(s => s.unlocked);
    for (let i = 0; i < skills.length; i++) {
      const skill = skills[i], y = startY + i * spacing;
      const isPassive = skill.type === 'passive';
      // 被动：暗灰底+灰边（视觉上"不可点"）；主动：正常色底
      const bg = this.scene.add.circle(x, y, 16, isPassive ? 0x1a1f2b : 0x2a3a5a).setDepth(101);
      bg.setStrokeStyle(2, isPassive ? 0x3a4456 : (SKILL_COLORS[skill.id] || 0xffffff));
      const icon = this.scene.add.text(x, y - 2, skill.icon, {
        fontSize: '12px',
      }).setOrigin(0.5).setDepth(102);
      if (isPassive) icon.setAlpha(0.55);
      // 被动标识：右下角小"被"字
      if (isPassive) {
        this.scene.add.text(x + 11, y + 10, '被', {
          fontSize: '7px', fill: '#8899aa', fontFamily: 'Arial',
        }).setOrigin(0.5).setDepth(103);
      }
      // 等级徽章（Lv1 不显示）
      let lvText = null;
      if (skill.level > 1) {
        lvText = this.scene.add.text(x + 10, y - 8, `${skill.level}`, {
          fontSize: '8px', fill: '#ffdd44', fontFamily: 'Arial', fontStyle: 'bold',
          stroke: '#000000', strokeThickness: 2,
        }).setOrigin(0.5).setDepth(103);
      }
      const cdWedge = this.scene.add.arc(x, y, 16, 0, 360, 14, 0x000000, 0.65).setDepth(104);
      cdWedge.setVisible(false);
      const cdText = this.scene.add.text(x, y, '', {
        fontSize: '13px', fill: '#ffffff', fontFamily: 'Arial', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5).setDepth(105);
      const readyRing = this.scene.add.circle(x, y, 19, SKILL_COLORS[skill.id] || 0xffffff, 0).setDepth(103);
      readyRing.setStrokeStyle(2, SKILL_COLORS[skill.id] || 0xffffff, 0.9);
      readyRing.setVisible(false);
      const selectRing = this.scene.add.circle(x, y, 23, 0xffffff, 0).setDepth(103);
      selectRing.setStrokeStyle(2, 0xffffff, 1);
      selectRing.setVisible(false);

      // 被动：不可交互（不 setInteractive），hover 仍提示
      if (!isPassive) {
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerdown', (p) => {
          p.event.stopPropagation();
          this.onQuickCast?.(skill.id);
        });
      } else {
        // 被动：可交互（保留 hover tooltip），点击吞掉不施放
        bg.setInteractive({ useHandCursor: 'default' });
        bg.on('pointerdown', (p) => {
          p.event.stopPropagation();
          // 被动不可施放——显示提示
          this.onPassiveClick?.(skill.id);
        });
      }
      bg.on('pointerover', () => this._showTooltip(skill, x, y));
      bg.on('pointerout', () => this._hideTooltip());

      this.buttons.push({ skill, bg, icon, lvText, cdText, cdWedge, readyRing, selectRing, isPassive });
    }
    this.setSelected(this.selectedId);
  }

  /** 快捷施放回调（GameScene 注入）：点图标立即释放 */
  onQuickCast = null;
  /** 被动点击回调：提示"被动技能无需释放" */
  onPassiveClick = null;
  /** 选中回调（数字键瞄准流） */
  onSelect = null;

  setSelected(skillId) {
    this.selectedId = skillId;
    for (const b of this.buttons) {
      if (b.isPassive) { b.selectRing.setVisible(false); continue; }
      const sel = b.skill.id === skillId;
      b.selectRing.setVisible(sel);
      b.bg.setAlpha(sel ? 1 : 0.85);
      b.icon.setScale(sel ? 1.25 : 1);
    }
  }

  update(timeNow) {
    for (const b of this.buttons) {
      if (b.isPassive) continue; // 被动无冷却
      const cd = b.skill.currentCooldown;
      if (cd > 0) {
        const total = b.skill.cooldown || 1;
        const frac = Math.min(1, cd / total);
        b.cdWedge.setVisible(true);
        b.cdWedge.arc = 360 * frac;
        b.cdText.setText(cd >= 1 ? `${Math.ceil(cd)}` : cd.toFixed(1));
        b.icon.setAlpha(0.35);
        b.readyRing.setVisible(false);
      } else {
        b.cdWedge.setVisible(false);
        b.cdText.setText('');
        b.icon.setAlpha(1);
        // 就绪脉冲：冷却≥3s 的技能就绪时提示可再释放
        if (b.skill.cooldown >= 3 && b.skill.id !== this.selectedId) {
          b.readyRing.setVisible(true);
          b.readyRing.setAlpha(0.5 + Math.sin(timeNow / 200) * 0.4);
        } else {
          b.readyRing.setVisible(false);
        }
      }
    }
  }
}
