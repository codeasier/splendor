'use strict';

/**
 * 音效引擎 —— 代码合成，零音频文件、零包体占用。
 *
 * 为什么不用音频文件：
 *   主包已到 1910KB / 2048KB（余量 138KB），一套 8 个 MP3 会吃掉 100-200KB，
 *   直接触顶。改用 WebAudio 振荡器现场合成，包体增长为 0。
 *
 * 基础库要求：
 *   wx.createWebAudioContext 需基础库 ≥ 2.19.0（以官方文档核实）。
 *   低版本 / H5 预览 / Node 测试环境无此 API 时自动静默降级 —— 不抛错、
 *   不影响任何游戏逻辑，只是没有声音。
 *
 * 官方注意：音频上下文不会自动回收，页面 onUnload 必须调 destroy()。
 */

// 各音效定义：freq 起始频率、dur 时长、type 波形、to 滑到的目标频率、gain 峰值音量
// 合成音没有共鸣腔，音量不能开大，否则刺耳；0.08~0.18 是实测较舒服的区间。
const SOUNDS = {
  // 按钮 / 选牌：极短，高音，几乎只起确认作用
  tap: { steps: [{ freq: 660, dur: 0.05, type: 'sine', gain: 0.10 }] },

  // 拿筹码：上滑，听起来「获得」
  takeGem: { steps: [{ freq: 520, dur: 0.10, type: 'triangle', to: 780, gain: 0.14 }] },

  // 买卡：两音上行，比拿筹码更「值钱」
  buyCard: { steps: [
    { freq: 440, dur: 0.07, type: 'triangle', gain: 0.14 },
    { freq: 660, dur: 0.11, type: 'triangle', gain: 0.13, delay: 0.07 }
  ] },

  // 预留：下滑，听起来「收起来」
  reserve: { steps: [{ freq: 380, dur: 0.11, type: 'sine', to: 300, gain: 0.12 }] },

  // 贵族到访：四音琶音上行，有仪式感
  noble: { steps: [
    { freq: 523, dur: 0.12, type: 'sine', gain: 0.13 },
    { freq: 659, dur: 0.12, type: 'sine', gain: 0.13, delay: 0.09 },
    { freq: 784, dur: 0.14, type: 'sine', gain: 0.13, delay: 0.18 },
    { freq: 1047, dur: 0.18, type: 'sine', gain: 0.12, delay: 0.27 }
  ] },

  // 胜利：五音大调上行，拉长尾音
  win: { steps: [
    { freq: 523, dur: 0.15, type: 'triangle', gain: 0.15 },
    { freq: 659, dur: 0.15, type: 'triangle', gain: 0.15, delay: 0.11 },
    { freq: 784, dur: 0.15, type: 'triangle', gain: 0.15, delay: 0.22 },
    { freq: 1047, dur: 0.20, type: 'triangle', gain: 0.14, delay: 0.33 },
    { freq: 1319, dur: 0.30, type: 'triangle', gain: 0.13, delay: 0.44 }
  ] },

  // 失败：三音下行，收得干脆
  lose: { steps: [
    { freq: 392, dur: 0.18, type: 'sine', gain: 0.13 },
    { freq: 330, dur: 0.18, type: 'sine', gain: 0.13, delay: 0.14 },
    { freq: 262, dur: 0.28, type: 'sine', gain: 0.12, delay: 0.28 }
  ] },

  // 轮到你：方波，短促有「叮」的提醒感
  turn: { steps: [{ freq: 880, dur: 0.04, type: 'square', gain: 0.06 }] },

  // 非法操作：低频短促下挫
  error: { steps: [{ freq: 220, dur: 0.09, type: 'square', to: 180, gain: 0.07 }] }
};

const STORAGE_KEY = 'sfx_muted';

let ctx = null;
let muted = false;
let inited = false;
let failed = false;   // 初始化失败后不再重试，避免每帧反复尝试建上下文

function hasApi() {
  return typeof wx !== 'undefined' && typeof wx.createWebAudioContext === 'function';
}

/** 读取本地静音偏好；只在第一次调用时真正读存储 */
function init() {
  if (inited) return;
  inited = true;
  try {
    if (typeof wx !== 'undefined' && wx.getStorageSync) {
      muted = !!wx.getStorageSync(STORAGE_KEY);
    }
  } catch (e) { /* 存储读不到就用默认值 */ }
}

/**
 * 懒建上下文：第一次真正要播放时才创建。
 * 不在 onLoad 里建，避免用户从不听音效也白占一份音频资源。
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

/**
 * 合成单音：起音 + 指数衰减包络。
 * 包络是必须的 —— 直接 start/stop 会有明显爆音（咔哒声）。
 */
function playStep(c, step) {
  const startAt = c.currentTime + (step.delay || 0);
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
  // 起音 8ms 到峰值，再指数衰减到近零：听感干净且不爆音
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);

  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(startAt);
  osc.stop(startAt + dur + 0.02);
}

/**
 * 播放音效。
 * @param {string} name SOUNDS 里的键
 * 任何异常都被吞掉 —— 音频绝不能让游戏主流程中断。
 */
function play(name) {
  if (muted) return;
  const def = SOUNDS[name];
  if (!def) return;
  init();
  const c = ensureContext();
  if (!c) return;
  try {
    def.steps.forEach(function (s) { playStep(c, s); });
  } catch (e) {
    // 单次合成失败（如上下文被系统回收）不应静默永久失效
    failed = false;
    ctx = null;
  }
}

function setMuted(v) {
  muted = !!v;
  try {
    if (typeof wx !== 'undefined' && wx.setStorageSync) {
      wx.setStorageSync(STORAGE_KEY, muted ? 1 : 0);
    }
  } catch (e) { /* 存不下只影响下次启动的默认值 */ }
}

function toggle() {
  setMuted(!muted);
  return muted;
}

function isMuted() {
  init();
  return muted;
}

/**
 * 释放音频上下文。
 * 官方明确：音频资源不会自动回收，页面 onUnload / onHide 必须调用。
 */
function destroy() {
  if (ctx) {
    try { if (ctx.close) ctx.close(); } catch (e) { /* 已关闭则忽略 */ }
  }
  ctx = null;
  failed = false;
}

module.exports = {
  SOUNDS: SOUNDS,
  init: init,
  play: play,
  setMuted: setMuted,
  toggle: toggle,
  isMuted: isMuted,
  destroy: destroy
};
