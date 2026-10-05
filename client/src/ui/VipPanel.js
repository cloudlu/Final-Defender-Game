import { GAME_WIDTH, GAME_HEIGHT } from '../engine/GridConstants.js';
import { VIP_LEVELS, PERK_NAMES } from '../engine/VipSystem.js';

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
      this.container.add(this.scene.add.text(cx - 150, y, `充值 ¥${lv.requiredYuan}`, {
        fontSize: '12px', fill: '#99aabb', fontFamily: 'Arial',
      }).setOrigin(0, 0.5));
      this.container.add(this.scene.add.text(cx + 20, y, (lv.perks || []).map(p => PERK_NAMES[p] || p).join('、') || '—', {
        fontSize: '10.5px', fill: reached ? '#88ff88' : '#667788', fontFamily: 'Arial',
      }).setOrigin(0, 0.5));
      if (isCurrent) {
        this.container.add(this.scene.add.text(cx + 200, y, '← 当前', {
          fontSize: '12px', fill: '#ffcc44', fontFamily: 'Arial', fontStyle: 'bold',
        }).setOrigin(0, 0.5));
      }
      y += 50;
    }

    // 兑换码输入区（输入框本体是 DOM 元素，_syncInputPosition 负责钉位；Phaser 侧只画文字说明与按钮，
    // 不再画输入框底框——否则与 DOM 输入框边框叠成"两个框"）
    const inputY = height - 190;
    this.container.add(this.scene.add.text(cx, inputY - 26, '充值（临时形态：输入兑换码）', {
      fontSize: '12px', fill: '#8899bb', fontFamily: 'Arial',
    }).setOrigin(0.5));

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

    // DOM input（Phaser 文本不支持输入）：位置按画布实际缩放/偏移对齐（_syncInputPosition）
    this._inputGX = cx - 40; // 输入框中心（游戏坐标），与"兑换"按钮间距 100
    this._inputGY = inputY + 8;
    this._domInput = document.createElement('input');
    this._domInput.maxLength = 24;
    this._domInput.placeholder = '输入兑换码';
    this._domInput.style.cssText = 'position:absolute;background:#0d1220;color:#fff;border:2px solid #4466aa;border-radius:4px;padding:0 8px;text-transform:uppercase;outline:none;z-index:999;';
    document.body.appendChild(this._domInput);
    // 仅阻断冒泡（Phaser 监听 canvas，DOM 输入事件本就不会穿透到画布）；
    // 切勿 preventDefault——会阻止输入框聚焦导致无法输入
    for (const evt of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend']) {
      this._domInput.addEventListener(evt, (e) => e.stopPropagation());
    }
    this._domInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._redeem();
      e.stopPropagation(); // 阻止按键冒泡到 window 级 Phaser 键盘
    });
    submitBtn.on('pointerdown', () => this._redeem());
    submitBtn.on('pointerup', () => this._domInput?.focus()); // 兑换后焦点回输入框，便于连续测试
    this._onResize = () => this._syncInputPosition();
    window.addEventListener('resize', this._onResize);
    this._syncInputPosition();
    this._domInput.focus();

    this.container.add(this.scene.add.text(cx, height - 20, '点击空白处关闭', {
      fontSize: '11px', fill: '#667', fontFamily: 'Arial',
    }).setOrigin(0.5));
    this.container.list[0].on('pointerdown', () => { this.destroy(); this.onClose?.(); });

    this._refreshInfo();
  }

  _refreshInfo() {
    const exp = this.vip.info.vipExp || 0; // vipExp = 累计充值元
    const next = this.vip.nextLevelYuan;
    const progress = next ? `（已充 ¥${exp}，再充 ¥${next - exp} 升级）` : '（已满级 VIP15）';
    this.infoText.setText(
      `当前 VIP${this.vip.level}\n${progress}`
    );
  }

  /** 把 DOM 输入框钉到游戏坐标 → 屏幕坐标（画布 FIT 缩放 + 居中偏移） */
  _syncInputPosition() {
    const canvas = this.scene.game.canvas;
    if (!canvas || !this._domInput) return;
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / this.scene.game.config.width; // FIT 等比缩放
    const w = 240 * scale;
    Object.assign(this._domInput.style, {
      left: `${rect.left + this._inputGX * scale}px`,
      top: `${rect.top + this._inputGY * scale}px`,
      width: `${w}px`,
      height: `${36 * scale}px`,
      fontSize: `${14 * scale}px`,
      transform: 'translate(-50%, -50%)',
    });
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
    // 成功：更新 VIP 信息；附送钻石入账（VIP 码与钻石码都带 amount）
    let extra = '';
    if (result.vipInfo) {
      this.vip.setInfo(result.vipInfo);
      this._refreshInfo();
      this.onVipUpdate?.();
      extra = `VIP${result.vipInfo.vipLevel}`;
    }
    if (result.amount > 0) {
      this.saveDiamonds?.(result.amount);
      extra = `${extra ? extra + ' ' : ''}+${result.amount}💎`;
    }
    this.statusText.setText(`✓ 兑换成功 ${extra}`).setColor('#66ff88');
    this._domInput.value = '';
    this.onPersist?.();
  }

  /** 注入钻石入账回调 */
  saveDiamonds = null;

  destroy() {
    window.removeEventListener('resize', this._onResize);
    this._domInput?.remove();
    this._domInput = null;
    if (this.container) { this.container.destroy(); this.container = null; }
  }
}
