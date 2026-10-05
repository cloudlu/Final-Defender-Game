/**
 * Player: cartoon wizard at bottom center.
 * Skills: unlocked via level-up draft; repeat picks level them up (max 5).
 */
const MAX_SKILL_LEVEL = 5;
const LEVEL_DMG_SCALE = 1.25;
const LEVEL_CD_SCALE = 0.90;
const LEVEL_AOE_ADD = 0.3;
const LEVEL_RARITY = { 2: 'white', 3: 'blue', 4: 'purple', 5: 'orange' };

const STAT_CARDS = [
  { kind: 'stat', id: 'stat_attack_speed', name: '射速提升', icon: '🌀', rarity: 'white', description: '攻击间隔 -15%' },
  { kind: 'stat', id: 'stat_damage', name: '攻击强化', icon: '⚔️', rarity: 'white', description: '伤害 +20%' },
  { kind: 'stat', id: 'stat_crit', name: '暴击强化', icon: '🎯', rarity: 'blue', description: '暴击率 +10%' },
  { kind: 'stat', id: 'stat_speed', name: '攻速狂暴', icon: '💥', rarity: 'purple', description: '攻击间隔 -30%' },
];

/** 原版技能升级关键节点（skillId → [{level, key, value}]），useSkill 时应用 */
export const SKILL_MILESTONES = {
  thermobaric: [
    { level: 2, key: 'explosionSpark' },    // [爆炸火花]：爆炸额外 2 处火花
    { level: 6, key: 'thermalIgnite' },     // [热能燃爆]：灼烧伤害翻倍
  ],
  fuelbomb: [
    { level: 5, key: 'igniteOnDeath' },     // （对齐 18 级，取近似）点燃目标死亡留火区
  ],
  empierce: [
    { level: 2, key: 'plasmaField' },       // [电磁爆炸]：命中生成等离子场
  ],
  dryice: [
    { level: 3, key: 'zeroStorm' },         // （对齐"每 32 次命中"，局内简化为等级触发）零度风暴：小范围冰爆
  ],
  vehicle: [
    { level: 3, key: 'scorchedEarth' },     // （对齐 14 级焦土）碾压留灼烧
    { level: 4, key: 'stunChance' },        // （对齐 18 级）眩晕概率翻倍
  ],
  drone: [
    { level: 2, key: 'slow80' },            // （对齐 6 级）命中减速 80%
    { level: 4, key: 'vulnerable' },        // （对齐 18 级）受伤+30%
  ],
};

/** 原版合成表（基础池内可实装的配方）：两原料技能均满级 → 合成 */
export const EVO_RECIPES = [
  {
    id: 'evo_deathboom',
    name: '死亡爆炸',
    icon: '🔥',
    ingredients: ['fuelbomb', 'thermobaric'],
    result: {
      id: 'evo_deathboom', name: '死亡爆炸', icon: '🔥', type: 'zone',
      baseDamage: 50, baseCooldown: 5.5, baseAoe: 3.2, baseChain: 0,
      baseEffect: { type: 'burn', damage: 14, duration: 5 },
      range: 99, desc: '火区+冲击双重伤害，敌人死亡时殉爆',
    },
  },
  {
    id: 'evo_flamedrone',
    name: '烈焰无人机',
    icon: '🛸',
    ingredients: ['drone', 'thermobaric'],
    result: {
      id: 'evo_flamedrone', name: '烈焰无人机', icon: '🛸', type: 'drone',
      baseDamage: 30, baseCooldown: 8, baseAoe: 1.8, baseChain: 0,
      baseEffect: { type: 'burn', damage: 10, duration: 3 },
      range: 99, desc: '无人机轰炸附带点燃',
    },
  },
  {
    id: 'evo_guidedemp',
    name: '制导电磁',
    icon: '⚡',
    ingredients: ['guidedlaser', 'empierce'],
    result: {
      id: 'evo_guidedemp', name: '制导电磁', icon: '⚡', type: 'guided',
      baseDamage: 52, baseCooldown: 9, baseAoe: 0, baseChain: 0,
      baseEffect: { type: 'stun', duration: 0.8 },
      range: 99, desc: '追踪制导电磁脉冲，麻痹目标',
    },
  },
  {
    id: 'evo_frostburst',
    name: '冰霜炸裂',
    icon: '🧊',
    ingredients: ['dryice', 'icestorm'],
    result: {
      id: 'evo_frostburst', name: '冰霜炸裂', icon: '🧊', type: 'zone',
      baseDamage: 36, baseCooldown: 7, baseAoe: 3, baseChain: 0,
      baseEffect: { type: 'freeze', duration: 2.5 },
      range: 99, desc: '冰爆后碎冰四溅二次冻结',
    },
  },
];

