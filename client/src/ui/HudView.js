import { GRID, GAME_WIDTH } from '../engine/GridConstants.js';
import { audio as audioSystem } from './AudioSystem.js';
import { UiSkin } from './UiSkin.js';

/**
 * HudView: 顶部资源条 + 墙血条 + 暂停/倍速按钮 + 出波倒计时。
 * 只读引擎状态刷新显示。
 */
export class HudView {
  constructor(scene, state) {
    this.scene = scene;
    this.state = state;
    this._build();
  }

  _build() {
    const s = this.state;

    // 顶部资源条（皮肤化：圆角+描边+高光）
    UiSkin.panel(this.scene, GAME_WIDTH / 2, 16, GAME_WIDTH - 12, 32, { fill: 0x131a2c, border: 0x3d5a8a });
    this.goldText = this.scene.add.text(14, 8, '', { fontSize: '14px', fill: '#ffd700', fontFamily: 'Arial', fontStyle: 'bold' }).setDepth(101);
    this.livesText = this.scene.add.text(110, 8, '', { fontSize: '14px', fill: '#ff4444', fontFamily: 'Arial', fontStyle: 'bold' }).setDepth(101);
    this.waveText = this.scene.add.text(200, 8, '', { fontSize: '14px', fill: '#00ccff', fontFamily: 'Arial', fontStyle: 'bold' }).setDepth(101);
    this.scoreText = this.scene.add.text(290, 8, '', { fontSize: '14px', fill: '#88ff88', fontFamily: 'Arial', fontStyle: 'bold' }).setDepth(101);

    // 控制按钮组（顶栏内，右侧紧凑排列）：⏸ 倍速 🔊
    const ctrlY = 16;
    this.pauseBtn = this.scene.add.circle(GAME_WIDTH - 92, ctrlY, 13, 0x2a3a5a).setDepth(101);
    this.pauseBtn.setStrokeStyle(1, 0x556688);
    this.pauseBtnText = this.scene.add.text(GAME_WIDTH - 92, ctrlY, '⏸', { fontSize: '11px' }).setOrigin(0.5).setDepth(102);
    this.pauseBtn.setInteractive({ useHandCursor: true });
    this.pauseBtn.on('pointerdown', (p) => {
      p.event.stopPropagation();
      const paused = s.togglePause();
      this.pauseBtnText.setText(paused ? '▶' : '⏸');
      this.pauseBtn.setFillStyle(paused ? 0x886600 : 0x2a3a5a);
    });

    this.speedBtn = this.scene.add.circle(GAME_WIDTH - 58, ctrlY, 13, 0x2a3a5a).setDepth(101);
    this.speedBtn.setStrokeStyle(1, 0x556688);
    this.speedBtnText = this.scene.add.text(GAME_WIDTH - 58, ctrlY, '1x', { fontSize: '9px', fill: '#ffffff', fontFamily: 'Arial' }).setOrigin(0.5).setDepth(102);
    this.speedBtn.setInteractive({ useHandCursor: true });
    this.speedBtn.on('pointerdown', (p) => {
      p.event.stopPropagation();
      const speed = s.toggleSpeed();
      this.speedBtnText.setText(`${speed}x`);
      this.speedBtn.setFillStyle(speed > 1 ? 0x884400 : 0x2a3a5a);
    });

    // 音效+BGM 开关
    this.soundOn = true;
    this.soundBtn = this.scene.add.circle(GAME_WIDTH - 26, ctrlY, 13, 0x336655).setDepth(101);
    this.soundBtn.setStrokeStyle(1, 0x558877);
    this.soundBtnText = this.scene.add.text(GAME_WIDTH - 26, ctrlY, '🔊', { fontSize: '10px' }).setOrigin(0.5).setDepth(102);
    this.soundBtn.setInteractive({ useHandCursor: true });
    this.soundBtn.on('pointerdown', (p) => {
      p.event.stopPropagation();
      this.soundOn = !this.soundOn;
      audioSystem.setEnabled(this.soundOn);
      if (this.soundOn) audioSystem.startBgm();
      this.soundBtnText.setText(this.soundOn ? '🔊' : '🔇');
      this.soundBtn.setFillStyle(this.soundOn ? 0x336655 : 0x555555);
    });
    audioSystem.startBgm();

    // 墙血条（贴墙下方）
    const wallY = GRID.OFFSET_Y + s.wallRow * GRID.CELL_SIZE;
    const barW = GAME_WIDTH - 8, barH = 5;
    this.scene.add.rectangle(GAME_WIDTH / 2, wallY + 12, barW, barH, 0x222222).setDepth(41).setStrokeStyle(1, 0x444444);
    this.wallHpBar = this.scene.add.rectangle(4, wallY + 12, barW, barH, 0x44ff44).setOrigin(0, 0.5).setDepth(42);
    this.wallHpMax = s.lives;

    // 出波倒计时（顶栏下方独立位置，不与技能栏抢右上）
    this.waveCountdownText = this.scene.add.text(GAME_WIDTH / 2, 44, '', {
      fontSize: '16px', fill: '#ffaa00', fontFamily: 'Arial', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(102);

    this.update();
  }

  update() {
    const s = this.state;
    this.goldText.setText(`💰${s.gold}`);
    this.livesText.setText(`🛡️${s.lives}`);
    const info = s.getWaveInfo();
    this.waveText.setText(info.active ? `⚔️${info.wave}(${info.remaining})` : `⚔️${info.wave}`);
    this.scoreText.setText(`⭐${s.score}`);
    this.waveCountdownText.setText(
      !info.active && s.waveCountdown > 0 ? `⏱${Math.ceil(s.waveCountdown)}` : ''
    );
    const frac = Math.max(0, s.lives / this.wallHpMax);
    this.wallHpBar.setSize((GAME_WIDTH - 8) * frac, 5);
    this.wallHpBar.setFillStyle(frac > 0.5 ? 0x44ff44 : frac > 0.25 ? 0xffcc00 : 0xff2222);
  }
}
