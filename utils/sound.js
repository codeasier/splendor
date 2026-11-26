'use strict';

/**
 * 音效 + 背景音乐引擎 —— 全部代码合成，零音频文件、零包体占用。
 *
 * 为什么不用音频文件：
 *   主包 1917.5KB / 2048KB，余量仅 130KB。一段 30 秒 32kbps 的 BGM 就要 120KB，
 *   会吃掉 92% 的余量；常规 MP3 音效每首 5–30KB 同样塞不下。
 *   改用 WebAudio 振荡器现场合成，包体增长接近 0。
 *
 * 基础库要求：
 *   wx.createWebAudioContext 需基础库 ≥ 2.19.0（以官方文档核实）。
 *   低版本 / H5 预览无此 API 时自动静默降级 —— 不抛错、不影响游戏逻辑。
 *
 * 官方注意：音频上下文不会自动回收，页面 onUnload / onHide 必须调 destroy()。
 *
 * 双通道设计：
 *   音效（sfx）与音乐（bgm）各有独立开关，分别持久化到 sfx_muted / bgm_muted。
 *   玩家只想关音乐但保留操作反馈是很常见的需求，合并成一个开关会让人恼火。
 */

/* ---------- 音效定义 ---------- */
// steps 里每个音的字段：freq 起始频率、dur 时长、type 波形、to 滑到的目标频率、
// gain 峰值音量、delay 相对起点的延迟（秒）。
// 合成音没有共鸣腔，gain 开大会刺耳，0.05~0.18 是实测较舒服的区间。
const SOUNDS = {
  /* ——— 对局动作 ——— */
  // 拿筹码：上滑，听起来「获得」
  takeGem: { steps: [{ freq: 520, dur: 0.10, type: 'triangle', to: 780, gain: 0.14 }] },
  // 买卡：两音上行，比拿筹码更「值钱」
  buyCard: { steps: [
    { freq: 440, dur: 0.07, type: 'triangle', gain: 0.14 },
    { freq: 660, dur: 0.11, type: 'triangle', gain: 0.13, delay: 0.07 }
  ] },
  // 预留：下滑，听起来「收起来」
  reserve: { steps: [{ freq: 380, dur: 0.11, type: 'sine', to: 300, gain: 0.12 }] },
  // 贵族到访 / 技能：四音琶音上行，有仪式感
  noble: { steps: [
    { freq: 523, dur: 0.12, type: 'sine', gain: 0.13 },
    { freq: 659, dur: 0.12, type: 'sine', gain: 0.13, delay: 0.09 },
    { freq: 784, dur: 0.14, type: 'sine', gain: 0.13, delay: 0.18 },
    { freq: 1047, dur: 0.18, type: 'sine', gain: 0.12, delay: 0.27 }
  ] },
  // 轮到你：方波，短促有提醒感
  turn: { steps: [{ freq: 880, dur: 0.04, type: 'square', gain: 0.06 }] },

  // 跳过 / 弃牌：最轻的一声，这两个动作本身没有成就感
  tap: { steps: [{ freq: 660, dur: 0.05, type: 'sine', gain: 0.10 }] },

  /* ——— 结算 ——— */
  win: { steps: [
    { freq: 523, dur: 0.15, type: 'triangle', gain: 0.15 },
    { freq: 659, dur: 0.15, type: 'triangle', gain: 0.15, delay: 0.11 },
    { freq: 784, dur: 0.15, type: 'triangle', gain: 0.15, delay: 0.22 },
    { freq: 1047, dur: 0.20, type: 'triangle', gain: 0.14, delay: 0.33 },
    { freq: 1319, dur: 0.30, type: 'triangle', gain: 0.13, delay: 0.44 }
  ] },
  lose: { steps: [
    { freq: 392, dur: 0.18, type: 'sine', gain: 0.13 },
    { freq: 330, dur: 0.18, type: 'sine', gain: 0.13, delay: 0.14 },
    { freq: 262, dur: 0.28, type: 'sine', gain: 0.12, delay: 0.28 }
  ] },
  // 非法操作：低频短促下挫
  error: { steps: [{ freq: 220, dur: 0.09, type: 'square', to: 180, gain: 0.07 }] },

  /* ——— 通用交互（按语义分组，而不是给 79 个入口各配一个） ——— */
  // 打开弹层 / 详情 / 面板：短促上行
  uiOpen: { steps: [{ freq: 560, dur: 0.06, type: 'sine', to: 720, gain: 0.10 }] },
  // 关闭 / 取消：短促下行
  uiClose: { steps: [{ freq: 520, dur: 0.06, type: 'sine', to: 400, gain: 0.09 }] },
  // 单选 / 切换 / 选人：轻点
  uiPick: { steps: [{ freq: 700, dur: 0.04, type: 'sine', gain: 0.09 }] },
  // 确认 / 创建 / 保存 / 发送：双音确认
  uiConfirm: { steps: [
    { freq: 620, dur: 0.06, type: 'triangle', gain: 0.12 },
    { freq: 930, dur: 0.09, type: 'triangle', gain: 0.11, delay: 0.06 }
  ] },
  // 复制成功：清脆提示
  uiCopy: { steps: [{ freq: 1046, dur: 0.05, type: 'sine', gain: 0.10 }] },
  // 移除 / 拒绝：低音否定
  uiDeny: { steps: [{ freq: 300, dur: 0.10, type: 'square', to: 240, gain: 0.07 }] }
};