export class Player {
  constructor() {
    this.x = 3.5; // center of 8-col grid (0-7)
    this.y = 12.7; // behind the wall (wall at row 12)
    this.hp = 100;
    this.maxHp = 100;

    // ===== 原版技能表对齐（系数/冷却来自原版数据）=====
    // 类型：projectile 弹道 / zone 地面区域 / pierceLine 直线穿透 / cone 扇形击退 / beam 激光 / guided 制导 / sweep 召唤横穿 / airstrike 空投 / drone 召唤
    this.skills = [
      { id: 'attack', name: '枪械', icon: '🔫', type: 'gun', baseDamage: 20, baseCooldown: 0.3, baseAoe: 0, baseChain: 0, baseEffect: null, range: 99, unlocked: true, level: 1, desc: '基础枪械，弹匣 30 发' },
      { id: 'thermobaric', name: '温压弹', icon: '💥', type: 'projectile', baseDamage: 32, baseCooldown: 6.2, baseAoe: 2.2, baseChain: 0, baseEffect: { type: 'burn', damage: 6, duration: 2 }, range: 99, unlocked: false, level: 0, rarity: 'blue', element: 'fire', desc: '落地大范围爆炸+灼烧，清潮核心' },
      { id: 'fuelbomb', name: '燃油弹', icon: '🔥', type: 'zone', baseDamage: 30, baseCooldown: 4.0, baseAoe: 2.8, baseChain: 0, baseEffect: { type: 'burn', damage: 9, duration: 4.1 }, range: 99, unlocked: false, level: 0, rarity: 'purple', element: 'fire', desc: 'T0：地面留持续火区，高伤大范围' },
      { id: 'empierce', name: '电磁穿刺', icon: '⚡', type: 'pierceLine', baseDamage: 30, baseCooldown: 3.8, baseAoe: 0, baseChain: 0, baseEffect: { type: 'stun', duration: 0.6 }, range: 99, unlocked: false, level: 0, rarity: 'blue', element: 'electric', desc: '直线穿透+麻痹' },
      { id: 'dryice', name: '干冰弹', icon: '🧊', type: 'projectile', baseDamage: 23, baseCooldown: 4.1, baseAoe: 0, baseChain: 0, baseEffect: { type: 'freeze', duration: 2 }, range: 99, unlocked: false, level: 0, rarity: 'blue', element: 'ice', desc: '命中冰冻 2 秒' },
      { id: 'icestorm', name: '冰暴发生器', icon: '❄️', type: 'zone', baseDamage: 4, baseCooldown: 6.2, baseAoe: 2.4, baseChain: 0, baseEffect: { type: 'freeze', duration: 1.6 }, range: 99, unlocked: false, level: 0, rarity: 'purple', element: 'ice', desc: '冻结圆形区域，强控克 BOSS' },
      { id: 'cyclone', name: '旋风加农', icon: '🌪️', type: 'cone', baseDamage: 14, baseCooldown: 17.1, baseAoe: 3, baseChain: 0, baseEffect: { type: 'knockback', power: 2.5 }, range: 5, unlocked: false, level: 0, rarity: 'blue', element: 'wind', desc: '扇形强风吹退，拉开距离' },
      { id: 'airblade', name: '压缩气刃', icon: '🌀', type: 'pierceLine', baseDamage: 32, baseCooldown: 6.5, baseAoe: 0, baseChain: 0, baseEffect: null, range: 99, unlocked: false, level: 0, rarity: 'blue', element: 'wind', desc: '风系中高系数直线刃' },
      { id: 'ray', name: '高能射线', icon: '📡', type: 'beam', baseDamage: 42, baseCooldown: 7.5, baseAoe: 0, baseChain: 0, baseEffect: null, range: 99, unlocked: false, level: 0, rarity: 'purple', element: 'energy', desc: '贯穿直线，泛用补刀' },
      { id: 'guidedlaser', name: '制导激光', icon: '🔦', type: 'guided', baseDamage: 38, baseCooldown: 10.3, baseAoe: 0, baseChain: 0, baseEffect: null, range: 99, unlocked: false, level: 0, rarity: 'purple', element: 'energy', desc: '自动追踪最高血量目标' },
      { id: 'vehicle', name: '装甲车', icon: '🚛', type: 'sweep', baseDamage: 55, baseCooldown: 17.4, baseAoe: 0.8, baseChain: 0, baseEffect: { type: 'stun', duration: 0.5 }, range: 99, unlocked: false, level: 0, rarity: 'orange', element: 'physical', desc: '沿直线碾压穿透，概率眩晕' },
      { id: 'airstrike', name: '空投轰炸', icon: '🎯', type: 'airstrike', baseDamage: 60, baseCooldown: 7.7, baseAoe: 2.6, baseChain: 0, baseEffect: null, range: 99, unlocked: false, level: 0, rarity: 'purple', element: 'physical', desc: '高系数物理轰炸' },
      { id: 'drone', name: '无人机冲击', icon: '🛸', type: 'drone', baseDamage: 20, baseCooldown: 10.0, baseAoe: 1.2, baseChain: 0, baseEffect: { type: 'slow', factor: 0.2, duration: 0.5 }, range: 99, unlocked: false, level: 0, rarity: 'purple', element: 'physical', desc: '无人机轰炸，命中减速 80%' },
      // === C 档扩展（原版补充技能） ===
      { id: 'leapwave', name: '跃迁电子', icon: '🔆', type: 'pierceLine', baseDamage: 25, baseCooldown: 3.8, baseAoe: 1.0, baseChain: 0, baseEffect: null, range: 99, unlocked: false, level: 0, rarity: 'blue', element: 'electric', desc: '电子束直线穿透+溅射' },
      { id: 'rift', name: '时空裂隙', icon: '🕳️', type: 'zone', baseDamage: 12, baseCooldown: 8.0, baseAoe: 2.2, baseChain: 0, baseEffect: null, range: 99, unlocked: false, level: 0, rarity: 'purple', element: 'energy', desc: '裂隙持续撕裂区域内的敌人' },
      // === 子弹强化线（原版枪械词条） ===
      { id: 'multishot', name: '连射', icon: '🔀', type: 'passive', baseDamage: 0, baseCooldown: 0, baseAoe: 0, baseChain: 0, baseEffect: null, range: 0, unlocked: false, level: 0, rarity: 'blue', desc: '基础射击 +1 发扇形弹' },
      { id: 'pierce', name: '穿透', icon: '🎯', type: 'passive', baseDamage: 0, baseCooldown: 0, baseAoe: 0, baseChain: 0, baseEffect: null, range: 0, unlocked: false, level: 0, rarity: 'blue', desc: '基础射击可穿透 +1 名敌人' },
      { id: 'splitshot', name: '分裂', icon: '🧬', type: 'passive', baseDamage: 0, baseCooldown: 0, baseAoe: 0, baseChain: 0, baseEffect: null, range: 0, unlocked: false, level: 0, rarity: 'purple', desc: '弹道分裂：射击时多出 1 列平行弹（每列 60% 伤害）' },
      { id: 'bounce', name: '弹射', icon: '🏀', type: 'passive', baseDamage: 0, baseCooldown: 0, baseAoe: 0, baseChain: 0, baseEffect: null, range: 0, unlocked: false, level: 0, rarity: 'blue', desc: '子弹到点后向最近敌人弹射（70% 伤害递减/次）' },
      { id: 'giant', name: '巨大化', icon: '🔵', type: 'passive', baseDamage: 0, baseCooldown: 0, baseAoe: 0, baseChain: 0, baseEffect: null, range: 0, unlocked: false, level: 0, rarity: 'blue', desc: '子弹更大更重：尺寸+40%、伤害+10%/级' },
      { id: 'chainboom', name: '连锁爆炸', icon: '💥', type: 'passive', baseDamage: 0, baseCooldown: 0, baseAoe: 0, baseChain: 0, baseEffect: null, range: 0, unlocked: false, level: 0, rarity: 'purple', desc: '击杀敌人时爆炸（40% 伤害，1.0 范围）' },
    ];
    for (const s of this.skills) if (s.unlocked) this._applyLevel(s);

    // 技能强化卡层数（全局作用于所有主动技）：范围/持续/冷却/技能伤害
    this.skillBuffs = { range: 0, duration: 0, cd: 0, dmg: 0 };

    this.autoAttackTimer = 0;
    this.autoAttackInterval = 0.4;

    // 经验升级系统（向僵尸开炮式）：击杀获得经验，升级弹出三选一
    this.level = 1;
    this.xp = 0;
    this.xpToNext = 5;
    this.pendingStatMods = [];
  }

