"use strict";
/* ================================================================
   SKY HOP — a tiny auto-jump climber (vanilla JS + canvas, no deps)
   Systems: Utils / SFX / Input / Particles / Background /
            Platform / Platforms / Player / Camera / Score / UI / Game
   Controls: ← → or A D · mouse / touch drag to steer
             Space / Enter: start & restart · P pause · M mute
   ================================================================ */

/* ---------------- utils ---------------- */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const clamp01 = v => clamp(v, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const choice = arr => arr[(Math.random() * arr.length) | 0];
function smoothstep(e0, e1, x) { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); }
function mixc(c1, c2, t) { return [0, 1, 2].map(i => Math.round(lerp(c1[i], c2[i], t))); }
function rgb(c) { return `rgb(${c[0]},${c[1]},${c[2]})`; }
function rr(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function wrap(v) { const M = CFG.H * 2; return ((v % M) + M) % M - CFG.H * 0.5; }

/* ---------------- config & canvas ---------------- */
const CFG = {
  W: 480, H: 720,
  gravity: 2000,
  jumpVel: 820,
  springMul: 1.72,
  maxVX: 300,
  accel: 2900,
  playerW: 34, playerH: 30,
  pxPerM: 10,
};
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let viewScale = 1, viewOX = 0, viewOY = 0;
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  // adaptive logical height: fill tall (phone portrait) screens, keep 720 on desktop-ish ratios
  const winRatio = Math.max(0.2, window.innerWidth / Math.max(1, window.innerHeight));
  const newH = Math.round(clamp(CFG.W / winRatio, 720, 1200) / 16) * 16;
  if (newH !== CFG.H) {
    CFG.H = newH;
    if (BG.genH && Math.abs(CFG.H - BG.genH) > 40) BG.reset();
  }
  const s = Math.min(window.innerWidth / CFG.W, window.innerHeight / CFG.H) * 0.98;
  const w = Math.max(1, Math.round(CFG.W * s * dpr));
  const h = Math.max(1, Math.round(CFG.H * s * dpr));
  if (canvas.width === w && canvas.height === h && canvas.style.width === (CFG.W * s) + 'px') return;
  canvas.style.width = (CFG.W * s) + 'px';
  canvas.style.height = (CFG.H * s) + 'px';
  canvas.width = w;
  canvas.height = h;
  viewScale = s * dpr;
  viewOX = (canvas.width - CFG.W * viewScale) / 2;
  viewOY = (canvas.height - CFG.H * viewScale) / 2;
}

/* ---------------- sfx (tiny synth, no assets) ---------------- */
const SFX = {
  ctx: null, on: true,
  ensure() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; } }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(f0, f1, dur, type, vol, delay = 0) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, f0), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t); o.stop(t + dur + 0.03);
  },
  noise(dur, freq, vol, delay = 0) {
    if (!this.on || !this.ctx) return;
    if (!this._nb) {
      const len = Math.floor(this.ctx.sampleRate * 0.5);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._nb = buf;
    }
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource(); src.buffer = this._nb;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.ctx.destination);
    src.start(t); src.stop(t + dur + 0.02);
  },
  jump() { const d = rand(0.95, 1.05); this.tone(300 * d, 620 * d, 0.13, 'triangle', 0.11); },
  spring() { this.tone(180, 980, 0.28, 'triangle', 0.15); },
  land() { this.tone(150, 90, 0.07, 'sine', 0.1); },
  crack() { this.noise(0.12, 500, 0.13); },
  crumble() { this.tone(175, 60, 0.13, 'sine', 0.18); this.tone(115, 42, 0.17, 'sine', 0.12, 0.06); },
  die() { this.tone(420, 70, 0.5, 'triangle', 0.14); this.noise(0.3, 300, 0.08, 0.05); },
  click() { this.tone(500, 720, 0.08, 'square', 0.07); },
  collectShield() { this.tone(320, 520, 0.09, 'sine', 0.13); this.tone(520, 940, 0.16, 'sine', 0.12, 0.07); },
  collectJet() { this.tone(140, 720, 0.3, 'triangle', 0.16); },
  collectSlow() { this.tone(620, 240, 0.32, 'sine', 0.13); },
  collectX2() { this.tone(660, 660, 0.07, 'square', 0.09); this.tone(880, 880, 0.12, 'square', 0.09, 0.07); },
  shieldPop() { this.tone(420, 90, 0.24, 'triangle', 0.17); this.noise(0.15, 900, 0.12); },
  milestone() { this.tone(523, 523, 0.08, 'sine', 0.11); this.tone(659, 659, 0.08, 'sine', 0.11, 0.08); this.tone(784, 784, 0.16, 'sine', 0.12, 0.16); },
  fanfare() { this.tone(523, 523, 0.09, 'square', 0.08); this.tone(659, 659, 0.09, 'square', 0.08, 0.1); this.tone(784, 784, 0.09, 'square', 0.08, 0.2); this.tone(1047, 1047, 0.28, 'square', 0.09, 0.3); },
};

