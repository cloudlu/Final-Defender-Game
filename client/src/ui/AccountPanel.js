import { GAME_WIDTH, GAME_HEIGHT } from '../engine/GridConstants.js';
import { AuthClient } from '../repository/AuthClient.js';

/**
 * AccountPanel: 账号设置（修改密码 / 删除账号）。
 * - 改密：旧密码验证 → 新密码
 * - 删号：输密码 + 勾选确认（进度连同存档永久删除，二次弹确认）
 * - 删除成功/改密后由 onClose 回调处理会话清理与场景重启
 */
export class AccountPanel {
  constructor(scene, username, { onClose, onDeleted }) {
    this.scene = scene;
    this.username = username;
    this.onClose = onClose;
    this.onDeleted = onDeleted; // 删除成功回调（清会话+回登录页）
    this._domInputs = [];
    this.build();
  }

  build() {
    const { width, height } = this.scene.cameras.main;
    const cx = width / 2;
    this.container = this.scene.add.container(0, 0).setDepth(880);
    this.container.add(this.scene.add.rectangle(cx, height / 2, width, height, 0x000000, 0.9).setInteractive());

    this.container.add(this.scene.add.text(cx, height / 2 - 200, '⚙️ 账号设置', {
      fontSize: '20px', fill: '#ffdd44', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));
    this.container.add(this.scene.add.text(cx, height / 2 - 168, `当前账号：${this.username}`, {
      fontSize: '12px', fill: '#88aacc', fontFamily: 'Arial',
    }).setOrigin(0.5));

    // ===== 修改密码区 =====
    const fy = height / 2 - 110;
    this.container.add(this.scene.add.text(cx, fy - 26, '── 修改密码 ──', {
      fontSize: '12px', fill: '#88ddff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));
    this._oldPw = this._makeDomInput(cx, fy, '旧密码', true);
    this._newPw = this._makeDomInput(cx, fy + 48, '新密码（≥4 位）', true);
    const cpBtn = this.scene.add.rectangle(cx, fy + 100, 220, 36, 0x2277aa).setInteractive({ useHandCursor: true });
    this.container.add(cpBtn);
    this.container.add(this.scene.add.text(cx, fy + 100, '确认修改密码', {
      fontSize: '13px', fill: '#fff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));
    cpBtn.on('pointerdown', () => this._changePassword());

    // ===== 删除账号区 =====
    const dy = fy + 170;
    this.container.add(this.scene.add.text(cx, dy - 26, '── 危险区 ──', {
      fontSize: '12px', fill: '#ff8866', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));
    this.container.add(this.scene.add.text(cx, dy - 4, '删除账号将永久清除该账号及全部进度，不可恢复', {
      fontSize: '10.5px', fill: '#cc7766', fontFamily: 'Arial',
    }).setOrigin(0.5));
    this._delPw = this._makeDomInput(cx, dy + 26, '输入密码确认身份', true);
    const delBtn = this.scene.add.rectangle(cx, dy + 76, 220, 36, 0x884444).setInteractive({ useHandCursor: true });
    this.container.add(delBtn);
    this.container.add(this.scene.add.text(cx, dy + 76, '🗑️ 删除账号', {
      fontSize: '13px', fill: '#ffccaa', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));
    delBtn.on('pointerdown', () => this._deleteAccount());

    this.status = this.scene.add.text(cx, dy + 118, '', {
      fontSize: '12px', fontFamily: 'Arial', align: 'center', wordWrap: { width: 420 },
    }).setOrigin(0.5);
    this.container.add(this.status);

    // 关闭
    const closeBtn = this.scene.add.text(cx, height / 2 + 190, '✕ 关闭', {
      fontSize: '13px', fill: '#88aacc', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerdown', () => { this._cleanup(); this.container.destroy(); this.onClose?.(); });
    this.container.add(closeBtn);
  }

  _makeDomInput(gx, gy, placeholder, isPassword = false) {
    const canvas = this.scene.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / this.scene.game.config.width;
    const input = document.createElement('input');
    input.placeholder = placeholder;
    if (isPassword) input.type = 'password';
    input.style.cssText = 'position:absolute;background:#0d1220;color:#fff;border:2px solid #335577;border-radius:4px;padding:0 10px;outline:none;z-index:920;';
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
    input.addEventListener('keydown', (e) => e.stopPropagation());
    return input;
  }

  async _changePassword() {
    const oldPw = this._oldPw?.value || '';
    const newPw = this._newPw?.value || '';
    if (!oldPw || !newPw) { this.status.setText('⚠ 请填写旧密码和新密码').setColor('#ffaa66'); return; }
    if (newPw.length < 4) { this.status.setText('⚠ 新密码至少 4 位').setColor('#ffaa66'); return; }
    this.status.setText('提交中…').setColor('#88aaff');
    const client = new AuthClient();
    const r = await client.changePassword(this.username, oldPw, newPw);
    if (!r.success) { this.status.setText(`✗ ${r.error}`).setColor('#ff6666'); return; }
    this.status.setText('✓ 密码修改成功').setColor('#66ff88');
    this._oldPw.value = ''; this._newPw.value = '';
  }

  async _deleteAccount() {
    const pw = this._delPw?.value || '';
    if (!pw) { this.status.setText('⚠ 输入密码确认身份').setColor('#ffaa66'); return; }
    // 二次确认覆盖层
    const { width, height } = this.scene.cameras.main;
    const cx = width / 2;
    const confirmBg = this.scene.add.rectangle(cx, height / 2, width, height, 0x000000, 0.85).setDepth(890).setInteractive();
    const box = this.scene.add.rectangle(cx, height / 2, 420, 160, 0x1a0d0d, 0.98).setDepth(891);
    box.setStrokeStyle(2, 0xff4444);
    const g = this.scene.add.container(0, 0).setDepth(892);
    g.add(confirmBg); g.add(box);
    g.add(this.scene.add.text(cx, height / 2 - 50, '⚠️ 最终确认', {
      fontSize: '16px', fill: '#ff6666', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));
    g.add(this.scene.add.text(cx, height / 2 - 20, `账号 "${this.username}" 及其全部进度将被永久删除。\n此操作不可恢复！`, {
      fontSize: '11.5px', fill: '#ffccaa', fontFamily: 'Arial', align: 'center', lineSpacing: 3,
    }).setOrigin(0.5));
    const yes = this.scene.add.text(cx - 80, height / 2 + 30, '✅ 确认删除', {
      fontSize: '14px', fill: '#ff6666', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    const no = this.scene.add.text(cx + 80, height / 2 + 30, '❌ 取消', {
      fontSize: '14px', fill: '#88aacc', fontFamily: 'Arial',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    g.add(yes); g.add(no);
    const cleanup = () => { confirmBg.destroy(); box.destroy(); g.destroy(true); };
    no.on('pointerdown', cleanup);
    yes.on('pointerdown', async () => {
      const client = new AuthClient();
      const r = await client.deleteAccount(this.username, pw);
      if (!r.success) {
        cleanup();
        this.status.setText(`✗ ${r.error}`).setColor('#ff6666');
        return;
      }
      cleanup();
      this._cleanup();
      AuthClient.clearSession();
      this.container.destroy();
      this.onDeleted?.();
    });
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
