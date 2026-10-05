import Phaser from 'phaser';
import { GameState } from '../engine/GameState.js';
import { LevelManager } from '../engine/LevelManager.js';
import { loadGameConfigs } from '../data/loadGameConfigs.js';
import { gridToPixel, pixelToGrid, GRID, GAME_WIDTH, GAME_HEIGHT } from '../engine/GridConstants.js';
import { UpgradeOverlay } from '../ui/UpgradeOverlay.js';
import { LevelClearOverlay } from '../ui/LevelClearOverlay.js';
import { EffectsLayer } from '../ui/EffectsLayer.js';
import { EnemyRenderer } from '../ui/EnemyRenderer.js';
import { XpOrbRenderer } from '../ui/XpOrbRenderer.js';
import { HudView } from '../ui/HudView.js';
import { SkillBar } from '../ui/SkillBar.js';
import { WorldRenderer } from '../ui/WorldRenderer.js';
import { BossHpBar } from '../ui/BossHpBar.js';
import { audio } from '../ui/AudioSystem.js';
import { GlobalUpgradeSystem } from '../engine/GlobalUpgradeSystem.js';
import { EquipmentForgeSystem } from '../engine/EquipmentForgeSystem.js';
import { MercenarySystem } from '../engine/MercenarySystem.js';
import { GemSystem } from '../engine/GemSystem.js';
import { VipSystem } from '../engine/VipSystem.js';
import { ReviveSystem } from '../engine/ReviveSystem.js';
import { SyncedSaveRepository } from '../repository/SyncedSaveRepository.js';

const LEVEL_SAVE_KEY = 'lastline_levelsave';
const GLOBAL_SAVE_KEY = 'lastline_globalsave';

/**
 * GameScene: 薄壳。职责仅三件事：
 * 1. 组装 UI 视图（渲染委托给 ui/ 下的视图类）
 * 2. 引擎事件 → 视觉特效的路由
 * 3. 弹层调度（升级三选一 / 装备掉落 / 通关结算）
 */