/* ---------------- music (tiny procedural loop, no assets) ---------------- */
const Music = {
  ctx: null, started: false, playing: false,
  step: 0, nextTime: 0, timer: null, droneGain: null, lastDrone: 0,
  bass: [110, 92.5, 130.8, 98],
  mel: [
    440, 0, 554.4, 659.3, 739.99, 0, 659.3, 554.4,
    493.88, 0, 440, 493.88, 554.4, 0, 493.88, 440,
    659.3, 0, 739.99, 659.3, 554.4, 0, 493.88, 554.4,
    659.3, 554.4, 493.88, 0, 369.99, 0, 0, 0,
  ],
  ensure() {
    if (!SFX.ctx) SFX.ensure();
    this.ctx = SFX.ctx;
    if (!this.ctx || this.started) return;
    this.started = true;
    this.nextTime = this.ctx.currentTime + 0.05;
    this.timer = setInterval(() => this.schedule(), 90);
    const c = this.ctx;
    this.droneGain = c.createGain();
    this.droneGain.gain.value = 0;
    this.droneGain.connect(c.destination);
    for (const f of [55, 82.41]) {
      const o = c.createOscillator();
      o.type = 'sine'; o.frequency.value = f; o.detune.value = rand(-6, 6);
      o.connect(this.droneGain); o.start();
    }
    const lfo = c.createOscillator(); lfo.frequency.value = 0.12;
    const lg = c.createGain(); lg.gain.value = 0.012;
    lfo.connect(lg).connect(this.droneGain.gain); lfo.start();
    if (Game.state === 'playing' || Game.state === 'menu') this.playing = true;
  },
  setPlaying(on) { this.playing = on; },
  update(time, altT) {
    if (!this.ctx || !this.droneGain || time - this.lastDrone < 0.3) return;
    this.lastDrone = time;
    const target = altT > 0.5 && this.playing && SFX.on && !Game.paused ? 0.035 : 0;
    this.droneGain.gain.setTargetAtTime(target, this.ctx.currentTime, 1.2);
  },
  schedule() {
    if (!this.ctx) return;
    const stepDur = 60 / 132 / 2;
    while (this.nextTime < this.ctx.currentTime + 0.35) {
      if (this.playing && SFX.on && !Game.paused) this.playStep(this.step, this.nextTime);
      this.step = (this.step + 1) % 32;
      this.nextTime += stepDur;
    }
  },
  playStep(i, t) {
    const c = this.ctx;
    if (i % 2 === 0) this.note(this.bass[(i >> 3) % 4], t, 0.3, 'sine', 0.06);
    const m = this.mel[i % 32];
    if (m && Math.random() > 0.03) this.note(m * rand(0.99, 1.01), t, 0.2, 'triangle', 0.045);
  },
  note(f, t, dur, type, vol) {
    const c = this.ctx;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t); o.stop(t + dur + 0.03);
  },
};

/* ---------------- input (keyboard + pointer) ---------------- */
const Input = {
  keys: { l: false, r: false },
  keyT: { l: -99, r: -99 },
  ptr: { x: CFG.W / 2, last: -99, down: false },            // mouse: absolute follow
  touch: { x: CFG.W / 2, target: CFG.W / 2, startX: 0, baseX: CFG.W / 2, last: -99, down: false, id: null }, // touch: relative drag
  now() { return performance.now() / 1000; },
  logicalX(e) {
    const r = canvas.getBoundingClientRect();
    return r.width > 0 ? clamp((e.clientX - r.left) * (CFG.W / r.width), -60, CFG.W + 60) : CFG.W / 2;
  },
  desiredVX(px) {
    const n = this.now();
    const ages = { keys: n - Math.max(this.keyT.l, this.keyT.r), touch: n - this.touch.last, ptr: n - this.ptr.last };
    const keysHeld = (this.keys.r ? 1 : 0) - (this.keys.l ? 1 : 0);
    let newest = 'keys';
    if (ages.touch < ages[newest]) newest = 'touch';
    if (ages.ptr < ages[newest]) newest = 'ptr';
    if (newest === 'keys' && ages.keys < 1.5) return keysHeld * CFG.maxVX;
    if (newest === 'touch' && ages.touch < 1.5) return clamp((this.touch.target - px) * 6, -CFG.maxVX, CFG.maxVX);
    if (newest === 'ptr' && ages.ptr < 1.5) return clamp((this.ptr.x - px) * 6, -CFG.maxVX, CFG.maxVX);
    if (this.keys.l || this.keys.r) return keysHeld * CFG.maxVX;
    return 0;
  },
  resetInput() {
    this.ptr.last = -99; this.ptr.down = false;
    this.touch.last = -99; this.touch.down = false; this.touch.id = null;
    this.touch.target = Game.player.x;
  },
  attach() {
    addEventListener('keydown', e => {
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') { this.keys.l = true; this.keyT.l = this.now(); }
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') { this.keys.r = true; this.keyT.r = this.now(); }
      else if (k === ' ' || k === 'Enter') { if (!e.repeat) { SFX.ensure(); Music.ensure(); Game.primaryAction(); } }
      else if (k === 'p' || k === 'P') { Game.togglePause(); }
      else if (k === 'm' || k === 'M') { SFX.on = !SFX.on; }
      else return;
      if (k === ' ' || k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight') e.preventDefault();
    });
    addEventListener('keyup', e => {
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') this.keys.l = false;
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') this.keys.r = false;
    });
    canvas.addEventListener('pointerdown', e => {
      SFX.ensure();
      Music.ensure();
      const x = this.logicalX(e);
      if (e.pointerType === 'touch') {
        this.touch.down = true;
        this.touch.id = e.pointerId ?? 0;
        this.touch.x = x; this.touch.startX = x;
        this.touch.baseX = Game.player.x;
        this.touch.target = Game.player.x;
        this.touch.last = this.now();
      } else {
        this.ptr.down = true;
        this.ptr.x = clamp(x, 0, CFG.W);
        this.ptr.last = this.now();
      }
      Game.primaryAction();
    });
    canvas.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') {
        if (!this.touch.down || (e.pointerId ?? 0) !== this.touch.id) return;
        const x = this.logicalX(e);
        this.touch.x = x;
        this.touch.target = clamp(this.touch.baseX + (x - this.touch.startX), -60, CFG.W + 60);
        this.touch.last = this.now();
      } else if (!e.pointerType || e.pointerType === 'mouse') {
        this.ptr.x = clamp(this.logicalX(e), 0, CFG.W);
        this.ptr.last = this.now();
      }
    });
    const up = e => {
      if (e.pointerType === 'touch') {
        if ((e.pointerId ?? 0) === this.touch.id) { this.touch.down = false; this.touch.id = null; }
        this.touch.last = this.now();
      } else this.ptr.down = false;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', () => { this.ptr.down = false; });
  },
};