  /** 按当前等级换算技能实际数值（伤害/冷却/范围/链数） */
  _applyLevel(skill) {
    const lv = Math.max(1, skill.level);
    skill.level = lv;
    skill.damage = Math.round(skill.baseDamage * Math.pow(LEVEL_DMG_SCALE, lv - 1) * 100) / 100;
    skill.cooldown = Math.round(skill.baseCooldown * Math.pow(LEVEL_CD_SCALE, lv - 1) * 100) / 100;
    skill.aoe = (skill.baseAoe > 0 && skill.baseAoe < 90)
      ? Math.round((skill.baseAoe + LEVEL_AOE_ADD * (lv - 1)) * 10) / 10
      : skill.baseAoe;
    skill.chain = skill.baseChain > 0 ? skill.baseChain + Math.floor((lv - 1) / 2) : 0;
    skill.effect = skill.baseEffect;
    skill.currentCooldown = 0;
  }

  update(dt) {
    for (const skill of this.skills) {
      if (skill.currentCooldown > 0) skill.currentCooldown = Math.max(0, skill.currentCooldown - dt);
    }
    if (this.silencedTimer > 0) this.silencedTimer = Math.max(0, this.silencedTimer - dt);
  }

  /** 施放技能：targetCol/targetRow 为落点（网格坐标），未解锁/冷却中返回 null */
  useSkill(skillId, targetCol = this.x, targetRow = this.y) {
    const skill = this.skills.find(s => s.id === skillId);
    if (!skill || !skill.unlocked || skill.currentCooldown > 0) return null;
    if (this.silencedTimer > 0) return null; // BOSS 咆哮沉默
    // 技能强化卡换算（层数封顶 3）：伤害/冷却/范围/持续时间
    const b = this.skillBuffs;
    const dmgMul = 1 + 0.15 * b.dmg;
    const cdMul = Math.max(0.5, 1 - 0.08 * b.cd);
    const rangeMul = 1 + 0.10 * b.range;
    const durMul = 1 + 0.25 * b.duration;
    const cdActual = Math.round(skill.cooldown * cdMul * 100) / 100;
    skill.currentCooldown = cdActual;
    const aoe = skill.aoe > 0 && skill.aoe < 90 ? Math.round(skill.aoe * rangeMul * 10) / 10 : skill.aoe;
    const effect = skill.effect
      ? { ...skill.effect, duration: Math.round(skill.effect.duration * durMul * 100) / 100 }
      : null;
    // 已达成的升级关键节点（原版机制：等级解锁分支/特殊效果）
    const milestones = (SKILL_MILESTONES[skill.id] || [])
      .filter(m => skill.level >= m.level)
      .map(m => m.key);
    return {
      id: skill.id, type: skill.type,
      damage: Math.round(skill.damage * dmgMul * 100) / 100,
      range: skill.range,
      aoe,
      chain: skill.chain,
      effect,
      cooldownActual: cdActual,
      milestones,
      targetCol, targetRow, playerX: this.x, playerY: this.y,
    };
  }

