/**
 * AudioSystem: WebAudio 程序化音效合成（零素材文件）。
 * 单例。所有音效由振荡器+噪声+包络合成，音量统一控制，支持开关。
 */
export class AudioSystem {
  constructor() {
    this.ctx = null; // 懒初始化（首次用户交互后）
    this.enabled = true;
    this.volume = 0.35;
    this._lastPlay = {}; // 节流
  }

  _ensure() {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      this.enabled = false;
    }
    return this.ctx;
  }

  /** 首次用户交互时调用（浏览器自动播放策略） */
  unlock() {
    const ctx = this._ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  _throttle(key, ms = 50) {
    const now = performance.now();
    if (this._lastPlay[key] && now - this._lastPlay[key] < ms) return false;
    this._lastPlay[key] = now;
    return true;
  }

  /** 基础音：振荡器 + 频率包络 + 音量包络 */
  _tone({ freq = 440, freqEnd = null, type = 'sine', duration = 0.1, volume = 1, delay = 0 }) {
    if (!this.enabled) return;
    const ctx = this._ensure();
    if (!ctx || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + duration);
    gain.gain.setValueAtTime(volume * this.volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  /** 噪声爆点（爆炸/碎裂） */
  _noise({ duration = 0.2, volume = 1, filterFreq = 800, delay = 0 }) {
    if (!this.enabled) return;
    const ctx = this._ensure();
    if (!ctx || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + delay;
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume * this.volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t0);
  }

  // ==================== 游戏音效 ====================

  shoot() {
    if (!this._throttle('shoot', 60)) return;
    this._tone({ freq: 880, freqEnd: 220, type: 'square', duration: 0.07, volume: 0.25 });
  }

  hit() {
    if (!this._throttle('hit', 40)) return;
    this._tone({ freq: 200, freqEnd: 80, type: 'triangle', duration: 0.06, volume: 0.3 });
  }

  crit() {
    this._tone({ freq: 1200, freqEnd: 2400, type: 'sawtooth', duration: 0.12, volume: 0.35 });
  }

  explode() {
    if (!this._throttle('explode', 80)) return;
    this._noise({ duration: 0.3, volume: 0.5, filterFreq: 600 });
    this._tone({ freq: 90, freqEnd: 30, type: 'sine', duration: 0.3, volume: 0.5 });
  }

  freeze() {
    this._tone({ freq: 1800, freqEnd: 2600, type: 'sine', duration: 0.15, volume: 0.2 });
    this._tone({ freq: 2400, freqEnd: 3200, type: 'sine', duration: 0.12, volume: 0.15, delay: 0.05 });
  }

  lightning() {
    this._noise({ duration: 0.08, volume: 0.3, filterFreq: 4000 });
    this._tone({ freq: 160, freqEnd: 60, type: 'sawtooth', duration: 0.15, volume: 0.3 });
  }

  laser() {
    if (!this._throttle('laser', 100)) return;
    this._tone({ freq: 2200, freqEnd: 400, type: 'sawtooth', duration: 0.25, volume: 0.3 });
  }

  /** 旋风加农：风声呼啸（噪声扫频） */
  cyclone() {
    if (!this._throttle('cyclone', 150)) return;
    this._noise({ duration: 0.4, volume: 0.35, filterFreq: 1200 });
    this._tone({ freq: 300, freqEnd: 900, type: 'sine', duration: 0.35, volume: 0.15 });
  }

  /** 装甲车：引擎轰鸣+金属撞击 */
  vehicle() {
    if (!this._throttle('vehicle', 200)) return;
    this._tone({ freq: 70, freqEnd: 45, type: 'square', duration: 0.5, volume: 0.4 });
    this._noise({ duration: 0.35, volume: 0.3, filterFreq: 500 });
  }

  /** 制导激光：锁定音+高能发射 */
  guided() {
    this._tone({ freq: 600, freqEnd: 1500, type: 'sine', duration: 0.15, volume: 0.25 });
    this._tone({ freq: 1800, freqEnd: 600, type: 'sawtooth', duration: 0.2, volume: 0.2, delay: 0.12 });
  }

  /** 空投轰炸：呼啸下落+巨响 */
  airstrike() {
    this._tone({ freq: 1200, freqEnd: 200, type: 'sine', duration: 0.5, volume: 0.25 });
    this._noise({ duration: 0.4, volume: 0.5, filterFreq: 700, delay: 0.35 });
    this._tone({ freq: 80, freqEnd: 30, type: 'sine', duration: 0.4, volume: 0.5, delay: 0.4 });
  }

  /** 跃迁电子：电弧跃迁音 */
  leapwave() {
    if (!this._throttle('leapwave', 100)) return;
    this._tone({ freq: 400, freqEnd: 1800, type: 'square', duration: 0.18, volume: 0.25 });
  }

  /** 时空裂隙：空间扭曲低鸣 */
  rift() {
    this._tone({ freq: 150, freqEnd: 600, type: 'sine', duration: 0.6, volume: 0.3 });
    this._tone({ freq: 150, freqEnd: 400, type: 'triangle', duration: 0.6, volume: 0.2, delay: 0.1 });
  }

  coin() {
    if (!this._throttle('coin', 70)) return;
    this._tone({ freq: 1320, type: 'sine', duration: 0.06, volume: 0.2 });
    this._tone({ freq: 1760, type: 'sine', duration: 0.09, volume: 0.2, delay: 0.05 });
  }

  levelUp() {
    // 上行琶音
    [523, 659, 784, 1047].forEach((f, i) => {
      this._tone({ freq: f, type: 'triangle', duration: 0.15, volume: 0.3, delay: i * 0.08 });
    });
  }

  wallHit() {
    if (!this._throttle('wallHit', 120)) return;
    this._tone({ freq: 120, freqEnd: 40, type: 'sine', duration: 0.25, volume: 0.5 });
    this._noise({ duration: 0.15, volume: 0.3, filterFreq: 400 });
  }

  bossRoar() {
    this._tone({ freq: 80, freqEnd: 50, type: 'sawtooth', duration: 0.8, volume: 0.5 });
    this._noise({ duration: 0.6, volume: 0.3, filterFreq: 300 });
  }

  uiClick() {
    this._tone({ freq: 660, freqEnd: 880, type: 'sine', duration: 0.05, volume: 0.2 });
  }

  revive() {
    [440, 554, 659, 880, 1109].forEach((f, i) => {
      this._tone({ freq: f, type: 'sine', duration: 0.3, volume: 0.25, delay: i * 0.1 });
    });
  }

  // ==================== BGM（程序化氛围循环） ====================

  startBgm() {
    if (!this.enabled || this._bgmPlaying) return;
    const ctx = this._ensure();
    if (!ctx || ctx.state !== 'running') return;
    this._bgmPlaying = true;
    // 低音踏板 + 缓慢琶音的极简氛围循环，音量很低不抢戏
    const bass = [55, 55, 65.4, 49]; // A1 A1 C2 G1
    let step = 0;
    const playStep = () => {
      if (!this._bgmPlaying || !this.enabled) return;
      const f = bass[step % bass.length];
      this._tone({ freq: f, type: 'triangle', duration: 1.8, volume: 0.1 });
      // 每 4 步加一个高八度回声
      if (step % 4 === 2) this._tone({ freq: f * 4, type: 'sine', duration: 0.8, volume: 0.03 });
      step++;
      this._bgmTimer = setTimeout(playStep, 1900);
    };
    playStep();
  }

  stopBgm() {
    this._bgmPlaying = false;
    clearTimeout(this._bgmTimer);
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.stopBgm();
  }
}

/** 全局单例 */
export const audio = new AudioSystem();
