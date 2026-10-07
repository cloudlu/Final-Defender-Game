import Phaser from 'phaser';
import { LevelManager } from '../engine/LevelManager.js';
import { GlobalUpgradeSystem } from '../engine/GlobalUpgradeSystem.js';
import { GachaSystem } from '../engine/GachaSystem.js';
import { EquipmentForgeSystem } from '../engine/EquipmentForgeSystem.js';
import { MercenarySystem } from '../engine/MercenarySystem.js';
import { GameState } from '../engine/GameState.js';
import { VanguardPanel } from '../ui/VanguardPanel.js';
import { GemSystem } from '../engine/GemSystem.js';
import { DailyRewardSystem } from '../engine/DailyRewardSystem.js';
import { VipSystem } from '../engine/VipSystem.js';
import { VipClient } from '../repository/VipClient.js';
import { AuthClient } from '../repository/AuthClient.js';
import { AuthPanel } from '../ui/AuthPanel.js';
import { AccountPanel } from '../ui/AccountPanel.js';
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

    // ===== 登录门控（v9.0）：未登录显示登录/注册面板，登录后按用户槽位加载存档 =====
    // v9.13：会话恢复改异步 token 校验（/api/auth/me）——校验通过才渲染主菜单，否则显示登录面板
    this._bootAuth(cfg);
  }

  /** 登录门控（异步）：token 恢复成功 → 继续 create 主流程；否则显示 AuthPanel 并等待登录 */
  _bootAuth(cfg) {
    AuthClient.restore().then(session => {
      if (!session) {
        // 未登录/token 过期：显示登录/注册面板（登录成功后 restart 走正常流程）
        this.authPanel = new AuthPanel(this, {
          onAuthed: (username, slot) => {
            // v9.3b：走 Phaser 正规生命周期重启（手动调 create() 会在未 shutdown 状态下重入）
            this.scene.restart();
          },
        });
        return;
      }
      this.playerId = session.username;
      this.playerSlot = session.slot || 1;
      this._createAfterAuth(cfg);
    });
  }

  /** 登录后的主菜单构建（原 create() 主体，v9.13 拆分以便登录门控异步等待） */
  _createAfterAuth(cfg) {
    const { width, height } = this.cameras.main;
    const cx = width / 2;
    this.playerId = this.playerId || AuthClient.getSession()?.username || 'player1';
    this.playerSlot = this.playerSlot || AuthClient.getSession()?.slot || 1;;

    // 菜单背景：复用战场背景图（有夜空/城市剪影/月亮），加深色遮罩保证文字可读
    if (!this.textures.exists('battle_bg')) {
      paintBattleBackground(this);
    }
    this.add.image(0, 0, 'battle_bg').setOrigin(0, 0);
    this.add.rectangle(cx, height / 2, width, height, 0x0a0a18, 0.62);

    // 关卡进度（v9.3：无本地存储——远端到达前用空进度，到达后重启场景应用）
    this.levelManager = new LevelManager(cfg.levelsConfig, null);
    this.eliteMode = false;

    // 全局强化（Meta 层）——远端到达前用空骨架，远端到达后覆盖并重启场景
    let globalSave = { levels: {} };
    globalSave.equipment = globalSave.equipment || { inventory: [], nextUid: 1 };
    globalSave.equipped = globalSave.equipped || {};
    // 穿戴表消毒（同 GameScene）：单 uid + 合法六部位
    {
      const VALID = ['weapon', 'helmet', 'coat', 'bracers', 'pants', 'shoes'];
      for (const k of Object.keys(globalSave.equipped)) {
        if (!VALID.includes(k)) { delete globalSave.equipped[k]; continue; }
        if (Array.isArray(globalSave.equipped[k])) globalSave.equipped[k] = globalSave.equipped[k][0] ?? null;
        if (globalSave.equipped[k] == null) delete globalSave.equipped[k];
      }
    }
    globalSave.daily = globalSave.daily || { lastClaimDate: null, streakDay: 0 };
    globalSave.vip = globalSave.vip || { vipLevel: 0, vipExp: 0, goldBonus: 0 };
    this.globalUpgrades = new GlobalUpgradeSystem(cfg.globalUpgrades, globalSave);
    this._rebindSystems(cfg);
    this.vipSystem = new VipSystem(globalSave.vip);
    this.vipClient = new VipClient(this.playerId); // 按账号隔离 VIP 档案
    // 远端 VIP 信息异步刷新（服务端不可达则静默保留缓存）
    // v9.2b：_remoteLoaded 闸门——远端档加载完成前禁止任何持久化（防空骨架覆盖远端有效数据）
    this._remoteLoaded = false;
    this.vipClient.getVipInfo().then(info => {
      if (info && this._remoteLoaded) {
        this.vipSystem.setInfo(info);
        globalSave.vip = { vipLevel: info.vipLevel, vipExp: info.vipExp, goldBonus: info.goldBonus };
        this._persistGlobalMenuSave();
      }
    });
    // 远端存档加载（v9.3 纯远端：到达即应用并重启场景；无远端数据=新号空进度）
    // v9.2b 防覆盖：空骨架（无 gold 字段=从未游玩）不得反向推送覆盖远端有效数据
    this.saveRepo = new SyncedSaveRepository();
    const isEmptySkeleton = (g) => g && g.gold === undefined && (g.equipment?.inventory?.length ?? 0) === 0;
    // v9.3c 防重启循环：远端档已在本次会话应用过则不再 load→restart
    // 重启场景时远端数据经 registry 传递（create 局部变量不跨 restart 存活）
    const remoteAppliedKey = 'remoteApplied_' + (this.playerSlot || 1);
    const remoteDataKey = 'remoteData_' + (this.playerSlot || 1);
    if (this.registry.get(remoteAppliedKey)) {
      // 已应用：从 registry 取远端数据作为起点（restart 后 create 的空骨架 ← registry 数据）
      const cached = this.registry.get(remoteDataKey);
      if (cached) Object.assign(globalSave, cached);
      this._rebindSystems(cfg); // v9.3d：重挂子系统引用（否则子系统持有旧空对象）
      if (this.registry.get('levelProgress')) {
        this.levelManager = new LevelManager(cfg.levelsConfig, this.registry.get('levelProgress'));
      }
      this._remoteLoaded = true;
    } else {
      this.saveRepo.load(this.playerSlot || 1).then(remote => {
        this._remoteLoaded = true; // 闸门开：此后持久化合法
        if (remote?.global) {
          this.registry.set(remoteAppliedKey, true);
          this.registry.set(remoteDataKey, remote.global);
          Object.assign(globalSave, remote.global);
          // 关卡进度从远端回填
          if (remote.global.levelProgress) {
            this.levelManager = new LevelManager(cfg.levelsConfig, remote.global.levelProgress);
            this.registry.set('levelProgress', remote.global.levelProgress);
          }
          this.scene.restart(); // 重建场景应用远端数据
          return;
        }
        // 远端无档（新号）→ 本地骨架有游玩数据时才初始化远端档
        this.registry.set(remoteAppliedKey, true);
        if (!isEmptySkeleton(globalSave)) {
          this.saveRepo.save(this.playerSlot || 1, { global: globalSave, version: 2 });
        }
      });
    }

    // 标题
    this.add.text(cx, 70, '最 后 防 线', {
      fontSize: '46px', fill: '#00ccff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.add.text(cx, 112, '弹幕射击 · Roguelike', {
      fontSize: '13px', fill: '#666688', fontFamily: 'Arial',
    }).setOrigin(0.5);

    // ===== 两级选关（v8.8 原版式）：章节图卡 → 章内小关（左右滑动翻页） =====
    this._buildLevelSelect(cfg.levelsConfig.elite);

    // ===== 底部统一布局（v8.16 两行栅格，全元素核算入 540 宽）=====
    // 资源行（y=height-118=842）：💰 💎 ⚡战力 一行三段
    // 次行按钮（y=height-82=878）：签到 / VIP / 属性
    // 主行按钮（y=height-44=916）：装备·宝石 / 强化 / 抽卡 / 酒馆
    // 页脚（y=height-10=950）：操作说明单行（原两行块占 858~894 与按钮区冲突，按用户建议移到按钮后）
    // 复用 create() 顶部已声明的 width/height/cx（v8.17 修复：此处重复 const 声明致 SyntaxError 白屏）
    const rowBtnY = height - 82;
    const mainBtnY = height - 44;
    const resY = height - 118;

    // 页脚操作说明（单行，按钮后方）
    this.add.text(cx, height - 10, '操作：点技能图标选中 → 点场地施放（1-6 快捷键）· 击杀攒经验升级三选一', {
      fontSize: '10px', fill: '#556677', fontFamily: 'Arial', align: 'center',
    }).setOrigin(0.5);

    // --- 资源行：💰/💎/⚡ 一行三段 ---
    this.menuGold = this.globalUpgrades.save.gold || 0; // v9.3：save 局部变量已随 localStorage 移除，直接读全局档
    {
      const lightState = new GameState(cfg.enemies, cfg.balance, cfg.equipment, null, {
        globalUpgrades: this.globalUpgrades,
        forgeSystem: this.forgeSystem,
        equippedMap: this.globalUpgrades.save.equipped || {},
        mercenarySystem: this.mercenarySystem,
        gemSystem: this.gemSystem,
        vipSystem: this.vipSystem,
      });
      const segX = [cx - 180, cx, cx + 180];
      this.add.text(segX[0], resY, `💰 ${this.globalUpgrades.save.gold || 0}`, {
        fontSize: '14px', fill: '#ffd700', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0.5);
      this.add.text(segX[1], resY, `💎 ${this.globalUpgrades.save.diamond || 0}`, {
        fontSize: '13px', fill: '#88ccff', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0.5);
      this.add.text(segX[2], resY, `⚡ 战力 ${lightState.getTotalPower()}`, {
        fontSize: '13px', fill: '#ffdd66', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0.5);
    }

    // --- 主行按钮 ×4（等宽 118，间距 8：总宽 4×118+3×8=496 ≤ 540）---
    const mkMainBtn = (idx, w, label, color, onClick) => {
      const total = 4 * 118 + 3 * 8;
      const x = cx - total / 2 + 118 / 2 + idx * (118 + 8);
      const b = this.add.rectangle(x, mainBtnY, w, 34, color).setInteractive({ useHandCursor: true });
      this.add.text(x, mainBtnY, label, {
        fontSize: '12.5px', fill: '#ffffff', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0.5);
      b.on('pointerdown', onClick);
      return b;
    };
    mkMainBtn(0, 118, '🔧 装备·宝石', 0x3377aa, () => {
      if (this._forgePanel) return;
      this._forgePanel = new ForgePanel(this, this.forgeSystem, this.globalUpgrades.save, {
        gemSystem: this.gemSystem,
        onClose: () => { this._forgePanel = null; },
        onPersist: () => this._persistGlobalMenuSave(),
      });
    });
    mkMainBtn(1, 118, '⚡ 强化', 0x6644aa, () => this._showUpgradePanel());
    mkMainBtn(2, 118, '🎰 抽卡', 0xaa5588, () => {
      if (this._gachaPanel) return;
      this._gachaPanel = new GachaPanel(this, this.gachaSystem, this.globalUpgrades.save, {
        onClose: () => { this._gachaPanel = null; },
        onPersist: () => this._persistGlobalMenuSave(),
      });
    });
    mkMainBtn(3, 118, '🍺 酒馆', 0xcc8833, () => {
      if (this._tavernPanel) return;
      this._tavernPanel = new TavernPanel(this, this.mercenarySystem, this.globalUpgrades.save, {
        forgeRef: this.forgeSystem,
        onClose: () => { this._tavernPanel = null; },
        onPersist: () => this._persistGlobalMenuSave(),
      });
    });

    // --- 次行按钮 ×4（等宽 96，间距 10：总宽 4×96+3×10=414 ≤ 540）---
    const mkSubBtn = (idx, label, color, onClick) => {
      const total = 4 * 96 + 3 * 10;
      const x = cx - total / 2 + 96 / 2 + idx * (96 + 10);
      const b = this.add.rectangle(x, rowBtnY, 96, 30, color).setInteractive({ useHandCursor: true });
      this.add.text(x, rowBtnY, label, {
        fontSize: '12.5px', fill: '#ffffff', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0.5);
      b.on('pointerdown', onClick);
      return b;
    };
    mkSubBtn(0, `📅 签到`, 0x228866, () => this._openDailyPanel());
    this.vipBtnText = mkSubBtn(1, `👑 VIP${this.vipSystem.level}`, 0xaa8822, () => this._openVipPanel());
    mkSubBtn(2, '📊 属性', 0x446688, () => this._openVanguardPanel());
    mkSubBtn(3, `⚙️ 账号`, 0x556677, () => this._openAccountPanel());

    // 未领取 → 自动弹出
    if (this.dailySystem.canClaim()) {
      this.time.delayedCall(200, () => this._openDailyPanel());
    }

    this.add.text(cx, height - 8, 'v1.7', {
      fontSize: '11px', fill: '#333344', fontFamily: 'Arial',
    }).setOrigin(0.5);
  }

  /** ⚙️ 账号设置（修改密码 / 删除账号 / 退出登录） */
  _openAccountPanel() {
    if (this._accountPanel) return;
    this._accountPanel = new AccountPanel(this, this.playerId, {
      onClose: () => { this._accountPanel = null; this._domCleanup(); },
      onDeleted: () => {
        // 账号已删除：清会话回登录页
        AuthClient.clearSession();
        this._accountPanel = null;
        this._domCleanup();
        this.scene.restart();
      },
      onLogout: () => {
        // v9.12 退出登录：清会话 + 清 registry 远端标记（换号重新加载）
        this._accountPanel = null;
        this._domCleanup();
        this.registry.remove('remoteApplied_' + (this.playerSlot || 1));
        this.registry.remove('remoteData_' + (this.playerSlot || 1));
        this.registry.remove('levelProgress');
        this.registry.remove('globalSave');
        this.registry.remove('playerSlot');
        this.registry.remove('playerId');
        this.scene.restart(); // session 已清 → 走登录面板分支
      },
    });
  }

  /**
   * 子系统绑定（v9.3d）：以当前 globalSave 的子对象引用重建全部 Meta 子系统。
   * 远端数据应用（Object.assign 替换顶层子对象）后必须重调——否则子系统持有旧空对象引用，
   * 表现为"装备/宝石/佣兵消失、签到状态不更新"（v9.3c 用户报告的根因）。
   */
  _rebindSystems(cfg) {
    const globalSave = this.globalUpgrades.save;
    globalSave.equipment = globalSave.equipment || { inventory: [], nextUid: 1 };
    globalSave.equipped = globalSave.equipped || {};
    globalSave.mercs = globalSave.mercs || { owned: {}, deployed: [null, null] };
    globalSave.gems = globalSave.gems || { collection: {}, sockets: {}, nextUid: 1 };
    globalSave.daily = globalSave.daily || { lastClaimDate: null, streakDay: 0 };
    globalSave.vip = globalSave.vip || { vipLevel: 0, vipExp: 0, goldBonus: 0 };
    this.forgeSystem = new EquipmentForgeSystem(cfg.equipment, globalSave.equipment);
    this.mercenarySystem = new MercenarySystem(cfg.mercenaries, globalSave.mercs);
    this.gemSystem = new GemSystem(undefined, globalSave.gems);
    // GachaSystem(equipmentConfigs, save, config, forgeSystem, mercenarySystem, gemSystem)
    this.gachaSystem = new GachaSystem(cfg.equipment, globalSave, undefined, this.forgeSystem, this.mercenarySystem, this.gemSystem);
    this.dailySystem = new DailyRewardSystem(cfg.balance, globalSave.daily);
  }

  _openDailyPanel() {
    if (this._dailyPanel) return;
    this._dailyPanel = new DailyPanel(this, this.dailySystem, this.globalUpgrades.save, {
      onClose: () => { this._dailyPanel = null; },
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
    // v9.2b：远端档未加载完成前禁止持久化（空骨架会覆盖远端有效数据）
    if (!this._remoteLoaded) return;
    if (this.levelManager) this.globalUpgrades.save.levelProgress = this.levelManager.save;
    const save = { global: this.globalUpgrades.save, version: 2 };
    // 同步 registry 缓存（面板重启后以此为起点）
    this.registry.set('remoteData_' + (this.playerSlot || 1), this.globalUpgrades.save);
    this.registry.set('levelProgress', this.levelManager?.save || null);
    this.saveRepo.save(this.playerSlot || 1, save);
  }

  /** 📊 先锋官属性明细面板（组装各系统 breakdown） */
  _openVanguardPanel() {
    if (this._vanguardPanel) return;
    // 轻量 GameState 实例（无战斗 runtime，只为 getBonusBreakdown）。
    // cfg 自行加载（v8.18 修复：原引用 create() 局部变量，点📊按钮 ReferenceError）
    const cfg = loadGameConfigs();
    const lightState = new GameState(cfg.enemies, cfg.balance, cfg.equipment, null, {
      globalUpgrades: this.globalUpgrades,
      forgeSystem: this.forgeSystem,
      equippedMap: this.globalUpgrades.save.equipped || {},
      mercenarySystem: this.mercenarySystem,
      gemSystem: this.gemSystem,
      vipSystem: this.vipSystem,
    });
    const breakdown = lightState.getBonusBreakdown(); // 结构化对象 { power, stats, sources }
    // 穿戴摘要（结构化数组，面板内两列网格渲染）
    const SLOT_N = { weapon: '武器', helmet: '头盔', coat: '衣服', bracers: '护臂', pants: '腰饰', shoes: '鞋子' };
    const QN = { white: '白', green: '绿', blue: '蓝', purple: '紫', orange: '橙', red: '红', rainbow: '彩' };
    const QN_COLOR = { white: '#aaaaaa', green: '#66cc66', blue: '#4488ff', purple: '#aa44ff', orange: '#ff8800', red: '#ff4444', rainbow: '#ff44dd' };
    const AFFIX_CN = {
      damage: '伤害', attackSpeed: '攻速', critRate: '暴击率', critDamage: '暴击伤害',
      baseAttack: '攻击力', wallHp: '防线血量', gunDamage: '枪械伤害',
      element_fire: '火系', element_ice: '冰系', element_electric: '电系',
      element_wind: '风系', element_physical: '物理系', element_energy: '能量系',
      debuffTargetDamage: '对负面怪', highHpTargetDamage: '对高血怪', eliteDamage: '对精英',
      explodeDamage: '爆炸', lowHpWallDamage: '残墙',
    };
    const equippedList = ['weapon', 'helmet', 'coat', 'bracers', 'pants', 'shoes'].map(slot => {
      const uid = (this.globalUpgrades.save.equipped || {})[slot];
      const entry = uid != null ? this.forgeSystem.save.inventory.find(i => i.uid === uid) : null;
      if (!entry) return { slot: SLOT_N[slot], empty: true };
      return {
        slot: SLOT_N[slot],
        empty: false,
        quality: QN[entry.quality] || '?',
        qColor: QN_COLOR[entry.quality] || '#fff',
        tier: entry.tier,
        affixes: (entry.affixes || []).slice(0, 2).map(a => `${AFFIX_CN[a.name] || AFFIX_CN[a.stat] || a.name || a.stat}+${a.pct ? Math.round(a.value * 100) / 100 + '%' : a.value}`),
      };
    });
    this._vanguardPanel = new VanguardPanel(this, breakdown, equippedList, {
      onClose: () => { this._vanguardPanel = null; },
    });
  }

  _openVipPanel() {
    if (this._vipPanel) return;
    this._vipPanel = new VipPanel(this, this.vipSystem, this.vipClient, {
      onClose: () => { this._vipPanel = null; this._domCleanup(); },
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

  /** 章节主题（图片式选择卡；章号 → 视觉主题） */
  static CHAPTERS = [
    { id: 'S1', name: '荒郊夜袭', icon: '🌃', color: 0x1d3a5c, accent: '#55a0e0' },
    { id: 'S2', name: '隧道突围', icon: '🚇', color: 0x3a2a1d, accent: '#e0a055' },
    { id: 'S3', name: '城区巷战', icon: '🏙️', color: 0x2a1d3a, accent: '#a055e0' },
    { id: 'S4', name: '核心决战', icon: '☢️', color: 0x3a1d22, accent: '#e05570' },
  ];

  /**
   * 两级选关（v8.8）：章节图卡视图 ⇄ 章内小关翻页视图。
   * 章内每页 4 关，◀ ▶ 箭头 + 左右滑动（≥60px 翻页）。
   * 所有 UI 对象统一挂 _levelSelectRoot：翻页/切章 = removeAll(true) 重建，无泄漏。
   */
  _buildLevelSelect(eliteCfg) {
    this._chapterIdx = null; // null = 章节视图；数字 = 章内视图
    this._page = 0;
    this._levelSelectRoot = this.add.container(0, 0);
    this._renderLevelSelect(eliteCfg);
  }

  _renderLevelSelect(eliteCfg) {
    this._levelSelectRoot.removeAll(true);
    const root = this._levelSelectRoot;
    const { width } = this.cameras.main;
    const cx = width / 2;
    const chapters = MenuScene.CHAPTERS;
    const allLevels = this.levelManager.getLevelList();
    const goto = (view) => { this._chapterIdx = view; this._page = 0; this._renderLevelSelect(eliteCfg); };

    // ===== 视图 A：章节图卡 =====
    if (this._chapterIdx === null) {
      root.add(this.add.text(cx, 148, '选 择 章 节', {
        fontSize: '16px', fill: '#88aacc', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0.5));
      const cardW = 118, cardH = 150, gap = 14;
      const startX = cx - (chapters.length * (cardW + gap) - gap) / 2 + cardW / 2;
      chapters.forEach((ch, i) => {
        const x = startX + i * (cardW + gap);
        const y = 250;
        const levels = allLevels.filter(l => l.id.startsWith(ch.id));
        const cleared = levels.filter(l => this.levelManager.save.cleared[l.id]).length;
        const unlocked = levels.some(l => l.unlocked);
        const isCurrent = cleared > 0 && cleared < levels.length;

        const g = this.add.graphics();
        g.fillStyle(0x000000, 0.4);
        g.fillRoundedRect(x - cardW / 2 + 3, y - cardH / 2 + 4, cardW, cardH, 14);
        g.fillStyle(unlocked ? ch.color : 0x1a1a26, 0.97);
        g.fillRoundedRect(x - cardW / 2, y - cardH / 2, cardW, cardH, 14);
        g.lineStyle(3, unlocked ? 0xffffff : 0x2a2a3c, unlocked ? 0.25 : 1);
        g.strokeRoundedRect(x - cardW / 2, y - cardH / 2, cardW, cardH, 14);
        g.fillStyle(0xffffff, 0.07);
        g.fillRoundedRect(x - cardW / 2 + 2, y - cardH / 2 + 2, cardW - 4, 40, { tl: 12, tr: 12, bl: 0, br: 0 });
        const progress = levels.length ? cleared / levels.length : 0;
        g.fillStyle(0x000000, 0.5);
        g.fillRoundedRect(x - cardW / 2 + 10, y + cardH / 2 - 22, cardW - 20, 8, 4);
        g.fillStyle(unlocked ? 0xffcc44 : 0x334455, 1);
        if (progress > 0) g.fillRoundedRect(x - cardW / 2 + 10, y + cardH / 2 - 22, Math.max(8, (cardW - 20) * progress), 8, 4);
        root.add(g);

        root.add(this.add.text(x, y - 40, unlocked ? ch.icon : '🔒', { fontSize: '34px' }).setOrigin(0.5));
        root.add(this.add.text(x, y + 4, ch.id, {
          fontSize: '18px', fill: unlocked ? '#ffcc44' : '#444460', fontFamily: 'Arial', fontStyle: 'bold',
        }).setOrigin(0.5));
        root.add(this.add.text(x, y + 28, unlocked ? ch.name : '？？？', {
          fontSize: '12px', fill: unlocked ? '#ffffff' : '#444460', fontFamily: 'Arial', fontStyle: 'bold',
        }).setOrigin(0.5));
        root.add(this.add.text(x, y + cardH / 2 - 36, unlocked ? `${cleared}/${levels.length} 关${isCurrent ? ' ●' : ''}` : '未解锁', {
          fontSize: '10px', fill: unlocked ? ch.accent : '#383850', fontFamily: 'Arial',
        }).setOrigin(0.5));

        const zone = this.add.rectangle(x, y, cardW, cardH, 0xffffff, 0)
          .setInteractive({ useHandCursor: unlocked });
        root.add(zone);
        zone.on('pointerdown', () => {
          if (!unlocked) { this._flashLocked(x, y); return; }
          goto(i);
        });
      });
      return;
    }

    // ===== 视图 B：章内小关（每页 6 关 · 2 列 × 3 行，滑动/箭头翻页） =====
    const ch = chapters[this._chapterIdx];
    const levels = allLevels.filter(l => l.id.startsWith(ch.id));
    const PER_PAGE = 6;
    const totalPages = Math.ceil(levels.length / PER_PAGE);
    this._page = Math.max(0, Math.min(this._page, totalPages - 1));

    // 返回章节
    const back = this.add.text(46, 148, '◀ 章节', {
      fontSize: '15px', fill: '#88aacc', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
    back.on('pointerdown', () => goto(null));
    root.add(back);

    root.add(this.add.text(cx, 148, `${ch.icon} ${ch.id} · ${ch.name}`, {
      fontSize: '16px', fill: ch.accent, fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));

    // 精英难度开关（解锁后显示，章内视图右上角）
    if (this.levelManager.isEliteUnlocked()) {
      this.eliteBtn = this.add.rectangle(cx + 205, 148, 88, 26, this.eliteMode ? 0xaa4411 : 0x553322)
        .setInteractive({ useHandCursor: true });
      root.add(this.eliteBtn);
      this.eliteText = this.add.text(cx + 205, 148, `💀精英:${this.eliteMode ? '开' : '关'}`, {
        fontSize: '11px', fill: '#ff9955', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0.5);
      root.add(this.eliteText);
      this.eliteBtn.on('pointerdown', () => {
        this.eliteMode = !this.eliteMode;
        this.eliteText.setText(`💀精英:${this.eliteMode ? '开' : '关'}`);
        this.eliteBtn.setFillStyle(this.eliteMode ? 0xaa4411 : 0x553322);
      });
    }

    // 本页关卡卡片（2 列 × 3 行；卡片窄版 460→224 宽由 _buildLevelCardInto 内部处理，此处布局）
    const pageLevels = levels.slice(this._page * PER_PAGE, (this._page + 1) * PER_PAGE);
    const colX = [cx - 117, cx + 117]; // 两列中心（卡宽 224）
    pageLevels.forEach((lv, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      this._buildLevelCardInto(root, colX[col], 225 + row * 100, lv);
    });

    // 翻页箭头 + 页码 + 滑动手势
    if (totalPages > 1) {
      const py = 660;
      const mkArrow = (x, label, dir, enabled) => {
        const a = this.add.text(x, py, label, {
          fontSize: '26px', fill: enabled ? '#ffcc44' : '#334', fontFamily: 'Arial', fontStyle: 'bold',
        }).setOrigin(0.5).setInteractive({ useHandCursor: enabled });
        if (enabled) a.on('pointerdown', () => { this._page += dir; this._renderLevelSelect(eliteCfg); });
        root.add(a);
      };
      mkArrow(cx - 140, '◀', -1, this._page > 0);
      root.add(this.add.text(cx, py, `${this._page + 1} / ${totalPages}`, {
        fontSize: '15px', fill: '#aabbcc', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0.5));
      mkArrow(cx + 140, '▶', 1, this._page < totalPages - 1);

      // 滑动手势挂在 root 最底层透明区（命中优先级低于卡片：卡片后注册先命中）
      const swipe = this.add.rectangle(cx, 400, width, 520, 0xffffff, 0)
        .setInteractive({ useHandCursor: false });
      let startX = null;
      swipe.on('pointerdown', (p) => { startX = p.x; });
      swipe.on('pointerup', (p) => {
        if (startX === null) return;
        const dx = p.x - startX;
        if (dx <= -60 && this._page < totalPages - 1) { this._page++; this._renderLevelSelect(eliteCfg); }
        else if (dx >= 60 && this._page > 0) { this._page--; this._renderLevelSelect(eliteCfg); }
        startX = null;
      });
      root.addAt(swipe, 0); // 底层：卡片 zone 在其后注册，命中测试优先
      this.children.bringToTop(root);
    }
  }

  /** 关卡卡片（窄版 224 宽，2 列布局；挂进指定容器，翻页统一清理） */
  _buildLevelCardInto(root, cx, y, lv) {
    const locked = !lv.unlocked;
    const W = 224, H = 88;
    const cardG = this.add.graphics();
    const drawCard = (fill, border) => {
      cardG.clear();
      cardG.fillStyle(0x000000, 0.35);
      cardG.fillRoundedRect(cx - W / 2, y - H / 2 + 3, W, H, 10);
      cardG.fillStyle(fill, 0.95);
      cardG.fillRoundedRect(cx - W / 2, y - H / 2, W, H, 10);
      cardG.lineStyle(2, border, 0.95);
      cardG.strokeRoundedRect(cx - W / 2, y - H / 2, W, H, 10);
      cardG.fillStyle(0xffffff, 0.08);
      cardG.fillRoundedRect(cx - W / 2 + 2, y - H / 2 + 2, W - 4, 24, { tl: 10, tr: 10, bl: 0, br: 0 });
    };
    drawCard(locked ? 0x181826 : 0x1d2c45, locked ? 0x2a2a3c : 0x3d6a9a);
    root.add(cardG);
    const card = this.add.rectangle(cx, y, W, H, 0xffffff, 0)
      .setInteractive({ useHandCursor: !locked });
    root.add(card);

    // 关卡号（短显示：S1-01 → 01）
    const shortId = lv.id.split('-')[1];
    root.add(this.add.text(cx - W / 2 + 12, y - 20, shortId, {
      fontSize: '19px', fill: locked ? '#444460' : '#ffcc44', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0, 0.5));
    // 名称（去前缀取主题词）
    const theme = (lv.name.split('·')[1] || lv.name).trim();
    root.add(this.add.text(cx - W / 2 + 12, y + 2, locked ? '？？？' : theme, {
      fontSize: '12px', fill: locked ? '#444460' : '#ffffff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0, 0.5));
    root.add(this.add.text(cx - W / 2 + 12, y + 22, locked ? '通关上一关解锁' : `${lv.waves}波 x${lv.difficulty}`, {
      fontSize: '9.5px', fill: locked ? '#383850' : '#8888aa', fontFamily: 'Arial',
    }).setOrigin(0, 0.5));
    // 星级 + 精英标记（右上）
    const starTxt = '⭐'.repeat(lv.stars) + '☆'.repeat(Math.max(0, 3 - lv.stars));
    root.add(this.add.text(cx + W / 2 - 10, y - 20, locked ? '' : starTxt, { fontSize: '12px' }).setOrigin(1, 0.5));
    if (!locked && this.levelManager.save.cleared[`${lv.id}:elite`]) {
      root.add(this.add.text(cx + W / 2 - 10, y + 2, '💀✓', {
        fontSize: '10px', fill: '#ff8855', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(1, 0.5));
    }

    if (!locked) {
      card.on('pointerover', () => drawCard(0x24385c, 0x55a0e0));
      card.on('pointerout', () => drawCard(0x1d2c45, 0x3d6a9a));
      card.on('pointerdown', () => {
        this.registry.set('selectedLevel', lv.id);
        this.registry.set('eliteMode', this.eliteMode);
        this.registry.set('playerSlot', this.playerSlot || 1);
        this.registry.set('playerId', this.playerId || 'player1');
        this.registry.set('levelProgress', this.levelManager?.save || null);
        this.registry.set('globalSave', this.globalUpgrades.save);
        this.scene.start('GameScene');
      });
    }
  }

  _flashLocked(x, y) {
    const t = this.add.text(x, y + 95, '🔒 通关前置章节解锁', {
      fontSize: '12px', fill: '#ff6666', fontFamily: 'Arial', fontStyle: 'bold',
      backgroundColor: '#000000cc', padding: { x: 10, y: 5 },
    }).setOrigin(0.5).setDepth(400);
    this.tweens.add({ targets: t, alpha: 0, delay: 900, duration: 300, onComplete: () => t.destroy() });
  }
}
