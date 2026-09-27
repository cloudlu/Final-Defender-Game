import { GAME_WIDTH, GAME_HEIGHT, GRID } from '../engine/GridConstants.js';

/**
 * BackgroundPainter: Canvas 离屏渲染战场背景（一次生成，作为 texture 使用）。
 * 分层：夜空渐变 → 月亮星群 → 远景城市废墟剪影 → 中景残骸 → 地面纹理+弹坑 → 雾气。
 * 解决"纯色背景太丑"的核心 complaints，零外部素材。
 */
export function paintBattleBackground(scene) {
  // 场景 restart 时 texture 已存在 → 直接复用（防重复添加报错）
  if (scene.textures.exists('battle_bg')) {
    return scene.add.image(0, 0, 'battle_bg').setOrigin(0, 0).setDepth(0);
  }
  const canvas = document.createElement('canvas');
  canvas.width = GAME_WIDTH;
  canvas.height = GAME_HEIGHT;
  const ctx = canvas.getContext('2d');
  const W = GAME_WIDTH, H = GAME_HEIGHT;

  // === 1. 夜空渐变（深蓝→暗紫） ===
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.55);
  sky.addColorStop(0, '#0a0a1e');
  sky.addColorStop(0.6, '#141433');
  sky.addColorStop(1, '#1e1a3e');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H * 0.55);

  // === 2. 月亮 + 光晕 ===
  const moonX = W * 0.78, moonY = 90, moonR = 34;
  const halo = ctx.createRadialGradient(moonX, moonY, moonR * 0.5, moonX, moonY, moonR * 3);
  halo.addColorStop(0, 'rgba(220,225,255,0.25)');
  halo.addColorStop(1, 'rgba(220,225,255,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(moonX - moonR * 3, moonY - moonR * 3, moonR * 6, moonR * 6);
  ctx.fillStyle = '#e8e8f8';
  ctx.beginPath();
  ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
  ctx.fill();
  // 月坑
  ctx.fillStyle = 'rgba(180,185,210,0.5)';
  ctx.beginPath(); ctx.arc(moonX - 10, moonY - 8, 6, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(moonX + 8, moonY + 6, 4, 0, Math.PI * 2); ctx.fill();

  // === 3. 星星 ===
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * W, y = Math.random() * H * 0.35;
    const a = 0.15 + Math.random() * 0.5;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.fillRect(x, y, Math.random() < 0.2 ? 2 : 1, Math.random() < 0.2 ? 2 : 1);
  }

  // === 4. 远景城市废墟剪影（两层视差） ===
  const skyline = (baseY, color, maxH, step) => {
    ctx.fillStyle = color;
    let x = -10;
    while (x < W + 10) {
      const w = step * (0.6 + Math.random() * 0.9);
      const h = maxH * (0.3 + Math.random() * 0.7);
      ctx.fillRect(x, baseY - h, w, h);
      // 部分楼顶断口（废墟感）
      if (Math.random() < 0.4) {
        ctx.clearRect(x + w * 0.3, baseY - h, w * 0.25, h * 0.15);
        ctx.fillStyle = color;
      }
      // 破窗灯光
      if (Math.random() < 0.5) {
        ctx.fillStyle = 'rgba(255,200,100,0.35)';
        for (let wy = baseY - h + 8; wy < baseY - 10; wy += 14) {
          for (let wx = x + 5; wx < x + w - 8; wx += 12) {
            if (Math.random() < 0.15) ctx.fillRect(wx, wy, 4, 5);
          }
        }
        ctx.fillStyle = color;
      }
      x += w + 4;
    }
  };
  skyline(H * 0.42, '#181830', 130, 46); // 远层
  skyline(H * 0.46, '#101024', 90, 60);  // 近层更暗

  // === 5. 地面（战场区域）：暗土色 + 噪点纹理 ===
  const groundTop = GRID.OFFSET_Y - 30;
  const ground = ctx.createLinearGradient(0, groundTop, 0, H);
  ground.addColorStop(0, '#1c1815');
  ground.addColorStop(1, '#12100d');
  ctx.fillStyle = ground;
  ctx.fillRect(0, groundTop, W, H - groundTop);
  // 噪点碎石
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * W;
    const y = groundTop + Math.random() * (H - groundTop);
    const shade = 20 + Math.random() * 30;
    ctx.fillStyle = `rgba(${shade + 15},${shade + 10},${shade},${0.25 + Math.random() * 0.3})`;
    ctx.fillRect(x, y, 1 + Math.random() * 2.5, 1 + Math.random() * 2);
  }

  // === 6. 弹坑（随机分布的暗色椭圆+边缘高光） ===
  for (let i = 0; i < 9; i++) {
    const x = 30 + Math.random() * (W - 60);
    const y = groundTop + 30 + Math.random() * (H - groundTop - 70);
    const r = 12 + Math.random() * 22;
    const crater = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
    crater.addColorStop(0, 'rgba(0,0,0,0.55)');
    crater.addColorStop(0.8, 'rgba(0,0,0,0.3)');
    crater.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = crater;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    // 弹坑边缘碎石高光
    ctx.strokeStyle = 'rgba(120,110,95,0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.95, r * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // === 7. 中景残骸剪影（翻倒的车/路障），纯形状 ===
  ctx.fillStyle = '#0d0d18';
  // 翻倒的车（左）
  ctx.beginPath();
  ctx.moveTo(40, H * 0.62);
  ctx.lineTo(60, H * 0.62 - 22);
  ctx.lineTo(105, H * 0.62 - 26);
  ctx.lineTo(130, H * 0.62 - 8);
  ctx.lineTo(132, H * 0.62);
  ctx.closePath();
  ctx.fill();
  // 路障（右）
  ctx.fillRect(W - 90, H * 0.58, 8, 34);
  ctx.fillRect(W - 100, H * 0.58 + 10, 30, 6);

  // === 8. 顶部雾气 ===
  const fog = ctx.createLinearGradient(0, 0, 0, 130);
  fog.addColorStop(0, 'rgba(90,90,140,0.22)');
  fog.addColorStop(1, 'rgba(90,90,140,0)');
  ctx.fillStyle = fog;
  ctx.fillRect(0, 0, W, 130);

  // 贴入场景
  scene.textures.addCanvas('battle_bg', canvas);
  const img = scene.add.image(0, 0, 'battle_bg').setOrigin(0, 0).setDepth(0);
  return img;
}
