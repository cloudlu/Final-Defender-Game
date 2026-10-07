import { gridToPixel } from '../engine/GridConstants.js';

/** 敌人全局视觉缩放（v8.21 玩家反馈偏小；碰撞判定用格坐标不受影响） */
export const ENEMY_SCALE = 1.35;

export const ENEMY_DEFS = {
  enemy_basic:     { kind: 'basic',   color: 0x66aa44, outline: 0x336622, emoji: '🧟', size: 13 },
  enemy_runner:    { kind: 'runner',  color: 0xff8844, outline: 0xaa5500, emoji: '💨', size: 10 },
  enemy_tank:      { kind: 'tank',    color: 0xcc4444, outline: 0x771111, emoji: '🦍', size: 19 },
  enemy_bucket:    { kind: 'bucket',  color: 0x888888, outline: 0x444444, emoji: '🪣', size: 14 },
  enemy_bomber:    { kind: 'bomber',  color: 0xff5533, outline: 0x992211, emoji: '💣', size: 12 },
  enemy_flyer:     { kind: 'flyer',   color: 0xddccff, outline: 0x8866cc, emoji: '👻', size: 12 },
  enemy_polevault: { kind: 'polevault', color: 0x44aa88, outline: 0x226655, emoji: '🏃', size: 12 },
  enemy_nurse:     { kind: 'nurse',   color: 0xeeaacc, outline: 0xaa6688, emoji: '💉', size: 12 },
  enemy_giant:     { kind: 'giant',   color: 0x8866aa, outline: 0x443366, emoji: '🦣', size: 18 },
  enemy_boar:      { kind: 'boar',    color: 0x997766, outline: 0x553322, emoji: '🐗', size: 13 },
  enemy_antenna:   { kind: 'antenna', color: 0x66bbdd, outline: 0x336688, emoji: '📡', size: 12 },
  enemy_driller:   { kind: 'driller', color: 0xaa9955, outline: 0x665522, emoji: '⛏️', size: 12 },
  enemy_flame:     { kind: 'flame',   color: 0xff7733, outline: 0xaa3311, emoji: '🔥', size: 12 },
  enemy_frostbeast:{ kind: 'frostbeast', color: 0x66aaff, outline: 0x3366aa, emoji: '🧊', size: 15 },
  enemy_heavy:     { kind: 'heavy',   color: 0x556677, outline: 0x2a3344, emoji: '🏋️', size: 17 },
  enemy_fish:      { kind: 'fish',    color: 0x77aacc, outline: 0x3a6688, emoji: '🐟', size: 13 },
  enemy_mummy:     { kind: 'mummy',   color: 0xddddbb, outline: 0x999977, emoji: '🧻', size: 13 },
  enemy_tomb:      { kind: 'tomb',    color: 0x777788, outline: 0x444455, emoji: '🪦', size: 15 },
  enemy_clown:     { kind: 'clown',   color: 0xdd6688, outline: 0x883355, emoji: '🤡', size: 12 },
  enemy_timid:     { kind: 'timid',   color: 0xaadd88, outline: 0x668855, emoji: '🐔', size: 10 },
  enemy_puppet:    { kind: 'puppet',  color: 0xbb9977, outline: 0x776644, emoji: '🎭', size: 13 },
  enemy_tennis:    { kind: 'tennis',  color: 0x88cc44, outline: 0x448822, emoji: '🎾', size: 12 },
  enemy_bomb:      { kind: 'bomb2',   color: 0xcc8844, outline: 0x774422, emoji: '🧨', size: 12 },
  enemy_flame2:    { kind: 'flame2',  color: 0xff6633, outline: 0xaa2211, emoji: '🌋', size: 12 },
  enemy_lizard:    { kind: 'lizard',  color: 0xffff44, outline: 0xaaaa00, emoji: '🦎', size: 14 },
  enemy_bandage:   { kind: 'bandage', color: 0xeeeecc, outline: 0xaaaa88, emoji: '🩹', size: 14 },
  enemy_shark:     { kind: 'shark',   color: 0x4488cc, outline: 0x224477, emoji: '🦈', size: 18 },
  enemy_vampire:   { kind: 'vampire', color: 0x883355, outline: 0x441122, emoji: '🧛', size: 13 },
};

/**
 * EnemyRenderer: 敌人精灵的创建/同步/销毁，含每种敌人独立造型。
 * 只读引擎状态来画，不修改状态。
 */
