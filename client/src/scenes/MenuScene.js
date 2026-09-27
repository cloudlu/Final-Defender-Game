import Phaser from 'phaser';
import { LevelManager } from '../engine/LevelManager.js';
import { GlobalUpgradeSystem } from '../engine/GlobalUpgradeSystem.js';
import { GachaSystem } from '../engine/GachaSystem.js';
import { EquipmentForgeSystem } from '../engine/EquipmentForgeSystem.js';
import { MercenarySystem } from '../engine/MercenarySystem.js';
import { DailyRewardSystem } from '../engine/DailyRewardSystem.js';
import { VipSystem } from '../engine/VipSystem.js';
import { VipClient } from '../repository/VipClient.js';
import { GachaPanel } from '../ui/GachaPanel.js';
import { ForgePanel } from '../ui/ForgePanel.js';
import { TavernPanel } from '../ui/TavernPanel.js';
import { DailyPanel } from '../ui/DailyPanel.js';
import { VipPanel } from '../ui/VipPanel.js';
import { SyncedSaveRepository } from '../repository/SyncedSaveRepository.js';
import { paintBattleBackground } from '../ui/BackgroundPainter.js';
import { loadGameConfigs } from '../data/loadGameConfigs.js';

const LEVEL_SAVE_KEY = 'lastline_levelsave';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('MenuScene');
  }

  create() {
    const { width, height } = this.cameras.main;
    const cx = width / 2;
    const cfg = loadGameConfigs();

    // 菜单背景：复用战场背景图（有夜空/城市剪影/月亮），加深色遮罩保证文字可读
    if (!this.textures.exists('battle_bg')) {
      paintBattleBackground(this);
    }
    this.add.image(0, 0, 'battle_bg').setOrigin(0, 0);
    this.add.rectangle(cx, height / 2, width, height, 0x0a0a18, 0.62);

    // 读取本地关卡进度
    let save = null;
    try {
      const raw = localStorage.getItem(LEVEL_SAVE_KEY);
      save = raw ? JSON.parse(raw) : null;
    } catch { save = null; }
    this.levelManager = new LevelManager(cfg.levelsConfig, save);
    this.eliteMode = false;

    // 全局强化（Meta 层）——存档缺省时先建骨架，再挂子模块引用（保证同一引用持久化）
    let globalSave = null;
    try {
      const raw = localStorage.getItem('lastline_globalsave');
      globalSave = raw ? JSON.parse(raw) : null;
    } catch { globalSave = null; }
    globalSave = globalSave || { levels: {} };
    globalSave.equipment = globalSave.equipment || { inventory: [], nextUid: 1 };
    globalSave.equipped = globalSave.equipped || {};
    globalSave.daily = globalSave.daily || { lastClaimDate: null, streakDay: 0 };
    globalSave.vip = globalSave.vip || { vipLevel: 0, vipExp: 0, goldBonus: 0 };
    this.globalUpgrades = new GlobalUpgradeSystem(cfg.globalUpgrades, globalSave);
    this.forgeSystem = new EquipmentForgeSystem(cfg.equipment, globalSave.equipment);
    globalSave.mercs = globalSave.mercs || { owned: {}, deployed: [null, null] };
    this.mercenarySystem = new MercenarySystem(cfg.mercenaries, globalSave.mercs);
    this.gachaSystem = new GachaSystem(cfg.equipment, globalSave, undefined, this.forgeSystem, null, this.mercenarySystem);
    this.dailySystem = new DailyRewardSystem(cfg.balance, globalSave.daily);
    this.vipSystem = new VipSystem(globalSave.vip);
    this.vipClient = new VipClient();
    // 远端 VIP 信息异步刷新（服务端不可达则静默保留缓存）
    this.vipClient.getVipInfo().then(info => {
      if (info) {
        this.vipSystem.setInfo(info);
        globalSave.vip = { vipLevel: info.vipLevel, vipExp: info.vipExp, goldBonus: info.goldBonus };
        this._persistGlobalMenuSave();
      }
    });
    // 远端存档同步（远端优先，无则本地；加载后并入 globalSave 持久化通道）
    this.saveRepo = new SyncedSaveRepository();
    this.saveRepo.load(1).then(remote => {
      if (remote?.global && remote.global.gold > (globalSave.gold || 0)) {
        // 远端全局档更新者胜（金币对比的最简合并策略）
        Object.assign(globalSave, remote.global);
        this.scene.restart();
      }
    });
    this._remoteGlobal = remote => this.saveRepo.save(1, { global: remote, version: 2 });

    // 标题
    this.add.text(cx, 70, '最 后 防 线', {
      fontSize: '46px', fill: '#00ccff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.add.text(cx, 112, '弹幕射击 · Roguelike', {
      fontSize: '13px', fill: '#666688', fontFamily: 'Arial',
    }).setOrigin(0.5);

    // 关卡列表
    const levels = this.levelManager.getLevelList();
    const startY = 175;
    const rowH = 92;
    levels.forEach((lv, i) => {
      this._levelCard(cx, startY + i * rowH, lv, cfg.levelsConfig.elite);
    });

    // 精英开关（通关全部关卡后可用）
    if (this.levelManager.isEliteUnlocked()) {
      const eliteY = startY + levels.length * rowH + 16;
      this.eliteBtn = this.add.rectangle(cx, eliteY, 320, 40, 0x553322)
        .setInteractive({ useHandCursor: true });
      this.eliteText = this.add.text(cx, eliteY, '💀 精英难度：关', {
        fontSize: '14px', fill: '#ff9955', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0.5);
      this.eliteBtn.on('pointerdown', () => {
        this.eliteMode = !this.eliteMode;
        this.eliteText.setText(`💀 精英难度：${this.eliteMode ? '开' : '关'}`);
        this.eliteBtn.setFillStyle(this.eliteMode ? 0xaa4411 : 0x553322);
      });
    }

    // 操作说明 + 强化入口
    const helpY = height - 66;
    this.add.text(cx, helpY - 18, [
      '操作：点技能图标选中 → 点场地施放（1-6 快捷键）',
      '击杀攒经验，升级三选一强化。守住城墙！',
    ].join('\n'), {
      fontSize: '11px', fill: '#556677', fontFamily: 'Arial', align: 'center', lineSpacing: 5,
    }).setOrigin(0.5);

    // 金币 + 强化 + 抽卡按钮
    const goldY = height - 34;
    this.menuGold = (save && save.gold) || 0;
    this.add.text(cx - 110, goldY, `💰 ${this.globalUpgrades.save.gold || 0}`, {
      fontSize: '15px', fill: '#ffd700', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.add.text(cx - 110, goldY + 16, `💎 ${this.globalUpgrades.save.diamond || 0}`, {
      fontSize: '12px', fill: '#88ccff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5);

    const upBtn = this.add.rectangle(cx + 20, goldY, 110, 30, 0x6644aa)
      .setInteractive({ useHandCursor: true });
    this.add.text(cx + 20, goldY, '⚡ 强化', {
      fontSize: '14px', fill: '#ffffff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5);
    upBtn.on('pointerdown', () => this._showUpgradePanel());

    const gachaBtn = this.add.rectangle(cx + 145, goldY, 110, 30, 0xaa5588)
      .setInteractive({ useHandCursor: true });
    this.add.text(cx + 145, goldY, '🎰 抽卡', {
      fontSize: '14px', fill: '#ffffff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5);
    gachaBtn.on('pointerdown', () => {
      if (this._gachaPanel) return;
      this._gachaPanel = new GachaPanel(this, this.gachaSystem, this.globalUpgrades.save, {
        onClose: () => { this._gachaPanel = null; this.scene.restart(); },
        onPersist: () => this._persistGlobalMenuSave(),
      });
    });

    const forgeBtn = this.add.rectangle(cx - 215, goldY, 90, 30, 0x3377aa)
      .setInteractive({ useHandCursor: true });
    this.add.text(cx - 215, goldY, '🔧 锻造', {
      fontSize: '14px', fill: '#ffffff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5);
    forgeBtn.on('pointerdown', () => {
      if (this._forgePanel) return;
      this._forgePanel = new ForgePanel(this, this.forgeSystem, this.globalUpgrades.save, {
        onClose: () => { this._forgePanel = null; this.scene.restart(); },
        onPersist: () => this._persistGlobalMenuSave(),
      });
    });

    const petBtn = this.add.rectangle(cx + 255, goldY, 90, 30, 0xcc8833)
      .setInteractive({ useHandCursor: true });
    this.add.text(cx + 255, goldY, '🍺 酒馆', {
      fontSize: '14px', fill: '#ffffff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5);
    petBtn.on('pointerdown', () => {
      if (this._tavernPanel) return;
      this._tavernPanel = new TavernPanel(this, this.mercenarySystem, this.globalUpgrades.save, {
        onClose: () => { this._tavernPanel = null; this.scene.restart(); },
        onPersist: () => this._persistGlobalMenuSave(),
      });
    });

    // 签到按钮（有可领奖励时闪烁提醒）
    const dailyBtn = this.add.rectangle(cx - 320 < 40 ? 40 : cx - 215, goldY - 40, 90, 30, 0x228866)
      .setInteractive({ useHandCursor: true });
    this.add.text(cx - 215, goldY - 40, '📅 签到', {
      fontSize: '14px', fill: '#ffffff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5);
    dailyBtn.on('pointerdown', () => this._openDailyPanel());

    // VIP 按钮
    const vipBtn = this.add.rectangle(cx + 215, goldY - 40, 90, 30, 0xaa8822)
      .setInteractive({ useHandCursor: true });
    this.vipBtnText = this.add.text(cx + 215, goldY - 40, `👑 VIP${this.vipSystem.level}`, {
      fontSize: '14px', fill: '#ffffff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5);
    vipBtn.on('pointerdown', () => this._openVipPanel());

    // 未领取 → 自动弹出
    if (this.dailySystem.canClaim()) {
      this.time.delayedCall(200, () => this._openDailyPanel());
    }

    this.add.text(cx, height - 8, 'v1.7', {
      fontSize: '11px', fill: '#333344', fontFamily: 'Arial',
    }).setOrigin(0.5);
  }

  _openDailyPanel() {
    if (this._dailyPanel) return;
    this._dailyPanel = new DailyPanel(this, this.dailySystem, this.globalUpgrades.save, {
      onClose: () => { this._dailyPanel = null; this.scene.restart(); },
      onPersist: () => this._persistGlobalMenuSave(),
    });
  }

  /** 全局强化面板：金币购买永久属性 */
  _showUpgradePanel() {
    if (this._upgradeContainer) { this._upgradeContainer.destroy(); this._upgradeContainer = null; return; }
    const { width, height } = this.cameras.main;
    const c = this.add.container(0, 0).setDepth(400);
    this._upgradeContainer = c;
    c.add(this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.85)
      .setInteractive());
    c.add(this.add.text(width / 2, 60, '⚡ 全局强化', {
      fontSize: '24px', fill: '#ffdd44', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));
    this.panelGoldText = this.add.text(width / 2, 95, `💰 ${this.globalUpgrades.save.gold || 0}`, {
      fontSize: '16px', fill: '#ffd700', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5);
    c.add(this.panelGoldText);

    const listY = 140;
    const rowH = 68;
    this.globalUpgrades.configs.forEach((up, i) => {
      const y = listY + i * rowH;
      const lv = this.globalUpgrades.getLevel(up.id);
      const cost = this.globalUpgrades.getNextCost(up.id);
      const maxed = cost === null;

      const row = this.add.rectangle(width / 2, y, 480, 58, 0x22283f).setInteractive({ useHandCursor: true });
      row.setStrokeStyle(1, 0x445577);
      c.add(row);
      c.add(this.add.text(width / 2 - 225, y - 12, `${up.icon} ${up.name}`, {
        fontSize: '15px', fill: '#ffffff', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0, 0.5));
      c.add(this.add.text(width / 2 - 225, y + 12, `${up.description} · Lv.${lv}/${up.maxLevel}`, {
        fontSize: '11px', fill: '#8899bb', fontFamily: 'Arial',
      }).setOrigin(0, 0.5));

      const btnColor = maxed ? 0x444466 : 0x00aa44;
      const btn = this.add.rectangle(width / 2 + 165, y, 130, 40, btnColor)
        .setInteractive({ useHandCursor: !maxed });
      c.add(btn);
      c.add(this.add.text(width / 2 + 165, y, maxed ? 'MAX' : `⬆ ${cost}G`, {
        fontSize: '14px', fill: '#ffffff', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0.5));

      if (!maxed) {
        btn.on('pointerdown', () => {
          const r = this.globalUpgrades.upgradeAndPay(up.id, this.globalUpgrades.save);
          if (r.success) {
            this._persistGlobalMenuSave();
            // 刷新面板
            this._upgradeContainer.destroy();
            this._upgradeContainer = null;
            this._showUpgradePanel();
          } else if (r.reason === 'poor') {
            // 余额不足闪红提示
            this.panelGoldText.setColor('#ff4444');
            this.time.delayedCall(400, () => this.panelGoldText.setColor('#ffd700'));
          }
        });
      }
    });

    c.add(this.add.text(width / 2, height - 30, '点击空白处关闭', {
      fontSize: '11px', fill: '#667', fontFamily: 'Arial',
    }).setOrigin(0.5));
    c.list[0].on('pointerdown', () => { c.destroy(); this._upgradeContainer = null; });
  }

  _persistGlobalMenuSave() {
    try {
      localStorage.setItem('lastline_globalsave', JSON.stringify(this.globalUpgrades.save));
      this._remoteGlobal?.(this.globalUpgrades.save); // 异步双写远端
    } catch { /* ignore */ }
  }

  _openVipPanel() {
    if (this._vipPanel) return;
    this._vipPanel = new VipPanel(this, this.vipSystem, this.vipClient, {
      onClose: () => { this._vipPanel = null; this._domCleanup(); this.scene.restart(); },
      onPersist: () => this._persistGlobalMenuSave(),
      onVipUpdate: () => { /* 特权即时生效（modifiers 每次 getResolvedStats 重算） */ },
    });
    this._vipPanel.saveDiamonds = (amount) => {
      this.globalUpgrades.save.diamond = (this.globalUpgrades.save.diamond || 0) + amount;
    };
  }

  _domCleanup() {
    document.querySelectorAll('input[style*="z-index:999"]').forEach(el => el.remove());
  }

  _levelCard(cx, y, lv, eliteCfg) {
    const locked = !lv.unlocked;
    // 卡片皮肤（圆角+描边+阴影）
    const cardG = this.add.graphics();
    const drawCard = (fill, border) => {
      cardG.clear();
      cardG.fillStyle(0x000000, 0.35);
      cardG.fillRoundedRect(cx - 230, y - 39 + 3, 460, 78, 12);
      cardG.fillStyle(fill, 0.95);
      cardG.fillRoundedRect(cx - 230, y - 39, 460, 78, 12);
      cardG.lineStyle(2, border, 0.95);
      cardG.strokeRoundedRect(cx - 230, y - 39, 460, 78, 12);
      cardG.fillStyle(0xffffff, 0.08);
      cardG.fillRoundedRect(cx - 228, y - 37, 456, 26, { tl: 12, tr: 12, bl: 0, br: 0 });
    };
    drawCard(locked ? 0x181826 : 0x1d2c45, locked ? 0x2a2a3c : 0x3d6a9a);
    const card = this.add.rectangle(cx, y, 460, 78, 0xffffff, 0)
      .setInteractive({ useHandCursor: !locked });
    card.setStrokeStyle(0);

    // 关卡号
    this.add.text(cx - 210, y - 22, lv.id, {
      fontSize: '20px', fill: locked ? '#444460' : '#ffcc44', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0, 0.5);

    // 名称 + 波数
    this.add.text(cx - 140, y - 22, locked ? '？？？？？' : lv.name, {
      fontSize: '18px', fill: locked ? '#444460' : '#ffffff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0, 0.5);
    this.add.text(cx - 140, y + 8, locked ? '通关上一关解锁' : `${lv.waves} 波 · 难度 x${lv.difficulty}`, {
      fontSize: '11px', fill: locked ? '#383850' : '#8888aa', fontFamily: 'Arial',
    }).setOrigin(0, 0.5);

    // 星级
    const starTxt = '⭐'.repeat(lv.stars) + '☆'.repeat(Math.max(0, 3 - lv.stars));
    this.add.text(cx + 130, y - 20, locked ? '' : starTxt, {
      fontSize: '15px',
    }).setOrigin(0, 0.5);

    // 精英通关标记
    if (!locked && this.levelManager.save.cleared[`${lv.id}:elite`]) {
      this.add.text(cx + 130, y + 8, '💀精英✓', {
        fontSize: '11px', fill: '#ff8855', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0, 0.5);
    }

    if (!locked) {
      card.on('pointerover', () => drawCard(0x24385c, 0x55a0e0));
      card.on('pointerout', () => drawCard(0x1d2c45, 0x3d6a9a));
      card.on('pointerdown', () => {
        this.registry.set('selectedLevel', lv.id);
        this.registry.set('eliteMode', this.eliteMode);
        this.scene.start('GameScene');
      });
    }
  }
}
