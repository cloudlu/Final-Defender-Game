/**
 * 射速实测 v3：钉住测试敌人（防行军/泄漏噪声），对比修复前/后的实际射速。
 * buggy=true 时在运行时复刻修复前的 autoAttack（先消耗间隔再尝试开火）。
 */
const fs = require('fs');

async function main() {
  const { GameState } = await import('./src/engine/GameState.js');
  const { Enemy } = await import('./src/engine/Enemy.js');
  const enemiesData = JSON.parse(fs.readFileSync('src/data/enemies.json', 'utf8'));
  const balance = JSON.parse(fs.readFileSync('src/data/balance.json', 'utf8'));

  function setup(cardIds) {
    const state = new GameState(enemiesData, balance, [], null, { rngSeed: 7 });
    state.startWave();
    state.waveManager.spawnQueue.length = 0;
    state.enemies.length = 0;
    const e = new Enemy(enemiesData.find(c => c.id === 'enemy_basic'), 4, 5, 1);
    e.hp = 999999;
    e.maxHp = 999999;
    state.enemies.push(e);
    for (const id of cardIds) state.player.applyUpgrade({ kind: 'stat', id });
    return { state, e };
  }

  function countShots(state, enemy, seconds, buggy) {
    if (buggy) {
      state.player.autoAttack = function (enemies) {
        if (this.autoAttackTimer > 0) return null;
        const sorted = enemies.filter(e2 => e2.alive).sort((a, b) => b.row - a.row);
        if (sorted.length === 0) return null;
        this.autoAttackTimer = this.autoAttackInterval;
        return this.useSkill('attack');
      };
    }
    let shots = 0;
    const orig = state._createProjectile.bind(state);
    state._createProjectile = (skillId, ...rest) => {
      if (skillId === 'attack') shots++;
      return orig(skillId, ...rest);
    };
    for (let i = 0; i < seconds * 30; i++) {
      state.update(1 / 30);
      enemy.row = 5; enemy.col = 4; // 钉住
      enemy.hp = 999999;
    }
    return shots;
  }

  const cases = [
    ['无加成', []],
    ['-15%（射速提升）', ['stat_attack_speed']],
    ['-30%（攻速狂暴）', ['stat_speed']],
    ['-45%（两张）', ['stat_attack_speed', 'stat_speed']],
  ];

  for (const buggy of [true, false]) {
    console.log(`\n===== ${buggy ? '修复前' : '修复后'}（20 秒实测） =====`);
    const results = [];
    for (const [label, cards] of cases) {
      const { state, e } = setup(cards);
      const s = state.getResolvedStats();
      const interval = 0.4 / s.attackSpeed;
      const n = countShots(state, e, 20, buggy);
      results.push({ label, n });
      console.log(`${label}: 攻速=${s.attackSpeed.toFixed(3)} 间隔=${interval.toFixed(3)}s → ${n} 发（${(n / 20).toFixed(2)} 发/秒）`);
    }
    const base = results[0].n;
    for (const r of results.slice(1)) {
      console.log(`  ${r.label} 相对无加成: ${((r.n / base - 1) * 100).toFixed(0)}%`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
