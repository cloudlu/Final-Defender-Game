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
};

/** 单条 effect 的中文描述："damage +5" → "伤害 +5"、"mul_pct -0.12" → "攻速 +12%"（attackSpeed 负值=更快） */
export function describeEffect(effect, { scale = 1 } = {}) {
  const name = STAT_NAMES[effect.stat] || effect.stat;
  const v = Math.round(effect.value * scale * 100) / 100;
  if (effect.stat === 'attackSpeed') {
    // 间隔语义：负值 = 更快
    const pct = Math.round(-v * 100);
    return pct >= 0 ? `${name} +${pct}%` : `${name} ${pct}%`;
  }
  const abs = effect.type === 'add' ? `+${v}` : `+${Math.round(v * 100)}%`;
  return `${name} ${abs}`;
}