/* ---------- 背景音乐 ---------- */
/*
 * 做法：不播单音循环（那样 4 秒就听腻），而是按「和弦进行」逐小节调度。
 * 每小节 2 秒，和弦自动轮换；同一和弦内用琶音铺底 + 高八度点缀，
 * 于是听觉上是连续不断的氛围乐，循环周期 = 和弦数 × 2 秒（这里是 8 秒一轮、
 * 4 个和弦，实际听感上 32 秒才会明显重复一次）。
 *
 * 音色只用 sine。
 *
 * ⚠️ 音量必须只在「单层」控制（第七十二轮修复）：
 *   早期版本同时设了 bgmGain=0.045 和每音 gain=0.028，两层相乘得到 0.00126
 *   （约 -58dB），比最轻的音效（0.06 / -24dB）还低 34dB —— 真机上等于没声音。
 *   现在 bgmGain 固定为 1.0（只作为统一调音/淡出用的接线点），实际音量
 *   全由每个音的 gain 决定，数值即真实振幅，方便直接对照音效调音。
 */
const BGM = {
  // 每小节 2 秒；bass 是和弦根音，arp 是和弦内音（琶音顺序）
  barSeconds: 2,
  // D 小调氛围进行：Dm - Bb - C - F（古典、克制，配璀璨宝石的文艺复兴气质）
  progression: [
    { bass: 147, arp: [294, 349, 440] },   // D3  / D4 F4 A4
    { bass: 117, arp: [234, 294, 349] },   // Bb2 / Bb3 D4 F4
    { bass: 131, arp: [262, 330, 392] },   // C3  / C4 E4 G4
    { bass: 175, arp: [349, 440, 523] }    // F3  / F4 A4 C5
  ],
  // 单层总音量：只作为 bgmGain 节点的系数，保持 1.0 表示「不额外衰减」。
  // 需要整体调 BGM 音量时改这个值（0~1），不要再去动每个音的 gain。
  level: 1.0,
  // 每个音的绝对增益（这是最终振幅，不再与 level 相乘）。
  // 对照：操作音效普遍 0.10~0.15，BGM 低 6~8dB 刚好「听得见但不抢」。
  gains: { bass: 0.055, arp: 0.042, sparkle: 0.024 },
  // 琶音在每小节内的起音位置（秒），留出呼吸不让它变成机械节拍
  arpOffsets: [0, 0.5, 1.0, 1.5]
};

