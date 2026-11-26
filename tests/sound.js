'use strict';

/**
 * 音效 + BGM 引擎测试（第六十九~七十轮）
 * ------------------------------------------------------------------
 * 重点不是「能发声」（Node 里没有音频设备），而是这些不变量：
 *   1. 无 wx / 无 createWebAudioContext 时必须静默降级，绝不抛错；
 *   2. 音效与音乐开关互不干扰，且各自持久化；
 *   3. 上下文和 BGM 调度器不能重复创建 / 泄漏；
 *   4. 音效定义与 BGM 和弦进行本身要合法（频率、音量、时长）。
 */

const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOUND_PATH = path.join(ROOT, 'utils', 'sound.js');

/* 每次 require 都拿到干净模块，避免测试间互相污染 */
function fresh() {
  delete require.cache[require.resolve(SOUND_PATH)];
  return require(SOUND_PATH);
}

/* 构造一个假的 WebAudio 上下文，记录所有调用 */
function makeFakeWx() {
  const calls = { osc: [], gain: [], started: 0, stopped: 0, closed: 0, created: 0 };
  const fakeCtx = {
    currentTime: 0,
    destination: { id: 'dest' },
    createOscillator() {
      const o = {
        type: '',
        frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
        start() { calls.started += 1; },
        stop() { calls.stopped += 1; }
      };
      calls.osc.push(o);
      return o;
    },
    createGain() {
      const g = {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {}
      };
      calls.gain.push(g);
      return g;
    },
    close() { calls.closed += 1; }
  };
  const store = {};
  const wx = {
    createWebAudioContext() { calls.created += 1; return fakeCtx; },
    getStorageSync(k) { return store[k] === undefined ? '' : store[k]; },
    setStorageSync(k, v) { store[k] = v; }
  };
  return { wx: wx, calls: calls, store: store };
}

/* ---------- 1. 无 wx 环境静默降级 ---------- */

(function () {
  delete global.wx;
  const S = fresh();
  S.init();
  S.play('takeGem');
  S.play('nonexistent-sound');    // 未知音效不能炸
  S.startBgm('lobby');            // 无 API 时 startBgm 应静默返回
  assert.equal(S.isBgmPlaying(), false, '无 API 时 BGM 不应进入播放态');
  S.setSfxMuted(true);
  S.setBgmMuted(true);
  assert.equal(S.isSfxMuted(), true);
  assert.equal(S.isBgmMuted(), true);
  S.stopBgm();
  S.destroy();
  console.log('OK  降级 · 无 wx 环境全部静默不抛错');
})();

/* ---------- 2. 音效合成与上下文复用 ---------- */

(function () {
  const f = makeFakeWx();
  global.wx = f.wx;
  const S = fresh();
  S.init();

  S.play('buyCard');
  assert.equal(f.calls.created, 1, '首次播放应建上下文');
  assert.equal(f.calls.osc.length, 2, 'buyCard 应合成两个音');
  assert.equal(f.calls.started, 2, '两个音都应 start');

  S.play('win');
  assert.equal(f.calls.created, 1, '上下文必须复用');
  assert.equal(f.calls.osc.length, 7, 'win 应再合成五个音');

  S.destroy();
  assert.equal(f.calls.closed, 1, 'destroy 应关闭上下文');
  global.wx = undefined;
  console.log('OK  音效 · 合成正确 / 上下文复用 / destroy 释放');
})();

/* ---------- 3. 音效开关与音乐开关互不干扰 ---------- */

(function () {
  const f = makeFakeWx();
  global.wx = f.wx;
  const S = fresh();
  S.init();

  // 只关音效：音乐应照常
  S.setSfxMuted(true);
  assert.equal(f.store['sfx_muted'], 1, '音效静音应写入 sfx_muted');
  S.play('takeGem');
  assert.equal(f.calls.osc.length, 0, '音效静音时不该合成');
  S.startBgm('lobby');
  assert.equal(S.isBgmPlaying(), true, '关音效不应影响音乐');

  // 关音乐：应停止播放，且不影响音效开关状态
  S.setBgmMuted(true);
  assert.equal(f.store['bgm_muted'], 1, '音乐静音应写入 bgm_muted');
  assert.equal(S.isBgmPlaying(), false, '关音乐应停止 BGM');
  assert.equal(S.isSfxMuted(), true, '关音乐不应改到音效状态');

  // 重新开音效：能播
  S.setSfxMuted(false);
  S.play('takeGem');
  assert(f.calls.osc.length > 0, '重新开启音效应能播放');

  // 持久化读回
  const S2 = fresh();
  S2.init();
  assert.equal(S2.isBgmMuted(), true, '音乐静音状态应持久化');
  assert.equal(S2.isSfxMuted(), false, '音效状态应持久化');

  S.destroy();
  global.wx = undefined;
  console.log('OK  开关 · 音效/音乐独立 / 互不干扰 / 各自持久化');
})();