  autoAttack(enemies) {
    if (this.autoAttackTimer > 0) return null;
    const sorted = enemies.filter(e => e.alive).sort((a, b) => b.row - a.row);
    if (sorted.length === 0) return null;
    const shot = this.useSkill('attack');
    if (!shot) return null; // 枪械冷却/沉默未就绪：不消耗射击间隔，下帧重试
    this.autoAttackTimer = this.autoAttackInterval;
    return shot;
  }

  /** 同步枪械射击节奏：攻速加成同时作用于射击间隔与枪械自身冷却（否则间隔<冷却时节拍性漏射）。取整防浮点尾数泄漏到 UI */
  setAttackCadence(interval) {
    this.autoAttackInterval = Math.round(interval * 1000) / 1000;
    const gun = this.skills.find(s => s.id === 'attack');
    if (gun) {
      gun.cooldown = Math.round(this.autoAttackInterval * Math.pow(LEVEL_CD_SCALE, Math.max(0, gun.level - 1)) * 1000) / 1000;
      gun.currentCooldown = Math.min(gun.currentCooldown, gun.cooldown);
    }
  }

  addXp(amount) {
    if (amount <= 0) return null;
    this.xp += amount;
    if (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level++;
      this.xpToNext = Math.round(this.xpToNext * 1.4) + 2;
      return { leveledUp: true, level: this.level };
    }
    return { leveledUp: false, level: this.level };
  }