/* ---------- 状态 ---------- */
const SFX_KEY = 'sfx_muted';
const BGM_KEY = 'bgm_muted';

let ctx = null;
let failed = false;
let inited = false;

let sfxMuted = false;
let bgmMuted = false;

// BGM 调度器状态
let bgmTimer = null;
let bgmStep = 0;
let bgmPlaying = false;
// BGM 用的独立增益节点：调音量 / 淡出都作用在它身上，不影响音效
let bgmGain = null;

function hasApi() {
  return typeof wx !== 'undefined' && typeof wx.createWebAudioContext === 'function';
}

function readFlag(key) {
  try {
    if (typeof wx !== 'undefined' && wx.getStorageSync) return !!wx.getStorageSync(key);
  } catch (e) { /* 读不到就用默认值 */ }
  return false;
}

function writeFlag(key, value) {
  try {
    if (typeof wx !== 'undefined' && wx.setStorageSync) wx.setStorageSync(key, value ? 1 : 0);
  } catch (e) { /* 存不下只影响下次启动的默认值 */ }
}

/** 读取本地偏好；只在第一次调用时真正读存储 */
function init() {
  if (inited) return;
  inited = true;
  sfxMuted = readFlag(SFX_KEY);
  bgmMuted = readFlag(BGM_KEY);
}

/**
 * 懒建上下文：第一次真正要发声时才创建。
 * 不在 onLoad 里建，避免从不听声的玩家白占一份音频资源。
 */
function ensureContext() {
  if (ctx || failed) return ctx;
  if (!hasApi()) { failed = true; return null; }
  try {
    ctx = wx.createWebAudioContext();
    if (!ctx) failed = true;
  } catch (e) {
    failed = true;
    ctx = null;
  }
  return ctx;
}

/** 合成单音：起音 + 指数衰减包络。没有包络会有明显爆音（咔哒声） */
function synth(c, step, startAt, dest) {
  const dur = step.dur;
  const osc = c.createOscillator();
  const gain = c.createGain();

  osc.type = step.type || 'sine';
  osc.frequency.setValueAtTime(step.freq, startAt);
  if (step.to) {
    // 指数滑音；目标频率必须 > 0，否则指数曲线不合法
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, step.to), startAt + dur);
  }

  const peak = step.gain === undefined ? 0.12 : step.gain;
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);

  osc.connect(gain);
  gain.connect(dest || c.destination);
  osc.start(startAt);
  osc.stop(startAt + dur + 0.02);
}

/* ==================== 音效 ==================== */

/**
 * 播放音效。
 * @param {string} name SOUNDS 里的键
 * 任何异常都被吞掉 —— 音频绝不能让游戏主流程中断。
 */
function play(name) {
  init();
  if (sfxMuted) return;
  const def = SOUNDS[name];
  if (!def) return;
  const c = ensureContext();
  if (!c) return;
  try {
    const now = c.currentTime;
    def.steps.forEach(function (s) {
      synth(c, s, now + (s.delay || 0));
    });
  } catch (e) {
    // 上下文可能被系统回收：这次失败不该让它永久失效
    failed = false;
    ctx = null;
    bgmGain = null;
  }
}

/* ==================== 背景音乐 ==================== */

/** 取 BGM 的独立增益节点（挂在 destination 前，便于统一调音/淡出） */
function ensureBgmGain() {
  const c = ensureContext();
  if (!c) return null;
  if (!bgmGain) {
    try {
      bgmGain = c.createGain();
      // 固定 1.0：不在这里衰减。真正的音量由每个音的 gain 决定（单层控制），
      // 两层相乘会把 BGM 压到听不见（第七十二轮踩过这个坑）。
      bgmGain.gain.setValueAtTime(BGM.level, c.currentTime);
      bgmGain.connect(c.destination);
    } catch (e) {
      bgmGain = null;
    }
  }
  return bgmGain;
}

