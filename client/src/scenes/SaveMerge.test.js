import { describe, it, expect } from 'vitest';

/**
 * 回归（v8.6）：MenuScene 远端存档合并策略。
 * 旧策略"远端 gold > 本地 gold 就覆盖"会把抽卡/兑换结果回滚——
 * 抽卡花钱不減 gold，单字段对比失真，陈远端快照反而胜出。
 * 新策略：lastline_globalsave_ts（本地保存时间）vs remote.timestamp 决胜。
 * 这里锁定决策函数语义（MenuScene 内联逻辑的提取等价实现）。
 */
describe('远端存档合并策略（时间戳决胜）', () => {
  function decide(localIso, remoteIso) {
    const localTs = Date.parse(localIso || '') || 0;
    const remoteTs = Date.parse(remoteIso || '') || 0;
    if (remoteTs > localTs) return 'adopt-remote';
    if (remoteTs > 0 && localTs > 0) return 'push-local';
    return 'keep-local';
  }

  it('本地比远端新（刚抽完卡）→ 不采用远端，反向推送', () => {
    expect(decide('2026-10-01T07:00:00Z', '2026-10-01T06:51:12Z')).toBe('push-local');
  });

  it('远端比本地新（另一设备有更新动作）→ 采用远端', () => {
    expect(decide('2026-10-01T06:00:00Z', '2026-10-01T06:51:12Z')).toBe('adopt-remote');
  });

  it('本地无时间戳（旧档首次迁移）→ 采用远端（首次同步基线）', () => {
    expect(decide('', '2026-10-01T06:51:12Z')).toBe('adopt-remote');
  });

  it('远端无时间戳（异常响应）→ 保留本地', () => {
    expect(decide('2026-10-01T07:00:00Z', '')).toBe('keep-local');
  });

  /** 旧策略的失真场景：抽卡花钻不减 gold，旧快照 gold 更大 → 旧策略会错误采用远端 */
  it('旧策略失真案例：本地抽卡后 gold 不变，远端旧快照 gold 更大——新策略仍保本地', () => {
    // 本地 ts 在抽卡后（07:00），远端旧快照 ts 早（06:51），即使远端 gold 更大也不采用
    const localIso = '2026-10-01T07:00:00Z';
    const remoteIso = '2026-10-01T06:51:12Z';
    expect(decide(localIso, remoteIso)).not.toBe('adopt-remote');
  });
});
