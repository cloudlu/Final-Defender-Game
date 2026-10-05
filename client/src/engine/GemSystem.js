import gemData from '../data/gems.json';

/**
 * GemSystem: 宝石系统（v5.3 原版对齐）。
 * - 通用词条（所有部位）+ 部位专属词条池（头盔头选/裤子秒杀/护臂精英增伤等）
 * - 镶嵌：6 部位 × 2 孔；自由拆装
 * - 合成：3 同词条同品质 → 高品质
 * - 套装：6 件同色 → 全伤害 +12%
 * - 特殊词条（秒杀/传送/枪械/各系/精英增伤等）由 GameState 单独消费
 */
export class GemSystem {
  constructor(config = gemData, save = null) {
    this.config = config;
    this.save = save || {
      collection: {},
      sockets: {},
      nextUid: 1,
    };
    this.save.sockets = this.save.sockets || {};
  }

  /** 百分比折算攻击的单位（12% 全伤害 ≈ 12 攻，与 gemPower 锚点一致） */
  static BASE_POWER_UNIT = 1;

  _allAffixes() {
    return [...this.config.generalAffixes, ...Object.values(this.config.slotAffixes).flat()];
  }

  _affix(affixId) {
    return this._allAffixes().find(a => a.id === affixId) || null;
  }

  /** 按 id 查词条配置（UI 层用；gems.json 结构是 generalAffixes+slotAffixes，无平铺 affixes 字段） */
  getAffix(affixId) {
    return this._affix(affixId);
  }

  /** 生成宝石：部位池 = 通用 + 该部位专属（专属约 30% 概率）。
   * minQuality：保底品质（抽卡稀有度映射用）；专属词条另受自身 minQuality 门槛过滤 */
  generate(rngLike, slot = null, minQuality = 0) {
    const qualityWeights = [40, 25, 18, 10, 4, 2, 1];
    const total = qualityWeights.reduce((a, b) => a + b, 0);
    let roll = (rngLike?.next?.() ?? Math.random()) * total;
    let quality = 0;
    for (let q = 0; q < qualityWeights.length; q++) {
      roll -= qualityWeights[q];
      if (roll <= 0) { quality = q; break; }
    }
    quality = Math.max(quality, Math.min(minQuality, this.config.qualities.length - 1));
    let pool = this.config.generalAffixes;
    const slotPool = slot ? (this.config.slotAffixes[slot] || []) : [];
    if (slotPool.length > 0 && (rngLike?.next?.() ?? Math.random()) < 0.3) pool = slotPool;
    // 尊重 minQuality（专属至尊词条低品质不出），过滤后为空则回退通用池
    const valid = pool.filter(a => (a.minQuality ?? 0) <= quality);
    const from = valid.length ? valid : this.config.generalAffixes;
    const affix = from[Math.floor((rngLike?.next?.() ?? Math.random()) * from.length)];
    const uid = `g${this.save.nextUid++}`;
    this.save.collection[uid] = { affixId: affix.id, quality };
    return { uid, affixId: affix.id, quality };
  }

  gemValue(gem) {
    const affix = this._affix(gem.affixId);
    return affix ? (affix.values[gem.quality] ?? affix.values[0]) : 0;
  }

