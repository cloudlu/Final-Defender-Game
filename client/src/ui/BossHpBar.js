import { GAME_WIDTH } from '../engine/GridConstants.js';

/**
 * BossHpBar: 顶部 BOSS 血条 + 名牌。BOSS 死亡/清场后隐藏。
 */
export class BossHpBar {
  constructor(scene) {
    this.scene = scene;
    this.container = scene.add.container(0, 0).setDepth(210).setVisible(false);
    const w = GAME_WIDTH - 80;
    this.nameText = scene.add.text(GAME_WIDTH / 2, 58, '', {
      fontSize: '13px', fill: '#ff8888', fontFamily: 'Arial', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5);
    this.bg = scene.add.rectangle(GAME_WIDTH / 2, 76, w, 10, 0x220000).setStrokeStyle(1, 0x663333);
    this.fill = scene.add.rectangle(GAME_WIDTH / 2 - w / 2, 76, w, 10, 0xcc2222).setOrigin(0, 0.5);
    this.container.add([this.nameText, this.bg, this.fill]);
    this.barW = w;
  }

  show(boss) {
    this.boss = boss;
    this.container.setVisible(true);
    this.nameText.setText(`☠️ ${boss.name}`);
  }

  hide() {
    this.boss = null;
    this.container.setVisible(false);
  }

  update(enemies) {
    if (!this.boss) return;
    const alive = this.boss.alive && enemies.find(e => e.id === this.boss.id);
    if (!alive) { this.hide(); return; }
    const frac = Math.max(0, this.boss.hp / this.boss.maxHp);
    this.fill.setSize(this.barW * frac, 10);
    this.fill.setFillStyle(frac > 0.5 ? 0xcc2222 : frac > 0.25 ? 0xcc6600 : 0xff2222);
  }
}
