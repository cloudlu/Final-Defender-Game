import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload() {
    const { width, height } = this.cameras.main;
    const cx = width / 2;
    const cy = height / 2;

    const bg = this.add.rectangle(cx, cy, width, height, 0x1a1a2e);

    const loadText = this.add.text(cx, cy - 20, '加载中...', {
      fontSize: '24px',
      fill: '#e0e0e0',
      fontFamily: 'Arial',
    }).setOrigin(0.5);

    const progressBar = this.add.graphics();
    const progressBox = this.add.graphics();
    progressBox.fillStyle(0x333355, 0.8);
    progressBox.fillRect(cx - 160, cy + 10, 320, 30);

    this.load.on('progress', (value) => {
      progressBar.clear();
      progressBar.fillStyle(0x00ccff, 1);
      progressBar.fillRect(cx - 158, cy + 12, 316 * value, 26);
    });

    this.load.on('complete', () => {
      progressBar.destroy();
      progressBox.destroy();
      loadText.destroy();
      bg.destroy();
    });

    // Load placeholder assets
    this.load.image('placeholder', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
  }

  create() {
    this.scene.start('MenuScene');
  }
}
