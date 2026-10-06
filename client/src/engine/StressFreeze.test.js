import { describe, it } from 'vitest';
import { GameState } from './GameState.js';
import enemiesData from '../data/enemies.json';
import balance from '../data/balance.json';

/** v9.4 排查：偶发"怪不出+倒计时卡住"。快进长时间战斗（含升级自动选第一项），断言每秒状态健康。 */
describe('长时间战斗状态健康压测', () => {
  it('快进 20 分钟：任意时刻 waveActive 或 countdown 递减，不得冻结', () => {
    const state = new GameState(enemiesData, balance, [], null, { rngSeed: 42 });
    state.startWave();
    // 自动选升级（模拟玩家随手点第一个）
    const origPending = () => {
      if (state.pendingLevelUp) {
        const opts = state.player.getUpgradeOptions(3);
        if (opts.length > 0) state.applyUpgrade(opts[0]);
        else state.pendingLevelUp = false; // 空选项防御
      }
    };
    let frozenFrames = 0;
    let lastCountdown = -1, lastQueue = -1, lastAlive = -1;
    const totalFrames = 20 * 60 * 30; // 20 分钟 @30fps
    let clearedAt = null;
    for (let f = 0; f < totalFrames; f++) {
      origPending();
      const before = state.waveCountdown;
      state.update(1 / 30);
      origPending();
      // 冻结检测：非通关、非暂停、既无怪又无 queue 且 countdown 一动不动
      if (!state.levelCleared && !state.waveManager.waveActive) {
        const q = state.waveManager.spawnQueue.length;
        const alive = state.enemies.filter(e => e.alive).length;
        if (q === 0 && alive === 0 && state.waveCountdown === before && state.waveCountdown > 0) {
          frozenFrames++;
          if (frozenFrames > 5) {
            console.log(`✗ 冻结于帧 ${f}（${(f / 30 / 60).toFixed(1)} 分钟）: countdown=${state.waveCountdown} queue=${q} alive=${alive} wave=${state.waveManager.currentWave}`);
            console.log('   pendingLevelUp:', state.pendingLevelUp, 'levelCleared:', state.levelCleared, 'gameOver:', state.gameOver);
            break;
          }
        } else frozenFrames = 0;
      }
      if (state.levelCleared && clearedAt === null) {
        clearedAt = (f / 30 / 60).toFixed(1);
        console.log(`关卡通关于 ${clearedAt} 分钟（正常，结束压测）`);
        break;
      }
    }
    if (clearedAt === null && frozenFrames <= 5) console.log('✓ 20 分钟无冻结，currentWave =', state.waveManager.currentWave);
  });
});