/* ---------- 4. BGM 调度：和弦轮换、定时器单例 ---------- */

(function () {
  const f = makeFakeWx();
  global.wx = f.wx;
  // 用可控的 setInterval 捕获回调，手动触发以观察调度行为
  const timers = [];
  const realSetInterval = global.setInterval;
  const realClearInterval = global.clearInterval;
  global.setInterval = function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; };
  global.clearInterval = function () {};

  const S = fresh();
  S.init();
  S.startBgm('lobby');

  assert.equal(timers.length, 1, 'startBgm 应只注册一个定时器');
  assert.equal(timers[0].ms, S.BGM.barSeconds * 1000, '定时间隔应等于小节长度');
  // 立即排过一小节：低音 + 3 琶音 + 1 点缀 = 5 个音
  assert.equal(f.calls.osc.length, 5, '首小节应合成 5 个音（低音+3琶音+点缀）');

  // 重复调用不该叠加定时器
  S.startBgm('board');
  assert.equal(timers.length, 1, 'startBgm 必须幂等，不能重复注册定时器');

  // 手动推进两小节，验证和弦在轮换（不同小节用的根音不同）
  timers[0].fn();
  timers[0].fn();
  assert.equal(f.calls.osc.length, 15, '三小节共 15 个音');

  S.stopBgm();
  assert.equal(S.isBgmPlaying(), false, 'stopBgm 后应停止');

  global.setInterval = realSetInterval;
  global.clearInterval = realClearInterval;
  S.destroy();
  global.wx = undefined;
  console.log('OK  BGM · 定时器单例 / 首小节立即出声 / 和弦逐小节调度 / stop 幂等');
})();

/* ---------- 5. BGM 关掉后 startBgm 不应再启动 ---------- */

(function () {
  const f = makeFakeWx();
  global.wx = f.wx;
  const S = fresh();
  S.init();
  S.setBgmMuted(true);
  S.startBgm('lobby');
  assert.equal(S.isBgmPlaying(), false, '音乐静音时 startBgm 应直接返回');
  S.destroy();
  global.wx = undefined;
  console.log('OK  BGM · 静音时拒绝启动');
})();

/* ---------- 6. 上下文创建失败后不反复重试 ---------- */

(function () {
  let attempts = 0;
  global.wx = {
    createWebAudioContext() { attempts += 1; throw new Error('audio unavailable'); },
    getStorageSync() { return ''; },
    setStorageSync() {}
  };
  const S = fresh();
  S.init();
  S.play('takeGem');
  S.play('takeGem');
  S.startBgm('lobby');
  assert.equal(attempts, 1, '创建失败后应记住失败，不反复重试');
  S.destroy();
  global.wx = undefined;
  console.log('OK  降级 · 上下文创建失败只尝试一次');
})();

/* ---------- 7. 音效定义合法性 ---------- */