  /** 解锁一个技能（升级三选一选取后调用） */
  unlockSkill(skillId) {
    const skill = this.skills.find(s => s.id === skillId);
    if (!skill || skill.unlocked) return false;
    skill.unlocked = true;
    skill.level = 1;
    this._applyLevel(skill);
    return true;
  }

  /** 被动技能等级（连射/穿透等子弹强化线），未解锁 = 0 */
  getPassiveLevel(passiveId) {
    const s = this.skills.find(k => k.id === passiveId);
    return s?.unlocked ? s.level : 0;
  }

  /** 检查进化配方是否可用（两原料均已解锁且满级） */
  canEvolve(recipe) {
    return recipe.ingredients.every(id => {
      const s = this.skills.find(k => k.id === id);
      return s?.unlocked && s.level >= MAX_SKILL_LEVEL;
    });
  }

  /** 执行进化：移除原料技能（evolved 标记），加入进化技能 Lv1 */
  evolve(recipe) {
    if (!this.canEvolve(recipe)) return { applied: false };
    for (const id of recipe.ingredients) {
      const s = this.skills.find(k => k.id === id);
      s.unlocked = false;
      s.evolved = true;
    }
    const evo = { ...recipe.result, unlocked: true, level: 1, rarity: 'orange' };
    this.skills.push(evo);
    this._applyLevel(evo);
    return { applied: true, skill: evo };
  }

