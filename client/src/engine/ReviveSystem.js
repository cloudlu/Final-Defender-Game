/**
 * ReviveSystem: 墙破复活（Meta 层，消费钻石）。
 * 复活效果：墙血回 50% + 清屏当前敌人 + 1.5s 无敌（无敌由 GameState 的 invulnTimer 实现）。
 * 纯逻辑。
 */
export class ReviveSystem {
  constructor(globalSave = { diamond: 0 }) {
    this.globalSave = globalSave;
    this.reviveCost = 100; // 钻石/次，配置化
    this.usedThisRun = 0;
    this.maxPerRun = 1;    // 每局限 1 次，防刷
  }

  canAfford() {
    return (this.globalSave.diamond || 0) >= this.reviveCost;
  }

  canRevive() {
    return this.usedThisRun < this.maxPerRun && this.canAfford();
  }

  /** 执行复活：扣钻石，返回复活参数（墙血恢复比例/清屏标记），失败返回 null */
  performRevive() {
    if (!this.canRevive()) return null;
    this.globalSave.diamond -= this.reviveCost;
    this.usedThisRun++;
    return { wallHpRestorePct: 0.5, clearEnemies: true, invulnSeconds: 1.5 };
  }
}