(function () {
  const S = fresh();
  const names = Object.keys(S.SOUNDS);
  assert(names.length >= 15, '至少 15 个音效（9 动作 + 6 交互），实际 ' + names.length);

  names.forEach(function (name) {
    const def = S.SOUNDS[name];
    assert(Array.isArray(def.steps) && def.steps.length > 0, name + ' 必须有 steps');
    def.steps.forEach(function (s, i) {
      assert(typeof s.freq === 'number' && s.freq > 0, name + '[' + i + '] 频率必须为正');
      assert(s.freq <= 8000, name + '[' + i + '] 频率过高会刺耳');
      assert(typeof s.dur === 'number' && s.dur > 0, name + '[' + i + '] 时长必须为正');
      assert(s.dur <= 1.2, name + '[' + i + '] 单音时长过长');
      assert(s.gain === undefined || (s.gain > 0 && s.gain <= 0.25),
        name + '[' + i + '] gain 超出安全区间（>0.25 会破音）');
      assert(s.to === undefined || s.to > 0, name + '[' + i + '] 滑音目标必须为正');
      assert(s.delay === undefined || s.delay >= 0, name + '[' + i + '] delay 不能为负');
    });
    const total = def.steps.reduce(function (m, s) {
      return Math.max(m, (s.delay || 0) + s.dur);
    }, 0);
    assert(total <= 1.5, name + ' 总时长 ' + total + 's 过长');
  });
  console.log('OK  音效 · ' + names.length + ' 个定义合法');
})();

/* ---------- 8. BGM 定义合法性 ---------- */

(function () {
  const S = fresh();
  const B = S.BGM;
  assert(typeof B.barSeconds === 'number' && B.barSeconds > 0.5, '小节长度应 > 0.5s');
  assert(B.progression.length >= 4, '和弦进行至少 4 个，否则循环太短会明显重复');

  /* 音量必须「单层控制」，且实际可闻。
   * 这里刻意校验「level × gains」的乘积而不是只看 level ——
   * 早期版本 level=0.045 且每音 gain=0.028，相乘后仅 0.00126（-58dB），
   * 真机完全听不见，但单看 level 却「很合规」。 */
  assert(B.level > 0 && B.level <= 1, 'BGM.level 应是 bgmGain 系数（≤1.0），当前 ' + B.level);
  assert(B.gains && typeof B.gains === 'object', 'BGM 必须用 gains 声明每个音的绝对增益');
  const ampBass = B.level * B.gains.bass;
  const ampArp = B.level * B.gains.arp;
  const ampSparkle = B.level * B.gains.sparkle;
  assert(ampArp >= 0.01, 'BGM 琶音实际振幅 ' + ampArp.toFixed(4) + ' 过低，真机听不到（检查是否双层衰减）');
  assert(ampBass <= 0.14, 'BGM 低音振幅 ' + ampBass.toFixed(3) + ' 过高，会盖住操作音效');
  assert(ampBass > ampArp && ampArp > ampSparkle, 'BGM 音量层级应为 低音 > 琶音 > 点缀');

  B.progression.forEach(function (chord, i) {
    assert(typeof chord.bass === 'number' && chord.bass > 0, '和弦 ' + i + ' 根音必须为正');
    assert(chord.bass >= 80 && chord.bass <= 250, '和弦 ' + i + ' 根音应在低音区（80~250Hz）');
    assert(Array.isArray(chord.arp) && chord.arp.length >= 3, '和弦 ' + i + ' 至少 3 个琶音');
    chord.arp.forEach(function (f) {
      assert(f > chord.bass, '和弦 ' + i + ' 琶音应高于根音');
      assert(f <= 2000, '和弦 ' + i + ' 琶音过高会尖');
    });
  });
  // 琶音偏移必须落在小节内且递增
  assert(B.arpOffsets.length >= 4, '琶音偏移至少 4 个');
  B.arpOffsets.forEach(function (o, i) {
    assert(o >= 0 && o < B.barSeconds, '琶音偏移 ' + i + ' 必须在小节内');
    if (i > 0) assert(o > B.arpOffsets[i - 1], '琶音偏移必须递增');
  });
  console.log('OK  BGM · ' + B.progression.length + ' 个和弦 / 实际振幅 bass ' + ampBass.toFixed(3) +
    ' arp ' + ampArp.toFixed(3) + ' / 小节 ' + B.barSeconds + 's 均合法');
})();

/* ---------- 9. 未 init 也能工作 ---------- */

(function () {
  const f = makeFakeWx();
  global.wx = f.wx;
  const S = fresh();
  S.play('takeGem');   // 故意不 init
  assert.equal(f.calls.osc.length, 1, '未 init 也应能播放');
  S.destroy();
  global.wx = undefined;
  console.log('OK  自愈 · 未 init 时仍可播放');
})();

console.log('ALL SOUND TESTS PASS');
