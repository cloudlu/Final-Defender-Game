/**
 * UpgradeOverlay: 升级三选一弹层（向僵尸开炮式）。
 * 展示 3 个升级选项（新技能解锁 / 属性强化），玩家选一项后继续战斗。
 */
const RARITY_COLORS = {
  white: { border: 0xaaaaaa, bg: 0x2a2a3a, label: '普通' },
  blue: { border: 0x4488ff, bg: 0x1a2a4a, label: '稀有' },
  purple: { border: 0xaa44ff, bg: 0x2a1a4a, label: '史诗' },
  orange: { border: 0xff8800, bg: 0x4a2a1a, label: '传说' },
};

export class UpgradeOverlay {
  constructor(scene, onPick) {
    this.scene = scene;
    this.onPick = onPick;
    this.container = null;
    this.visible = false;
  }

  show(options) {
    if (this.visible) return;
    this.visible = true;

    const { width, height } = this.scene.cameras.main;
    this.container = this.scene.add.container(0, 0).setDepth(600);

    const bg = this.scene.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.78);
    bg.setInteractive();
    this.container.add(bg);

    const title = this.scene.add.text(width / 2, height / 2 - 190, '⬆️ 升级！选择一项强化', {
      fontSize: '24px', fill: '#ffdd44', fontFamily: 'Arial', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5);
    this.container.add(title);

    const cardWidth = 150;
    const cardHeight = 230;
    const spacing = 16;
    const totalWidth = options.length * cardWidth + (options.length - 1) * spacing;
    const startX = (width - totalWidth) / 2 + cardWidth / 2;

    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      const x = startX + i * (cardWidth + spacing);
      const y = height / 2 + 20;
      const rc = RARITY_COLORS[opt.rarity] || RARITY_COLORS.white;

      const cardBg = this.scene.add.rectangle(x, y, cardWidth, cardHeight, rc.bg);
      cardBg.setStrokeStyle(2, rc.border);
      cardBg.setInteractive({ useHandCursor: true });
      this.container.add(cardBg);

      const rarityText = this.scene.add.text(x, y - cardHeight / 2 + 18, rc.label, {
        fontSize: '12px', fill: `#${rc.border.toString(16).padStart(6, '0')}`, fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0.5);
      this.container.add(rarityText);

      const icon = this.scene.add.text(x, y - 45, opt.icon, { fontSize: '30px' }).setOrigin(0.5);
      this.container.add(icon);

      const nameText = this.scene.add.text(x, y - 5, opt.name, {
        fontSize: '15px', fill: '#ffffff', fontFamily: 'Arial', fontStyle: 'bold',
        wordWrap: { width: cardWidth - 20 }, align: 'center',
      }).setOrigin(0.5);
      this.container.add(nameText);

      const descText = this.scene.add.text(x, y + 35, opt.description, {
        fontSize: '11px', fill: '#ccccdd', fontFamily: 'Arial',
        wordWrap: { width: cardWidth - 24 }, align: 'center',
      }).setOrigin(0.5);
      this.container.add(descText);

      cardBg.on('pointerover', () => {
        cardBg.setFillStyle(rc.bg + 0x111111);
        cardBg.setScale(1.05);
      });
      cardBg.on('pointerout', () => {
        cardBg.setFillStyle(rc.bg);
        cardBg.setScale(1.0);
      });
      cardBg.on('pointerdown', () => {
        this.hide();
        this.onPick(opt);
      });
    }
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    if (this.container) {
      this.container.destroy();
      this.container = null;
    }
  }

  isVisible() {
    return this.visible;
  }
}