  /** 三选一选项池：未解锁技能 + 可升级技能 + 进化卡 + 通用属性卡。rng 未传时退化为 Math.random（仅测试用） */
  getUpgradeOptions(count = 3, rng = null) {
    const options = [];
    // 进化卡（配方可用时优先注入，橘色传说）
    for (const recipe of EVO_RECIPES) {
      if (this.canEvolve(recipe) && !this.skills.some(s => s.id === recipe.result.id)) {
        options.push({
          kind: 'evolve', id: recipe.id, icon: recipe.icon, name: `✨ 进化：${recipe.name}`,
          rarity: 'orange', description: `${recipe.ingredients.join(' + ')} 满级合体 → ${recipe.result.desc}`,
        });
      }
    }
    for (const skill of this.skills) {
      if (skill.evolved) continue; // 已被进化的原料不再出选项
      if (!skill.unlocked) {
        options.push({
          kind: 'skill', id: skill.id, name: skill.name, icon: skill.icon,
          rarity: skill.rarity || 'blue', description: `解锁技能：${skill.desc}`,
        });
      } else if (skill.level < MAX_SKILL_LEVEL) {
        // 升级预览：按技能类型显示对应效果（被动无伤害/冷却，显示自身机制成长）
        let description;
        if (skill.type === 'passive') {
          description = skill.desc; // 被动升级 = 机制效果增强（如连射弹数+1），直接用描述
        } else {
          const rangeTxt = (skill.baseAoe > 0 && skill.baseAoe < 90) ? ' · 范围+0.3' : '';
          const chainTxt = skill.baseChain > 0 && (skill.level + 1 - 1) % 2 === 0 ? ' · 链+1' : '';
          // 升级预览：当前 → 下一级 具体数值（对齐原版图鉴感）
          const curDmg = skill.damage;
          const nextDmg = Math.round(curDmg * LEVEL_DMG_SCALE * 100) / 100;
          const curCd = skill.cooldown;
          const nextCd = Math.round(curCd * LEVEL_CD_SCALE * 100) / 100;
          description = `伤害 ${curDmg}→${nextDmg} · 冷却 ${curCd}s→${nextCd}s${rangeTxt}${chainTxt}`;
        }
        options.push({
          kind: 'skillUp', id: skill.id, icon: skill.icon,
          name: `${skill.name} Lv.${skill.level} → Lv.${skill.level + 1}`,
          rarity: LEVEL_RARITY[skill.level + 1] || 'blue',
          description,
        });
      }
    }
    options.push(...STAT_CARDS);
    // 技能强化卡（全局作用于主动技，各上限 3 层）
    const SKILL_BUFF_CARDS = [
      { kind: 'skillBuff', id: 'sb_range', buff: 'range', name: '范围强化', icon: '⭕', rarity: 'blue', description: '所有技能范围 +10%' },
      { kind: 'skillBuff', id: 'sb_duration', buff: 'duration', name: '持续强化', icon: '⏳', rarity: 'blue', description: '灼烧/减速/中毒持续时间 +25%' },
      { kind: 'skillBuff', id: 'sb_cd', buff: 'cd', name: '冷却强化', icon: '⚡', rarity: 'purple', description: '技能冷却 -8%' },
      { kind: 'skillBuff', id: 'sb_dmg', buff: 'dmg', name: '技能强化', icon: '🌟', rarity: 'purple', description: '所有技能伤害 +15%' },
    ];
    for (const card of SKILL_BUFF_CARDS) {
      if (this.skillBuffs[card.buff] < 3) {
        options.push({ ...card, description: `${card.description}（${this.skillBuffs[card.buff]}/3）` });
      }
    }
    // 洗牌后取前 count 个
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor((rng ? rng.next() : Math.random()) * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }
    return options.slice(0, count);
  }

  applyUpgrade(option) {
    if (option.kind === 'skillBuff') {
      const card = { sb_range: 'range', sb_duration: 'duration', sb_cd: 'cd', sb_dmg: 'dmg' }[option.id];
      if (!card || this.skillBuffs[card] >= 3) return { applied: false, type: 'skillBuff' };
      this.skillBuffs[card]++;
      return { applied: true, type: 'skillBuff', stacks: this.skillBuffs[card] };
    }
    if (option.kind === 'evolve') {
      const recipe = EVO_RECIPES.find(r => r.id === option.id);
      if (!recipe) return { applied: false, type: 'evolve' };
      const r = this.evolve(recipe);
      return { applied: r.applied, type: 'evolve', skill: r.skill };
    }
    if (option.kind === 'skill') return { applied: this.unlockSkill(option.id), type: 'skill' };
    if (option.kind === 'skillUp') {
      const skill = this.skills.find(s => s.id === option.id);
      if (!skill || !skill.unlocked || skill.level >= MAX_SKILL_LEVEL) {
        return { applied: false, type: 'skillUp' };
      }
      skill.level++;
      this._applyLevel(skill);
      return { applied: true, type: 'skillUp', level: skill.level };
    }
    // 属性卡 → Modifier 管线（负 mul_pct = 攻速提升）
    switch (option.id) {
      case 'stat_attack_speed': this.pendingStatMods.push({ id: 'stat_attack_speed', source: 'upgrade', stat: 'attackSpeed', type: 'mul_pct', value: -0.15 }); break;
      case 'stat_damage': this.pendingStatMods.push({ id: 'stat_damage', source: 'upgrade', stat: 'damage', type: 'mul_pct', value: 0.20 }); break;
      case 'stat_crit': this.pendingStatMods.push({ id: 'stat_crit', source: 'upgrade', stat: 'critRate', type: 'add', value: 0.10 }); break;
      case 'stat_speed': this.pendingStatMods.push({ id: 'stat_speed', source: 'upgrade', stat: 'attackSpeed', type: 'mul_pct', value: -0.30 }); break;
    }
    return { applied: true, type: 'stat' };
  }
}
