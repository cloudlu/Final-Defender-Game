/**
 * ModifierPipeline: unified buff resolution.
 * Formula (order fixed, registration order irrelevant):
 *   final = (base + Σadd) × (1 + Σmul_pct) × Πmul
 * Per-stat caps applied last. 概率类(critRate)走 add 绝对值封顶。
 *
 * attackSpeed 约定：stat 值为"攻击间隔缩放"，1 = 正常，<1 = 更快。
 * mul_pct 为负值表示加速（如 -0.20 = 间隔 x0.8 ≈ 攻速 +25%）。
 * balance.json 的 attackSpeed cap=2.0 表示"攻速最多翻倍"，
 * 换算到间隔语义 = 间隔下限 1/2.0 = 0.5。
 */
export class ModifierPipeline {
  constructor(caps = {}) {
    this.caps = caps;
  }

  /**
   * @param {number} baseValue
   * @param {string} stat
   * @param {Array<{stat:string,type:string,value:number}>} modifiers
   * @returns {number} rounded to 4 decimals
   */
  resolve(baseValue, stat, modifiers) {
    let add = 0, mulPct = 0, mul = 1;
    for (const m of modifiers) {
      if (m.stat !== stat) continue;
      if (m.type === 'add') add += m.value;
      else if (m.type === 'mul_pct') mulPct += m.value;
      else if (m.type === 'mul') mul *= m.value;
    }
    const raw = (baseValue + add) * (1 + mulPct) * mul;
    const capped = this._clamp(stat, raw, baseValue);
    return Math.round(capped * 10000) / 10000;
  }

  _clamp(stat, value, baseValue) {
    const cap = this.caps[stat];
    if (cap === undefined) return value;
    if (stat === 'attackSpeed') {
      // 间隔语义：cap 限定"最快攻速倍率"，间隔下限 = base/cap
      return Math.max(value, baseValue / cap);
    }
    if (ABSOLUTE_CAP_STATS.has(stat)) {
      // 概率/加值类：cap 是绝对上限
      return Math.min(value, cap);
    }
    // 倍率类：cap 表示"最大为 base 的 cap 倍"
    return Math.min(value, baseValue * cap);
  }
}

// cap 为绝对值（非基数的倍数）的 stat
const ABSOLUTE_CAP_STATS = new Set(['range', 'critRate', 'slowPct']);
