import { GAME_WIDTH, GAME_HEIGHT } from '../engine/GridConstants.js';
import { AuthClient } from '../repository/AuthClient.js';

/**
 * AuthPanel: 登录/注册门控（进主菜单前显示）。
 * - 登录成功 → onAuthed(username, slot)（MenuScene 据此加载该用户的存档槽）
 * - 预置账号：亮亮 / test
 */
export class AuthPanel {
  constructor(scene, { onAuthed }) {
    this.scene = scene;
    this.onAuthed = onAuthed;
    this._domInputs = [];
    this.build();
  }

  build() {
    const { width, height } = this.scene.cameras.main;
    const cx = width / 2;
    this.container = this.scene.add.container(0, 0).setDepth(900);
    this.container.add(this.scene.add.rectangle(cx, height / 2, width, height, 0x0a0e1a, 0.97).setInteractive());

    this.container.add(this.scene.add.text(cx, height / 2 - 180, '最 后 防 线', {
      fontSize: '34px', fill: '#00ccff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));
    this.container.add(this.scene.add.text(cx, height / 2 - 136, '登录后开始游戏（进度按账号保存）', {
      fontSize: '12px', fill: '#667788', fontFamily: 'Arial',
    }).setOrigin(0.5));

    // 表单（DOM input，游戏坐标 → 屏幕坐标由 GameScene 同款 FIT 换算）
    const inputY = height / 2 - 70;
    this._userInput = this._makeDomInput(cx, inputY, '用户名');
    this._passInput = this._makeDomInput(cx, inputY + 52, '密码', true);

    // 登录 / 注册按钮
    const mkBtn = (x, w, label, color, onClick) => {
      const b = this.scene.add.rectangle(x, inputY + 118, w, 40, color).setInteractive({ useHandCursor: true });
      this.container.add(b);
      this.container.add(this.scene.add.text(x, inputY + 118, label, {
        fontSize: '14px', fill: '#fff', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0.5));
      b.on('pointerdown', onClick);
      return b;
    };
    this.status = this.scene.add.text(cx, inputY + 160, '', {
      fontSize: '12px', fontFamily: 'Arial', align: 'center', wordWrap: { width: 400 },
    }).setOrigin(0.5);
    this.container.add(this.status);
    mkBtn(cx - 110, 190, '登 录', 0x2277aa, () => this._submit('login'));
    mkBtn(cx + 110, 190, '注 册 新 账 号', 0x7766aa, () => this._submit('register'));

    this.container.add(this.scene.add.text(cx, height - 40, '预置账号：亮亮 / test', {
      fontSize: '11px', fill: '#556677', fontFamily: 'Arial',
    }).setOrigin(0.5));
    // 首个输入框聚焦
    this.scene.time.delayedCall(100, () => this._userInput?.focus());
  }

  _makeDomInput(gx, gy, placeholder, isPassword = false) {
    const canvas = this.scene.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / this.scene.game.config.width;
    const input = document.createElement('input');
    input.placeholder = placeholder;
    if (isPassword) input.type = 'password';
    input.style.cssText = 'position:absolute;background:#0d1220;color:#fff;border:2px solid #335577;border-radius:4px;padding:0 10px;outline:none;z-index:950;';
    Object.assign(input.style, {
      left: `${rect.left + gx * scale - 110 * scale}px`,
      top: `${rect.top + gy * scale - 18 * scale}px`,
      width: `${220 * scale}px`,
      height: `${36 * scale}px`,
      fontSize: `${14 * scale}px`,
    });
    document.body.appendChild(input);
    this._domInputs.push(input);
    for (const evt of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend']) {
      input.addEventListener(evt, (e) => e.stopPropagation());
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._submit('login');
      e.stopPropagation();
    });
    return input;
  }

  async _submit(mode) {
    const username = (this._userInput?.value || '').trim();
    const password = this._passInput?.value || '';
    if (!username || !password) {
      this.status.setText('⚠ 请输入用户名和密码').setColor('#ffaa66');
      return;
    }
    this.status.setText(mode === 'login' ? '登录中…' : '注册中…').setColor('#88aaff');
    const client = new AuthClient();
    let r = mode === 'login'
      ? await client.login(username, password)
      : await client.register(username, password);
    // 注册成功自动登录
    if (mode === 'register' && r.success) {
      r = await client.login(username, password);
    }
    if (!r.success) {
      this.status.setText(`✗ ${r.error || '失败'}`).setColor('#ff6666');
      return;
    }
    // 换取存档槽
    let slot = 1;
    try {
      const res = await fetch(`/api/auth/slot?username=${encodeURIComponent(r.username)}`);
      if (res.ok) slot = (await res.json()).slot;
    } catch { /* 服务端不可达用默认槽 */ }
    AuthClient.setSession(r.username, slot, r.token);
    this._cleanup();
    this.container.destroy();
    this.onAuthed(r.username, slot);
  }

  _cleanup() {
    for (const el of this._domInputs) el.remove();
    this._domInputs = [];
  }

  destroy() {
    this._cleanup();
    if (this.container) { this.container.destroy(); this.container = null; }
  }
}