  /**
   * 单颗宝石战力分（原版语义：战力 = 总攻击力聚合，所有词条折算成"等效攻击力"相加）。
   * 折算锚点：攻击力 add 型 1:1；百分比伤害型按"基准攻击 100 × 百分比"折算；
   * 功能型（秒杀/传送/头选/质变）给固定高权重（攻略共识：百分比>穿透>秒杀>传送）。
   * 返回 0 表示当前品质无效果（废宝石，不可合成素材以外用途）。
   */
  gemPower(gem) {
    const affix = this._affix(gem.affixId);
    if (!affix) return 0;
    const v = this.gemValue(gem);
    if (v <= 0) return 0;
    const st = affix.stat;
    const BASE_ATK = 100; // 百分比词条折算锚点（中期面板攻击量级）
    if (st === 'baseAttack') return v;                       // add 型 1:1
    if (st === 'wallHp') return v * 0.1;                     // 200 血 ≈ 20 攻防御价值
    if (st === 'critRate') return v * 12;                    // 1% 暴击 ≈ 12 攻（期望伤害换算）
    if (st === 'damage') return v * BASE_ATK / 100;          // 全伤害百分比
    if (st?.startsWith('element_') || st?.startsWith('skill_')) return v * BASE_ATK / 100 * 1.2; // 系伤/技能伤略高于泛用
    if (st === 'gunDamage') return v * BASE_ATK / 100;
    if (st === 'eliteDamage') return v * BASE_ATK / 100 * 0.8;   // 限目标打折
    if (st === 'debuffTargetDamage' || st === 'highHpTargetDamage' || st === 'lowHpWallDamage') return v * BASE_ATK / 100 * 0.7;
    if (st === 'explodeDamage') return v * BASE_ATK / 100 * 0.8;
    if (st === 'cdReduce') return v * 15;                    // 1% 冷却 ≈ 15 攻（循环价值）
    if (st === 'gunPierce') return v * 60;
    if (st === 'gunVolley') return v * 150;
    if (st === 'allPierce') return v * 80;                   // 穿透+3 ≈ 240
    if (st === 'instantKill') return 200;                    // 秒杀固定高分（前 100 关神级）
    if (st === 'teleport') return 100;
    if (st === 'extraPick') return 250;                      // 头选：开局节奏神词条
    if (st === 'debuffExtend') return v * 6;
    if (st === 'wallBlock') return v * 25;
    if (['airstrikeShock', 'icestormCd', 'thermBounce', 'thermBurnZone', 'cycloneBurn', 'empBurn', 'iceRank'].includes(st)) return 180; // 至尊质变词条
    return v * BASE_ATK / 100; // 未知词条兜底按百分比折算
  }

  /** 全局战力聚合（宝石侧）：已镶 12 孔宝石分数总和 + 套装加成折算 */
  getTotalGemPower() {
    let total = 0;
    for (const gem of this.getSocketed()) total += this.gemPower(gem);
    if (this.getSocketedCount() >= this.config.setMaxBonus.count * 2) {
      total += this.config.setMaxBonus.pct * GemSystem.BASE_POWER_UNIT; // 套装 12% 全伤害折算（静态属性须类名限定）
    }
    return Math.round(total);
  }

  gemName(gem) {
    return this._affix(gem.affixId)?.name || gem.affixId;
  }

  equip(slot, socketIdx, gemUid) {
    if (!this.save.collection[gemUid]) return { success: false, reason: 'missing' };
    if (socketIdx < 0 || socketIdx >= (this.config.socketsPerEquipment || 2)) {
      return { success: false, reason: 'bad_socket' };
    }
    for (const s of Object.keys(this.save.sockets)) {
      this.save.sockets[s] = this.save.sockets[s].map(u => (u === gemUid ? null : u));
    }
    const arr = this.save.sockets[slot] || [null, null];
    const replaced = arr[socketIdx];
    arr[socketIdx] = gemUid;
    this.save.sockets[slot] = arr;
    return { success: true, replaced };
  }

  unequip(slot, socketIdx) {
    const arr = this.save.sockets[slot];
    if (!arr || arr[socketIdx] == null) return null;
    const gemUid = arr[socketIdx];
    arr[socketIdx] = null;
    return gemUid;
  }

  getSocketed() {
    const out = [];
    for (const [slot, arr] of Object.entries(this.save.sockets)) {
      (arr || []).forEach((uid, idx) => {
        if (uid && this.save.collection[uid]) {
          out.push({ slot, socketIdx: idx, uid, ...this.save.collection[uid] });
        }
      });
    }
    return out;
  }

  /** 镶嵌宝石数量（套装判定用） */
  getSocketedCount() {
    return this.getSocketed().length;
  }

