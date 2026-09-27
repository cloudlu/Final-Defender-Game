import { GAME_WIDTH, GAME_HEIGHT } from '../engine/GridConstants.js';

const RARITY_COLORS = {
  white: { border: 0xaaaaaa, label: '普通', color: '#aaaaaa' },
  blue: { border: 0x4488ff, label: '稀有', color: '#4488ff' },
  purple: { border: 0xaa44ff, label: '史诗', color: '#aa44ff' },
  orange: { border: 0xff8800, label: '传说', color: '#ff8800' },
};

/**
 * GachaPanel: 抽卡弹层（主菜单入口）。
 * 双池单抽/十连、概率公示、结果逐张翻开、重复返还提示。
 */
export class GachaPanel {
  constructor(scene, gachaSystem, globalSave, { onClose, onPersist }) {
    this.scene = scene;
    this.gacha = gachaSystem;
    this.save = globalSave;
    this.onClose = onClose;
    this.onPersist = onPersist;
    this.rng = { next: () => Math.random() }; // 抽卡表现层随机；引擎侧结果由自身注入 rng
    this.build();
  }

  build() {
    const { width, height } = this.scene.cameras.main;
    const cx = width / 2;
    this.container = this.scene.add.container(0, 0).setDepth(700);
    this.container.add(this.scene.add.rectangle(cx, height / 2, width, height, 0x000000, 0.9)
      .setInteractive());

    this.container.add(this.scene.add.text(cx, 46, '🎰 补给抽取', {
      fontSize: '26px', fill: '#ffdd44', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));

    // 货币余额
    this.balanceText = this.scene.add.text(cx, 84, '', {
      fontSize: '15px', fill: '#ffffff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.container.add(this.balanceText);
    this._refreshBalance();

    // 双池
    this._buildPoolCard('gold', cx - 130, 210);
    this._buildPoolCard('diamond', cx + 130, 210);

    // 概率公示（合规）
    const rates = this.gacha.getPublishedRates('gold');
    const rateText = Object.entries(rates)
      .map(([r, p]) => `${RARITY_COLORS[r].label} ${(p * 100).toFixed(0)}%`)
      .join('  ');
    this.container.add(this.scene.add.text(cx, 330, `概率公示：${rateText}`, {
      fontSize: '11px', fill: '#8888aa', fontFamily: 'Arial',
    }).setOrigin(0.5));

    const pityGold = this.gacha.save.pity?.gold ?? 0;
    this.container.add(this.scene.add.text(cx, 350,
      `保底：${this.gacha.config.pity.threshold} 抽必出史诗（当前 ${pityGold}/${this.gacha.config.pity.threshold}）`, {
      fontSize: '11px', fill: '#aa88cc', fontFamily: 'Arial',
    }).setOrigin(0.5));

    // 结果区
    this.resultContainer = this.scene.add.container(0, 0);
    this.container.add(this.resultContainer);

    this.container.add(this.scene.add.text(cx, height - 24, '点击空白处关闭', {
      fontSize: '11px', fill: '#667', fontFamily: 'Arial',
    }).setOrigin(0.5));
    this.container.list[0].on('pointerdown', () => { this.destroy(); this.onClose?.(); });
  }

  _buildPoolCard(poolId, x, y) {
    const pool = this.gacha.getPool(poolId);
    const isGold = pool.currency === 'gold';
    const card = this.scene.add.rectangle(x, y, 230, 200, isGold ? 0x3a3020 : 0x20283a);
    card.setStrokeStyle(2, isGold ? 0xffaa00 : 0x4488ff);
    this.container.add(card);

    this.container.add(this.scene.add.text(x, y - 70, pool.name, {
      fontSize: '18px', fill: '#ffffff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));

    const sym = isGold ? '💰' : '💎';
    this.container.add(this.scene.add.text(x, y - 35, `${sym} ${pool.cost}/抽`, {
      fontSize: '13px', fill: '#ccccdd', fontFamily: 'Arial',
    }).setOrigin(0.5));

    const single = this._button(x, y + 20, 180, 38, `单抽 ${sym}${pool.cost}`, isGold ? 0x886611 : 0x3355aa);
    single.on('pointerdown', () => this._doPull(poolId, 1));
    const ten = this._button(x, y + 68, 180, 38, `十连 ${sym}${this.gacha.getCost(poolId, 10)}（9折）`, isGold ? 0xaa8822 : 0x5577cc);
    ten.on('pointerdown', () => this._doPull(poolId, 10));
  }

  _button(x, y, w, h, label, color) {
    const btn = this.scene.add.rectangle(x, y, w, h, color).setInteractive({ useHandCursor: true });
    this.container.add(btn);
    this.container.add(this.scene.add.text(x, y, label, {
      fontSize: '13px', fill: '#ffffff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));
    return btn;
  }

  _refreshBalance() {
    this.balanceText.setText(`💰 ${this.save.gold || 0}    💎 ${this.save.diamond || 0}`);
  }

  _doPull(poolId, count) {
    const pool = this.gacha.getPool(poolId);
    const cost = this.gacha.getCost(poolId, count);
    if ((this.save[pool.currency] || 0) < cost) {
      this.scene.cameras.main.flash(150, 255, 60, 60);
      return;
    }
    // 扣费（GachaSystem 校验+执行抽取）
    const rng = { next: () => Math.random() };
    const r = this.gacha.pull(poolId, count, this.save, rng);
    if (!r) { this.scene.cameras.main.flash(150, 255, 60, 60); return; }
    this._refreshBalance();
    this.onPersist?.();
    this._showResults(r.results, r.pityTriggered);
  }

  _showResults(results, pityTriggered) {
    this.resultContainer.removeAll(true);
    const cx = GAME_WIDTH / 2;
    const baseY = 430;
    const results2 = results.slice(0, 10);
    const cols = results2.length <= 1 ? 1 : results2.length <= 4 ? 2 : 5;
    const rows = Math.ceil(results2.length / cols);
    const cellW = 92, cellH = 110;

    if (pityTriggered) {
      this.resultContainer.add(this.scene.add.text(cx, baseY - rows * cellH / 2 - 26, '✨ 保底触发！', {
        fontSize: '15px', fill: '#ff88ff', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0.5));
    }

    results2.forEach((res, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const x = cx + (col - (cols - 1) / 2) * (cellW + 6);
      const y = baseY + row * (cellH + 8);
      const rc = RARITY_COLORS[res.item.rarity] || RARITY_COLORS.white;
      const card = this.scene.add.rectangle(x, y, cellW, cellH, 0x1a2030);
      card.setStrokeStyle(2, rc.border);
      this.resultContainer.add(card);
      this.resultContainer.add(this.scene.add.text(x, y - 26, rc.label, {
        fontSize: '11px', fill: rc.color, fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0.5));
      const eq = res.item.mercId
        ? { name: `${res.item.mercIcon} ${res.item.mercName}` }
        : this.gacha.resolveEquipment(res.item.refId);
      this.resultContainer.add(this.scene.add.text(x, y, res.item.mercId ? '佣兵!' : (eq?.name ?? res.item.refId), {
        fontSize: '11px', fill: res.item.mercId ? '#ffcc88' : '#ffffff', fontFamily: 'Arial',
        wordWrap: { width: cellW - 12 }, align: 'center',
      }).setOrigin(0.5));
      this.resultContainer.add(this.scene.add.text(x, y + 34,
        res.item.mercId
          ? (res.isNew ? 'NEW 佣兵!' : `碎片+${res.mercShards}`)
          : (res.isNew ? 'NEW!' : `重复→+${res.refund}G`), {
        fontSize: '10px', fill: res.isNew ? '#88ff88' : '#ffcc66', fontFamily: 'Arial',
      }).setOrigin(0.5));
      // 逐张弹出
      card.setAlpha(0).setScale(0.6);
      this.scene.tweens.add({ targets: [card], alpha: 1, scale: 1, delay: i * 90, duration: 200, ease: 'Back.easeOut' });
    });
  }

  destroy() {
    if (this.container) { this.container.destroy(); this.container = null; }
  }
}
