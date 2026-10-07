/**
 * 平衡演算报告（策划工具）：全技能/全敌人的量化表 + 自动标红失衡点。
 * 用法：node tools/balance-report.cjs
 * 读 JSON 配置直算，不进游戏——改配置后重跑即看全局影响。
 */
const fs = require('fs');
const path = require('path');

const playerSrc = require('fs').readFileSync(path.join(__dirname, '../src/engine/Player.js'), 'utf8');
const enemies = require('../src/data/enemies.json');
const levels = require('../src/data/levels.json').levels;

// ===== 从 Player.js 解析技能表（单一数据源，避免两处维护）=====
const rows = [...playerSrc.matchAll(
  /\{ id: '(\w+)', name: '([^']+)', icon: '[^']+', type: '(\w+)', baseDamage: ([\d.]+), baseCooldown: ([\d.]+), baseAoe: ([\d.]+), baseChain: (\d+)/g
)].map(m => ({
  id: m[1], name: m[2], type: m[3],
  dmg: +m[4], cd: +m[5], aoe: +m[6], chain: +m[7],
}));

const DMG_SCALE = 1.25, CD_SCALE = 0.90;
const GUN_DPS = 20 / 0.3;           // 枪械基线 66.7（面板 ×1.0）
const DPS_BAND = { lo: 0.08, hi: 0.50 }; // 技能 DPS 相对枪械的合理带（8%~50%）

// 类型系数：爆发技一次伤害打一篮子；持续/直线覆盖多个目标按 ×1.4 折算（粗校正）
const TYPE_MULT = { zone: 1.4, pierceLine: 1.4, beam: 1.4, cone: 1.2, sweep: 1.2, airstrike: 1.0, projectile: 1.0, guided: 1.0, drone: 1.0 };

// ===== 技能表 =====
console.log('════════ 技能 DPS 表（Lv1 / Lv5，枪械基线 100%）════════');
console.log('id'.padEnd(14), 'type'.padEnd(11), 'Lv1 DPS'.padStart(8), 'Lv5 DPS'.padStart(8), '对枪械'.padStart(7), '  标记');
console.log('-'.repeat(78));
const actives = rows.filter(r => r.type !== 'passive');
const flagged = [];
for (const s of actives) {
  const dps1 = s.dmg / s.cd;
  const dmg5 = s.dmg * Math.pow(DMG_SCALE, 4);
  const cd5 = s.cd * Math.pow(CD_SCALE, 4);
  const dps5 = dmg5 / cd5;
  const eff1 = dps1 * (TYPE_MULT[s.type] || 1);
  const ratio = eff1 / GUN_DPS;
  const flags = [];
  if (ratio < DPS_BAND.lo) flags.push('🔴 过低（<8% 枪械）');
  else if (ratio > DPS_BAND.hi) flags.push('🟠 过高（>50% 枪械）');
  // 控场技能（低伤害高 CD）标注"控场"而非直接标红
  if (s.dmg / GUN_DPS < 0.05 && flags.length === 0) flags.push('⚪ 控场型（低伤有意，升级涨控制）');
  if (flags.length) flagged.push({ s, flags, dps1, dps5, ratio });
  console.log(
    s.id.padEnd(14), s.type.padEnd(11),
    dps1.toFixed(1).padStart(8), dps5.toFixed(1).padStart(8),
    (ratio * 100).toFixed(1).padStart(6) + '%',
    '  ' + flags.join(' ')
  );
}

// ===== 失衡摘要 =====
console.log('\n════════ 失衡摘要 ════════');
const lows = flagged.filter(f => f.flags.some(x => x.includes('过低')));
const his = flagged.filter(f => f.flags.some(x => x.includes('过高')));
const controls = flagged.filter(f => f.flags.some(x => x.includes('控场')));
console.log(`🔴 DPS 过低（<8%）: ${lows.map(f => f.s.id).join(', ') || '无'}`);
console.log(`🟠 DPS 过高（>50%）: ${his.map(f => f.s.id).join(', ') || '无'}`);
console.log(`⚪ 控场型（设计使然）: ${controls.map(f => f.s.id).join(', ')}`);

// ===== 敌人有效血量曲线 & 关卡压力 =====
console.log('\n════════ 关卡压力曲线（每关 wave 总血量 vs 关卡墙血）════════');
console.log('id'.padEnd(8), 'diff'.padStart(6), 'waves'.padStart(6), '波均总血'.padStart(10), '墙血'.padStart(5));
console.log('-'.repeat(50));
const sampleIds = ['S1-01','S1-13','S1-25','S1-38','S1-50','S2-01','S2-25','S2-50','S3-01','S3-25','S3-50','S4-01','S4-25','S4-50'];
const hpById = Object.fromEntries(enemies.map(e => [e.id, e.hp]));
for (const id of sampleIds) {
  const l = levels.find(x => x.id === id);
  if (!l) continue;
  // 波均总血：每波每类 8 只 × 基础血 × difficulty
  let waveHp = 0;
  if (Array.isArray(l.enemyWaves) && l.enemyWaves[0]) {
    const kinds = l.enemyWaves[0].filter(k => k !== 'BOSS');
    for (const k of kinds) waveHp += (hpById[k] || 100) * 8;
  }
  waveHp *= l.difficulty;
  console.log(id.padEnd(8), String(l.difficulty).padStart(6), String(l.enemyWaves?.length ?? 0).padStart(6), String(Math.round(waveHp)).padStart(10), String(l.wallHp).padStart(5));
}

// ===== 赏金比审计 =====
console.log('\n════════ 赏金/血量比审计（基准 0.10，机制怪允许 0.12~0.25）════════');
const outliers = enemies.filter(e => { const r = e.bounty / e.hp; return r < 0.08 || r > 0.25; });
for (const e of outliers) {
  const r = (e.bounty / e.hp).toFixed(2);
  console.log(`${e.id.padEnd(16)} bounty/hp = ${r} ${r < 0.08 ? '🟠 偏低（击杀不划算）' : '⚪ 机制溢价（确认是否有机制）'}`);
}
if (outliers.length === 0) console.log('全部在合理带内 ✓');

console.log('\n用法提示：改 src/engine/Player.js 技能表或 data/*.json 后重跑本脚本即可看到全局影响。');
