import { gridToPixel, GRID, GAME_WIDTH, GAME_HEIGHT } from '../engine/GridConstants.js';
import { paintBattleBackground } from './BackgroundPainter.js';

/**
 * WorldRenderer: 战场静态元素一次性绘制（背景/城墙/英雄造型），并持有英雄的动态部件引用。
 */
export class WorldRenderer {
  constructor(scene, state) {
    this.scene = scene;
    this.state = state;
    this.drawBackground();
    this.drawWall();
    this.drawPlayer();
  }

  drawBackground() {
    // Canvas 预渲染背景（夜空/城市废墟剪影/地面/弹坑/雾），替换旧纯色渐变
    paintBattleBackground(this.scene);
  }

  drawWall() {
    // 城墙横贯整个画布宽度（全宽防御线），英雄在其后方
    const s = this.state;
    const wallY = GRID.OFFSET_Y + s.wallRow * GRID.CELL_SIZE;
    const wallX = 0, wallW = GAME_WIDTH;
    const w = this.scene.add.graphics();
    // 主体：石砖分层砌筑
    const wallH = 20;
    w.fillStyle(0x6b5a42, 1);
    w.fillRect(wallX, wallY - 4, wallW, wallH);
    // 砖缝（错缝排列）
    w.lineStyle(1, 0x4a3e2c, 0.9);
    for (let row = 0; row < 3; row++) {
      const yy = wallY - 4 + row * (wallH / 3);
      w.lineBetween(wallX, yy, wallX + wallW, yy);
      const offset = row % 2 === 0 ? 0 : 22;
      for (let bx = wallX + offset; bx < wallX + wallW; bx += 44) {
        w.lineBetween(bx, yy, bx, yy + wallH / 3);
      }
    }
    // 砖面高光/暗部（立体感）
    w.fillStyle(0xffffff, 0.07);
    w.fillRect(wallX, wallY - 4, wallW, 3);
    w.fillStyle(0x000000, 0.25);
    w.fillRect(wallX, wallY + wallH - 8, wallW, 4);
    // 城垛（顶部齿状）
    const merlonW = 16, merlonH = 12;
    const merlonCount = Math.floor(wallW / (merlonW * 1.5));
    for (let i = 0; i <= merlonCount; i++) {
      const mx = wallX + i * (wallW / merlonCount);
      w.fillStyle(0x7d6a4e, 1);
      w.fillRoundedRect(mx - merlonW / 2, wallY - merlonH, merlonW, merlonH + 4, 2);
      w.lineStyle(1, 0x4a3e2c, 1);
      w.strokeRoundedRect(mx - merlonW / 2, wallY - merlonH, merlonW, merlonH + 4, 2);
      // 垛口高光
      w.fillStyle(0xffffff, 0.1);
      w.fillRect(mx - merlonW / 2 + 1, wallY - merlonH + 1, merlonW - 2, 2);
    }
    // 墙面弹痕（随机暗斑）
    for (let i = 0; i < 14; i++) {
      w.fillStyle(0x000000, 0.18 + Math.random() * 0.12);
      w.fillCircle(Math.random() * wallW, wallY + 2 + Math.random() * 10, 2 + Math.random() * 4);
    }
    w.setDepth(40);
  }

  drawPlayer() {
    const pos = gridToPixel(this.state.player.x, this.state.player.y);
    const P = this.scene.add;
    this.scene.add.ellipse(pos.x, pos.y + 12, 22, 7, 0x000000, 0.25).setDepth(78);
    this.playerGlow = P.circle(pos.x, pos.y, 16, 0x4488ff, 0.1).setDepth(79);
    this.scene.tweens.add({ targets: this.playerGlow, scaleX: 1.2, scaleY: 1.2, alpha: 0.03, duration: 1000, yoyo: true, repeat: -1 });
    this.playerBody = P.circle(pos.x, pos.y, 11, 0x3366cc).setDepth(80);
    this.playerBody.setStrokeStyle(2, 0x2244aa);
    this.playerHat = P.triangle(pos.x, pos.y - 14, 0, -9, -6, 0, 6, 0, 0x3366cc).setDepth(81);
    this.playerHat.setStrokeStyle(2, 0x2244aa);
    P.circle(pos.x - 3, pos.y - 2, 1.5, 0xffffff).setDepth(82);
    P.circle(pos.x + 3, pos.y - 2, 1.5, 0xffffff).setDepth(82);
    P.circle(pos.x - 3, pos.y - 2, 0.7, 0x000000).setDepth(83);
    P.circle(pos.x + 3, pos.y - 2, 0.7, 0x000000).setDepth(83);
    P.line(pos.x + 9, pos.y, 0, 0, 10, -7, 0x886644, 1).setDepth(82);
    P.circle(pos.x + 19, pos.y - 7, 2.5, 0xffff00).setDepth(83);
  }

  updatePlayer() {
    const pos = gridToPixel(this.state.player.x, this.state.player.y);
    this.playerGlow.setPosition(pos.x, pos.y);
    this.playerBody.setPosition(pos.x, pos.y);
    this.playerHat.setPosition(pos.x, pos.y - 14);
  }
}