/* ---------------- particles ---------------- */
const PAL = {
  dust: ['#ffffff', '#ffe9c9', '#d9f7ff'],
  spring: ['#ffd166', '#ff9e5e', '#ffffff'],
  crumble: ['#e0985a', '#c97f45', '#a35d2e'],
  death: ['#ff7d66', '#ffd166', '#8ee08e'],
};
const Particles = {
  list: [],
  MAX: 260,
  burst(x, y, o = {}) {
    const n = o.n ?? 10;
    for (let i = 0; i < n; i++) {
      if (this.list.length >= this.MAX) this.list.shift();
      const a = (o.angle ?? -Math.PI / 2) + rand(-(o.spread ?? Math.PI) / 2, (o.spread ?? Math.PI) / 2);
      const v = (o.speed ?? 120) * rand(0.4, 1);
      this.list.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        g: o.g ?? 500, drag: o.drag ?? 2,
        age: 0, life: o.life ?? rand(0.4, 0.8),
        size: (o.size ?? 3) * rand(0.7, 1.3),
        color: o.color || choice(PAL.dust),
      });
    }
  },
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt;
      if (p.age >= p.life) { this.list.splice(i, 1); continue; }
      p.vy += p.g * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy *= d;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
  },
  draw(camY) {
    ctx.save();
    ctx.translate(0, -camY);
    for (const p of this.list) {
      ctx.globalAlpha = clamp01(1 - p.age / p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  },
};

/* ---------------- active effects (power-up timers) ---------------- */
const FX = {
  shield: false, jet: 0, slow: 0, x2: 0,
  MAX: { jet: 2.6, slow: 6, x2: 10 },
  clear() { this.shield = false; this.jet = 0; this.slow = 0; this.x2 = 0; },
  tick(dt) {
    if (this.jet > 0) this.jet = Math.max(0, this.jet - dt);
    if (this.slow > 0) this.slow = Math.max(0, this.slow - dt);
    if (this.x2 > 0) this.x2 = Math.max(0, this.x2 - dt);
  },
};

/* ---------------- items (power-ups) ---------------- */
const ITEM_TYPES = ['shield', 'jet', 'slow', 'x2'];
const ITEM_COLORS = { shield: '#6fc7ff', jet: '#ff9e5e', slow: '#9b6fff', x2: '#ffd166' };
class Item {
  constructor(x, y, type) {
    this.x = x; this.y = y; this.type = type;
    this.t = rand(0, 6.28);
    this.taken = false;
  }
  update(dt) { this.t += dt * 3; }
  draw() {
    if (this.taken) return;
    const y = this.y + Math.sin(this.t) * 4;
    ctx.save();
    ctx.globalAlpha = 0.3 + 0.2 * Math.sin(this.t * 2);
    ctx.fillStyle = ITEM_COLORS[this.type];
    ctx.beginPath(); ctx.arc(this.x, y, 15, 0, 7); ctx.fill();
    ctx.restore();
    if (this.type === 'shield') {
      ctx.fillStyle = '#6fc7ff'; ctx.beginPath(); ctx.arc(this.x, y, 8, 0, 7); ctx.fill();
      ctx.strokeStyle = '#cfeeff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(this.x, y, 8, 0, 7); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(this.x - 2, y - 2, 4, -2.2, -0.8); ctx.stroke();
    } else if (this.type === 'jet') {
      ctx.fillStyle = '#ff6b4a'; rr(ctx, this.x - 5, y - 8, 10, 16, 4); ctx.fill();
      ctx.fillStyle = '#ffd166';
      ctx.beginPath(); ctx.moveTo(this.x - 5, y + 4); ctx.lineTo(this.x - 9, y + 9); ctx.lineTo(this.x - 5, y + 8); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(this.x + 5, y + 4); ctx.lineTo(this.x + 9, y + 9); ctx.lineTo(this.x + 5, y + 8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#8ecdf5'; ctx.beginPath(); ctx.arc(this.x, y - 2, 2.5, 0, 7); ctx.fill();
    } else if (this.type === 'slow') {
      ctx.fillStyle = '#9b6fff'; ctx.beginPath(); ctx.arc(this.x, y, 8, 0, 7); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(this.x, y, 8, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(this.x, y); ctx.lineTo(this.x, y - 4);
      ctx.moveTo(this.x, y); ctx.lineTo(this.x + 3, y + 1); ctx.stroke();
    } else {
      ctx.fillStyle = '#ffd166'; rr(ctx, this.x - 9, y - 9, 18, 18, 5); ctx.fill();
      ctx.fillStyle = '#5a3d00'; ctx.font = '800 11px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('\u00d72', this.x, y + 1);
      ctx.textBaseline = 'alphabetic';
    }
  }
}
const Items = {
  list: [],
  reset() { this.list.length = 0; },
  spawnFrom(pl) {
    if (this.list.length > 30) return;
    const d = clamp01(Score.meters / 450);
    if (Math.random() > 0.05 + 0.05 * d) return;
    const r = Math.random();
    const type = r < 0.3 ? 'shield' : r < 0.55 ? 'jet' : r < 0.8 ? 'slow' : 'x2';
    const x = clamp(pl.x + rand(-18, 18), 16, CFG.W - 16);
    this.list.push(new Item(x, pl.y - 30, type));
  },
  prune(camY) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const it = this.list[i];
      if (it.taken || it.y > camY + CFG.H + 80 || it.y < camY - 80) this.list.splice(i, 1);
    }
  },
  update(dt) { for (const it of this.list) it.update(dt); },
  draw() { for (const it of this.list) it.draw(); },
};

/* ---------------- background (parallax sky) ---------------- */
const SKY = {
  top: [[105, 183, 255], [74, 95, 174], [20, 16, 50]],
  bot: [[214, 239, 255], [196, 120, 160], [51, 32, 77]],
};
function skyCol(arr, t) {
  const [c1, c2, k] = t < 0.55 ? [arr[0], arr[1], t / 0.55] : [arr[1], arr[2], (t - 0.55) / 0.45];
  return mixc(c1, c2, clamp01(k));
}
function drawCloud(x, y, s, a) {
  if (a <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x, y, 18 * s, 0, 7);
  ctx.arc(x + 17 * s, y + 4 * s, 14 * s, 0, 7);
  ctx.arc(x - 17 * s, y + 5 * s, 13 * s, 0, 7);
  ctx.fill();
  ctx.restore();
}
const BG = {
  stars: [], clouds: [], genH: 0,
  reset() {
    this.genH = CFG.H;
    this.stars = [];
    for (let i = 0; i < 70; i++) this.stars.push({ x: rand(CFG.W), y: rand(CFG.H * 2), s: rand(0.6, 1.8), tw: rand(0, 6.28), sp: rand(0.5, 1.6) });
    this.clouds = [];
    for (let i = 0; i < 6; i++) this.clouds.push({ x: rand(CFG.W), y: rand(CFG.H * 2), s: rand(0.5, 0.9), f: 0.22, sp: rand(4, 9), a: 0.35 });
    for (let i = 0; i < 5; i++) this.clouds.push({ x: rand(CFG.W), y: rand(CFG.H * 2), s: rand(0.8, 1.3), f: 0.45, sp: rand(6, 14), a: 0.5 });
  },
  update(dt) {
    for (const c of this.clouds) {
      c.x += c.sp * dt;
      if (c.x > CFG.W + 150) c.x = -150;
    }
  },
  draw(camY, altM, time) {
    const t = clamp01(altM / 600);
    const g = ctx.createLinearGradient(0, 0, 0, CFG.H);
    g.addColorStop(0, rgb(skyCol(SKY.top, t)));
    g.addColorStop(1, rgb(skyCol(SKY.bot, t)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CFG.W, CFG.H);
    const sa = smoothstep(0.42, 0.85, t);
    if (sa > 0.01) {
      ctx.fillStyle = '#fff';
      for (const s of this.stars) {
        const sy = wrap(s.y - camY * 0.12);
        if (sy < -10 || sy > CFG.H + 10) continue;
        ctx.globalAlpha = sa * (0.3 + 0.7 * (0.5 + 0.5 * Math.sin(time * 1.8 * s.sp + s.tw)));
        ctx.beginPath(); ctx.arc(s.x, sy, s.s, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    for (const c of this.clouds) {
      const sy = wrap(c.y - camY * c.f);
      if (sy < -80 || sy > CFG.H + 80) continue;
      drawCloud(c.x, sy, c.s, c.a * (1 - t * 0.75));
    }
  },
};

/* ---------------- platforms ---------------- */
const PTYPES = { normal: 0, move: 1, crumble: 2, spring: 3 };
class Platform {
  constructor(x, y, w, type) {
    this.x = x; this.y = y; this.w = w; this.h = 14; this.type = type;
    this.baseX = x; this.t = rand(0, 6.28); this.speed = rand(1.2, 2.2); this.range = 0;
    this.prevX = x;
    this.broken = false; this.breakT = 0;
    this.springCD = 0; this.springT = 0;
    this.gone = false;
  }
  get x0() { return this.x - this.w / 2; }
  setRange(r) { this.range = Math.min(r, this.x - this.w / 2 - 8, CFG.W - this.w / 2 - 8 - this.x); }
  update(dt) {
    this.prevX = this.x;
    if (this.type === PTYPES.move) { this.t += this.speed * dt; this.x = this.baseX + Math.sin(this.t) * this.range; }
    if (this.broken) {
      this.breakT -= dt;
      if (this.breakT <= 0) {
        this.gone = true;
        Particles.burst(this.x, this.y + 4, { n: 8, angle: Math.PI / 2, spread: 2.2, speed: 90, g: 900, life: 0.6, size: 3, color: choice(PAL.crumble) });
        SFX.crumble();
      }
    }
    if (this.springCD > 0) this.springCD -= dt;
    if (this.springT > 0) this.springT = Math.max(0, this.springT - 3 * dt);
  }
  get dx() { return this.x - this.prevX; }
  draw() {
    if (this.gone) return;
    const ox = this.broken ? rand(-2.5, 2.5) : 0;
    const x = this.x0 + ox, y = this.y, w = this.w, h = this.h;
    let body = '#58c14e', top = '#83dd70';
    if (this.type === PTYPES.move) { body = FX.slow > 0 ? '#7a6fd0' : '#4f9fe0'; top = FX.slow > 0 ? '#a89cf0' : '#8ecdf5'; }
    else if (this.type === PTYPES.crumble) { body = this.broken ? '#9a6a3d' : '#d99a55'; top = this.broken ? '#b07c48' : '#eec27f'; }
    ctx.fillStyle = body; rr(ctx, x, y, w, h, 6); ctx.fill();
    ctx.fillStyle = top; rr(ctx, x + 2.5, y + 2, w - 5, 5, 2.5); ctx.fill();
    if (this.type === PTYPES.move) {
      ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      const cy = y + h / 2 + 1.5;
      for (const off of [-10, 8]) {
        ctx.beginPath();
        ctx.moveTo(this.x + ox - 5 + off, cy - 3);
        ctx.lineTo(this.x + ox + 1 + off, cy);
        ctx.lineTo(this.x + ox - 5 + off, cy + 3);
        ctx.stroke();
      }
    }
    if (this.type === PTYPES.crumble && !this.broken) {
      ctx.strokeStyle = 'rgba(90,50,20,.35)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.3, y + 2);
      ctx.lineTo(x + w * 0.38, y + h - 3);
      ctx.lineTo(x + w * 0.45, y + h * 0.5);
      ctx.lineTo(x + w * 0.55, y + h - 2);
      ctx.stroke();
    }
    if (this.type === PTYPES.spring) {
      const lift = 4 + 10 * this.springT;
      ctx.strokeStyle = '#9aa7b5'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(this.x + ox - 6, y - 1);
      ctx.lineTo(this.x + ox + 6, y - 3 - lift * 0.4);
      ctx.lineTo(this.x + ox - 6, y - 5 - lift * 0.7);
      ctx.lineTo(this.x + ox + 6, y - 7 - lift);
      ctx.stroke();
      ctx.fillStyle = '#ff6b6b'; rr(ctx, this.x + ox - 12, y - 10 - lift, 24, 6, 3); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.5)'; rr(ctx, this.x + ox - 10, y - 9 - lift, 20, 2, 1); ctx.fill();
    }
  }
}
class Platforms {
  constructor() { this.list = []; this.last = null; }
  reset() {
    this.list = [];
    const p = new Platform(CFG.W / 2, CFG.H * 0.66, 190, PTYPES.normal);
    this.list.push(p);
    this.last = p;
  }
  difficulty() { return clamp01(Score.meters / 450); }
  spawnAbove() {
    const d = this.difficulty();
    const gap = 56 + rand(0, 40) + 26 * d;
    const w = clamp(lerp(96, 62, d) * rand(0.88, 1.18), 52, 120);
    const prev = this.last;
    const v0 = CFG.jumpVel, G = CFG.gravity;
    const tUp = (v0 + Math.sqrt(Math.max(1, v0 * v0 - 2 * G * gap))) / G;
    const maxD = CFG.maxVX * tUp * 0.82;
    const nx = clamp(prev.x + rand(-maxD, maxD), w / 2 + 8, CFG.W - w / 2 - 8);
    const moveP = 0.10 + 0.42 * d;
    const crumbP = 0.08 + 0.24 * d;
    let type = PTYPES.normal;
    const r = Math.random();
    if (r < moveP) type = PTYPES.move;
    else if (r < moveP + crumbP) type = PTYPES.crumble;
    else if (Math.random() < 0.14) type = PTYPES.spring;
    const p = new Platform(nx, prev.y - gap, w, type);
    if (type === PTYPES.move) p.setRange(30 + 95 * d);
    this.list.push(p);
    this.last = p;
    Items.spawnFrom(p);
  }
  ensure(camY) {
    let guard = 0;
    while (this.last && this.last.y > camY - 260 && guard++ < 64) this.spawnAbove();
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i].y > camY + CFG.H + 140) this.list.splice(i, 1);
    }
  }
  update(dt) {
    for (const p of this.list) p.update(dt);
  }
  draw() {
    for (const p of this.list) p.draw();
  }
}

/* ---------------- player ---------------- */
class Player {
  constructor() { this.reset(); }
  reset() {
    this.x = CFG.W / 2;
    this.y = CFG.H * 0.62;
    this.vx = 0; this.vy = 0;
    this.minY = this.y;
    this.squash = 1;
    this.face = 1;
    this.blink = rand(1.5, 4);
    this.dead = false;
    this.spin = 0;
    this.onPlat = null;
    this.rescueGrace = 0;
  }
  get hw() { return CFG.playerW / 2; }
  get hh() { return CFG.playerH / 2; }
  jump(v) { this.vy = -v; this.onPlat = null; }
  update(dt, plats) {
    this.blink -= dt;
    if (this.blink < -0.12) this.blink = rand(1.5, 4.5);
    const want = Input.desiredVX(this.x);
    if (this.vx < want) this.vx = Math.min(want, this.vx + CFG.accel * dt);
    else if (this.vx > want) this.vx = Math.max(want, this.vx - CFG.accel * dt);
    this.x += this.vx * dt;
    if (this.x < this.hw) { this.x = this.hw; if (this.vx < 0) this.vx = 0; }
    if (this.x > CFG.W - this.hw) { this.x = CFG.W - this.hw; if (this.vx > 0) this.vx = 0; }
    const prevBottom = this.y + this.hh;
    if (FX.jet > 0) {
      this.vy = -CFG.jumpVel * 1.4;
      if (Math.random() < 0.6) Particles.burst(this.x, this.y + this.hh, { n: 1, angle: Math.PI / 2, spread: 1.2, speed: 70, g: 60, life: 0.25, size: 3, color: choice(['#ffd166', '#ff9e5e', '#ffffff']) });
    } else {
      this.vy = Math.min(1400, this.vy + CFG.gravity * dt);
    }
    this.y += this.vy * dt;
    this.minY = Math.min(this.minY, this.y);
    this.squash = lerp(this.squash, 1, Math.min(1, dt * 9));
    if (this.vy > 0) {
      const bot = this.y + this.hh;
      for (const p of plats.list) {
        if (p.gone || p.broken) continue;
        if (prevBottom <= p.y + 1 && bot >= p.y &&
            this.x + this.hw * 0.7 > p.x0 && this.x - this.hw * 0.7 < p.x0 + p.w) {
          this.y = p.y - this.hh;
          this.squash = 0.62;
          this.onPlat = p;
          if (p.type === PTYPES.crumble) { p.broken = true; p.breakT = 0.35; }
          const boosted = p.type === PTYPES.spring && p.springCD <= 0;
          if (boosted) { p.springCD = 1.6; p.springT = 1; }
          this.jump(CFG.jumpVel * (boosted ? CFG.springMul : 1));
          if (boosted) {
            Particles.burst(this.x, this.y + this.hh, { n: 14, angle: Math.PI / 2, spread: 1.6, speed: 150, g: 600, life: 0.5, size: 3, color: choice(PAL.spring) });
            SFX.spring();
          } else {
            Particles.burst(this.x, this.y + this.hh, { n: 8, angle: Math.PI / 2, spread: 2.4, speed: 90, g: 700, life: 0.45, size: 2.5, color: '#ffffff' });
            SFX.land();
            if (p.type === PTYPES.crumble) SFX.crack();
            SFX.jump();
          }
          break;
        }
      }
    }
    if (this.vx > 20) this.face = 1;
    else if (this.vx < -20) this.face = -1;
  }
  die() {
    this.dead = true;
    this.spin = 0;
    SFX.die();
    Particles.burst(this.x, this.y, { n: 22, angle: 0, spread: 6.28, speed: 180, g: 500, life: 0.8, size: 3, color: choice(PAL.death) });
  }
  draw() {
    const s = clamp(this.squash, 0.45, 1.6);
    const jet = FX.jet > 0;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.dead ? this.spin : clamp(this.vx / CFG.maxVX, -1, 1) * (jet ? 0.1 : 0.18));
    if (jet) {
      const fl = 10 + rand(0, 9);
      ctx.fillStyle = 'rgba(255,158,94,.85)';
      ctx.beginPath(); ctx.moveTo(-6, 11); ctx.lineTo(0, 11 + fl); ctx.lineTo(6, 11); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,225,130,.9)';
      ctx.beginPath(); ctx.moveTo(-3, 11); ctx.lineTo(0, 11 + fl * 0.6); ctx.lineTo(3, 11); ctx.closePath(); ctx.fill();
    }
    ctx.scale(2 - s, s);
    const w = CFG.playerW, h = CFG.playerH;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#3f9d58'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(0, -h / 2 + 2); ctx.quadraticCurveTo(3, -h / 2 - 6, -1, -h / 2 - 11); ctx.stroke();
    ctx.fillStyle = '#57c26b';
    ctx.beginPath(); ctx.ellipse(-5, -h / 2 - 10, 5, 3, -0.6, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(3, -h / 2 - 12, 5, 3, 0.5, 0, 7); ctx.fill();
    ctx.fillStyle = '#8ee08e'; rr(ctx, -w / 2, -h / 2, w, h, 10); ctx.fill();
    ctx.strokeStyle = '#4da664'; ctx.lineWidth = 2.5;
    rr(ctx, -w / 2 + 1.25, -h / 2 + 1.25, w - 2.5, h - 2.5, 9); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.beginPath(); ctx.ellipse(0, h / 2 - 7, 9, 5, 0, 0, 7); ctx.fill();
    const blink = this.blink < 0 && !this.dead;
    for (const side of [-1, 1]) {
      const ex = side * 6, ey = -3;
      if (this.dead) {
        ctx.strokeStyle = '#25455e'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ex - 3, ey - 3); ctx.lineTo(ex + 3, ey + 3);
        ctx.moveTo(ex + 3, ey - 3); ctx.lineTo(ex - 3, ey + 3);
        ctx.stroke();
      } else if (blink) {
        ctx.strokeStyle = '#25455e'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(ex - 3, ey); ctx.lineTo(ex + 3, ey); ctx.stroke();
      } else {
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(ex, ey, 4.2, 0, 7); ctx.fill();
        ctx.fillStyle = '#25455e';
        ctx.beginPath(); ctx.arc(ex + this.face * 1.6, ey + clamp(this.vy / 900, -1, 1) * 1.6, 2.1, 0, 7); ctx.fill();
      }
    }
    ctx.fillStyle = 'rgba(255,140,150,.5)';
    ctx.beginPath(); ctx.arc(-11, 3, 2.6, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(11, 3, 2.6, 0, 7); ctx.fill();
    ctx.strokeStyle = '#25455e'; ctx.lineWidth = 1.8;
    ctx.beginPath();
    if (this.dead) ctx.arc(0, 5, 2.5, Math.PI * 1.1, Math.PI * 1.9);
    else ctx.arc(0, 3.5, 3.2, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
    if (FX.shield && !this.dead) {
      const r = 27 + Math.sin(Game.time * 5) * 2;
      ctx.fillStyle = 'rgba(111,199,255,.16)';
      ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(111,199,255,.8)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke();
    }
    ctx.restore();
  }
}

/* ---------------- camera ---------------- */
const Camera = {
  y: 0, target: 0,
  reset() { this.y = 0; this.target = 0; },
  update(dt, py) {
    const want = py - CFG.H * 0.38;
    if (want < this.target) this.target = want;
    this.y += (this.target - this.y) * (1 - Math.exp(-6 * dt));
  },
};

/* ---------------- score ---------------- */
const Score = {
  meters: 0, points: 0, best: 0, startY: 0, newBest: false,
  load() { try { this.best = +localStorage.getItem('skyhop.best') || 0; } catch (e) { this.best = 0; } },
  save() { try { localStorage.setItem('skyhop.best', String(this.best)); } catch (e) { } },
  reset(py) { this.meters = 0; this.points = 0; this.newBest = false; this.startY = py; },
  update(py) {
    const real = Math.max(0, (this.startY - py) / CFG.pxPerM);
    if (real > this.meters) {
      const crossed = Math.floor(real / 100) > Math.floor(this.meters / 100);
      this.points += (real - this.meters) * (FX.x2 > 0 ? 2 : 1);
      this.meters = real;
      if (crossed && this.meters >= 100) SFX.milestone();
    }
    if (Math.floor(this.points) > this.best) { this.best = Math.floor(this.points); this.newBest = true; }
  },
};

/* ---------------- ui ---------------- */
const FONT = 'ui-rounded, "Hiragino Maru Gothic ProN", "Varela Round", "Segoe UI", system-ui, sans-serif';
const UI = {
  btn: null,
  setFont(size, weight) { ctx.font = `${weight || 700} ${size}px ${FONT}`; },
  hud() {
    if (Game.state === 'menu') return;
    const pts = Math.floor(Score.points);
    const suffix = FX.x2 > 0 ? ' pts' : ' m';
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    this.setFont(30, 800);
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fillText(`${pts}${suffix}`, CFG.W / 2 + 2, 16);
    ctx.fillStyle = FX.x2 > 0 ? '#ffd166' : '#fff';
    ctx.fillText(`${pts}${suffix}`, CFG.W / 2, 14);
    this.setFont(15, 700);
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.fillText(`BEST ${Math.max(Score.best, pts)}${suffix}`, CFG.W / 2, 54);
    if (!SFX.on) {
      this.setFont(12, 600);
      ctx.fillStyle = 'rgba(255,255,255,.4)';
      ctx.fillText('muted (M)', CFG.W / 2, 78);
    }
    let bx = 10;
    const badge = (frac, color, glyph) => {
      rr(ctx, bx, 88, 34, 22, 7);
      ctx.fillStyle = color; ctx.fill();
      ctx.fillStyle = '#fff';
      if (glyph === '2x') {
        this.setFont(11, 800);
        ctx.fillText('\u00d72', bx + 17, 94);
      } else if (glyph === 'shield') {
        ctx.beginPath(); ctx.arc(bx + 17, 98, 5, 0, 7); ctx.fill();
      } else if (glyph === 'jet') {
        ctx.beginPath(); ctx.moveTo(bx + 12, 103); ctx.lineTo(bx + 17, 92); ctx.lineTo(bx + 22, 103); ctx.closePath(); ctx.fill();
      } else {
        ctx.lineWidth = 2; ctx.strokeStyle = '#fff';
        ctx.beginPath(); ctx.arc(bx + 17, 98, 5.5, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(bx + 17, 98); ctx.lineTo(bx + 17, 94.5);
        ctx.moveTo(bx + 17, 98); ctx.lineTo(bx + 20, 99); ctx.stroke();
      }
      if (frac < 1) {
        ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(bx + 3, 105, 28, 3);
        ctx.fillStyle = '#fff'; ctx.fillRect(bx + 3, 105, 28 * clamp01(frac), 3);
      }
      bx += 42;
    };
    if (FX.jet > 0) badge(FX.jet / FX.MAX.jet, '#ff9e5e', 'jet');
    if (FX.slow > 0) badge(FX.slow / FX.MAX.slow, '#9b6fff', 'slow');
    if (FX.x2 > 0) badge(FX.x2 / FX.MAX.x2, '#ffd166', '2x');
    if (FX.shield) badge(1, '#6fc7ff', 'shield');
    ctx.restore();
  },
  menu(t) {
    const H = CFG.H;
    ctx.save();
    ctx.fillStyle = 'rgba(10,16,34,.3)';
    ctx.fillRect(0, 0, CFG.W, H);
    ctx.textAlign = 'center';
    ctx.translate(CFG.W / 2, H * 0.26 + Math.sin(t * 2.2) * 7);
    this.setFont(58, 800);
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.fillText('SKY HOP', 3, 4);
    ctx.fillStyle = '#fff';
    ctx.fillText('SKY HOP', 0, 0);
    ctx.restore();
    ctx.save();
    ctx.textAlign = 'center';
    this.setFont(16, 600);
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.fillText('hop forever · climb the sky', CFG.W / 2, H * 0.32);
    this.setFont(15, 600);
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.fillText('\u2190 \u2192 / A D · mouse · drag on touch', CFG.W / 2, H * 0.615);
    this.setFont(13, 500);
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.fillText('grab power-ups:  bubble · rocket · clock · \u00d72', CFG.W / 2, H * 0.65);
    ctx.globalAlpha = 0.55 + 0.45 * Math.sin(t * 3);
    this.setFont(21, 800);
    ctx.fillStyle = '#ffe9a8';
    ctx.fillText('TAP  or  SPACE  to start', CFG.W / 2, H * 0.705);
    ctx.globalAlpha = 1;
    this.setFont(13, 500);
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.fillText('P pause · M sound', CFG.W / 2, H * 0.92);
    ctx.restore();
  },
  dead() {
    ctx.fillStyle = 'rgba(10,14,30,.55)';
    ctx.fillRect(0, 0, CFG.W, CFG.H);
    const w = 320, h = 300;
    const x = (CFG.W - w) / 2, y = (CFG.H - h) / 2 - 30;
    rr(ctx, x, y, w, h, 20);
    ctx.fillStyle = 'rgba(20,26,48,.92)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.save();
    ctx.textAlign = 'center';
    this.setFont(40, 800);
    ctx.fillStyle = '#ff8d7a';
    ctx.fillText('OUCH!', CFG.W / 2, y + 66);
    this.setFont(36, 800);
    ctx.fillStyle = '#fff';
    ctx.fillText(`${Math.floor(Score.points)}`, CFG.W / 2, y + 112);
    this.setFont(13, 700);
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.fillText('SCORE', CFG.W / 2, y + 136);
    this.setFont(15, 600);
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.fillText(`best ${Score.best}  ·  height ${Math.floor(Score.meters)} m`, CFG.W / 2, y + 158);
    if (Score.newBest) {
      this.setFont(18, 800);
      ctx.fillStyle = '#ffd166';
      ctx.fillText('\u2605 NEW BEST \u2605', CFG.W / 2, y + 184);
    }
    const bw = 200, bh = 56;
    const bx = CFG.W / 2 - bw / 2, by = y + h - 84;
    rr(ctx, bx, by - 3, bw, bh, 16);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fill();
    rr(ctx, bx, by, bw, bh, 16);
    ctx.fillStyle = '#7ee08e'; ctx.fill();
    this.setFont(22, 800);
    ctx.fillStyle = '#123018';
    ctx.fillText('PLAY AGAIN', CFG.W / 2, by + 36);
    this.btn = { x: bx - 6, y: by - 8, w: bw + 12, h: bh + 12 };
    ctx.restore();
  },
  paused() {
    ctx.fillStyle = 'rgba(10,14,30,.5)';
    ctx.fillRect(0, 0, CFG.W, CFG.H);
    ctx.save();
    ctx.textAlign = 'center';
    this.setFont(40, 800);
    ctx.fillStyle = '#fff';
    ctx.fillText('PAUSED', CFG.W / 2, CFG.H / 2 - 8);
    this.setFont(16, 600);
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.fillText('press P to resume', CFG.W / 2, CFG.H / 2 + 26);
    ctx.restore();
  },
};

/* ---------------- game ---------------- */
const Game = {
  state: 'menu',
  paused: false,
  time: 0,
  shake: 0,
  player: new Player(),
  platforms: new Platforms(),
  start() {
    this.player.reset();
    Input.resetInput();
    this.platforms.reset();
    Particles.list.length = 0;
    Camera.reset();
    Score.reset(this.player.y);
    FX.clear();
    Items.reset();
    this.shake = 0;
    this.paused = false;
    UI.btn = null;
    this.state = 'playing';
    this.player.jump(CFG.jumpVel);
    SFX.jump();
    Music.setPlaying(true);
  },
  die() {
    if (this.state !== 'playing') return;
    this.state = 'dead';
    this.player.die();
    Music.setPlaying(false);
    this.shake = 1;
    Score.save();
    if (Score.newBest) SFX.fanfare();
  },
  primaryAction() {
    if (this.state === 'menu') { SFX.click(); this.start(); }
    else if (this.state === 'dead') { SFX.click(); this.start(); }
    else if (this.paused) this.paused = false;
  },
  togglePause() {
    if (this.state === 'playing') this.paused = !this.paused;
  },
  step(dt) {
    this.time += dt;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 2);
    BG.update(dt);
    Particles.update(dt);
    const p = this.player;
    if (this.state === 'playing') {
      FX.tick(dt);
      p.update(dt, this.platforms);
      this.platforms.update(dt);
      Items.update(dt);
      Camera.update(dt, p.y);
      this.platforms.ensure(Camera.y);
      Items.prune(Camera.y);
      Score.update(p.y);
      Music.update(this.time, clamp01(Score.meters / 600));
      for (const it of Items.list) {
        if (it.taken) continue;
        if (Math.abs(p.x - it.x) < p.hw + 11 && Math.abs(p.y - it.y) < p.hh + 11) {
          it.taken = true;
          Particles.burst(it.x, it.y, { n: 12, angle: 0, spread: 6.28, speed: 130, g: 150, life: 0.5, size: 3, color: ITEM_COLORS[it.type] });
          if (it.type === 'shield') { FX.shield = true; SFX.collectShield(); }
          else if (it.type === 'jet') { FX.jet = FX.MAX.jet; SFX.collectJet(); }
          else if (it.type === 'slow') { FX.slow = FX.MAX.slow; SFX.collectSlow(); }
          else { FX.x2 = FX.MAX.x2; SFX.collectX2(); }
        }
      }
      if (p.rescueGrace > 0) p.rescueGrace -= dt;
      if (p.y - p.hh > Camera.y + CFG.H) {
        if (p.rescueGrace > 0) {
          // shield just rescued, rising back into view
        } else if (FX.shield) {
          FX.shield = false;
          p.rescueGrace = 2.0;
          FX.jet = Math.max(FX.jet, 1.8);
          p.vy = -CFG.jumpVel * 1.4;
          this.shake = 1;
          SFX.shieldPop();
          Particles.burst(p.x, p.y, { n: 18, angle: 0, spread: 6.28, speed: 160, g: 300, life: 0.6, size: 3, color: '#6fc7ff' });
        } else this.die();
      }
    } else if (this.state === 'menu') {
      p.blink -= dt;
      if (p.blink < -0.12) p.blink = rand(1.5, 4.5);
      p.squash = lerp(p.squash, 1, Math.min(1, dt * 9));
      p.vy = Math.min(1400, p.vy + CFG.gravity * dt);
      p.y += p.vy * dt;
      p.x = lerp(p.x, CFG.W / 2, Math.min(1, dt * 3));
      const top = CFG.H * 0.66;
      if (p.vy > 0 && p.y + p.hh >= top) {
        p.y = top - p.hh;
        p.vy = -CFG.jumpVel * 0.55;
        p.squash = 0.72;
      }
    } else if (this.state === 'dead') {
      p.vy = Math.min(1400, p.vy + CFG.gravity * dt);
      p.y += p.vy * dt;
      p.spin += dt * 8;
    }
  },
  render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0e1526';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let ox = 0, oy = 0;
    if (this.shake > 0) { ox = rand(-4, 4) * this.shake; oy = rand(-4, 4) * this.shake; }
    ctx.setTransform(viewScale, 0, 0, viewScale, viewOX + ox * viewScale, viewOY + oy * viewScale);
    BG.draw(Camera.y, Score.meters, this.time);
    ctx.save();
    ctx.translate(0, -Camera.y);
    this.platforms.draw();
    Items.draw();
    this.player.draw();
    ctx.restore();
    Particles.draw(Camera.y);
    UI.hud();
    if (this.state === 'menu') UI.menu(this.time);
    else if (this.state === 'dead') UI.dead();
    if (this.paused) UI.paused();
  },
};

/* ---------------- main loop ---------------- */
let lastT = null, acc = 0;
const STEP = 1 / 120;
function frame(tMs) {
  requestAnimationFrame(frame);
  if (lastT === null) lastT = tMs;
  let dt = (tMs - lastT) / 1000;
  lastT = tMs;
  dt = Math.min(dt, 0.05);
  if (!Game.paused) {
    acc += dt;
    while (acc >= STEP) { Game.step(STEP); acc -= STEP; }
  } else acc = 0;
  Game.render();
}

Input.attach();
Score.load();
resize();
BG.reset();
Game.platforms.reset();
Game.player.reset();
addEventListener('resize', resize);
requestAnimationFrame(frame);

if (typeof globalThis !== 'undefined') {
  globalThis.__CFG__ = CFG;
  globalThis.__GAME__ = Game;
  globalThis.__SCORE__ = Score;
  globalThis.__PARTICLES__ = Particles;
  globalThis.__FX__ = FX;
  globalThis.__ITEMS__ = Items;
  globalThis.__ITEM__ = Item;
  globalThis.__CAMERA__ = Camera;
  globalThis.__PLATFORM__ = Platform;
  globalThis.__PTYPES__ = PTYPES;
  globalThis.__MUSIC__ = Music;
}