export class EnemyRenderer {
  constructor(scene) {
    this.scene = scene;
    this.sprites = [];
  }

  /** 删除已死亡（从引擎列表消失）敌人的精灵；在 sync 前后调用均可 */
  sync(enemies, timeNow) {
    const existingIds = new Set(this.sprites.map(s => s.enemyId));
    for (const enemy of enemies) {
      if (existingIds.has(enemy.id)) continue;
      this.sprites.push(this._create(enemy));
    }

    for (const s of this.sprites) {
      const e = enemies.find(en => en.id === s.enemyId);
      if (!e) continue;
      const pos = gridToPixel(e.col, e.row);
      // 飞行怪大幅正弦悬浮，视觉离地
      const bob = s.isFlyer
        ? Math.sin(timeNow / 180 + e.bobOffset) * 7 - 14
        : Math.sin(e.row * 2 + e.bobOffset) * 1.5;
      s.container.setPosition(pos.x, pos.y + bob);
      s.hpBar.setSize(s.hpBarW * Math.max(0, e.hp / e.maxHp), 3);

      if (e.hitFlash > 0) s.body.setFillStyle(0xffffff);
      else if (e.stunTimer > 0) s.body.setFillStyle(0xffff00);
      else if (e.slowFactor < 1) s.body.setFillStyle(0x66aaff);
      else if (e.dotEffects.length > 0) s.body.setFillStyle(0x88ff44);
      else if (s.isBoss) s.body.setFillStyle(s.baseColor); // BOSS 恒用专属色（DEFS 无其条目）
      else s.body.setFillStyle((ENEMY_DEFS[e.configId] || ENEMY_DEFS.enemy_basic).color);
    }
  }

  /** 移除并销毁已经不存在的敌人精灵，返回存活精灵数 */
  prune(enemies) {
    this.sprites = this.sprites.filter(s => {
      if (!enemies.find(e => e.id === s.enemyId)) { s.container.destroy(); return false; }
      return true;
    });
  }

