/**
 * 射速实测：对比攻速加成前后的实际射击频率。
 */
const fs = require('fs');

async function main() {
  const { GameState } = await import('./src/engine/GameState.js');
  const { Enemy } = await import('./src/engine/Enemy.js');
  const { EquipmentForgeSystem } = await import('./src/engine/EquipmentForgeSystem.js');
  const enemiesData = JSON.parse(fs.readFileSync('src/data/enemies.json', 'utf8'));
  const balance = JSON.parse(fs.readFileSync('src/data/balance.json', 'utf8'));
  const equipment = JSON.parse(fs.readFileSync('src/data/equipment.json', 'utf8'));

  function setup(withGear) {
    const forgeSave = { inventory: [], nextUid: 1, forgeLevels: {}, forgeStones: 100, gunResearch: { level: 0 } };
    const forge = new EquipmentForgeSystem(equipmentData, forgeSave);
    const state = new GameState(enemiesData, balance, [], null, {
      rngSeed: 7,
      forgeSystem: forge,
      equippedMap: {},
    });
    state.startWave();
    state.waveManager.spawnQueue.length = 0;
    state.enemies.length = 0;
    const e = new Enemy(enemiesData.find(c => c.id === 'enemy_basic'), 4, 5, 1);
    e.hp = 999999;
    state.enemies.push(e);
    if (withGear) {
      const entry = forge.generate({ slot: 'shoes', tier: 5, quality: 'blue', rngLike: { next: () => 0.9 } });
      entry.affixes = [{ poolId: 'atkspd', name: '攻速', stat: 'attackSpeed', type: 'mul_pct', value: 22, pct: true, locked: false }];
      state.equippedMap = state.equippedMap || {};
      state.equippedMap.shoes = entry.uid;
    }
    return state;
  }

  function countShots(state, seconds) {
    let shots = 0;
    const frames = seconds * 30;
    for (let i = 0; i < frames; i++) {
      state.update(1 / 30);
      shots += state.projectiles.filter(p => p.skillId === 'attack').length;
    }
    return shots;
  }

  console.log('=== 20 秒射击实测（只统计枪械弹） ===');
  const s1 = setup(false);
  console.log('拾取前 attackSpeed:', s1.getResolvedStats().attackSpeed.toFixed(2));
  const n1 = countShots(s1, 20);
  console.log('拾取前:', n1, '发 →', (n1 / 20).toFixed(1), '发/秒');

  const s2 = setup(true);
  console.log('穿戴攻速鞋 attackSpeed:', s2.getResolvedStats().attackSpeed.toFixed(2));
  const n2 = countShots(s2, 20);
  console.log('拾取后:', n2, '发 →', (n2 / 20).toFixed(1), '发/秒');

  console.log('\n增益倍率:', (n2 / Math.max(1, n1)).toFixed(2), '（应 ≈ 攻速倍率 1.22）');
}
main().catch(e => { console.error(e); process.exit(1); });
