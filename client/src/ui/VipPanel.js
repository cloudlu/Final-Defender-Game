import { GAME_WIDTH, GAME_HEIGHT } from '../engine/GridConstants.js';
import { VIP_LEVELS } from '../engine/VipSystem.js';

/**
 * VipPanel: VIP 面板（主菜单入口）——等级/特权展示 + 兑换码输入（临时充值形态）。
 */
export class VipPanel {
  constructor(scene, vipSystem, vipClient, { onClose, onPersist, onVipUpdate }) {
    this.scene = scene;
    this.vip = vipSystem;
    this.client = vipClient;
    this.onClose = onClose;
    this.onPersist = onPersist;
    this.onVipUpdate = onVipUpdate;
    this.build();
  }

  build() {
    const { width, height } = this.scene.cameras.main;
    const cx = width / 2;
    this.container = this.scene.add.container(0, 0).setDepth(700);
    this.container.add(this.scene.add.rectangle(cx, height / 2, width, height, 0x000000, 0.9).setInteractive());

    this.container.add(this.scene.add.text(cx, 50, '👑 VIP', {
      fontSize: '26px', fill: '#ffcc44', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));

    this.infoText = this.scene.add.text(cx, 92, '', {
      fontSize: '14px', fill: '#ffffff', fontFamily: 'Arial', align: 'center', lineSpacing: 4,
    }).setOrigin(0.5);
    this.container.add(this.infoText);

    // 等级表
    let y = 150;
    for (const lv of VIP_LEVELS) {
      if (lv.level === 0) continue;
      const isCurrent = this.vip.level === lv.level;
      const reached = this.vip.level >= lv.level;
      const row = this.scene.add.rectangle(cx, y, 480, 42, isCurrent ? 0x4a3a10 : 0x1e2436);
      row.setStrokeStyle(1, reached ? 0xffcc44 : 0x334466);
      this.container.add(row);
      this.container.add(this.scene.add.text(cx - 230, y, `VIP${lv.level}`, {
        fontSize: '14px', fill: reached ? '#ffcc44' : '#667788', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0, 0.5));
      this.container.add(this.scene.add.text(cx - 150, y, `充值 ¥${lv.requiredExp / 100}`, {
        fontSize: '12px', fill: '#99aabb', fontFamily: 'Arial',
      }).setOrigin(0, 0.5));
      this.container.add(this.scene.add.text(cx + 20, y, `金币 +${Math.round(lv.goldBonus * 100)}%`, {
        fontSize: '12px', fill: reached ? '#88ff88' : '#667788', fontFamily: 'Arial',
      }).setOrigin(0, 0.5));
      if (isCurrent) {
        this.container.add(this.scene.add.text(cx + 200, y, '← 当前', {
          fontSize: '12px', fill: '#ffcc44', fontFamily: 'Arial', fontStyle: 'bold',
        }).setOrigin(0, 0.5));
      }
      y += 50;
    }

    // 兑换码输入区
    const inputY = height - 190;
    this.container.add(this.scene.add.text(cx, inputY - 26, '充值（临时形态：输入兑换码）', {
      fontSize: '12px', fill: '#8899bb', fontFamily: 'Arial',
    }).setOrigin(0.5));
    const inputBg = this.scene.add.rectangle(cx - 40, inputY + 8, 280, 40, 0x0d1220);
    inputBg.setStrokeStyle(2, 0x4466aa);
    this.container.add(inputBg);
    this.inputText = this.scene.add.text(cx - 170, inputY + 8, '', {
      fontSize: '14px', fill: '#ffffff', fontFamily: 'Arial',
    }).setOrigin(0, 0.5);
    this.container.add(this.inputText);

    const submitBtn = this.scene.add.rectangle(cx + 140, inputY + 8, 100, 40, 0xaa5588)
      .setInteractive({ useHandCursor: true });
    this.container.add(submitBtn);
    this.container.add(this.scene.add.text(cx + 140, inputY + 8, '兑换', {
      fontSize: '14px', fill: '#ffffff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));

    this.statusText = this.scene.add.text(cx, inputY + 44, '', {
      fontSize: '12px', fill: '#8888aa', fontFamily: 'Arial',
    }).setOrigin(0.5);
    this.container.add(this.statusText);

    // DOM input 复用（Phaser 文本不支持输入）
    this._domInput = document.createElement('input');
    this._domInput.style.cssText = `position:absolute;left:50%;top:${inputY + 8}px;transform:translate(-135%,-50%);width:240px;height:36px;background:#0d1220;color:#fff;border:2px solid #4466aa;border-radius:4px;padding:0 8px;font-size:14px;z-index:999;`;
    document.body.appendChild(this._domInput);
    this._domInput.addEventListener('input', () => { this.inputText.setText(this._domInput.value.toUpperCase()); });
    this._domInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._redeem();
      e.stopPropagation();
    });
    submitBtn.on('pointerdown', () => this._redeem());

    this.container.add(this.scene.add.text(cx, height - 20, '点击空白处关闭', {
      fontSize: '11px', fill: '#667', fontFamily: 'Arial',
    }).setOrigin(0.5));
    this.container.list[0].on('pointerdown', () => { this.destroy(); this.onClose?.(); });

    this._refreshInfo();
  }

  _refreshInfo() {
    const exp = this.vip.info.vipExp || 0;
    const next = this.vip.nextLevelExp;
    const progress = next ? `（${exp}/${next}，再充 ¥${(next - exp) / 100} 升级）` : '（已满级）';
    this.infoText.setText(
      `当前 VIP${this.vip.level} · 累计充值 ¥${exp / 100}\n金币加成 +${Math.round(this.vip.goldBonus * 100)}% ${progress}`
    );
  }

  async _redeem() {
    const code = (this._domInput?.value || '').trim().toUpperCase();
    if (!code) return;
    this.statusText.setText('兑换中...').setColor('#88aaff');
    const result = await this.client.redeem(code);
    if (result === null) {
      this.statusText.setText('无法连接服务器（服务端未启动？）').setColor('#ff6666');
      return;
    }
    if (!result.success) {
      this.statusText.setText(`✗ ${result.error}`).setColor('#ff6666');
      return;
    }
    // 成功：更新 VIP 信息；钻石码 → 加余额
    let extra = '';
    if (result.vipInfo) {
      this.vip.setInfo(result.vipInfo);
      this._refreshInfo();
      this.onVipUpdate?.();
      extra = `VIP${result.vipInfo.vipLevel}`;
    }
    if (result.type === 'diamond' && result.amount > 0) {
      this.saveDiamonds?.(result.amount);
      extra = `+${result.amount}💎`;
    }
    this.statusText.setText(`✓ 兑换成功 ${extra}`).setColor('#66ff88');
    this._domInput.value = '';
    this.inputText.setText('');
    this.onPersist?.();
  }

  /** 注入钻石入账回调 */
  saveDiamonds = null;

  destroy() {
    this._domInput?.remove();
    this._domInput = null;
    if (this.container) { this.container.destroy(); this.container = null; }
  }
}