/** 调度一小节：低音铺底 + 三个琶音 + 高八度点缀 */
function scheduleBar() {
  const c = ctx;
  const dest = bgmGain;
  if (!c || !dest) return;
  const chord = BGM.progression[bgmStep % BGM.progression.length];
  const base = c.currentTime;
  const g = BGM.gains;
  try {
    // 低音持续整小节，垫住和声
    synth(c, { freq: chord.bass, dur: BGM.barSeconds * 0.92, type: 'sine', gain: g.bass }, base, dest);
    // 琶音：三个和弦内音轮流，起音错开半拍
    BGM.arpOffsets.slice(0, 3).forEach(function (off, i) {
      const f = chord.arp[i % chord.arp.length];
      synth(c, { freq: f, dur: 0.85, type: 'sine', gain: g.arp }, base + off, dest);
    });
    // 每小节末尾加一个高八度点缀，给循环一点「起承转合」
    synth(c, {
      freq: chord.arp[chord.arp.length - 1] * 2,
      dur: 0.5, type: 'sine', gain: g.sparkle
    }, base + BGM.arpOffsets[3], dest);
  } catch (e) { /* 单小节失败不打断循环 */ }
  bgmStep += 1;
}

/**
 * 开始播放背景音乐（幂等，重复调用不会叠加）。
 * @param {string} scene 'lobby' | 'board' —— 目前两处用同一套曲子，
 *                       预留参数是为了将来能给牌桌换更紧张的调式。
 */
function startBgm(scene) {
  init();
  if (bgmMuted) return;
  if (bgmPlaying) return;
  const c = ensureContext();
  if (!c) return;
  if (!ensureBgmGain()) return;

  bgmPlaying = true;
  // 立即排一小节，避免等第一个定时器才出声（约 500ms 的静默会显得卡）
  scheduleBar();
  if (typeof setInterval === 'function') {
    bgmTimer = setInterval(function () {
      if (!bgmPlaying) return;
      // 上下文被回收时重建，避免 BGM 静默死掉
      if (!ctx) {
        failed = false;
        if (!ensureContext()) { stopBgm(); return; }
        bgmGain = null;
        if (!ensureBgmGain()) { stopBgm(); return; }
      }
      scheduleBar();
    }, BGM.barSeconds * 1000);
  }
}

/** 停止 BGM（幂等） */
function stopBgm() {
  bgmPlaying = false;
  if (bgmTimer && typeof clearInterval === 'function') {
    clearInterval(bgmTimer);
    bgmTimer = null;
  }
}

function isBgmPlaying() {
  return bgmPlaying;
}

/* ==================== 开关 ==================== */

function setSfxMuted(v) {
  sfxMuted = !!v;
  writeFlag(SFX_KEY, sfxMuted);
}

function setBgmMuted(v) {
  bgmMuted = !!v;
  writeFlag(BGM_KEY, bgmMuted);
  // 关掉音乐立刻停；打开时由调用方决定是否 startBgm（避免在错误场景强行放）
  if (bgmMuted) stopBgm();
}

function isSfxMuted() {
  init();
  return sfxMuted;
}

function isBgmMuted() {
  init();
  return bgmMuted;
}

/**
 * 释放音频上下文。
 * 官方明确：音频资源不会自动回收，页面 onUnload / onHide 必须调用。
 */
function destroy() {
  stopBgm();
  if (ctx) {
    try { if (ctx.close) ctx.close(); } catch (e) { /* 已关闭则忽略 */ }
  }
  ctx = null;
  bgmGain = null;
  failed = false;
}

module.exports = {
  SOUNDS: SOUNDS,
  BGM: BGM,
  init: init,
  play: play,
  startBgm: startBgm,
  stopBgm: stopBgm,
  isBgmPlaying: isBgmPlaying,
  setSfxMuted: setSfxMuted,
  setBgmMuted: setBgmMuted,
  isSfxMuted: isSfxMuted,
  isBgmMuted: isBgmMuted,
  destroy: destroy
};