  /**
   * 全部宝石效果：管线 mods（通用数值词条）+ specials（战斗事件型词条）+ set（套装）。
   */
  getAllModifiers() {
    const mods = [];
    const specials = {
      instantKill: 0, teleport: 0, gunDamage: 0, gunPierce: 0, gunVolley: 0, extraPick: 0,
      cdReduce: 0, eliteDamage: 0, explodeDamage: 0, debuffTargetDamage: 0, highHpTargetDamage: 0,
      lowHpWallDamage: 0, wallBlock: 0, debuffExtend: 0,
      airstrikeShock: 0, icestormCd: 0, thermBounce: 0, thermBurnZone: 0, cycloneBurn: 0,
      elements: {}, // { fire: 8, ... } 六系伤害
      skillDmg: {},
    };
    for (const gem of this.getSocketed()) {
      const affix = this._affix(gem.affixId);
      if (!affix) continue;
      const value = this.gemValue(gem);
      const st = affix.stat;
      if (st === 'instantKill') specials.instantKill = Math.max(specials.instantKill, value);
      else if (st === 'teleport') specials.teleport = Math.max(specials.teleport, value);
      else if (st === 'gunDamage') specials.gunDamage += value;
      else if (st === 'gunPierce') specials.gunPierce += value;
      else if (st === 'gunVolley') specials.gunVolley += value;
      else if (st === 'extraPick') specials.extraPick += value;
      else if (st === 'cdReduce') specials.cdReduce += value;
      else if (st === 'eliteDamage') specials.eliteDamage += value;
      else if (st === 'explodeDamage') specials.explodeDamage += value;
      else if (st === 'debuffTargetDamage') specials.debuffTargetDamage += value;
      else if (st === 'highHpTargetDamage') specials.highHpTargetDamage += value;
      else if (st === 'lowHpWallDamage') specials.lowHpWallDamage += value;
      else if (st === 'wallBlock') specials.wallBlock += value;
      else if (st === 'debuffExtend') specials.debuffExtend = (specials.debuffExtend || 0) + value;
      else if (st === 'airstrikeShock') specials.airstrikeShock = Math.max(specials.airstrikeShock || 0, value);
      else if (st === 'icestormCd') specials.icestormCd = Math.max(specials.icestormCd || 0, value);
      else if (st === 'thermBounce') specials.thermBounce = Math.max(specials.thermBounce || 0, value);
      else if (st === 'thermBurnZone') specials.thermBurnZone = Math.max(specials.thermBurnZone || 0, value);
      else if (st === 'cycloneBurn') specials.cycloneBurn = Math.max(specials.cycloneBurn || 0, value);
      else if (st?.startsWith('element_')) {
        const el = st.replace('element_', '');
        specials.elements[el] = (specials.elements[el] || 0) + value;
      } else if (st?.startsWith('skill_')) {
        const sid = st.replace('skill_', '');
        specials.skillDmg[sid] = (specials.skillDmg[sid] || 0) + value;
      } else {
        mods.push({
          id: `gem_${gem.uid}`,
          source: 'gem',
          stat: st,
          type: affix.type,
          value: affix.pct ? value / 100 : value,
        });
      }
    }
    // 套装：6 件同色 → 全伤害 +12%（原版）。此处以"镶嵌满 12 孔"近似 6 件齐
    if (this.getSocketedCount() >= this.config.setMaxBonus.count * 2) {
      mods.push({ id: 'gem_set_bonus', source: 'gem_set', stat: 'damage', type: 'mul_pct', value: this.config.setMaxBonus.pct / 100 });
    }
    return { mods, specials };
  }

  /** 合成：3 同词条同品质 → 高品质（词条不变） */
  combine(uids) {
    if (!Array.isArray(uids) || uids.length !== 3) return { success: false, reason: 'need_three' };
    const gems = uids.map(u => this.save.collection[u]).filter(Boolean);
    if (gems.length !== 3) return { success: false, reason: 'missing' };
    const socketed = new Set(this.getSocketed().map(g => g.uid));
    if (uids.some(u => socketed.has(u))) return { success: false, reason: 'socketed' };
    const [a, b, c] = gems;
    if (a.affixId !== b.affixId || b.affixId !== c.affixId) return { success: false, reason: 'mismatch_affix' };
    if (a.quality !== b.quality || b.quality !== c.quality) return { success: false, reason: 'mismatch_quality' };
    if (a.quality >= this.config.qualities.length - 1) return { success: false, reason: 'max_quality' };
    const uidSet = new Set(uids);
    for (const u of uidSet) delete this.save.collection[u];
    const quality = a.quality + 1;
    const uid = `g${this.save.nextUid++}`;
    this.save.collection[uid] = { affixId: a.affixId, quality };
    return { success: true, gem: { uid, affixId: a.affixId, quality } };
  }
}