export class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
    this.selectedSkillId = 'attack';
  }

  create() {
    const cfg = loadGameConfigs();
    // 从 MenuScene 接收选关（缺省 L1-1）
    const levelId = this.registry.get('selectedLevel') || 'S1-01';
    const elite = this.registry.get('eliteMode') || false;
    this.levelManager = new LevelManager(cfg.levelsConfig, this._loadLevelSave());
    this.levelRuntime = this.levelManager.startLevel(levelId, { elite });
    this.globalUpgradeSystem = new GlobalUpgradeSystem(cfg.globalUpgrades, this._loadGlobalSave());
    // 子系统存档必须挂回全局档（同一引用），否则 forgeSystem 的仓库写不进全局存档
    this.globalUpgradeSystem.save.equipment = this.globalUpgradeSystem.save.equipment || { inventory: [], nextUid: 1 };
    this.globalUpgradeSystem.save.equipped = this.globalUpgradeSystem.save.equipped || {};
    this.globalUpgradeSystem.save.daily = this.globalUpgradeSystem.save.daily || { lastClaimDate: null, streakDay: 0 };
    this.globalUpgradeSystem.save.vip = this.globalUpgradeSystem.save.vip || { vipLevel: 0, vipExp: 0, goldBonus: 0 };
    this.reviveSystem = new ReviveSystem(this.globalUpgradeSystem.save);
    this.forgeSystem = new EquipmentForgeSystem(cfg.equipment, this.globalUpgradeSystem.save.equipment);
    this.vipSystem = new VipSystem(this.globalUpgradeSystem.save.vip);
    // 佣兵系统（v4.4 起替代宠物系统）
    this.globalUpgradeSystem.save.mercs = this.globalUpgradeSystem.save.mercs || { owned: {}, deployed: [null, null] };
    this.mercenarySystem = new MercenarySystem(cfg.mercenaries, this.globalUpgradeSystem.save.mercs);
    // 宝石系统（v4.9）
    this.globalUpgradeSystem.save.gems = this.globalUpgradeSystem.save.gems || { collection: {}, sockets: {}, nextUid: 1 };
    this.gemSystem = new GemSystem(undefined, this.globalUpgradeSystem.save.gems);
    this.state = new GameState(cfg.enemies, cfg.balance, cfg.equipment, this.levelRuntime, {
      globalUpgrades: this.globalUpgradeSystem,
      forgeSystem: this.forgeSystem,
      equippedMap: this.globalUpgradeSystem.save.equipped || {},
      bossConfig: cfg.bosses,
      vipSystem: this.vipSystem,
      mercenarySystem: this.mercenarySystem,
      gemSystem: this.gemSystem,
    });
    // 远端存档双写（权威源=远端；战斗内结算/BOSS 奖励等即时推送）
    this._remoteSave = (global) => {
      this._saveRepo = this._saveRepo || new SyncedSaveRepository();
      this._saveRepo.save(1, { global, version: 2 });
    };
    this.bossHpBar = new BossHpBar(this);

    this.effects = new EffectsLayer(this);
    this.enemyRenderer = new EnemyRenderer(this);
    this.xpOrbRenderer = new XpOrbRenderer(this);
    this.world = new WorldRenderer(this, this.state);
    this.hud = new HudView(this, this.state);
    this.skillBar = new SkillBar(this, this.state);
    // 点图标 = 立即施放（自动选最佳落点）；数字键 = 选中+瞄准模式
    this.skillBar.onQuickCast = (id) => this.quickCast(id);
    this.skillBar.onSelect = (id) => this.selectSkill(id);
    this.skillBar.onPassiveClick = (id) => {
      const sk = this.state.player.skills.find(s => s.id === id);
      if (sk) this._showSelectHint(id, id); // 显示"被动·常驻生效"提示
    };

    // 注：战斗中拾取装备不再弹窗（原版式）——进 pendingLoot 暂存栏，结算页统一处理

    this.upgradeOverlay = new UpgradeOverlay(this, (option) => {
      const before = this.state.getResolvedStats();
      const result = this.state.applyUpgrade(option);
      this.skillBar.rebuild();
      // 属性卡即时可感反馈（玩家反馈：看不出强化是否生效）
      if (result.applied && option.kind === 'stat') {
        const after = this.state.getResolvedStats();
        const changes = [];
        if (after.damage > before.damage) changes.push(`⚔️ 伤害 ${before.damage.toFixed(2)} → ${after.damage.toFixed(2)}`);
        if (after.attackSpeed > before.attackSpeed) changes.push(`🌀 攻速 ${before.attackSpeed.toFixed(2)} → ${after.attackSpeed.toFixed(2)}（${(0.4 / after.attackSpeed * 1000).toFixed(0)}ms/发）`);
        if (after.critRate > before.critRate) changes.push(`🎯 暴击 ${(before.critRate * 100).toFixed(0)}% → ${(after.critRate * 100).toFixed(0)}%`);
        const msg = changes.length > 0 ? changes.join('   ') : option.description;
        const t = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 100, msg, {
          fontSize: '16px', fill: '#88ff88', fontFamily: 'Arial', fontStyle: 'bold',
          stroke: '#000000', strokeThickness: 3,
          backgroundColor: '#000000cc', padding: { x: 14, y: 8 },
        }).setOrigin(0.5).setDepth(400);
        this.tweens.add({ targets: t, alpha: 0, delay: 2200, duration: 500, onComplete: () => t.destroy() });
        // 英雄脚下加速/强化环
        const pPos = gridToPixel(this.state.player.x, this.state.player.y);
        const ring = this.add.circle(pPos.x, pPos.y, 14, 0x88ff88, 0).setDepth(160);
        ring.setStrokeStyle(3, 0x88ff88, 0.9);
        this.tweens.add({ targets: ring, radius: 46, alpha: 0, duration: 600, onComplete: () => ring.destroy() });
        audio.levelUp();
      }
    });

    this._showBriefing(this.levelRuntime);
    this._createMercSprites();
    this.bindInput();
    // 原版开局节奏：进关立即首次三选一（抢节奏）
    this.time.delayedCall(2600, () => { this.state.pendingLevelUp = true; });
  }

  /** 出战佣兵的局内形象（英雄两侧漂浮，最多 2 位） */
  _createMercSprites() {
    this._mercSprites = [];
    const mercs = this.mercenarySystem.getDeployed();
    mercs.forEach((merc, i) => {
      const basePos = gridToPixel(this.state.player.x, this.state.player.y);
      const x = i === 0 ? basePos.x - 36 : basePos.x + 36;
      const sprite = this.add.text(x, basePos.y - 6, merc.cfg.icon, {
        fontSize: '18px',
      }).setOrigin(0.5).setDepth(84);
      this._mercSprites[i] = sprite;
      this.tweens.add({
        targets: sprite, y: basePos.y - 14, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    });
  }

  _loadLevelSave() {
    try {
      const raw = localStorage.getItem(LEVEL_SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  _persistLevelSave() {
    try {
      localStorage.setItem(LEVEL_SAVE_KEY, JSON.stringify(this.levelManager.save));
    } catch { /* storage unavailable */ }
  }

  _loadGlobalSave() {
    try {
      const raw = localStorage.getItem(GLOBAL_SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  _persistGlobalSave() {
    try {
      // 权威源=远端；localStorage 仅作离线兜底缓存（双写，远端失败不阻塞）
      this._remoteSave?.(this.globalUpgradeSystem.save);
      localStorage.setItem(GLOBAL_SAVE_KEY, JSON.stringify(this.globalUpgradeSystem.save));
      localStorage.setItem('lastline_globalsave_ts', new Date().toISOString());
    } catch { /* storage unavailable */ }
  }

  /** 关卡任务简报（1-2 句剧情，2.8 秒后淡出） */
  _showBriefing(level) {
    const { width } = this.cameras.main;
    const c = this.add.container(0, 0).setDepth(450);
    c.add(this.add.rectangle(GAME_WIDTH / 2, 130, GAME_WIDTH - 40, 110, 0x000000, 0.72).setStrokeStyle(2, 0x4488ff));
    c.add(this.add.text(GAME_WIDTH / 2, 100, `【${level.name}】${level.elite ? ' · 精英难度' : ''}`, {
      fontSize: '17px', fill: '#66ccff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));
    c.add(this.add.text(GAME_WIDTH / 2, 138, level.brief, {
      fontSize: '12px', fill: '#ddddee', fontFamily: 'Arial',
      wordWrap: { width: GAME_WIDTH - 100 }, align: 'center',
    }).setOrigin(0.5));
    c.add(this.add.text(GAME_WIDTH / 2, 170, `共 ${level.totalWaves} 波进攻`, {
      fontSize: '11px', fill: '#888899', fontFamily: 'Arial',
    }).setOrigin(0.5));
    this.tweens.add({ targets: c, alpha: 0, delay: 2800, duration: 500, onComplete: () => c.destroy() });
  }

  _onLevelCleared() {
    if (this._clearedHandled) return;
    this._clearedHandled = true;
    // 精英难度奖励翻倍（levels.json elite.rewardMultiplier，此前无消费方）
    const rewardMult = this.levelRuntime.elite
      ? (this.levelManager.elite?.rewardMultiplier || 2) : 1;
    // 金币闭环：局内金币结算进全局存档（供全局强化消费）
    this.globalUpgradeSystem.save.gold = (this.globalUpgradeSystem.save.gold || 0) + Math.round(this.state.gold * rewardMult);
    // 钻石首奖（仅首次通关）· 精英同乘
    const firstClear = !this.levelManager.save.cleared[this.levelRuntime.levelId];
    let diamondReward = firstClear ? (this.levelRuntime.diamondReward || 50) : 0;
    diamondReward = Math.round(diamondReward * rewardMult);
    this.globalUpgradeSystem.save.diamond = (this.globalUpgradeSystem.save.diamond || 0) + diamondReward;
    this._persistGlobalSave();
    const result = this.levelManager.completeLevel(this.levelRuntime.levelId, {
      wallHpLeft: this.state.lives,
      wallHpMax: this.state.wallHpMax,
      elite: this.levelRuntime.elite,
    });
    this._persistLevelSave();
    const hasNext = !!this.levelManager.getLevel(this._nextLevelId());
    new LevelClearOverlay(this, {
      ...result,
      levelName: this.levelRuntime.name,
      elite: this.levelRuntime.elite,
      score: this.state.score,
      goldEarned: Math.round(this.state.gold * rewardMult),
      diamondEarned: diamondReward,
      loot: [...this.state.pendingLoot], // 结算页统一处理本局装备
      storyUnlock: this.levelRuntime.storyUnlock, // 通关解锁剧情（原版机制）
      hasNext,
    }, {
      onRetry: () => this.scene.restart(),
      onNext: () => {
        this.registry.set('selectedLevel', this._nextLevelId());
        this.scene.restart();
      },
      onMenu: () => this.scene.start('MenuScene'),
      /** 结算装备处理：装备已在拾取时入仓——此处只做快捷穿戴/分解 */
      onLootResolve: (item, wear) => {
        this.state.resolveLoot(item, { wear });
        // 找到这件装备的仓库实体（拾取时按 id 入仓，可能多件——取最后一颗=最新）
        const owned = this.forgeSystem.save.inventory.filter(i => i.refId === item.id);
        const entry = owned[owned.length - 1];
        if (wear && entry) {
    this.globalUpgradeSystem.save.equipped = this.globalUpgradeSystem.save.equipped || {};
    // 穿戴表消毒：值必须单 uid（历史版本可能写入数组）；key 必须是合法六部位
    {
      const VALID = ['weapon', 'helmet', 'coat', 'bracers', 'pants', 'shoes'];
      const eq = this.globalUpgradeSystem.save.equipped;
      for (const k of Object.keys(eq)) {
        if (!VALID.includes(k)) { delete eq[k]; continue; } // 旧部位名（armor/boots/gloves/accessory）清除
        if (Array.isArray(eq[k])) eq[k] = eq[k][0] ?? null;  // 数组取第一
        if (eq[k] == null) delete eq[k];
      }
    }
          this.globalUpgradeSystem.save.equipped[item.slot] = entry.uid;
        } else if (!wear && entry) {
          this.save.gold = (this.save.gold || 0) + this.forgeSystem.getScrapValue(entry.uid);
          this.forgeSystem.scrap(entry.uid);
        }
        this._persistGlobalSave();
      },
    });
  }

  _nextLevelId() {
    const ids = this.levelManager.levels.map(l => l.id);
    const idx = ids.indexOf(this.levelRuntime.levelId);
    return ids[idx + 1] || null;
  }

  bindInput() {
    // 首次交互解锁音频（浏览器自动播放策略）+ 启动 BGM
    this.input.once('pointerdown', () => {
      audio.unlock();
      audio.startBgm();
    });    // 场地点击 = 施放当前选中技能（默认 attack）
    this.input.on('pointerdown', (pointer) => {
      if (this._anyOverlayVisible() || this._clickBlocked()) return;
      // 点击在 interactive UI（按钮/技能图标）上时不施放技能
      // （Phaser 场景级监听先于对象级触发，stopPropagation 无法阻止，需显式检查）
      const overUI = this.input.hitTestPointer(pointer).length > 0;
      if (overUI) return;
      const { col, row } = pixelToGrid(pointer.x, pointer.y);
      const skillId = this.selectedSkillId || 'attack';
      const skill = this.state.player.skills.find(s => s.id === skillId);
      const result = this.state.useSkill(skillId, col, row);
      if (!result && skillId !== 'attack') {
        // 施放失败（冷却中）→ 提示
        this._showSelectHint(skillId, this.selectedSkillId);
      } else if (result && skill && skill.id !== 'attack') {
        // 成功施放非基础技 → 光圈收缩反馈
        const pos = gridToPixel(col, row);
        const ring = this.add.circle(pos.x, pos.y, 30, 0xffffff, 0).setDepth(160);
        ring.setStrokeStyle(3, 0xffffff, 0.9);
        this.tweens.add({ targets: ring, radius: 4, alpha: 0, duration: 250, onComplete: () => ring.destroy() });
      }
    });
    this.input.on('pointermove', (pointer) => this._updateAimPosition(pointer));
    this.input.keyboard.on('keydown-ONE', () => this.selectSkill('attack'));
    this.input.keyboard.on('keydown-TWO', () => this.selectSkill('thermobaric'));
    this.input.keyboard.on('keydown-THREE', () => this.selectSkill('fuelbomb'));
    this.input.keyboard.on('keydown-FOUR', () => this.selectSkill('empierce'));
    this.input.keyboard.on('keydown-FIVE', () => this.selectSkill('dryice'));
    this.input.keyboard.on('keydown-SIX', () => this.selectSkill('ray'));
  }

  /** 选中技能（数字键/键盘流：选中+瞄准模式） */
  selectSkill(skillId) {
    const skill = this.state.player.skills.find(s => s.id === skillId);
    if (!skill || !skill.unlocked) return;
    this.selectedSkillId = (this.selectedSkillId === skillId && skillId !== 'attack') ? 'attack' : skillId;
    this.skillBar.setSelected(this.selectedSkillId);
    this._updateAiming();
    this._showSelectHint(skillId, this.selectedSkillId);
  }

  /**
   * 快捷施放（点图标，原版式）：自动选最佳落点。
   * 优先最靠下的敌人（威胁最大）；无敌人则战场中央。
   */
  quickCast(skillId) {
    const skill = this.state.player.skills.find(s => s.id === skillId);
    if (!skill || !skill.unlocked) return;
    if (skill.currentCooldown > 0) {
      this._showSelectHint(skillId, skillId);
      audio.uiClick();
      return;
    }
    let col, row;
    if (skillId === 'attack') {
      // attack 无落点概念，走无落点路径（自动追踪）
      this.state.useSkill('attack');
      audio.shoot();
      return;
    }
    const targets = this.state.enemies.filter(e => e.alive).sort((a, b) => b.row - a.row);
    if (skill.type === 'beam') {
      // 镭射：落在敌人最密的一列
      col = this._densestEnemyCol() ?? 3.5;
      row = 6;
    } else if (targets.length > 0) {
      const t = targets[0];
      col = t.col; row = t.row;
    } else {
      col = 3.5; row = 5;
    }
    const result = this.state.useSkill(skillId, col, row);
    if (result) {
      audio.uiClick();
      const pos = gridToPixel(col, row);
      const ring = this.add.circle(pos.x, pos.y, 30, 0xffffff, 0).setDepth(160);
      ring.setStrokeStyle(3, 0xffffff, 0.9);
      this.tweens.add({ targets: ring, radius: 4, alpha: 0, duration: 250, onComplete: () => ring.destroy() });
    }
  }

  /** 敌人最密集列（镭射用） */
  _densestEnemyCol() {
    const counts = {};
    let best = null, bestN = 0;
    for (const e of this.state.enemies) {
      if (!e.alive) continue;
      const c = Math.round(e.col);
      counts[c] = (counts[c] || 0) + 1;
      if (counts[c] > bestN) { bestN = counts[c]; best = c; }
    }
    return best;
  }

  /** 瞄准指示：非 attack 技能选中时，跟随指针的范围圈 + 提示 */
  _updateAiming() {
    if (!this.aimCircle) {
      this.aimCircle = this.add.circle(0, 0, 20, 0xffffff, 0.06).setDepth(145);
      this.aimCircle.setStrokeStyle(2, 0xffffff, 0.7);
      this.aimGraphic = this.add.graphics().setDepth(145);
    }
    const skill = this.state.player.skills.find(s => s.id === this.selectedSkillId);
    const isAimMode = skill && skill.id !== 'attack' && skill.unlocked;
    this.aimActive = !!isAimMode;
    this.aimCircle.setVisible(this.aimActive);
    this.aimGraphic.setVisible(this.aimActive);
    if (!this.aimActive) { this.input.setDefaultCursor('default'); return; }
    this.input.setDefaultCursor('crosshair');
    const aoe = skill.aoe || 0;
    const radius = aoe > 0 && aoe < 90 ? aoe * GRID.CELL_SIZE : 20;
    this.aimCircle.setRadius(Math.max(14, radius));
    if (skill.type === 'beam') {
      // 镭射：显示整列高亮（由 update 中跟随刷新）
      this.aimIsBeam = true;
    } else {
      this.aimIsBeam = false;
    }
  }

  /** 指针移动时刷新瞄准圈位置 */
  _updateAimPosition(pointer) {
    if (!this.aimActive || !this.aimCircle.visible) return;
    const { col, row } = pixelToGrid(pointer.x, pointer.y);
    const pos = gridToPixel(col, row);
    this.aimCircle.setPosition(pos.x, pos.y);
    if (this.aimIsBeam) {
      this.aimGraphic.clear();
      this.aimGraphic.lineStyle(2, 0xff2266, 0.4);
      const top = gridToPixel(col, -1);
      const bottom = gridToPixel(col, GRID.ROWS + 1);
      this.aimGraphic.lineBetween(pos.x, bottom.y, pos.x, top.y);
    } else {
      this.aimGraphic.clear();
    }
  }

  /** 选中/施放提示（3 秒淡出，防打扰） */
  _showSelectHint(skillId, selectedId) {
    if (this.hintText) { this.hintText.destroy(); this.hintText = null; }
    const skill = this.state.player.skills.find(s => s.id === skillId);
    if (!skill) return;
    const isSelect = skillId === selectedId && skillId !== 'attack';
    let msg;
    if (skill.type === 'passive') {
      msg = `【${skill.name}】是被动技能 · 常驻生效，无需释放`; // 被动点击提示
    } else if (skill.currentCooldown > 0) {
      msg = `${skill.name} 冷却中...`;
    } else if (isSelect) {
      msg = `已选中【${skill.name}】— 点击战场任意位置释放`;
    } else {
      msg = `已切换回【射击】（自动锁定）`;
    }
    this.hintText = this.add.text(GAME_WIDTH / 2, 200, msg, {
      fontSize: '14px', fill: '#ffdd88', fontFamily: 'Arial', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 3,
      backgroundColor: '#000000aa', padding: { x: 10, y: 5 },
    }).setOrigin(0.5).setDepth(250);
    this.tweens.add({ targets: this.hintText, alpha: 0, delay: 2400, duration: 600, onComplete: () => { this.hintText?.destroy(); this.hintText = null; } });
  }

  _anyOverlayVisible() {
    return this.upgradeOverlay.isVisible();
  }

  /** 弹层刚打开后的短保护窗：吞掉打开瞬间穿透的点击（防"选卡时误攻击"） */
  _clickBlocked() {
    if (this._overlayJustOpenedAt && this.time.now - this._overlayJustOpenedAt < 350) return true;
    return false;
  }

  update(time, delta) {
    if (this.state.gameOver) { this.showGameOver(); return; }
    if (this._anyOverlayVisible()) return;

    // 升级三选一：打断战斗，优先于一切
    if (this.state.pendingLevelUp) {
      this._overlayJustOpenedAt = this.time.now;
      this.upgradeOverlay.show(this.state.player.getUpgradeOptions(3));
      return;
    }

    const dt = delta / 1000;
    const waveResult = this.state.update(dt);

    // 自动射击配音（引擎层发射时无音频依赖，UI 层近似对齐：监测新弹道）
    if (this.state.projectiles.length > (this._lastProjectileCount || 0)) {
      audio.shoot();
    }
    this._lastProjectileCount = this.state.projectiles.length;

    this.enemyRenderer.sync(this.state.enemies, time);
    this.enemyRenderer.prune(this.state.enemies);
    this.xpOrbRenderer.sync(this.state.xpOrbs.orbs, dt);
    this.renderProjectiles();
    this.routeEvents();
    this.effects.update(dt);
    this.skillBar.update(time);
    this.world.updatePlayer();
    this.hud.update();
    this.bossHpBar.update(this.state.enemies);

    // 波间轻提示：本局已获装备数（原版式，非阻断；结算时统一处理）
    if (waveResult?.type === 'waveComplete' && this.state.pendingLoot.length > 0) {
      this.time.delayedCall(1500, () => {
        if (this.state.pendingLoot.length > 0 && !this._anyOverlayVisible()) {
          this.effects.floatingText(
            GAME_WIDTH / 2, GAME_HEIGHT / 2 + 90,
            `📦 本局已获 ${this.state.pendingLoot.length} 件装备（结算时处理）`, '#88ddff', 13
          );
        }
      });
    }

    if (waveResult?.type === 'waveComplete') {
      this.state.gold += waveResult.goldBonus;
      // 波次通关小概率掉锻造石/图纸（材料获取途径）
      if (this.rng_flag === undefined) { this.rng_flag = 0; }
      if (Math.random() < 0.18) {
        const stones = 1 + Math.floor(Math.random() * 3);
        this.globalUpgradeSystem.save.forgeStones = (this.globalUpgradeSystem.save.forgeStones || 0) + stones;
        this.effects.floatingText(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 80, `⚒️ 锻造石 +${stones}`, '#88ddff', 12);
      }
      if (Math.random() < 0.10) {
        const notes = 1 + Math.floor(Math.random() * 2);
        this.globalUpgradeSystem.save.gunNotes = (this.globalUpgradeSystem.save.gunNotes || 0) + notes;
        this.effects.floatingText(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 100, `📜 枪械图纸 +${notes}`, '#ffcc88', 12);
      }
      this.showWaveComplete(waveResult.wave, waveResult.goldBonus, waveResult.perfectWave);
      if (waveResult.levelCleared) {
        this.time.delayedCall(1200, () => this._onLevelCleared());
      }
    }
  }

  /** 引擎事件 → 特效路由 */
  routeEvents() {
    for (const ev of this.state.consumeEvents()) {
      switch (ev.type) {
        case 'hit': {
          if (!ev.target.alive) break;
          const pos = gridToPixel(ev.target.col, ev.target.row);
          this.effects.floatingText(pos.x, pos.y - 12, `${Math.round(ev.damage)}`, ev.isCrit ? '#ffff00' : '#ffffff', ev.isCrit ? 14 : 10);
          this.effects.hitSparks(pos.x, pos.y, ev.skill || 'attack');
          if (ev.isCrit) { audio.crit(); this.cameras.main.shake(60, 0.003); }
          else audio.hit();
          break;
        }
        case 'mercFire': {
          // 出战佣兵开火反馈：图标高亮脉冲 + 从佣兵位置发出手光圈（用佣兵专属色）
          const spr = this._mercSprites?.[ev.slotIdx];
          if (spr) {
            this.tweens.add({ targets: spr, scale: { from: 1.6, to: 1 }, duration: 260, ease: 'Cubic.easeOut' });
            spr.setTintFill(0xffffff);
            this.time.delayedCall(120, () => spr.clearTint());
          }
          const basePos = gridToPixel(this.state.player.x, this.state.player.y);
          const mx = basePos.x + (ev.slotIdx === 0 ? -36 : 36);
          this.effects.impactRing(mx, basePos.y - 16, ev.color || 0xffcc88);
          break;
        }
        case 'projectileHit': {
          const pos = gridToPixel(ev.x, ev.y);
          this.effects.impactRing(pos.x, pos.y, ev.color);
          break;
        }
        case 'aoeImpact': {
          const pos = gridToPixel(ev.x, ev.y);
          this.effects.aoeBurst(pos.x, pos.y, ev.radius * GRID.CELL_SIZE, ev.color);
          audio.explode();
          break;
        }
        case 'skillEffect': {
          if (ev.skill === 'thermobaric' || ev.skill === 'airstrike') {
            const p = gridToPixel(ev.x, ev.y);
            this.effects.aoeBurst(p.x, p.y, ev.range * GRID.CELL_SIZE, 0xff6600);
            audio.explode();
          }
          if (ev.skill === 'drone') {
            const p = gridToPixel(ev.x, ev.y);
            this.effects.droneStrike(p.x, p.y, (ev.range || 1) * GRID.CELL_SIZE);
            audio.explode();
          }
          if (ev.skill === 'dryice' || ev.skill === 'icestorm') audio.freeze();
          if (ev.skill === 'empierce') audio.lightning();
          if (ev.skill === 'ray') audio.laser();
          if (ev.skill === 'cyclone') audio.cyclone();
          if (ev.skill === 'leapwave') audio.leapwave();
          break;
        }
        case 'beamEffect': {
          this.effects.laserBeam(this.state.player.x, this.state.player.y, ev.col);
          break;
        }
        case 'zoneEffect': {
          // 地面区域（燃油弹火区/冰暴/时空裂隙）：持续光圈
          const p = gridToPixel(ev.x, ev.y);
          const g = this.add.graphics().setDepth(35);
          g.fillStyle(ev.color, 0.22);
          g.fillCircle(p.x, p.y, ev.radius * GRID.CELL_SIZE);
          g.lineStyle(2, ev.color, 0.8);
          g.strokeCircle(p.x, p.y, ev.radius * GRID.CELL_SIZE);
          this.tweens.add({ targets: g, alpha: 0, duration: (ev.radius || 2) * 700, onComplete: () => g.destroy() });
          if (ev.skill === 'rift') audio.rift(); else audio.explode();
          break;
        }
        case 'lineEffect': {
          // 直线穿透（电磁穿刺/气刃/跃迁电子）：沿方向的光束
          const from = gridToPixel(ev.x, ev.y);
          const g = this.add.graphics().setDepth(155);
          g.lineStyle(4, ev.skill === 'empierce' ? 0xffff00 : 0xaaffcc, 0.5);
          g.lineBetween(from.x, from.y, from.x + ev.ux * 900, from.y + ev.uy * 900);
          g.lineStyle(2, 0xffffff, 0.9);
          g.lineBetween(from.x, from.y, from.x + ev.ux * 900, from.y + ev.uy * 900);
          this.tweens.add({ targets: g, alpha: 0, duration: 220, onComplete: () => g.destroy() });
          break;
        }
        case 'coneEffect': {
          // 扇形风（旋风加农）：白色风圈扩散
          const from = gridToPixel(ev.x, ev.y);
          const ring = this.add.circle(from.x, from.y, 20, 0xaaffcc, 0.0).setDepth(155);
          ring.setStrokeStyle(4, 0xaaffcc, 0.8);
          this.tweens.add({ targets: ring, radius: 260, alpha: 0, duration: 400, onComplete: () => ring.destroy() });
          audio.cyclone();
          break;
        }
        case 'guidedEffect': {
          // 制导：从英雄到目标的锁定光线
          const from = gridToPixel(this.state.player.x, this.state.player.y);
          const to = gridToPixel(ev.col, ev.row);
          const g = this.add.graphics().setDepth(156);
          g.lineStyle(3, 0xff66aa, 0.8);
          g.lineBetween(from.x, from.y, to.x, to.y);
          const lock = this.add.circle(to.x, to.y, 16, 0xff66aa, 0).setDepth(157);
          lock.setStrokeStyle(2, 0xff66aa, 1);
          this.tweens.add({ targets: g, alpha: 0, duration: 260, onComplete: () => g.destroy() });
          this.tweens.add({ targets: lock, radius: 4, alpha: 0, duration: 300, onComplete: () => lock.destroy() });
          audio.guided();
          break;
        }
        case 'sweepEffect': {
          // 装甲车：竖列碾压光带（沿 Y 轴）
          const colX = GRID.OFFSET_X + ev.col * GRID.CELL_SIZE + GRID.CELL_SIZE / 2;
          const band = this.add.rectangle(colX, GRID.OFFSET_Y + (this.state.wallRow * GRID.CELL_SIZE) / 2, 30, this.state.wallRow * GRID.CELL_SIZE, 0xccaa66, 0.3).setDepth(155);
          this.tweens.add({ targets: band, alpha: 0, duration: 450, onComplete: () => band.destroy() });
          this.cameras.main.shake(200, 0.005);
          audio.vehicle();
          break;
        }
        case 'instantKill': {
          // 秒杀宝石触发
          const pos = gridToPixel(ev.target.col, ev.target.row);
          this.effects.floatingText(pos.x, pos.y - 22, '⚡ 秒杀!', '#ff44dd', 14);
          this.effects.deathPoof(pos.x, pos.y);
          audio.explode();
          break;
        }
        case 'kill': {
          const pos = gridToPixel(ev.target.col, ev.target.row);
          this.effects.floatingText(pos.x, pos.y - 20, `+${ev.bounty}G`, '#ffd700', 10);
          this.effects.deathPoof(pos.x, pos.y);
          audio.coin();
          break;
        }
        case 'itemDrop': {
          // 原版式：掉落即时飘提示（品质+部位），装备已自动入仓
          const slotNames = { weapon: '武器', helmet: '头盔', coat: '衣服', bracers: '护臂', pants: '腰饰', shoes: '鞋子' };
          const qName = { white: '白', green: '绿', blue: '蓝', purple: '紫', orange: '橙', red: '红', rainbow: '彩' }[ev.item.rarity] || '';
          this.effects.floatingText(GAME_WIDTH / 2, 200, `📦 ${qName}·${slotNames[ev.item.slot] || '装备'} 入仓`, '#88ddff', 12);
          audio.uiClick();
          break;
        }
        case 'perfectWave':
          this.effects.floatingText(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 60, `完美! +${ev.bonus}G`, '#00ffcc', 14);
          break;
        case 'levelUp':
          this.effects.floatingText(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40, `Level Up! Lv.${ev.level}`, '#ffdd44', 20);
          audio.levelUp();
          break;
        case 'revive':
          audio.revive();
          break;
        case 'wallHit': {
          const x = GRID.OFFSET_X + ev.col * GRID.CELL_SIZE + GRID.CELL_SIZE / 2;
          const wallY = GRID.OFFSET_Y + this.state.wallRow * GRID.CELL_SIZE;
          this.effects.wallHit(x, wallY, ev.damage);
          this.effects.floatingText(x, wallY - 18, `-${ev.damage}`, '#ff4444', 13);
          audio.wallHit();
          break;
        }
        case 'bossSpawn': {
          const boss = this.state.enemies.find(e => e.isBoss);
          if (boss) this.bossHpBar.show(boss);
          this.effects.floatingText(GAME_WIDTH / 2, 110, `⚠️ ${ev.name} 来袭!`, '#ff4444', 22);
          this.cameras.main.shake(400, 0.008);
          audio.bossRoar();
          break;
        }
        case 'bossSummon':
          this.effects.floatingText(GAME_WIDTH / 2, 110, '☠️ 召唤爪牙!', '#ffaa44', 16);
          break;
        case 'warnSpeed':
          this.effects.floatingText(GAME_WIDTH / 2, 110, '⚠️ 即将狂暴!', '#ff6644', 16);
          break;
        case 'warnRoar':
          this.effects.floatingText(GAME_WIDTH / 2, 110, '⚠️ 捂住耳朵!', '#ffee44', 16);
          break;
        case 'roar':
          this.effects.floatingText(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, '🙉 沉默!', '#ffee44', 22);
          this.cameras.main.shake(300, 0.006);
          break;
        case 'bossKill': {
          // BOSS 击杀钻石入全局档
          this.globalUpgradeSystem.save.diamond = (this.globalUpgradeSystem.save.diamond || 0) + ev.diamond;
          this._persistGlobalSave();
          this.effects.floatingText(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40, `🏆 BOSS 击杀! +${ev.gold}G +${ev.diamond}💎`, '#ffdd44', 20);
          this.cameras.main.flash(400, 255, 220, 100);
          break;
        }
      }
    }
  }

  /** 弹道一次性渲染（快速弹丸用拖尾残影近似） */
  renderProjectiles() {
    for (const p of this.state.projectiles) {
      if (!p.alive) continue;
      const pos = gridToPixel(p.col, p.row);
      const body = this.add.circle(pos.x, pos.y, p.size, p.color).setDepth(120);
      const glow = this.add.circle(pos.x, pos.y, p.size * 1.5, p.color, 0.2).setDepth(118);
      this.time.delayedCall(70, () => { body.destroy(); glow.destroy(); });
    }
  }

  showWaveComplete(wave, gold, perfect) {
    const msg = perfect ? `波次${wave} 完美! +${gold}G` : `波次${wave} 完成 +${gold}G`;
    const t = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, msg, { fontSize: '20px', fill: '#00ff88', fontFamily: 'Arial', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5).setDepth(200);
    this.time.delayedCall(1500, () => t.destroy());
  }

  showGameOver() {
    if (this._go) return;
    this._go = true;
    // 先弹复活选择（能付得起且未用过次数）
    if (this.reviveSystem.canRevive()) {
      this._showReviveOffer();
      return;
    }
    this._finalGameOver();
  }

  /** 复活选择弹窗：钻石复活继续 / 放弃结算 */
  _showReviveOffer() {
    const cx = GAME_WIDTH / 2, cy = GAME_HEIGHT / 2;
    const c = this.add.container(0, 0).setDepth(700);
    this._reviveContainer = c;
    c.add(this.add.rectangle(cx, cy, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.8).setInteractive());
    c.add(this.add.text(cx, cy - 120, '💀 城墙被攻破了!', {
      fontSize: '30px', fill: '#ff4444', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));
    c.add(this.add.text(cx, cy - 70, '是否复活？墙血回 50% · 清屏敌人 · 1.5s 无敌', {
      fontSize: '14px', fill: '#dddddd', fontFamily: 'Arial',
    }).setOrigin(0.5));

    const cost = this.reviveSystem.reviveCost;
    const can = this.reviveSystem.canAfford();
    const reviveBtn = this.add.rectangle(cx, cy, 260, 52, can ? 0xaa44bb : 0x555566)
      .setInteractive({ useHandCursor: can });
    c.add(reviveBtn);
    c.add(this.add.text(cx, cy, `💎 复活（${cost} 钻石）· 持有 ${this.reviveSystem.globalSave.diamond || 0}`, {
      fontSize: '15px', fill: '#ffffff', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5));
    reviveBtn.on('pointerdown', () => {
      const params = this.reviveSystem.performRevive();
      if (!params) { this._finalGameOver(); return; }
      this._persistGlobalSave();
      c.destroy();
      this._reviveContainer = null;
      this._go = false;
      this.state.applyRevive(params);
      this.effects.floatingText(cx, cy, '⚡ 复活！', '#ff88ff', 24);
      this.cameras.main.flash(400, 255, 150, 255);
    });

    const giveUp = this.add.rectangle(cx, cy + 68, 220, 40, 0x444466)
      .setInteractive({ useHandCursor: true });
    c.add(giveUp);
    c.add(this.add.text(cx, cy + 68, '放弃 · 领取金币结算', {
      fontSize: '13px', fill: '#ccccdd', fontFamily: 'Arial',
    }).setOrigin(0.5));
    giveUp.on('pointerdown', () => {
      c.destroy();
      this._reviveContainer = null;
      this._finalGameOver();
    });
  }

  /** 最终败局：安慰金结算 + 结算画面 */
  _finalGameOver() {
    // 败局 consolation：30% 金币仍进全局存档
    const consolation = Math.floor(this.state.gold * 0.3);
    if (consolation > 0) {
      this.globalUpgradeSystem.save.gold = (this.globalUpgradeSystem.save.gold || 0) + consolation;
      this._persistGlobalSave();
    }
    const cx = GAME_WIDTH / 2, cy = GAME_HEIGHT / 2;
    this.add.rectangle(cx, cy, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.78).setDepth(300);
    this.add.text(cx, cy - 90, '💀 城墙被攻破了!', { fontSize: '32px', fill: '#ff4444', fontFamily: 'Arial', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5).setDepth(301);
    this.add.text(cx, cy - 45, `分数 ${this.state.score} · 波次 ${this.state.waveManager.currentWave}`, { fontSize: '16px', fill: '#ffffff', fontFamily: 'Arial' }).setOrigin(0.5).setDepth(301);
    this.add.text(cx, cy - 15, `金币 +${consolation}（30% 存入强化）`, { fontSize: '13px', fill: '#ffd700', fontFamily: 'Arial' }).setOrigin(0.5).setDepth(301);

    // 本局装备：失败时默认全部自动入仓（不打断情绪，进锻造可再分解）
    const loot = [...this.state.pendingLoot];
    if (loot.length > 0) {
      // 拾取时已入仓——此处只需清理 pendingLoot 标记并持久化
      for (const item of loot) this.state.resolveLoot(item, { wear: false });
      this._persistGlobalSave();
      this.add.text(cx, cy + 15, `📦 ${loot.length} 件装备已存入锻造仓库`, { fontSize: '13px', fill: '#88ddff', fontFamily: 'Arial' }).setOrigin(0.5).setDepth(301);
    }

    // 两个大按钮：再来一次 / 返回主菜单（对齐原版失败界面）
    const mkBtn = (x, label, color, fn) => {
      const g = this.add.graphics().setDepth(301);
      g.fillStyle(0x000000, 0.3); g.fillRoundedRect(x - 95, cy + 40, 190, 52, 10);
      g.fillStyle(color, 1); g.fillRoundedRect(x - 95, cy + 37, 190, 52, 10);
      g.lineStyle(2, 0xffffff, 0.85); g.strokeRoundedRect(x - 95, cy + 37, 190, 52, 10);
      g.fillStyle(0xffffff, 0.14); g.fillRoundedRect(x - 93, cy + 39, 186, 20, { tl: 10, tr: 10, bl: 0, br: 0 });
      this.add.text(x, cy + 63, label, {
        fontSize: '17px', fill: '#ffffff', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(302);
      const zone = this.add.rectangle(x, cy + 63, 190, 52, 0xffffff, 0).setDepth(303).setInteractive({ useHandCursor: true });
      zone.on('pointerdown', fn);
      return zone;
    };
    mkBtn(cx - 105, '🔁 再来一次', 0x00884a, () => this.scene.restart());
    mkBtn(cx + 105, '🏠 返回主菜单', 0x335588, () => this.scene.start('MenuScene'));
  }
}