  _create(enemy) {
    const pos = gridToPixel(enemy.col, enemy.row);
    // v9.7 BOSS 专属造型：bossMeta（size/color/icon）驱动，远超普通怪的体型+王冠+名条
    const isBoss = !!enemy.isBoss;
    const isElite = !!enemy.elite && !isBoss; // v9.8 精英怪（BOSS 优先级更高）
    const def = isBoss
      ? { kind: 'boss', color: enemy.bossMeta?.color || 0xcc4444, outline: 0x2a0808, emoji: enemy.bossMeta?.icon || '👑', size: Math.max(30, (enemy.bossMeta?.size || 30) * 0.9) }
      : (ENEMY_DEFS[enemy.configId] || ENEMY_DEFS.enemy_basic);
    const c = this.scene.add.container(pos.x, pos.y).setDepth(isBoss ? 75 : 60);
    c.setScale(ENEMY_SCALE * (isElite ? 1.25 : 1)); // v8.21 全局放大 + v9.8 精英 1.25×

    const isFlyer = enemy.behavior?.type === 'fly';
    if (!isFlyer) {
      c.add(this.scene.add.ellipse(0, def.size + 3, def.size * 1.6, 5, 0x000000, 0.2));
    }

    // v9.8 精英怪：金色脉冲描边 + "精英"名条
    let eliteRing = null;
    if (isElite) {
      eliteRing = this.scene.add.circle(0, 0, def.size + 5, 0xffcc44, 0).setDepth(-1);
      eliteRing.setStrokeStyle(2, 0xffcc44, 0.8);
      c.add(eliteRing);
      this.scene.tweens.add({ targets: eliteRing, scale: 1.1, alpha: 0.4, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      c.add(this.scene.add.text(0, -def.size - 20, '精英', {
        fontSize: '8.5px', fill: '#ffdd66', fontFamily: 'Arial', fontStyle: 'bold',
      }).setOrigin(0.5));
    }

    // BOSS 光环（脉冲圈，出生即辨识度拉满）
    let bossAura = null;
    if (isBoss) {
      bossAura = this.scene.add.circle(0, 0, def.size + 8, def.color, 0).setDepth(-1);
      bossAura.setStrokeStyle(3, def.color, 0.55);
      c.add(bossAura);
      this.scene.tweens.add({
        targets: bossAura, scale: 1.12, alpha: 0.35, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    }

    const { bodyGroup, body } = this._buildBody(def);
    c.add(bodyGroup);

    // BOSS 王冠
    if (isBoss) {
      const crown = this.scene.add.triangle(0, -def.size - 14, 0, -10, -9, 0, 9, 0, 0xffcc44);
      crown.setStrokeStyle(1, 0x886600);
      c.add(crown);
    }

    // 血条（BOSS 更宽 + 名条）
    const barW = isBoss ? 46 : 22;
    const hpBg = this.scene.add.rectangle(0, -def.size - 10, barW, 3, 0x222222);
    hpBg.setStrokeStyle(1, 0x444444);
    c.add(hpBg);
    const hpBar = this.scene.add.rectangle(-barW / 2, -def.size - 10, barW, 3, 0x44ff44);
    hpBar.setOrigin(0, 0.5);
    c.add(hpBar);
    if (isBoss) {
      c.add(this.scene.add.text(0, -def.size - 20, enemy.name || 'BOSS', {
        fontSize: '9px', fill: '#ff8888', fontFamily: 'Arial', fontStyle: 'bold', align: 'center',
      }).setOrigin(0.5));
    }

    return { enemyId: enemy.id, container: c, body, hpBar, isFlyer, isBoss, isElite, bossAura, eliteRing, hpBarW: barW, baseColor: def.color };
  }

  /** 每种敌人独立造型，返回 { bodyGroup, body }（body 用于状态变色） */
  _buildBody(def) {
    const c = this.scene.add.container(0, 0);
    const s = def.size;
    const body = this.scene.add.circle(0, 0, s, def.color);
    body.setStrokeStyle(2, def.outline);
    c.add(body);

    switch (def.kind) {
      case 'runner': {
        body.setScale(0.75, 1.25);
        for (const dy of [-4, 2]) {
          const streak = this.scene.add.line(0, 0, 0, 0, 8, 0, 0xffcc88, 0.7);
          streak.setPosition(-s - 4, dy);
          c.add(streak);
        }
        c.add(this.scene.add.circle(-2.5, -2, 1.4, 0xffee00));
        c.add(this.scene.add.circle(2.5, -2, 1.4, 0xffee00));
        c.add(this.scene.add.text(0, s + 6, def.emoji, { fontSize: '9px' }).setOrigin(0.5));
        break;
      }
      case 'tank': {
        body.setScale(1.25, 1.1);
        for (const [dx, dy] of [[-6, -4], [6, -4], [-6, 3], [6, 3]]) {
          c.add(this.scene.add.circle(dx, dy, 1.6, 0x554433));
        }
        c.add(this.scene.add.line(-3.5, -4, 0, 0, 5, -2.5, 0x440000, 2));
        c.add(this.scene.add.line(3.5, -4, 0, 0, -5, -2.5, 0x440000, 2));
        c.add(this.scene.add.rectangle(0, 4, 8, 2, 0x440000));
        c.add(this.scene.add.text(0, s + 8, def.emoji, { fontSize: '10px' }).setOrigin(0.5));
        break;
      }
      case 'flyer': {
        body.setAlpha(0.85);
        const tail = this.scene.add.triangle(0, s * 0.8, 0, 8, -5, 0, 5, 0, def.color, 0.7);
        tail.setStrokeStyle(1, def.outline);
        c.add(tail);
        for (const dx of [-s - 2, s + 2]) {
          c.add(this.scene.add.ellipse(dx, -2, 8, 4, 0xddddff, 0.6));
        }
        c.add(this.scene.add.circle(-2.5, -2, 1.5, 0x4400aa));
        c.add(this.scene.add.circle(2.5, -2, 1.5, 0x4400aa));
        break;
      }
      case 'bucket': {
        // 铁桶头盔 + 铆钉
        const bucket = this.scene.add.rectangle(0, -s * 0.55, s * 1.4, s * 0.7, 0x777777);
        bucket.setStrokeStyle(2, 0x3a3a3a);
        c.add(bucket);
        c.add(this.scene.add.rectangle(0, -s * 0.9, s * 1.1, 3, 0x555555));
        for (const dx of [-s * 0.5, s * 0.5]) {
          c.add(this.scene.add.circle(dx, -s * 0.55, 1.3, 0x333333));
        }
        c.add(this.scene.add.circle(-2.5, 0, 1.3, 0xffffff));
        c.add(this.scene.add.circle(2.5, 0, 1.3, 0xffffff));
        c.add(this.scene.add.text(0, s + 6, def.emoji, { fontSize: '9px' }).setOrigin(0.5));
        break;
      }
      case 'bomber': {
        // 引线 + 火花
        const fuse = this.scene.add.line(0, 0, 0, -s, 3, -s - 5, 0x884422, 2);
        c.add(fuse);
        c.add(this.scene.add.circle(3.5, -s - 6, 1.8, 0xffee00));
        c.add(this.scene.add.circle(-2.5, -1, 1.3, 0xffffff));
        c.add(this.scene.add.circle(2.5, -1, 1.3, 0xffffff));
        c.add(this.scene.add.text(0, s + 6, def.emoji, { fontSize: '9px' }).setOrigin(0.5));
        break;
      }
      case 'polevault': {
        // 手持撑杆 + 前倾姿态
        body.setScale(0.85, 1.15);
        const pole = this.scene.add.line(0, 0, s - 1, s, s + 5, -s - 2, 0x996633, 2);
        c.add(pole);
        for (const dy of [-3, 3]) {
          const streak = this.scene.add.line(0, 0, 0, 0, 7, 0, 0xaaffcc, 0.6);
          streak.setPosition(-s - 3, dy);
          c.add(streak);
        }
        c.add(this.scene.add.circle(-2.5, -2, 1.3, 0xffffff));
        c.add(this.scene.add.circle(2.5, -2, 1.3, 0xffffff));
        c.add(this.scene.add.text(0, s + 6, def.emoji, { fontSize: '9px' }).setOrigin(0.5));
        break;
      }
      case 'nurse': {
        // 护士帽 + 十字
        const hat = this.scene.add.rectangle(0, -s * 0.8, s, 4, 0xffffff);
        hat.setStrokeStyle(1, 0xcc6688);
        c.add(hat);
        const cross1 = this.scene.add.rectangle(0, -s * 0.8, 2.5, 8, 0xff4444);
        const cross2 = this.scene.add.rectangle(0, -s * 0.8, 8, 2.5, 0xff4444);
        c.add(cross1); c.add(cross2);
        c.add(this.scene.add.circle(-2.5, -1, 1.3, 0xffffff));
        c.add(this.scene.add.circle(2.5, -1, 1.3, 0xffffff));
        c.add(this.scene.add.text(0, s + 6, def.emoji, { fontSize: '9px' }).setOrigin(0.5));
        break;
      }
      case 'giant': {
        // 巨型+獠牙
        body.setScale(1.3, 1.2);
        for (const dx of [-5, 5]) {
          c.add(this.scene.add.triangle(dx, s * 0.4, 0, 0, -2, 5, 2, 5, 0xffffff));
        }
        c.add(this.scene.add.line(-3.5, -5, 0, 0, 5, -2.5, 0x330033, 2));
        c.add(this.scene.add.line(3.5, -5, 0, 0, -5, -2.5, 0x330033, 2));
        c.add(this.scene.add.text(0, s + 8, def.emoji, { fontSize: '10px' }).setOrigin(0.5));
        break;
      }
      case 'boar': {
        // 獠牙上翘
        body.setScale(1.1, 0.95);
        for (const dx of [-4, 4]) {
          const tusk = this.scene.add.triangle(dx, s * 0.45, 0, 0, -1.5, -5, 1.5, -5, 0xeeeedd);
          c.add(tusk);
        }
        c.add(this.scene.add.circle(-2.5, -2, 1.3, 0xffffff));
        c.add(this.scene.add.circle(2.5, -2, 1.3, 0xffffff));
        c.add(this.scene.add.text(0, s + 6, def.emoji, { fontSize: '9px' }).setOrigin(0.5));
        break;
      }
      case 'antenna': {
        // 天线两根
        for (const dx of [-3, 3]) {
          c.add(this.scene.add.line(dx, -s, 0, 0, dx > 0 ? 3 : -3, -6, def.outline, 1.5));
          c.add(this.scene.add.circle(dx + (dx > 0 ? 3 : -3), -s - 6, 1.5, 0x66ddff));
        }
        c.add(this.scene.add.circle(-2.5, -2, 1.3, 0xffffff));
        c.add(this.scene.add.circle(2.5, -2, 1.3, 0xffffff));
        c.add(this.scene.add.text(0, s + 6, def.emoji, { fontSize: '9px' }).setOrigin(0.5));
        break;
      }
      case 'driller': {
        // 钻头帽
        const drill = this.scene.add.triangle(0, -s * 0.7, 0, -s - 8, -5, -s * 0.5, 5, -s * 0.5, 0xbb9944);
        drill.setStrokeStyle(1, 0x665522);
        c.add(drill);
        c.add(this.scene.add.circle(-2.5, -1, 1.3, 0xffffff));
        c.add(this.scene.add.circle(2.5, -1, 1.3, 0xffffff));
        c.add(this.scene.add.text(0, s + 6, def.emoji, { fontSize: '9px' }).setOrigin(0.5));
        break;
      }
      case 'flame': {
        // 头顶火苗
        const flame = this.scene.add.triangle(0, -s - 3, 0, -s - 11, -4, -s + 1, 4, -s + 1, 0xff8800);
        c.add(flame);
        c.add(this.scene.add.circle(-2.5, -2, 1.3, 0xffffff));
        c.add(this.scene.add.circle(2.5, -2, 1.3, 0xffffff));
        c.add(this.scene.add.text(0, s + 6, def.emoji, { fontSize: '9px' }).setOrigin(0.5));
        break;
      }
      case 'frostbeast': {
        // 冰晶尖刺
        for (const dx of [-5, 0, 5]) {
          c.add(this.scene.add.triangle(dx, -s * 0.6, dx, -s - 7, dx - 3, -s * 0.4, dx + 3, -s * 0.4, 0xaaddff));
        }
        c.add(this.scene.add.circle(-2.5, -1, 1.3, 0x224488));
        c.add(this.scene.add.circle(2.5, -1, 1.3, 0x224488));
        c.add(this.scene.add.text(0, s + 6, def.emoji, { fontSize: '9px' }).setOrigin(0.5));
        break;
      }
      case 'heavy': {
        // 重甲铆钉+宽体
        body.setScale(1.35, 1.05);
        for (const [dx, dy] of [[-7, -4], [7, -4], [-7, 4], [7, 4], [0, -6]]) {
          c.add(this.scene.add.circle(dx, dy, 1.8, 0x333d44));
        }
        c.add(this.scene.add.rectangle(0, 5, 10, 2.5, 0x223038));
        c.add(this.scene.add.text(0, s + 8, def.emoji, { fontSize: '10px' }).setOrigin(0.5));
        break;
      }
      case 'boss': {
        // v9.7 BOSS 专属造型：獠牙 + 怒目 + 角刺，体型来自 def.size（30+）
        body.setScale(1.15, 1.05);
        // 怒目（红色大眼）
        c.add(this.scene.add.circle(-4, -3, 2.6, 0xffdd00));
        c.add(this.scene.add.circle(4, -3, 2.6, 0xffdd00));
        c.add(this.scene.add.circle(-4, -3, 1.2, 0x880000));
        c.add(this.scene.add.circle(4, -3, 1.2, 0x880000));
        // 獠牙一对
        for (const dx of [-7, 7]) {
          c.add(this.scene.add.triangle(dx, s * 0.42, 0, 0, -2.5, -7, 2.5, -7, 0xffffee));
        }
        // 顶部角刺三根
        for (const dx of [-8, 0, 8]) {
          c.add(this.scene.add.triangle(dx, -s * 0.75, dx + (dx === 0 ? 0 : dx > 0 ? 2 : -2), -s - 9, dx - 3, -s * 0.45, dx + 3, -s * 0.45, 0xffdd66));
        }
        break;
      }
      default: {
        c.add(this.scene.add.circle(-2.5, -2, 1.3, 0xffffff));
        c.add(this.scene.add.circle(2.5, -2, 1.3, 0xffffff));
        c.add(this.scene.add.circle(-2.5, -2, 0.65, 0x000000));
        c.add(this.scene.add.circle(2.5, -2, 0.65, 0x000000));
        c.add(this.scene.add.line(0, 3, -3, 0, 3, -1.5, 0x331100, 1.5));
        c.add(this.scene.add.rectangle(-1.5, 5.5, 2, 2.5, 0xeeeeee));
        c.add(this.scene.add.rectangle(1.5, 5.5, 2, 2.5, 0xeeeeee));
        c.add(this.scene.add.text(0, s + 6, def.emoji, { fontSize: '9px' }).setOrigin(0.5));
      }
    }
    return { bodyGroup: c, body };
  }

  destroyAll() {
    for (const s of this.sprites) s.container.destroy();
    this.sprites = [];
  }
}
