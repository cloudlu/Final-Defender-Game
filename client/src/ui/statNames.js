/** 游戏属性中文映射（UI 显示统一用） */
export const STAT_NAMES = {
  damage: '伤害',
  attackSpeed: '攻速',
  range: '射程',
  critRate: '暴击率',
  critDamage: '暴击伤害',
  slowPct: '减速强度',
  goldBonus: '金币获取',
  wallHp: '城墙血量',
  xpBonus: '经验获取',
  baseAttack: '攻击力',
  gunDamage: '枪械伤害',
  instantKill: '秒杀',
  teleport: '传送',
  element_fire: '火系伤害',
  element_ice: '冰系伤害',
  element_electric: '电系伤害',
  element_wind: '风系伤害',
  element_physical: '物理系伤害',
  element_energy: '能量系伤害',
  debuffTargetDamage: '对负面怪物伤害',
  highHpTargetDamage: '对高血怪物伤害',
  explodeDamage: '爆炸伤害',
};

/** 任意词条名兜底转中文（存储值可能是英文 stat） */
export function affixCn(nameOrStat) {
  return STAT_NAMES[nameOrStat] || nameOrStat;
}

/** 单条 effect 的中文描述："damage +5" → "伤害 +5"、"mul_pct -0.12" → "攻速 +12%"（attackSpeed 负值=更快） */
export function describeEffect(effect, { scale = 1 } = {}) {
  const name = STAT_NAMES[effect.stat] || affixCn(effect.name) || effect.stat;
  const v = Math.round(effect.value * scale * 100) / 100;
  if (effect.stat === 'attackSpeed' || effect.stat === 'attackSpeed') {
    const pct = Math.round(-v * 100);
    return pct >= 0 ? `${name} +${pct}%` : `${name} ${pct}%`;
  }
  const isPct = effect.pct || effect.type === 'mul_pct';
  const abs = isPct ? `+${Math.round(v * 100) / 100}%` : `+${v}`;
  return `${name} ${abs}`;
}
