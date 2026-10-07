# 新会话快速上手指南（CLAUDE.md / AGENTS.md 等效文件）

> **目的**：新会话（new session）开始时先读本文，10 分钟内获得全部上下文，避免重踩已修复的坑。
> 最后更新：v9.14（2026-10-01）。详细版本历史见 `设计文档.md`（设计决策）与 `开发流程.md`（教训复盘）。

---

## 一、项目一句话

《最后防线》——向僵尸开炮（原版）对齐的塔防+Roguelike 网页游戏。Phaser 3 前端 + Express 后端（本地 saves/*.json 文件存储），账号注册/登录，进度按账号隔离存远端。

## 二、启动与测试

```bash
# 根目录
npm run dev          # 并发起前后端（前端 :30000 / 后端 :30001）
npm test             # = cd client && npm test（vitest，218 用例，约 1.5s）

# 单独跑
cd client && npx vitest run src/engine/XXX.test.js   # 单文件
cd server && node scripts/resetPassword.js 亮亮 新密码  # 管理员重置密码
node client/tools/balance-report.cjs                  # 平衡演算报告（改数值后必跑）

# 调试模式（战斗内调试面板）
浏览器打开 http://localhost:30000/?debug=1   # 滑杆调伤害/敌血/敌速倍率+清屏跳波按钮
```

- **预置账号**：亮亮 / test（玩家主账号，含全部测试进度）；芦煜轩（第二个号）
- **兑换码**：`server/src/data/codes/*.json`（VIP1~12 档 + DIA100/500/6480 钻石码）

## 三、目录地图（按修改频率排序）

| 文件 | 行数 | 职责 | 备注 |
|---|---|---|---|
| `client/src/engine/GameState.js` | **1243** | 战斗核心：update 主循环/弹道/技能结算/伤害/BOSS/存档读取 | **最大最复杂，改前必读上下文** |
| `client/src/ui/ForgePanel.js` | **1021** | 装备·宝石面板（主页 6 部位卡+部位弹窗+宝石选择器）| 迭代最多，DOM 无 |
| `client/src/scenes/GameScene.js` | 862 | 战斗场景：update 驱动/事件路由/UI 面板调度 | |
| `client/src/scenes/MenuScene.js` | 677 | 主菜单：两级选关/底部栅格/登录门控/_persistGlobalMenuSave | **_bootAuth/_createAfterAuth 拆分结构勿动** |
| `client/src/engine/Player.js` | 382 | 技能表（单一数据源）/升级成长/三选一选项池 | **技能平衡只改这里+重跑 balance-report** |
| `client/src/ui/EnemyRenderer.js` | 355 | 敌人渲染（28 种造型/BOSS 专属/精英金环/ENEMY_SCALE=1.35）| |
| `client/src/ui/TavernPanel.js` | 285 | 酒馆（佣兵招募/升级/上阵+枪械研发）| |
| `client/src/ui/GemPanel.js` | 207 | 宝石面板（独立面板已退役并入 ForgePanel？**否——GemPanel 已删，入口在 ForgePanel**）| |
| `server/src/services/AuthService.js` | ~150 | 注册/登录/token（HMAC 7 天）/改密/删号 | 种子账号亮亮/test |
| `server/src/services/CodeService.js` | 57 | 兑换码核销（codes/*.json）| |
| `server/src/routes/*.js` | — | save / recharge / auth 三组路由 | save 槽 id 支持 `u1/u2` 用户隔离 |

其余：GemSystem（宝石数据+战力评分 gemPower）、BossManager（BOSS 技能调度+狂暴）、GachaSystem（抽卡，pull 内扣费）、EquipmentForgeSystem（装备生成/洗练/合成）、Enemy（被动行为 12 类）、ModifierPipeline（add/mul_pct/mul 三段公式）。

## 四、当前架构铁律（违反=返工）

1. **进度数据纯远端**：金币/装备/宝石/佣兵/通关记录只在 `saves/<slot>.json`。localStorage 仅剩：`lastline_session`（登录态）、`lastline_globalsave`/`lastline_levelsave`（**已废弃**——v9.3 删除但键可能残留在用户浏览器）、SyncedSaveRepository 内部通道。
2. **登录会话 = token**：HMAC-SHA256 服务端签发，7 天过期，localStorage 持久化（`lastline_session`）。启动时 `AuthClient.restore()` 调 `/api/auth/me` 校验。
3. **跨 restart 数据走 registry**：MenuScene 的远端数据（`remoteData_<slot>`）、关卡进度（`levelProgress`）、玩家身份（`playerId/playerSlot`）都存 Phaser registry——create() 局部变量不跨 restart 存活。
4. **子系统引用绑定**：MenuScene 远端数据 Object.assign 后**必须调 `_rebindSystems(cfg)`** 重挂 forgeSystem/gemSystem/mercenarySystem/gachaSystem/dailySystem——否则子系统持有旧空骨架（v9.3d 事故根因）。
5. **持久化闸门**：`_persistGlobalMenuSave` 开头检查 `_remoteLoaded`——远端档加载完成前禁止持久化（防空骨架覆盖真实数据，v9.2c 事故根因）。
6. **中文项目禁用 shell 管道替换**（PowerShell Set-Content/-replace）：会毁 UTF-8 中文。**已三犯**。只用 Edit/Write 工具。
7. **UI 文件每次编辑后 `node --check`**：语法错误（重复声明/悬空引用）白屏级故障，v8.17/18/19 三连事故。
8. **面板 onClose 不要 scene.restart()**：纯远端架构下数据在内存已同步，重启导致签到循环弹（v9.3c）。

## 五、高频坑（全部踩过，别再踩）

- **`node --check` 抓不住运行时错误**：TDZ（块作用域 row is not defined）、悬空引用（cfg/enemy/BASE_POWER_UNIT is not defined）——这些都要靠"直达该分支的测试"或控制台实测。
- **边缘分支必须有直达测试**：eliteDamage 分支、套装分支、pity 骨架——都是"只在特定玩家状态下执行"的路径，上线即炸。
- **浮点尾数**：显示端一律 `Math.round(x*100)/100`（fmtVal 模式）；存档迁移归一（v8.12）。
- **Phaser 布局**：网格先算总宽（540 画布，2 列×240 是上限）；wordWrap 换行文本高度不可预知，禁入流式布局；DOM 输入框用 getBoundingClientRect 等比映射。
- **动态布局防重叠**：固定锚点自底向上（gBottom→标题→按钮→词条区），极端值验算。
- **构造器传参错位 JS 不报错**：GachaSystem 曾 7 实参塞 6 形参。
- **可选链 `?.call` 是 bug 遮蔽器**：方法不存在时静默跳过。
- **实验性：布局 bug 盲调三次不如实测一次**——`window.game` 已暴露，控制台遍历 scene 树打印坐标（v9.31 方法论）。

## 六、控制台调试（玩家可配合输出）

```js
// 布局排查：遍历场景树打印全部文本元素坐标（面板打开状态下跑）
const scene = game.scene.getScene('MenuScene');
const out = [];
function walk(list, dx, dy) {
  for (const o of list) {
    const wx = dx + (o.x || 0), wy = dy + (o.y || 0);
    if (o.text !== undefined) out.push({ y: Math.round(wy), x: Math.round(wx), w: Math.round(o.width||0), text: (o.text||'').slice(0,16) });
    else if (o.type === 'Container' && o.list) walk(o.list, wx, wy);
  }
}
walk(scene.children.list, 0, 0);
out.sort((a, b) => a.y - b.y || a.x - b.x);
console.table(out);
```

## 七、游戏系统速查

- **技能**：16 主动（枪械 0.3s CD 是 DPS 基准 66.7，技能合理带 8%~50%）+ 6 被动（连射=发射期扇形/分裂=命中后溅射 40% 小弹/穿透/弹射/巨大化/连锁爆炸）。等级成长 ×1.25 伤 ×0.90 CD；控场技能（icestorm 冻结+0.2s、drone 减速+0.1s、cyclone 击退+0.3）升级涨控不涨伤。
- **敌人**：28 种 12 类被动行为（explode/fly/dash/heal_aura/burrow/revive3/enrage/vampire/bandage_heal/dodge/免疫系/抗性系）。**精英怪**：累计波次≥8 起每只 8% 概率，血×4 赏金×3 金环。
- **BOSS**：10 个（boss.json），技能 summon/speedBurst/roar/rangedAttack + **狂暴**（6 分钟或血 20% 触发，无敌+4 速 15s，每场一次）+ **环境效果**（leviathan=darkFog 弹速×0.55、flame_lord=solarFlare 墙灼烧、pioneer=empField CD×1.3，死亡解除）+ 免疫/弱点表全配。
- **宝石**：7 品质（白→至尊）数值定档无随机；通用 20 词条+部位专属 13 词条（minQuality 门槛）；3 同词条同品质→升档合成；战力评分 gemPower（add 1:1/百分比×100 基准攻/秒杀 200/头选 250）。
- **装备**：6 部位×7 品质×品阶；词条洗练（锻造石 20/次）；合成 3 同部位同品质→升档；部位强化 Lv10 槽位继承。
- **佣兵**：6 个（flame/shotgun/mg/sniper/arrow/chrono），被动攻击拥有即生效，出战 2 位有独立弹道+专属色+狂暴前 aoe 型弹道。
- **关卡**：4 章（S1-S4）×50 关，两级选关（章节卡→章内翻页+滑动），unlockAfter 链式解锁，精英难度开关。

## 八、已知未实现 / 后续项

1. **宝石洗练**（原版有：只洗红/至尊）——我们只有装备洗练
2. **BOSS 战场环境扩展**：修道士"黑暗迷雾"变体、法老王"太阳耀斑"变体（机制已实现：leviathan/flame_lord/pioneer 三试点）
3. **BOSS 主动攻城**（巨兽挑战：拆城墙技能/10% 血上限伤害）——独立玩法
4. **DebugPanel**（?debug=1）滑杆不持久化——如需记忆用户偏好再议
5. **TOKEN_SECRET 进程级**：服务端重启全员重登——多实例部署需改持久密钥文件

## 九、提交纪律（血泪教训）

- **每轮修复验证通过后立即 commit**——v8.9 曾因未提交 + git checkout 事故回滚丢 200 行
- git checkout -- 前必须 `git diff --stat` 评估波及面
- 服务端接口改动：起真实服务 Invoke-RestMethod/fetch 实测，不只跑单元测试
- 新分支上线配"走到该行"的最小测试
